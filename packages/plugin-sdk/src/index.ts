/**
 * 苦瓜插件 SDK（@kugua/plugin-sdk）
 *
 * 契约层：插件只依赖本包即可接入苦音（Nigane）总线。
 *   - BasePlugin：生命周期钩子 on_load / on_enable / on_disable / on_unload
 *   - Context：主系统注入的宿主能力（日志 / 请求 / 广播 / 事件订阅）
 *   - 定义插件()：标注插件类并绑定元数据（对应模板仓库 manifest 的运行时校验）
 *   - 命令定义：在 on_load 中 this.注册命令({ 匹配, 处理, 说明 }) 挂载聊天命令
 */

import type { NiganeClient } from "@kugua/nigane";
import type { 配置声明 } from "@kugua/nigane";
import type { 标识, 消息段 } from "@kugua/onebot11";

export type { 标识, 消息段 } from "@kugua/onebot11";

/** 插件元数据（与 kugua-plugin.json 对应，市场展示与版本校验用） */
export interface 插件元数据 {
  name: string;
  version: string;
  description?: string;
  author?: string;
  homepage?: string;
  /**
   * 配置声明（可选）。
   *
   * 写了之后平台会自动生成配置页（和模块用同一套表单），
   * 插件在 on_load 里用 `ctx.配置()` 读当前值。凭据类字段（`凭据: true`）
   * 同样会隔离到本地配置文件，不进版本库。
   *
   * 放在清单里而不是代码里，是为了让平台在**加载插件之前**就知道
   * 它需要哪些配置——有些插件缺配置就没法正常工作，能提前在列表里
   * 标出「可配置」，用户不用先跑一遍才发现。
   */
  配置声明?: 配置声明;
  /**
   * 小组件声明（可选）。
   *
   * 插件向主界面注入的小展示块（CPU 曲线、下载速度等）。
   * **这里不说放在哪**——只声明「块里显示什么」与「哪个重要」，
   * 摆放位置由平台决定并可被用户调整。详见 docs/小组件设计.md。
   */
  widgets?: unknown;
}

/** 命令处理返回值：返回字符串/消息段即回复当前会话；null/void 表示已自行处理 */
export type 回复内容 = string | 消息段[] | void | null;

/** 消息上下文：命令处理函数的入参，包含会话信息与回复能力 */
export interface 消息上下文 {
  /** 会话类型：群聊 / 私聊 */
  类型: "group" | "private";
  /** 群号（私聊为空） */
  群号?: 标识;
  /** 消息发送者 QQ */
  用户号: 标识;
  /** 机器人自身 QQ */
  机器人号: 标识;
  /** OneBot 消息段数组 */
  消息段: 消息段[];
  /** 纯文本（text 段拼接） */
  文本: string;
  /** 消息中的 @ 目标列表 */
  at们: 标识[];
  /** 原始事件数据 */
  事件: unknown;
  /** 回复当前会话 */
  回复: (内容: string | 消息段[]) => Promise<unknown>;
  /** 合并转发（仅群聊可用，私聊回退文本） */
  转发: (内容: string | 消息段[], 目标群号?: 标识) => Promise<unknown>;
  /** 经苦音总线请求其他模块 */
  请求: (目标: string, 动作: string, 参数?: unknown, 超时毫秒?: number) => Promise<unknown>;
}

/** 聊天命令定义 */
export interface 命令定义 {
  /** 匹配正则（对消息纯文本测试） */
  匹配: RegExp;
  /** 处理函数 */
  处理: (消息: 消息上下文, 匹配: RegExpMatchArray) => 回复内容 | Promise<回复内容>;
  /** 帮助说明（市场/帮助展示用） */
  说明?: string;
}

/** 事件订阅句柄：插件卸载/禁用时由宿主调用取消 */
export interface 订阅句柄 {
  取消: () => void;
}

/** 宿主注入能力（Context 的实现依据） */
export interface 插件宿主 {
  日志: {
    信息: (消息: string) => void;
    警告: (消息: string) => void;
    错误: (消息: string) => void;
  };
  /** 经苦音总线向指定模块发起请求 */
  请求: (目标: string, 动作: string, 参数?: unknown, 超时毫秒?: number) => Promise<unknown>;
  /** 向苦音总线广播事件 */
  广播: (动作: string, 参数?: unknown) => void;
  /** 订阅总线事件（action 前缀匹配），返回可取消句柄 */
  订阅: (动作: string, 处理: (参数: unknown) => void | Promise<void>) => 订阅句柄;
  /**
   * 读取本插件的配置（已合并本地凭据层）。
   *
   * 用法与模块一致：拿到的是**本插件的配置节本身**，不是整个配置文件。
   * 配置项在平台侧改动后立即生效，插件下一次调用就能读到新值——
   * 不需要重启，也不需要自己缓存。
   */
  配置: () => Promise<Record<string, unknown>>;
  /**
   * 运行时补声明小组件。
   *
   * 静态声明写在清单的 `widgets` 里就够了。这个接口是给**能力不确定**的
   * 插件用的：比如 sysmon 要采 GPU，但机器上不一定有 N 卡。
   *
   * 为什么不能「清单里先声明、取不到就不推送」：那样没有显卡的机器会看到
   * 一个永远显示「无数据」的卡片。用户分不清是「还没采到」还是
   * 「这台机器根本没法采」。**取不到就不声明**才是对的。
   *
   * 补声明**追加**在清单声明之后，id 冲突时以补声明为准（插件自己更清楚
   * 当前能不能提供）。卸载时随插件一起注销，不需要手动清理。
   */
  声明小组件: (声明: unknown[]) => Promise<void>;
}

/** 简易日志器（缺省落到控制台） */
export function 创建日志器(前缀 = "[插件]"): 插件宿主["日志"] {
  return {
    信息: (消息) => console.log(`${前缀} ${消息}`),
    警告: (消息) => console.warn(`${前缀} ${消息}`),
    错误: (消息) => console.error(`${前缀} ${消息}`),
  };
}

/**
 * 基于苦音客户端的默认宿主适配。
 * 注意：NiganeClient.onEvent 按 action 覆盖注册，因此这里做多路复用扇出表，
 * 多个订阅者共享一个底层处理器，取消订阅只从扇出表移除。
 */
export function 创建宿主(
  客户端: NiganeClient,
  日志: 插件宿主["日志"] = 创建日志器(),
  插件名?: string,
): 插件宿主 {
  const 事件表 = new Map<string, Set<(参数: unknown) => void | Promise<void>>>();
  /** 配置缓存：只在成功时写入，失败时下次重试而不是永久返回空对象 */
  let 配置缓存: Record<string, unknown> | null = null;
  return {
    日志,
    请求: (目标, 动作, 参数, 超时毫秒) => 客户端.request(目标, 动作, 参数, 超时毫秒 ?? 10000),
    广播: (动作, 参数) => 客户端.sendEvent(动作, 参数),
    配置: async () => {
      if (!插件名) return {};
      // 每次调用都回源，保证平台侧改完立刻可见；主控侧本身是内存读取，开销很小。
      // 失败时回退到上次成功的结果（有缓存）或空对象，避免插件因为一次总线抖动就崩掉。
      try {
        const 值 = (await 客户端.request(
          "nigane",
          "nigane.moduleConfig.getModule",
          { name: 插件名 },
          5000,
        )) as Record<string, unknown> | null | undefined;
        配置缓存 = 值 && typeof 值 === "object" ? 值 : {};
        return 配置缓存;
      } catch (err) {
        日志.警告(`读取插件配置失败（${插件名}）：${String(err)}`);
        return 配置缓存 ?? {};
      }
    },
      声明小组件: async (声明) => {
      if (!插件名) return;
      try {
        await 客户端.request(
          "plugins",
          "plugins.widgets.declare",
          { name: 插件名, widgets: 声明 },
          5000,
        );
      } catch (err) {
        // 补声明失败不该拖垮插件：小组件只是展示，主功能照常跑
        日志.警告(`补声明小组件失败（${插件名}）：${String(err)}`);
      }
    },
    订阅: (动作, 处理) => {
      let 集合 = 事件表.get(动作);
      if (!集合) {
        集合 = new Set();
        事件表.set(动作, 集合);
        客户端.onEvent(动作, (参数) => {
          for (const 处理器 of 集合 ?? []) {
            void Promise.resolve(处理器(参数)).catch((err: unknown) =>
              日志.错误(`事件处理失败 ${动作}：${String(err)}`),
            );
          }
        });
      }
      集合.add(处理);
      return {
        取消: () => {
          集合?.delete(处理);
          if (集合 && 集合.size === 0) {
            事件表.delete(动作);
          }
        },
      };
    },
  };
}

/**
 * 插件上下文：主系统注入给每个插件实例的宿主门面。
 * 插件可在 on_load(ctx) 中保存它，用于请求其他模块、广播事件、订阅总线事件。
 */
export class Context implements 插件宿主 {
  readonly 日志: 插件宿主["日志"];
  readonly 请求: 插件宿主["请求"];
  readonly 广播: 插件宿主["广播"];
  readonly 订阅: 插件宿主["订阅"];
  readonly 配置: 插件宿主["配置"];
  readonly 声明小组件: 插件宿主["声明小组件"];

  constructor(宿主: 插件宿主) {
    this.日志 = 宿主.日志;
    this.请求 = 宿主.请求;
    this.广播 = 宿主.广播;
    this.订阅 = 宿主.订阅;
    this.配置 = 宿主.配置;
    this.声明小组件 = 宿主.声明小组件;
  }
}

/**
 * 插件基类：
 *   - 子类实现生命周期钩子
 *   - on_load 中保存 ctx 并调用 this.注册命令(...) 挂载命令
 *   - 宿主在加载后读取 this.命令 获取注册表
 */
export abstract class BasePlugin {
  /** 元数据由 定义插件() 写入（静态），宿主据此校验 */
  static 插件元数据?: 插件元数据;

  protected 上下文?: Context;
  private 命令表: 命令定义[] = [];

  /** 生命周期：插件加载（实例化后调用） */
  on_load(ctx: Context): void | Promise<void> {
    this.上下文 = ctx;
  }

  /** 生命周期：启用 */
  on_enable(): void | Promise<void> {
    // 默认无操作
  }

  /** 生命周期：禁用 */
  on_disable(): void | Promise<void> {
    // 默认无操作
  }

  /** 生命周期：卸载（动态导入缓存清理前调用） */
  on_unload(): void | Promise<void> {
    // 默认无操作
  }

  /** 注册一条聊天命令（应在 on_load 内调用） */
  注册命令(定义: 命令定义): void {
    this.命令表.push(定义);
  }

  /** 已注册命令（只读，宿主读取） */
  get 命令(): readonly 命令定义[] {
    return this.命令表;
  }
}

/** 插件类构造器类型（BasePlugin 具体子类，含静态元数据槽位） */
export interface 插件构造器 {
  new (): BasePlugin;
  插件元数据?: 插件元数据;
}

export type 插件类 = 插件构造器;

/**
 * 标注插件类并绑定元数据。
 * 用法：export default 定义插件(示例插件, { name: "hello", version: "0.1.0", ... })
 */
export function 定义插件<T extends 插件类>(类: T, 元数据: 插件元数据): T {
  类.插件元数据 = {
    ...元数据,
    name: 元数据.name.trim().toLowerCase(),
    version: 元数据.version.trim(),
  };
  return 类;
}

/** 从模块导出物解析插件类：默认导出优先，其次命名导出插件类 */
export function 解析插件类(模块: unknown): 插件类 | null {
  const 对象 = (模块 ?? {}) as Record<string, unknown>;
  const 候选列表: unknown[] = [];
  if (typeof 模块 === "function") 候选列表.push(模块);
  if (typeof 对象.default === "function") 候选列表.push(对象.default);
  for (const 值 of Object.values(对象)) {
    if (typeof 值 === "function" && !候选列表.includes(值)) 候选列表.push(值);
  }
  for (const 候选 of 候选列表) {
    const 类 = 候选 as 插件构造器;
    if (typeof 类 === "function" && (类.prototype?.on_load !== undefined || 类.插件元数据)) {
      return 类;
    }
  }
  return null;
}
