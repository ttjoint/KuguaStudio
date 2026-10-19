/**
 * 模块配置服务
 *
 * 职责：
 *  1. 按模块名读写 `kugua.config.json` 里的对应节
 *  2. **凭据隔离**：`凭据: true` 的字段写进 `kugua.config.local.json`
 *  3. 点号路径读写（`engines.voxcpm.url`）
 *  4. 合并 local 覆盖层后推送完整配置给模块
 *  5. 双向推送：平台改 → 推给模块；模块改 → 平台写盘 → 广播所有模块
 *
 * 平台**不理解字段含义**，只负责存储、校验类型、隔离凭据。
 */

import { existsSync, readFileSync, renameSync, writeFileSync } from "node:fs";
import { resolve } from "node:path";
import type { 配置声明, 配置字段声明, 配置字段类型, 配置载荷 } from "@kugua/nigane";

/** 主配置文件路径 */
export function 主配置路径(): string {
  return process.env.KUGUA_CONFIG
    ? resolve(process.cwd(), process.env.KUGUA_CONFIG)
    : resolve(process.cwd(), "kugua.config.json");
}

/** 本地私有覆盖文件路径（已 gitignore，用来放凭据） */
export function 本地配置路径(): string {
  // 必须认 KUGUA_CONFIG_LOCAL，与主配置对 KUGUA_CONFIG 的处理保持一致。
  //
  // 原先这里硬编码 cwd/kugua.config.local.json，于是设了环境变量也不生效：
  // 主控照样去读 cwd 下那个文件（多半不存在 → 静默空对象），
  // 凭据层整层丢失，而用户完全看不出哪里错了——界面上只是「未配置」。
  // 隔离测试、多实例、便携模式都靠这个环境变量把私有层指到别处。
  return process.env.KUGUA_CONFIG_LOCAL
    ? resolve(process.cwd(), process.env.KUGUA_CONFIG_LOCAL)
    : resolve(process.cwd(), "kugua.config.local.json");
}

/** 读 JSON 文件，失败返回空对象 */
function 读JSON(路径: string): Record<string, unknown> {
  if (!existsSync(路径)) return {};
  try {
    const v = JSON.parse(readFileSync(路径, "utf-8"));
    return v && typeof v === "object" ? (v as Record<string, unknown>) : {};
  } catch {
    return {};
  }
}

/** 原子写 JSON */
function 写JSON(路径: string, 对象: unknown): void {
  const 临时 = `${路径}.tmp`;
  writeFileSync(临时, JSON.stringify(对象, null, 2) + "\n", "utf-8");
  renameSync(临时, 路径);
}

/** 按点号路径取值；路径不存在返回 undefined */
export function 路径取值(对象: Record<string, unknown>, 路径: string): unknown {
  const 段 = 路径.split(".").filter(Boolean);
  let 当前: unknown = 对象;
  for (const 键 of 段) {
    if (!当前 || typeof 当前 !== "object") return undefined;
    当前 = (当前 as Record<string, unknown>)[键];
  }
  return 当前;
}

/** 按点号路径写值（自动创建中间对象） */
export function 路径写值(对象: Record<string, unknown>, 路径: string, 值: unknown): void {
  const 段 = 路径.split(".").filter(Boolean);
  if (段.length === 0) return;
  let 当前: Record<string, unknown> = 对象;
  for (let i = 0; i < 段.length - 1; i++) {
    const 键 = 段[i];
    const 下 = 当前[键];
    if (!下 || typeof 下 !== "object" || Array.isArray(下)) 当前[键] = {};
    当前 = 当前[键] as Record<string, unknown>;
  }
  当前[段[段.length - 1]] = 值;
}

/** 按点号路径删除值（用于清除凭据时清理空壳对象） */
export function 路径删值(对象: Record<string, unknown>, 路径: string): void {
  const 段 = 路径.split(".").filter(Boolean);
  if (段.length === 0) return;
  const 链: Array<{ 父: Record<string, unknown>; 键: string }> = [];
  let 当前: Record<string, unknown> = 对象;
  for (let i = 0; i < 段.length - 1; i++) {
    const 下 = 当前[段[i]];
    if (!下 || typeof 下 !== "object") return;
    链.push({ 父: 当前, 键: 段[i] });
    当前 = 下 as Record<string, unknown>;
  }
  delete 当前[段[段.length - 1]];
  // 自底向上清理变空的中间对象
  for (let i = 链.length - 1; i >= 0; i--) {
    const { 父, 键 } = 链[i];
    const 子 = 父[键];
    if (子 && typeof 子 === "object" && Object.keys(子 as object).length === 0) delete 父[键];
    else break;
  }
}

/** 深合并：后者覆盖前者，数组整体替换 */
export function 深合并(基: unknown, 覆盖: unknown): unknown {
  if (
    覆盖 &&
    typeof 覆盖 === "object" &&
    !Array.isArray(覆盖) &&
    基 &&
    typeof 基 === "object" &&
    !Array.isArray(基)
  ) {
    const 结果: Record<string, unknown> = { ...(基 as Record<string, unknown>) };
    for (const [键, 值] of Object.entries(覆盖 as Record<string, unknown>)) {
      结果[键] = 键 in 结果 ? 深合并(结果[键], 值) : 值;
    }
    return 结果;
  }
  return 覆盖 === undefined ? 基 : 覆盖;
}

/** 按声明校验并强制类型转换；类型不符抛错 */
export function 校验值(声明: 配置字段声明, 值: unknown): unknown {
  const 类型: 配置字段类型 = 声明.类型 ?? "string";
  if (值 === null || 值 === undefined) {
    if (声明.必填) throw new Error(`「${声明.标题}」不能为空`);
    return 类型 === "array" ? [] : undefined;
  }
  switch (类型) {
    case "number": {
      const n = typeof 值 === "number" ? 值 : Number(值);
      if (!Number.isFinite(n)) throw new Error(`「${声明.标题}」必须是数字`);
      if (typeof 声明.最小 === "number" && n < 声明.最小) throw new Error(`「${声明.标题}」不能小于 ${声明.最小}`);
      if (typeof 声明.最大 === "number" && n > 声明.最大) throw new Error(`「${声明.标题}」不能大于 ${声明.最大}`);
      return n;
    }
    case "boolean":
      if (typeof 值 === "boolean") return 值;
      if (值 === "true" || 值 === 1 || 值 === "1") return true;
      if (值 === "false" || 值 === 0 || 值 === "0") return false;
      throw new Error(`「${声明.标题}」必须是布尔值`);
    case "array": {
      if (!Array.isArray(值)) throw new Error(`「${声明.标题}」必须是数组`);
      // 对象数组：按列声明校验每个元素
      const 元素类型 = 声明.数组?.元素 ?? "string";
      if (元素类型 === "object") {
        const 列 = 声明.数组?.列 ?? [];
        return 值.map((项, i) => {
          if (!项 || typeof 项 !== "object") throw new Error(`「${声明.标题}」第 ${i + 1} 项必须是对象`);
          const 行: Record<string, unknown> = {};
          for (const 列声明 of 列) {
            const 原始 = (项 as Record<string, unknown>)[列声明.键];
            const 结果 = 校验值(列声明, 原始);
            if (结果 !== undefined) 行[列声明.键] = 结果;
          }
          return 行;
        });
      }
      return 值.map((项) => String(项));
    }
    case "select": {
      const s = String(值);
      const 允许 = (声明.选项 ?? []).map((o) => (typeof o === "string" ? o : o.值));
      if (允许.length > 0 && !允许.includes(s)) {
        throw new Error(`「${声明.标题}」取值必须是 ${允许.join(" / ")} 之一`);
      }
      return s;
    }
    default:
      return String(值);
  }
}

/**
 * 把扁平的点号键表单值还原成嵌套对象。
 *
 * 例如 `{ "engines.voxcpm.url": "http://x" }` → `{ engines: { voxcpm: { url: "http://x" } } }`
 */
export function 展开表单(表单: Record<string, unknown>): Record<string, unknown> {
  const 结果: Record<string, unknown> = {};
  for (const [键, 值] of Object.entries(表单)) 路径写值(结果, 键, 值);
  return 结果;
}

/** 读取某模块在两层配置里合并后的值 */
export function 读取模块配置(模块名: string): Record<string, unknown> {
  const 主 = 读JSON(主配置路径())[模块名];
  const 覆盖 = 读JSON(本地配置路径())[模块名];
  const 合并后 = 深合并(主 ?? {}, 覆盖 ?? {});
  if (!合并后 || typeof 合并后 !== "object") return {};
  // 数组里的凭据是分行存的，深合并做不到「按行补列」，需按声明再合一次
  const 声明 = 取声明(模块名);
  const 结果 = 合并后 as Record<string, unknown>;
  for (const f of 声明?.字段 ?? []) {
    if (f.类型 !== "array" || f.数组?.元素 !== "object") continue;
    // 公开层必须从主配置取，不能从 深合并 的结果取——数组是整体替换的，
    // 合并后的数组其实已经是凭据层（里面没有 name/baseUrl），
    // 拿它当公开层会把公开字段全丢掉。
    const 公开层 = 主 && typeof 主 === "object" ? (主 as Record<string, unknown>)[f.键] : undefined;
    const 凭据层 = 覆盖 && typeof 覆盖 === "object" ? (覆盖 as Record<string, unknown>)[f.键] : undefined;
    if (Array.isArray(公开层)) {
      const 主键 = f.数组.列?.[0]?.键;
      结果[f.键] = Array.isArray(凭据层) ? 合并凭据(公开层, 凭据层, 主键) : 公开层;
    }
  }
  return 结果;
}

/** 读取主配置里某模块的原始节点（不含覆盖层） */
export function 读取主节点(模块名: string): Record<string, unknown> {
  const 值 = 读JSON(主配置路径())[模块名];
  return 值 && typeof 值 === "object" ? (值 as Record<string, unknown>) : {};
}

/** 读取本地覆盖里某模块的原始节点 */
export function 读取覆盖节点(模块名: string): Record<string, unknown> {
  const 值 = 读JSON(本地配置路径())[模块名];
  return 值 && typeof 值 === "object" ? (值 as Record<string, unknown>) : {};
}


/**
 * 把一份「公开值」与「凭据值」按声明拆分。
 *
 * 顶层凭据字段很好处理（键名对得上就行），真正的问题是**数组里的对象**：
 * `providers[0].apiKey` 属于哪一层？答案取决于列声明里的 `凭据: true`。
 *
 * 如果不做这件事，一个声明了凭据的列会把密码写进 `kugua.config.json`，
 * 也就是**进版本库**——凭据隔离形同虚设。
 *
 * @returns `公开` 可安全提交；`凭据` 只能进 local 文件
 */
export function 拆分凭据(
  声明: 配置声明 | undefined,
  值: unknown,
  路径: string[] = [],
): { 公开: unknown; 凭据: unknown } {
  const 字段 = 声明?.字段?.find((f) => f.键 === 路径[0]);

  // 数组的对象元素：逐行逐列拆分。
  // 注意判断顺序——数组字段的键本身长度就是 1，必须先于「顶层凭据」判断，
  // 否则 providers 会被当成普通顶层字段整个写进主配置。
  if (路径.length === 1 && 字段?.类型 === "array" && 字段.数组?.元素 === "object") {
    if (!Array.isArray(值)) return { 公开: 值, 凭据: undefined };
    const 列 = 字段.数组.列 ?? [];
    // 每一行拆成 公开行 / 凭据行；凭据行按索引对齐，便于合并回来
    const 公开行: Array<Record<string, unknown>> = [];
    const 凭据行: Array<Record<string, unknown>> = [];
    let 有凭据 = false;
    for (const 项 of 值) {
      const 行 = (项 && typeof 项 === "object" ? 项 : {}) as Record<string, unknown>;
      const 公: Record<string, unknown> = {};
      const 密: Record<string, unknown> = {};
      // 第一列视作主键（如 provider 的 name）。凭据层必须带上它，
      // 否则读取时无法把密钥对回正确的行——只写 apiKey 的话，
      // 模块按名称合并会匹配不到，密钥等于丢失。
      const 主键列 = 列[0]?.键;
      for (const [键, 列值] of Object.entries(行)) {
        const 列声明 = 列.find((c) => c.键 === 键);
        if (列声明?.凭据 === true) {
          密[键] = 列值;
          if (主键列 && 行[主键列] !== undefined) 密[主键列] = 行[主键列];
          有凭据 = true;
        } else {
          公[键] = 列值;
        }
      }
      公开行.push(公);
      凭据行.push(密);
    }
    return { 公开: 公开行, 凭据: 有凭据 ? 凭据行 : undefined };
  }

  // 顶层凭据字段
  if (路径.length === 1) {
    if (字段?.凭据 === true) return { 公开: undefined, 凭据: 值 };
    return { 公开: 值, 凭据: undefined };
  }

  return { 公开: 值, 凭据: undefined };
}

/**
 * 把公开层与凭据层按索引合并回来（读取时用）。
 *
 * 合并规则按「行位置」而不是「名称列」——平台不该知道哪一列是主键。
 * 因此要求两层数组长度一致；不一致时以公开层为准（凭据层多余部分丢弃）。
 */
export function 合并凭据(
  公开: unknown,
  凭据: unknown,
  主键?: string,
): unknown {
  if (!Array.isArray(公开)) return 公开;
  if (!Array.isArray(凭据)) return 公开;

  // 有主键列时按主键对齐，避免用户删行 / 调序后密钥串行
  if (主键) {
    const 按主键 = new Map<string, Record<string, unknown>>();
    for (const 密 of 凭据) {
      if (!密 || typeof 密 !== "object") continue;
      const k = String((密 as Record<string, unknown>)[主键] ?? "");
      if (k) 按主键.set(k, 密 as Record<string, unknown>);
    }
    return 公开.map((项) => {
      if (!项 || typeof 项 !== "object") return 项;
      const 行 = 项 as Record<string, unknown>;
      const 密 = 按主键.get(String(行[主键] ?? ""));
      return 密 ? { ...行, ...密 } : 行;
    });
  }

  return 公开.map((项, i) => {
    const 密 = 凭据[i];
    if (!密 || typeof 密 !== "object") return 项;
    if (!项 || typeof 项 !== "object") return 项;
    return { ...(项 as Record<string, unknown>), ...(密 as Record<string, unknown>) };
  });
}

/**
 * 保存模块配置。
 *
 * @param 模块名     模块名，也就是配置里的顶层节名
 * @param 变更       扁平的表单值（点号键）
 * @param 声明       该模块上报的配置声明；不存在的键按普通字符串处理
 * @returns 实际变更的字段键列表
 */
export function 保存模块配置(模块名: string, 变更: Record<string, unknown>, 声明?: 配置声明): string[] {
  const 字段表 = new Map<string, 配置字段声明>();
  for (const f of 声明?.字段 ?? []) 字段表.set(f.键, f);

  const 主文件 = 读JSON(主配置路径());
  const 覆盖文件 = 读JSON(本地配置路径());
  const 主节点 = (主文件[模块名] as Record<string, unknown>) ?? {};
  const 覆盖节点 = (覆盖文件[模块名] as Record<string, unknown>) ?? {};

  const 实际变更: string[] = [];
  let 主是否改 = false;
  let 覆盖是否改 = false;

  for (const [键, 原始值] of Object.entries(变更)) {
    const 字段 = 字段表.get(键);
    const 值 = 字段 ? 校验值(字段, 原始值) : 原始值;

    // 凭据可能藏在顶层字段里，也可能藏在数组对象的某一列里，
    // 统一交给 拆分凭据() 判断，避免数组里的密钥漏进版本库。
    const { 公开, 凭据 } = 字段 ? 拆分凭据(声明, 值, 键.split(".").filter(Boolean)) : { 公开: 值, 凭据: undefined };

    const 写一层 = (
      目标: Record<string, unknown>,
      待写: unknown,
      是否凭据: boolean,
    ): boolean => {
      const 旧值 = 路径取值(目标, 键);
      if (JSON.stringify(旧值) === JSON.stringify(待写)) return false;
      if (待写 === undefined || 待写 === "") {
        路径删值(目标, 键);
      } else {
        路径写值(目标, 键, 待写);
      }
      return 是否凭据 ? (覆盖是否改 = true) : (主是否改 = true);
    };

    let 变了 = false;
    // 公开部分（凭据字段的公开部分为 undefined，跳过）
    if (!(字段?.凭据 === true) && 公开 !== undefined) 变了 = 写一层(主节点, 公开, false) || 变了;
    // 凭据部分
    if (凭据 !== undefined) 变了 = 写一层(覆盖节点, 凭据, true) || 变了;
    // 顶层凭据被清空（值变成 undefined）时也要把 local 里的旧值删掉
    if (字段?.凭据 === true && (值 === undefined || 值 === "")) {
      变了 = 写一层(覆盖节点, undefined, true) || 变了;
    }
    if (变了) 实际变更.push(键);
  }

  if (主是否改) {
    主文件[模块名] = 主节点;
    写JSON(主配置路径(), 主文件);
  }
  if (覆盖是否改) {
    if (Object.keys(覆盖节点).length === 0) delete 覆盖文件[模块名];
    else 覆盖文件[模块名] = 覆盖节点;
    写JSON(本地配置路径(), 覆盖文件);
  }
  return 实际变更;
}

/**
 * 给模块生成推送载荷。
 *
 * 推送的是**合并后的完整配置**（主配置 + local 覆盖），
 * 模块无需自己处理两层文件。
 */
export function 构造载荷(模块名: string, 来源: 配置载荷["来源"], 变更: string[]): 配置载荷 {
  return { 模块: 模块名, 配置: 读取模块配置(模块名), 来源, 变更 };
}

/**
 * 配置声明的合并维护表。
 *
 * 平台需要知道每个模块的字段声明，才能在模块离线时也正确渲染表单、
 * 判断哪些字段是凭据。声明随握手上报，此处缓存最近一次结果。
 */
const 声明表 = new Map<string, 配置声明>();

export function 记录声明(模块名: string, 声明: 配置声明 | undefined): void {
  if (声明 && Array.isArray(声明.字段)) 声明表.set(模块名, 声明);
}

export function 取声明(模块名: string): 配置声明 | undefined {
  return 声明表.get(模块名);
}

export function 全部声明(): Record<string, 配置声明> {
  return Object.fromEntries(声明表);
}

/** 测试用：清空声明缓存 */
export function 清空声明缓存(): void {
  声明表.clear();
}

/**
 * 生成前端的表单模型。
 *
 * 每个字段带上「当前值」（合并后）与「是否已设置凭据」，
 * 凭据字段**不回传明文**，只回 `已设置: true`。
 */
export function 构造表单模型(模块名: string): {
  模块: string;
  说明?: string;
  字段: Array<配置字段声明 & { 值: unknown; 已设置?: boolean }>;
} {
  const 声明 = 取声明(模块名);
  const 配置 = 读取模块配置(模块名);
  const 字段 = (声明?.字段 ?? []).map((f) => {
    const 值 = 路径取值(配置, f.键);
    if (f.凭据) {
      return { ...f, 值: "", 已设置: typeof 值 === "string" ? 值.length > 0 : 值 !== undefined && 值 !== null };
    }
    // 对象数组里的凭据列也要脱敏：表单收到明文就等于绕过了凭据隔离
    if (f.类型 === "array" && f.数组?.元素 === "object" && Array.isArray(值)) {
      const 凭据列 = (f.数组.列 ?? []).filter((c) => c.凭据 === true).map((c) => c.键);
      if (凭据列.length > 0) {
        const 脱敏 = 值.map((项) => {
          if (!项 || typeof 项 !== "object") return 项;
          const 行 = { ...(项 as Record<string, unknown>) };
          for (const 列 of 凭据列) {
            if (行[列] !== undefined && 行[列] !== "") {
              行[列] = "";
              行[`${列}__已设置`] = true;
            }
          }
          return 行;
        });
        return { ...f, 值: 脱敏, 凭据列 };
      }
    }
    return { ...f, 值: 值 ?? f.默认值 ?? null };
  });
  return { 模块: 模块名, 说明: 声明?.说明, 字段 };
}
