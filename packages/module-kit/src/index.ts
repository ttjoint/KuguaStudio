/**
 * @kugua/module-kit —— 苦瓜模块启动套件
 *
 * 目的：把每个模块重复的启动样板收敛到一处，消除 20+ 份「读配置 / 连主控 /
 * 注册能力 / 处理退出」的复制粘贴，且保证全平台行为一致。
 *
 * 典型用法（模块 `src/index.ts`）：
 *
 * ```ts
 * import { 启动模块 } from "@kugua/module-kit";
 *
 * const 能力清单: 能力声明[] = [ ... ];
 *
 * void 启动模块({
 *   name: "dice",
 *   version: "0.2.0",
 *   能力: 能力清单,
 *   处理器: { "dice.roll": (参数) => 掷骰(参数) },
 * });
 * ```
 *
 * 需要被测试导入的模块请传入 `仅在主模块启动: true`，或自行用 {@link 是主模块} 判断。
 */

import { existsSync, readFileSync } from "node:fs";
import { resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { NiganeClient } from "@kugua/nigane";
import type { 配置声明, 配置载荷, 模块UI声明 } from "@kugua/nigane";
import type { 能力声明 } from "@kugua/capability";

/** 配置热重载回调：收到平台推送的新配置 */
export type 模块配置处理器 = (载荷: 配置载荷) => void | Promise<void>;

/** 主控地址解析所需的配置字段（各模块 config 的公共子集） */
export interface 基础模块配置 {
  host?: string;
  port?: number;
  token?: string;
}

/** 请求处理器：返回任意可序列化值（可异步） */
export type 模块请求处理器 = (参数: unknown, 消息: unknown) => unknown | Promise<unknown>;

/** 事件处理器 */
export type 模块事件处理器 = (参数: unknown, 消息: unknown) => void | Promise<void>;

/** 日志器接口（与 @kugua/logger 的 创建日志器 兼容，避免强依赖） */
export interface 简易日志器 {
  信息: (信息: string) => void;
  警告?: (信息: string) => void;
  错误: (信息: string) => void;
}

export interface 启动模块选项<配置 extends 基础模块配置 = 基础模块配置> {
  /** 模块名（唯一，握手用） */
  name: string;
  /** 模块版本（握手用） */
  version?: string;
  /**
   * 能力声明列表。声明会被上报给主控用于能力注册表（GUI/指令/定时/MCP 派生）。
   * 能力名（capabilities）无需手写：握手时由「声明 + 已注册处理器」自动合并派生。
   * 也可传函数（可异步），用于需要运行时发现能力的模块（如 MCP 接入）。
   */
  能力?: 能力声明[] | (() => 能力声明[] | Promise<能力声明[]>);
  /** 直接指定能力名列表（一般不需要；不传则自动由声明与注册派生） */
  capabilities?: string[];
  /** action -> 请求处理器。键即苦音 action 名。 */
  处理器?: Record<string, 模块请求处理器>;
  /** action -> 事件处理器（等价于逐个调用 onEvent）。 */
  事件?: Record<string, 模块事件处理器>;
  /**
   * 自定义注册：传入已创建（尚未连接）的客户端，用于处理器写在其它文件的模块。
   * 若返回函数，则作为额外的资源清理钩子，在退出时与 `关闭` 一同执行。
   */
  注册?: (客户端: NiganeClient) => void | (() => void) | Promise<void | (() => void)>;
  /**
   * 自定义配置（覆盖基础字段）。返回对象会与文件配置合并（自定义优先）。
   * 用于读取模块专属配置项。
   */
  读配置?: (文件配置: Record<string, unknown>) => 配置;
  /** 配置文件路径（默认 cwd/kugua.config.json，受 KUGUA_CONFIG 影响） */
  配置路径?: string;
  /**
   * 关闭钩子：收到 shutdown / SIGINT / SIGTERM 时先执行（可异步），
   * 完成后再关闭客户端并退出进程。用于释放定时器、子进程、数据库等。
   */
  关闭?: (客户端: NiganeClient) => void | Promise<void>;
  /** 连接成功后的回调（可在其中做加载、定时器等初始化） */
  就绪?: (客户端: NiganeClient, 配置: 配置, 连接: { url: string }) => void | Promise<void>;
  /** 日志器（默认使用 console，带 `[name]` 前缀） */
  日志?: 简易日志器;
  /** 仅在作为主模块执行时启动（测试导入时跳过）。默认 false。
   * 若为 true，必须同时传 `入口文件URL: import.meta.url`。 */
  仅在主模块启动?: boolean;
  /** 调用方的 import.meta.url，用于「仅在主模块启动」判断 */
  入口文件URL?: string;
  /** 连接失败时的退出码（默认 1） */
  失败退出码?: number;
  /**
   * 配置声明（可选）：上报本模块有哪些可配置项。
   * 平台据此自动渲染配置页，无需模块自带前端。
   */
  配置声明?: 配置声明;
  /**
   * 配置热重载回调（可选）：收到平台推送的新配置时调用。
   *
   * 推送时机：模块首次上线（来源 `初始化`）、用户在 UI 改配置（来源 `用户`）、
   * 其他模块改了共享配置（来源 `模块`）。
   * 载荷里是**合并后的完整配置**，模块无需自己处理两层文件。
   */
  配置变更?: 模块配置处理器;
  /**
   * 自定义 UI 页（可选）：声明式表单表达不了的复杂交互（试听、进度条等）时使用。
   *
   * `entry` 是**相对模块入口文件所在目录**的路径，平台据此提供
   * `GET /module-ui/<模块名>/<路径>` 并在顶栏生成一个 iframe 标签页。
   */
  界面?: 模块UI声明;
}

/**
 * 读取 `kugua.config.json`（优先 `KUGUA_CONFIG` 环境变量指定的路径）。
 * 供需要访问平台配置的模块复用，避免各处重复实现。
 */
export function 加载模块配置(配置路径?: string): Record<string, unknown> {
  const 相对 = 配置路径 ?? process.env.KUGUA_CONFIG ?? "kugua.config.json";
  const 绝对 = resolve(process.cwd(), 相对);
  if (!existsSync(绝对)) return {};
  try {
    return JSON.parse(readFileSync(绝对, "utf-8")) as Record<string, unknown>;
  } catch {
    return {};
  }
}

/** 是否作为主模块执行（而非被测试 import）。
 * `入口文件URL` 需由调用方传入 `import.meta.url`（默认值只能取到本套件自身的 URL）。 */
export function 是主模块(入口文件URL?: string): boolean {
  if (!入口文件URL) return false;
  const 入口 = process.argv[1];
  if (!入口) return false;
  try {
    return resolve(入口) === resolve(fileURLToPath(入口文件URL));
  } catch {
    return false;
  }
}

/**
 * 按平台约定解析主控地址与令牌。
 * 优先级：NIGANE_URL/NIGANE_TOKEN 环境变量 > 命令行参数 > 配置文件。
 */
export function 解析连接参数(配置: 基础模块配置): { url: string; token: string } {
  const host = 配置.host ?? "127.0.0.1";
  const port = 配置.port ?? 24601;
  const url = process.env.NIGANE_URL ?? process.argv[2] ?? `ws://${host}:${port}`;
  const token = process.env.NIGANE_TOKEN ?? process.argv[3] ?? 配置.token ?? "";
  return { url, token };
}

/** 由能力声明派生能力名列表（优先动作名，缺省用名称） */
export function 派生能力名(能力?: 能力声明[]): string[] {
  return (能力 ?? []).map((c) => c.动作 ?? c.名称);
}

/**
 * 启动一个模块进程：统一完成配置合并、客户端连接、能力/处理器注册、
 * 就绪回调与退出处理。返回已连接的客户端，便于测试或无 guard 场景直接使用。
 */
export async function 启动模块<配置 extends 基础模块配置 = 基础模块配置>(
  选项: 启动模块选项<配置>,
): Promise<NiganeClient | null> {
  if (选项.仅在主模块启动 && !是主模块(选项.入口文件URL)) return null;

  const 日志 = 选项.日志 ?? 创建控制台日志(选项.name);

  // —— 配置：文件配置与自定义读取结果合并 ——
  const 文件配置 = 加载模块配置(选项.配置路径) as 基础模块配置 & Record<string, unknown>;
  const 自定义 = (选项.读配置?.(文件配置) ?? {}) as 配置;
  const 配置 = { ...文件配置, ...自定义 } as 配置;

  const { url, token } = 解析连接参数({ ...文件配置, ...自定义 });

  const 能力声明 = typeof 选项.能力 === "function" ? await 选项.能力() : 选项.能力;
  // 能力名：仅当调用方显式指定时才直接传递；否则交给 NiganeClient 在握手时
  // 自动由「能力声明 + 已注册处理器」合并派生，避免遗漏手动注册的动作
  // （如 mcp-client.providers）——能力声明与注册完全驱动能力表。
  const capabilities = 选项.capabilities;

  const 客户端 = new NiganeClient({
    name: 选项.name,
    url,
    token,
    version: 选项.version,
    capabilities,
    capabilityDefs: 能力声明,
    配置声明: 选项.配置声明,
    ui: 选项.界面,
  });

  // —— 注册处理器 ——
  for (const [action, 处理器] of Object.entries(选项.处理器 ?? {})) {
    客户端.onRequest(action, (参数, 消息) => 处理器(参数, 消息));
  }
  for (const [action, 处理器] of Object.entries(选项.事件 ?? {})) {
    客户端.onEvent(action, (参数, 消息) => void 处理器(参数, 消息));
  }

  // —— 配置热重载：平台推送 module.config 时回调给模块 ——
  if (选项.配置变更) {
    客户端.onEvent("module.config", (参数) => {
      const 载荷 = 参数 as 配置载荷 | undefined;
      if (!载荷 || 载荷.模块 !== 选项.name) return;
      // 初始化推送不视为「变更」以外的特殊处理，统一交给模块判断
      Promise.resolve(选项.配置变更?.(载荷)).catch((err) => {
        日志.错误(`应用新配置失败：${String(err)}`);
      });
    });
  }

  // —— 自定义注册（处理器位于其它文件的模块）——
  let 注册清理: (() => void) | undefined;
  if (选项.注册) {
    const 返回 = await 选项.注册(客户端);
    if (typeof 返回 === "function") 注册清理 = 返回;
  }

  try {
    await 客户端.connect();
  } catch (err) {
    日志.错误(`接入主控失败：${String(err)}`);
    process.exit(选项.失败退出码 ?? 1);
  }

  日志.信息(`已接入主控：${url}`);

  if (选项.就绪) {
    try {
      await 选项.就绪(客户端, 配置, { url });
    } catch (err) {
      日志.错误(`初始化失败：${String(err)}`);
    }
  }

  let 正在退出 = false;
  const 退出 = async (): Promise<void> => {
    if (正在退出) return;
    正在退出 = true;
    try {
      注册清理?.();
    } catch (err) {
      日志.错误(`资源清理异常：${String(err)}`);
    }
    try {
      await 选项.关闭?.(客户端);
    } catch (err) {
      日志.错误(`关闭钩子异常：${String(err)}`);
    }
    客户端.close();
    process.exit(0);
  };

  客户端.on("shutdown", () => void 退出());
  客户端.on("close", () => void 退出());
  process.on("SIGINT", () => void 退出());
  process.on("SIGTERM", () => void 退出());

  return 客户端;
}

/** 默认日志器：带 `[模块名]` 前缀输出到控制台 */
function 创建控制台日志(名称: string): 简易日志器 {
  const 前缀 = `[${名称}]`;
  return {
    信息: (信息) => console.log(`${前缀} ${信息}`),
    警告: (信息) => console.warn(`${前缀} ${信息}`),
    错误: (信息) => console.error(`${前缀} ${信息}`),
  };
}
