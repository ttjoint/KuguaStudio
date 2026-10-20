/**
 * @kugua/capability —— 苦瓜能力注册表
 *
 * 能力（Capability）是本平台中"一个功能"的一等公民表示。
 * 一次声明，自动派生全部入口：
 *   中文指令 / GUI / 定时任务 / 开机任务 / 外部接口（MCP）
 *
 * 设计要点：
 *   - 能力声明是纯元数据，可跨进程传输（模块在 hello 时上报）；
 *   - 具体实现留在模块进程内，注册表只做汇总、路由与校验；
 *   - 危险能力（含 exec / filesystem:write）默认不对外暴露。
 *
 * 详见 docs/架构设计.md 第四节。
 */

/** 权限标识 */
export type 权限 =
  | "filesystem:read"
  | "filesystem:write"
  | "network"
  | "exec"
  | "device"
  | "clipboard"
  | (string & {});

/**
 * 宽松 JSON Schema（对象）。不引入任何依赖，仅用于能力参数/返回值的描述与
 * MCP inputSchema 的直接复用。
 */
export interface JSONSchema {
  type?: string;
  title?: string;
  description?: string;
  properties?: Record<string, JSONSchema>;
  required?: string[];
  items?: JSONSchema;
  enum?: unknown[];
  default?: unknown;
  [关键字: string]: unknown;
}

/** 入口暴露开关 */
export interface 暴露开关 {
  /** 是否生成中文指令 */
  指令?: boolean;
  /** 是否出现在 GUI（命令面板/按钮） */
  GUI?: boolean;
  /** 是否作为定时/开机任务候选 */
  定时?: boolean;
  /** 是否对外暴露为 MCP tool */
  MCP?: boolean;
}

/** 入口种类 */
export type 能力入口 = "指令" | "GUI" | "定时" | "MCP";

/** 能力声明：纯元数据，可序列化传输 */
export interface 能力声明 {
  /** 全局唯一名称，建议 `模块.动作` */
  名称: string;
  /** 提供者模块名 */
  模块: string;
  /** 苦音 action；缺省等于 名称 */
  动作?: string;
  /** 人类可读标题 */
  标题?: string;
  /** 说明 */
  说明?: string;
  /** 中文指令别名（命中即调用本能力） */
  中文指令?: string[];
  /** 参数 JSON Schema（object） */
  参数?: JSONSchema;
  /** 返回 JSON Schema（可选） */
  返回?: JSONSchema;
  /** 所需权限 */
  权限?: 权限[];
  /** 危险能力：默认不对外暴露 */
  危险?: boolean;
  /** 长任务：走 Job 语义（见架构设计第五节） */
  长任务?: boolean;
  /**
   * 可以转成作业执行（批量/离线），配合 `执行` 使用。
   *
   * 与 `长任务` 分开的理由：`长任务` 只是「等很久」，可以在原模块里同步等；
   * `可作业` 是「能脱离请求生命周期在子进程里跑」，这就要求命令可序列化、
   * 不依赖会话状态。混为一个字段会让「能等 10 分钟」被误解成「能批量离线」。
   */
  可作业?: boolean;
  /**
   * 把本能力转成作业执行时的命令模板（`{参数键}` 占位）。
   *
   * 为什么放在能力声明里而不是 job 模块里：`执行` 描述的是「这个能力
   * 怎么启动」，跟能力一起演化（换 ffmpeg 路径、加一个命令行开关）
   * 是能力作者的事。job 抄一份就是第二份真相，改了那边忘了这边，
   * 表现是「作业跑的是旧命令」且完全没有征兆。见 docs/作业与插件长任务.md。
   */
  执行?: { 命令: string; 参数?: string[]; shell?: boolean };
  /** 各入口暴露开关 */
  暴露?: 暴露开关;
  /** 扩展元数据（如外部 MCP 来源、调度参数等），对注册表透明 */
  扩展?: Record<string, unknown>;
}

/** 默认暴露策略：本地指令与 GUI 默认开，定时与外部接口默认关（按需显式开启） */
export const 默认暴露: Required<暴露开关> = {
  指令: true,
  GUI: true,
  定时: false,
  MCP: false,
};

/** 补全缺省值，得到规范化声明 */
export function 规范化声明(声明: 能力声明): 能力声明 {
  return {
    ...声明,
    动作: 声明.动作 ?? 声明.名称,
    暴露: { ...默认暴露, ...(声明.暴露 ?? {}) },
    权限: 声明.权限 ?? [],
    中文指令: 声明.中文指令 ?? [],
  };
}

/** 判断能力是否在指定入口暴露 */
export function 能力暴露于(声明: 能力声明, 入口: 能力入口, 允许危险 = false): boolean {
  const 规范 = 规范化声明(声明);
  if (!规范.暴露?.[入口]) return false;
  // 危险能力绝不通过 MCP 暴露，除非显式白名单
  if (入口 === "MCP" && 规范.危险 && !允许危险) return false;
  return true;
}

/** 调用器：把能力路由到对应模块（通常是苦音客户端） */
export interface 能力调用器 {
  请求: (目标: string, 动作: string, 参数?: unknown, 超时毫秒?: number) => Promise<unknown>;
}

/** 调用上下文 */
export interface 能力上下文 {
  调用者: string;
  日志: (...参数: unknown[]) => void;
}

/** 中文指令命中结果 */
export interface 指令命中 {
  能力: 能力声明;
  /** 指令后剩余文本（作为参数的原始输入） */
  参数文本: string;
}

/** 能力过滤条件 */
export interface 能力过滤 {
  模块?: string;
  入口?: 能力入口;
  /** 是否包含危险能力 */
  包含危险?: boolean;
  允许危险?: boolean;
}

/**
 * 能力注册表：汇总模块声明，提供查询、中文指令匹配、统一调用。
 */
export class 能力注册表 {
  private 表 = new Map<string, 能力声明>();
  /** 中文指令 -> 能力（最长匹配优先） */
  private 指令索引 = new Map<string, 能力声明>();

  /** 注册（或覆盖）一条能力声明 */
  注册(声明: 能力声明): 能力声明 {
    const 规范 = 规范化声明(声明);
    if (!规范.名称) throw new Error("能力声明缺少名称");
    if (!规范.模块) throw new Error(`能力 ${规范.名称} 缺少所属模块`);
    if (this.表.has(规范.名称)) {
      // 同名以最新声明为准（支持模块热重载/升级）
      this.移除(规范.名称);
    }
    this.表.set(规范.名称, 规范);
    for (const 指令 of 规范.中文指令 ?? []) {
      this.指令索引.set(指令, 规范);
    }
    return 规范;
  }

  /** 批量注册 */
  批量注册(声明列表: 能力声明[]): void {
    for (const 声明 of 声明列表) this.注册(声明);
  }

  /** 移除单条能力 */
  移除(名称: string): void {
    const 旧 = this.表.get(名称);
    if (!旧) return;
    this.表.delete(名称);
    for (const 指令 of 旧.中文指令 ?? []) {
      // 仅当该指令仍指向被移除的能力时才清除
      if (this.指令索引.get(指令)?.名称 === 名称) this.指令索引.delete(指令);
    }
  }

  /** 移除某模块的全部能力（模块下线时调用） */
  移除模块(模块: string): void {
    for (const 名称 of [...this.表.keys()]) {
      if (this.表.get(名称)?.模块 === 模块) this.移除(名称);
    }
  }

  /** 清空 */
  清空(): void {
    this.表.clear();
    this.指令索引.clear();
  }

  /** 获取单条 */
  获取(名称: string): 能力声明 | undefined {
    return this.表.get(名称);
  }

  /** 列出能力（可按模块/入口过滤） */
  列表(过滤: 能力过滤 = {}): 能力声明[] {
    return [...this.表.values()].filter((声明) => {
      if (过滤.模块 && 声明.模块 !== 过滤.模块) return false;
      if (过滤.入口 && !能力暴露于(声明, 过滤.入口, 过滤.允许危险 ?? false)) return false;
      return true;
    });
  }

  /** 列出某模块的能力 */
  按模块(模块: string): 能力声明[] {
    return this.列表({ 模块 });
  }

  /** 中文指令匹配（最长前缀优先） */
  匹配指令(文本: string): 指令命中 | null {
    const 原文 = 文本.trim();
    let 最佳: 能力声明 | undefined;
    let 最佳长度 = 0;
    for (const [指令, 能力] of this.指令索引) {
      if (原文 === 指令 || 原文.startsWith(指令)) {
        if (指令.length > 最佳长度) {
          最佳 = 能力;
          最佳长度 = 指令.length;
        }
      }
    }
    if (!最佳) return null;
    return { 能力: 最佳, 参数文本: 原文.slice(最佳长度).trim() };
  }

  /** 统一调用：按能力名路由到提供者模块 */
  async 调用(
    名称: string,
    参数: unknown,
    调用器: 能力调用器,
    调用者 = "system",
  ): Promise<unknown> {
    const 声明 = this.表.get(名称);
    if (!声明) throw new Error(`能力不存在：${名称}`);
    return 调用器.请求(声明.模块, 声明.动作 ?? 声明.名称, 参数, 声明.长任务 ? 600000 : 60000);
  }

  /** 生成给 GUI / 帮助用的清单 */
  生成清单(): { 名称: string; 模块: string; 标题?: string; 说明?: string; 中文指令: string[] }[] {
    return this.列表({ 入口: "GUI" }).map((声明) => ({
      名称: 声明.名称,
      模块: 声明.模块,
      标题: 声明.标题,
      说明: 声明.说明,
      中文指令: 声明.中文指令 ?? [],
    }));
  }
}

/** 校验已授予权限是否覆盖能力所需权限，不足则抛错 */
export function 校验权限(声明: 能力声明, 已授予: 权限[]): void {
  const 缺 = (声明.权限 ?? []).filter((p) => !已授予.includes(p));
  if (缺.length > 0) {
    throw new Error(`权限不足：需要 ${缺.join("、")}`);
  }
}
