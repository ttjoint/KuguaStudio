/**
 * 模块身份与版本状态机
 *
 * 处理外部模块重新接入时的「是否同一个模块 / 版本升降 / 信息变化」判定，
 * 并输出统一的处理决策。独立成文件是为了让规则集中、可单测。
 *
 * 核心概念：
 *   - **原位（in-place）**：上报的物理路径与已注册路径相同。
 *     路径会因目录迁移变化，因此只用它判「原位」，不做身份主键。
 *   - **身份主键**：模块名（协议层已保证唯一、有顶号语义）。
 *   - **版本比较**：宽松语义化比较（支持 1.2.3 / 1.2 / v1.2.3-beta）。
 *
 * 决策矩阵：
 *   | 原位 | 版本 | 信息变化 | 决策 |
 *   |---|---|---|---|
 *   | 是 | 更新 | — | autoUpdate ? 自动接受 : 提示更新（可手动） |
 *   | 是 | 相同 | 有变化 | 暂下线 + 红灯 + error，只能手动「替换」 |
 *   | 是 | 相同 | 无变化 | 正常上线 |
 *   | 是 | 落后 | — | 暂下线 + error，只能手动「替换」（回滚） |
 *   | 否 | — | — | 拒绝接入，warning；只能手动移除旧模块 |
 *   | （无同名注册） | — | — | 正常首次注册 |
 */

export type 判定结果 =
  | { 类型: "first" }
  | { 类型: "online" }
  | { 类型: "auto-update"; 旧版本: string; 新版本: string }
  | { 类型: "manual-update"; 旧版本: string; 新版本: string }
  | { 类型: "replace"; 原因: "信息变化" | "版本回退"; 旧版本: string; 新版本: string; 差异: string[] }
  | { 类型: "reject"; 原因: "非原位" | "同路径不同名" | "缺少状态查询能力"; 详情: string };

export interface 注册快照 {
  name: string;
  version?: string;
  /** 已注册的物理路径（entry / 自报 path） */
  path?: string;
  /** 能力声明指纹 */
  capabilityHash?: string;
  /** 是否启用自动更新 */
  autoUpdate?: boolean;
  /** 是否内置模块（内置强制自动更新） */
  builtin?: boolean;
  /**
   * 是否已确认实现 ``module.query``。
   * 首次成功上线后由平台主动探测并写入，不依赖模块自报能力列表，
   * 因此模块无需把协议动作当作业务能力暴露。
   */
  queryable?: boolean;
}

export interface 上报快照 {
  name: string;
  version?: string;
  path?: string;
  capabilityHash?: string;
}

/**
 * 宽松版本比较。
 * 返回 1 = a 更新，-1 = a 更旧，0 = 相同。
 * 非数字段按字符串比较；缺失段视为 0（1.2 == 1.2.0）。
 */
export function 比较版本(a: string | undefined, b: string | undefined): number {
  const 规整 = (v: string | undefined): string[] => {
    const 文本 = String(v ?? "")
      .trim()
      .replace(/^v/i, "")
      .split("-")[0];
    // 空版本（未上报）等价于 0.0.0，避免落入字符串比较出现 -1
    if (!文本) return ["0"];
    return 文本.split(".").map((s) => (s === "" ? "0" : s));
  };
  const 左 = 规整(a);
  const 右 = 规整(b);
  const 长度 = Math.max(左.length, 右.length);
  for (let i = 0; i < 长度; i += 1) {
    const x = 左[i] ?? "0";
    const y = 右[i] ?? "0";
    const nx = Number(x);
    const ny = Number(y);
    const 都是数字 = Number.isFinite(nx) && Number.isFinite(ny) && x !== "" && y !== "";
    if (都是数字) {
      if (nx > ny) return 1;
      if (nx < ny) return -1;
    } else {
      if (x > y) return 1;
      if (x < y) return -1;
    }
  }
  return 0;
}

/** 规范化路径用于比较（统一分隔符与大小写，Windows 不区分大小写） */
export function 规整路径(p: string | undefined): string {
  if (!p) return "";
  return p
    .trim()
    .replace(/\\/g, "/")
    .replace(/\/+/g, "/")
    .replace(/\/$/, "")
    .toLowerCase();
}

/** 是否为「原位」：上报路径与已注册路径一致 */
export function 是原位(已注册: 注册快照, 上报: 上报快照): boolean {
  const a = 规整路径(已注册.path);
  const b = 规整路径(上报.path);
  // 双方都没上报路径时，无法判定为非原位，按原位处理（宽松）
  if (!a || !b) return true;
  return a === b;
}

/**
 * 计算重新接入时的处理决策。
 *
 * @param 已注册  系统内的注册记录；null/undefined 表示首次注册
 * @param 上报    本次握手上报的信息
 * @param 支持查询 该模块是否实现了 module.query
 */
export function 判定重新接入(
  已注册: 注册快照 | null | undefined,
  上报: 上报快照,
  支持查询 = true,
): 判定结果 {
  if (!已注册) return { 类型: "first" };

  // 未实现状态查询的外部模块：无法确认身份与版本，视为离线
  if (!支持查询) {
    return {
      类型: "reject",
      原因: "缺少状态查询能力",
      详情: `模块「${上报.name}」未实现 module.query，无法校验版本与身份，已按离线处理。`,
    };
  }

  // —— 非原位：同一模块名换了路径 → 拒绝，只能手动移除旧模块 ——
  if (!是原位(已注册, 上报)) {
    return {
      类型: "reject",
      原因: "非原位",
      详情:
        `模块「${上报.name}」已注册于 ${已注册.path ?? "（未记录路径）"}，` +
        `本次从 ${上报.path ?? "（未上报路径）"} 接入。` +
        `同名校非原位不允许自动覆盖，请先在模块管理中移除旧注册。`,
    };
  }

  const 版本比较 = 比较版本(上报.version, 已注册.version);
  const 信息变化 = Boolean(上报.capabilityHash) && 上报.capabilityHash !== 已注册.capabilityHash;

  // —— 版本更新 ——
  if (版本比较 > 0) {
    const 可自动 = 已注册.builtin ? true : 已注册.autoUpdate !== false;
    return 可自动
      ? { 类型: "auto-update", 旧版本: 已注册.version ?? "?", 新版本: 上报.version ?? "?" }
      : { 类型: "manual-update", 旧版本: 已注册.version ?? "?", 新版本: 上报.version ?? "?" };
  }

  // —— 版本相同但信息（指令/能力）变了 → 暂下线，需人工确认替换 ——
  if (版本比较 === 0 && 信息变化) {
    return {
      类型: "replace",
      原因: "信息变化",
      旧版本: 已注册.version ?? "?",
      新版本: 上报.version ?? "?",
      差异: ["能力声明（指令）发生变化"],
    };
  }

  // —— 版本落后 → 暂下线，只能手动替换（回滚） ——
  if (版本比较 < 0) {
    return {
      类型: "replace",
      原因: "版本回退",
      旧版本: 已注册.version ?? "?",
      新版本: 上报.version ?? "?",
      差异: [`版本回退 ${已注册.version ?? "?"} → ${上报.version ?? "?"}`],
    };
  }

  // —— 版本相同、信息未变 → 正常上线 ——
  return { 类型: "online" };
}

/** 计算能力声明指纹（稳定排序，只关心名称与中文指令等可用性信息） */
export function 能力指纹(defs: Array<Record<string, unknown>> | undefined): string {
  if (!defs || defs.length === 0) return "";
  const 归一 = defs
    .map((d) => {
      const 名称 = String(d["名称"] ?? d["name"] ?? "");
      const 指令 = [...((d["中文指令"] as string[] | undefined) ?? [])].sort().join(",");
      const 动作 = String(d["动作"] ?? d["action"] ?? "");
      return `${名称}|${动作}|${指令}`;
    })
    .sort();
  return 归一.join(";");
}
