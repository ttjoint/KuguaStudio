/**
 * 插件加载器：扫描 ./plugins/ 目录、动态导入 ES Module、管理插件生命周期与聊天命令分发。
 * 对应文章架构的「运行时机制：动态注入与加载」。
 */

import { existsSync, readdirSync, readFileSync, statSync } from "node:fs";
import { join, resolve } from "node:path";
import { pathToFileURL } from "node:url";
import {
  Context,
  解析插件类,
  type BasePlugin,
  type 插件元数据,
  type 插件宿主,
  type 命令定义,
  type 消息上下文,
  type 订阅句柄,
} from "@kugua/plugin-sdk";

export type 插件状态 = "loaded" | "enabled" | "disabled" | "error";

/** 插件运行时记录 */
export interface 插件记录 {
  name: string;
  /** 插件目录绝对路径 */
  目录: string;
  元数据: 插件元数据 & { entry?: string };
  状态: 插件状态;
  实例?: BasePlugin;
  命令: 命令定义[];
  错误?: string;
  加载时间?: number;
}

export interface 加载器日志 {
  信息: (消息: string) => void;
  警告: (消息: string) => void;
  错误: (消息: string) => void;
}

export interface 加载器选项 {
  /** 插件根目录（默认 <cwd>/plugins） */
  插件目录: string;
  /** 为每个插件实例创建宿主（Context 注入） */
  宿主工厂: (插件名: string) => 插件宿主;
  /** 动态导入函数（测试可注入；默认 Node ESM import，带缓存清理参数） */
  导入?: (url: string) => Promise<unknown>;
  日志?: 加载器日志;
  /** 单条命令处理的超时（毫秒），默认 15000 */
  命令超时毫秒?: number;
  /** 回复当前会话的超时（毫秒），默认 15000 */
  回复超时毫秒?: number;
}


/**
 * 给一个 Promise 加超时。
 *
 * 不取消底层操作（做不到），只是让等待方按时放弃——目的是不让一条卡死的
 * 命令把消息分发流程永久挂住。
 */
function 限时<T>(任务: Promise<T> | T, 毫秒: number, 描述: string): Promise<T> {
  return new Promise<T>((resolve, reject) => {
    let 已完成 = false;
    const 定时 = setTimeout(() => {
      if (已完成) return;
      已完成 = true;
      reject(new Error(`超时（${毫秒}ms）：${描述}`));
    }, 毫秒);
    if (typeof 定时.unref === "function") 定时.unref();
    Promise.resolve(任务).then(
      (值) => {
        if (已完成) return;
        已完成 = true;
        clearTimeout(定时);
        resolve(值);
      },
      (错误) => {
        if (已完成) return;
        已完成 = true;
        clearTimeout(定时);
        reject(错误);
      },
    );
  });
}

const 空日志: 加载器日志 = {
  信息: () => undefined,
  警告: () => undefined,
  错误: () => undefined,
};

/** 读取插件目录元数据：kugua-plugin.json 优先，其次 package.json 的 kugua-plugin 字段 */
export function 读取插件元数据(目录: string): 插件元数据 & { entry?: string } | null {
  const 清单路径 = join(目录, "kugua-plugin.json");
  if (existsSync(清单路径)) {
    try {
      const 清单 = JSON.parse(readFileSync(清单路径, "utf-8")) as 插件元数据 & { entry?: string };
      if (!清单.name || !清单.version) return null;
      return 清单;
    } catch {
      return null;
    }
  }
  const 包路径 = join(目录, "package.json");
  if (existsSync(包路径)) {
    try {
      const 包 = JSON.parse(readFileSync(包路径, "utf-8")) as Record<string, unknown> & {
        name?: string;
        version?: string;
        main?: string;
        "kugua-plugin"?: 插件元数据 & { entry?: string };
      };
      if (包["kugua-plugin"]) {
        const 清单 = 包["kugua-plugin"];
        if (!清单.name || !清单.version) return null;
        return { ...清单, entry: 清单.entry ?? 包.main };
      }
      if (包.name && 包.version) {
        const 名 = 包.name.includes("/") ? 包.name.split("/")[1] : 包.name;
        return { name: 名, version: 包.version, entry: 包.main };
      }
    } catch {
      return null;
    }
  }
  return null;
}

export class 插件加载器 {
  private 插件表 = new Map<string, 插件记录>();
  private 句柄表 = new Map<string, 订阅句柄[]>();
  private 日志: 加载器日志;

  constructor(private 选项: 加载器选项) {
    this.日志 = 选项.日志 ?? 空日志;
  }

  get 插件目录(): string {
    return this.选项.插件目录;
  }

  /** 扫描插件目录，返回全部元数据记录（未实例化） */
  扫描(): 插件记录[] {
    const 结果: 插件记录[] = [];
    if (!existsSync(this.插件目录)) return 结果;
    for (const 项 of readdirSync(this.插件目录)) {
      if (项.startsWith(".")) continue;
      const 目录 = resolve(this.插件目录, 项);
      if (!statSync(目录).isDirectory()) continue;
      const 元数据 = 读取插件元数据(目录);
      if (!元数据) {
        this.日志.警告(`跳过 ${项}：缺少合法元数据（kugua-plugin.json 或 package.json）`);
        continue;
      }
      结果.push({ name: 元数据.name, 目录, 元数据, 状态: "disabled", 命令: [] });
    }
    return 结果;
  }

  /** 扫描并把未加载的插件全部加载启用（启动时调用） */
  async 加载全部(): Promise<插件记录[]> {
    const 已加载: 插件记录[] = [];
    for (const 记录 of this.扫描()) {
      if (this.插件表.has(记录.name)) continue;
      const 实例 = await this.加载(记录.name).catch((err: unknown) => {
        this.日志.错误(`插件 ${记录.name} 加载失败：${String(err)}`);
        this.插件表.set(记录.name, { ...记录, 状态: "error", 错误: String(err) });
        return this.插件表.get(记录.name)!;
      });
      if (实例.状态 !== "error") {
        await this.启用(记录.name).catch((err: unknown) =>
          this.日志.错误(`插件 ${记录.name} 启用失败：${String(err)}`),
        );
      }
      已加载.push(this.插件表.get(记录.name) ?? 记录);
    }
    return 已加载;
  }

  /** 动态导入并实例化插件（不启用） */
  async 加载(name: string): Promise<插件记录> {
    const 已有 = this.插件表.get(name);
    if (已有 && 已有.实例) {
      this.日志.警告(`插件 ${name} 已加载，忽略重复加载`);
      return 已有;
    }
    const 记录 = 已有 ?? this.扫描().find((r) => r.name === name);
    if (!记录) throw new Error(`插件不存在：${name}`);

    const 入口 = this.解析入口(记录.目录, 记录.元数据.entry);
    if (!入口) throw new Error(`插件 ${name} 缺少入口文件（期望 dist/index.js 或 index.js）`);

    const 导入 = this.选项.导入 ?? (async (url: string) => import(url));
    const url = `${pathToFileURL(入口).href}?t=${Date.now()}`;
    const 模块 = await 导入(url);
    const 插件类 = 解析插件类(模块);
    if (!插件类) throw new Error(`插件 ${name} 默认导出不是 BasePlugin 子类`);

    const 实例 = new 插件类();
    // 包装宿主订阅，记录句柄以便禁用/卸载时取消
    const 宿主 = this.选项.宿主工厂(name);
    const 原订阅 = 宿主.订阅.bind(宿主);
    const 句柄列表: 订阅句柄[] = [];
    宿主.订阅 = (动作, 处理) => {
      const 句柄 = 原订阅(动作, 处理);
      句柄列表.push(句柄);
      return 句柄;
    };
    this.句柄表.set(name, 句柄列表);

    const ctx = new Context(宿主);
    await 实例.on_load(ctx);

    // 清单里的元数据与代码里的静态元数据合并：
    // 代码优先（它才是运行时真实状况），但清单里**代码不认识的字段**
    // （widgets / 配置声明）必须保留。
    // 早期直接取 `类元数据 ?? 清单元数据`，结果“清单里写了 widgets
    // 但代码里没重复写一遂”就丢得干干净净，插件作者完全看不出原因。
    const 类元数据 = 插件类.插件元数据;
    const 元数据 = 类元数据
      ? { ...记录.元数据, ...类元数据, name: 类元数据.name || 记录.元数据.name, version: 类元数据.version || 记录.元数据.version }
      : 记录.元数据;
    const 更新: 插件记录 = {
      ...记录,
      元数据,
      实例: 实例 as 插件记录["实例"],
      命令: [...实例.命令],
      状态: "loaded",
      加载时间: Date.now(),
      错误: undefined,
    };
    this.插件表.set(name, 更新);
    this.日志.信息(`插件已加载：${name} v${更新.元数据.version}（${更新.命令.length} 条命令）`);
    return 更新;
  }

  /** 启用插件（未加载则先加载） */
  async 启用(name: string): Promise<插件记录> {
    let 记录 = this.插件表.get(name);
    if (!记录 || !记录.实例) 记录 = await this.加载(name);
    if (记录.状态 === "enabled") return 记录;
    await 记录.实例!.on_enable();
    记录.状态 = "enabled";
    this.日志.信息(`插件已启用：${name}`);
    return 记录;
  }

  /** 禁用插件：取消事件订阅并调用 on_disable */
  async 禁用(name: string): Promise<插件记录> {
    const 记录 = this.插件表.get(name);
    if (!记录 || !记录.实例) throw new Error(`插件未加载：${name}`);
    if (记录.状态 !== "enabled") return 记录;
    this.取消订阅(name);
    await 记录.实例.on_disable();
    记录.状态 = "disabled";
    this.日志.信息(`插件已禁用：${name}`);
    return 记录;
  }

  /** 卸载插件（从注册表移除；不删除目录） */
  async 卸载(name: string): Promise<void> {
    const 记录 = this.插件表.get(name);
    if (!记录) return;
    if (记录.状态 === "enabled") await this.禁用(name);
    this.取消订阅(name);
    try {
      await 记录.实例?.on_unload();
    } catch (err) {
      this.日志.警告(`插件 ${name} on_unload 异常：${String(err)}`);
    }
    this.插件表.delete(name);
    this.日志.信息(`插件已卸载：${name}`);
  }

  /** 热重载：卸载后重新加载（保持原启用状态） */
  async 重载(name: string): Promise<插件记录> {
    const 原 = this.插件表.get(name);
    const 曾启用 = 原?.状态 === "enabled";
    await this.卸载(name);
    const 记录 = await this.加载(name);
    if (曾启用) await this.启用(name);
    this.日志.信息(`插件已重载：${name}`);
    return 记录;
  }

  /** 全部卸载（模块关闭时调用） */
  async 卸载全部(): Promise<void> {
    for (const name of [...this.插件表.keys()]) {
      await this.卸载(name).catch((err: unknown) => this.日志.警告(`卸载 ${name} 失败：${String(err)}`));
    }
  }

  列表(): 插件记录[] {
    return [...this.插件表.values()];
  }

  获取(name: string): 插件记录 | undefined {
    return this.插件表.get(name);
  }

  /**
   * 分发一条消息：按启用插件注册顺序查找首个命中的命令并执行。
   * 返回是否已处理。处理函数返回 string/消息段数组时自动回复当前会话。
   *
   * 两个保护（插件与平台同进程，插件卡住就是平台卡住）：
   *
   *  1. **超时**。命令处理里可能有网络请求、磁盘 IO，或干脆是个死循环之前
   *     的长时间等待。没有超时的话，这条消息会一直挂着，占住一份闭包与
   *     上下文引用；高频消息下会不断堆积直到内存涨满。
   *  2. **回复也单独兜底**。`回复` 走总线下发，同样可能失败（机器人掉线）；
   *     它失败不该被算成「命令处理失败」，更不该把异常抛给调用方。
   *
   * 超时并不中断正在跑的函数（JS 无法从外部杀同步循环），但能让**分发流程**
   * 按时结束、不再等待，从而不拖垮后续消息。真正的死循环需要隔离才能根治，
   * 那与「插件要高效调用平台」的初衷冲突，此处不做。
   */
  async 分发消息(上下文: 消息上下文): Promise<boolean> {
    for (const 记录 of this.插件表.values()) {
      if (记录.状态 !== "enabled" || !记录.实例) continue;
      for (const 命令 of 记录.命令) {
        const 匹配 = 上下文.文本.match(命令.匹配);
        if (!匹配) continue;
        try {
          const 结果 = await 限时(
            命令.处理(上下文, 匹配),
            this.选项.命令超时毫秒 ?? 15000,
            `插件 ${记录.name} 的命令处理`,
          );
          if (结果 !== null && 结果 !== undefined) {
            await 限时(
              上下文.回复(结果),
              this.选项.回复超时毫秒 ?? 15000,
              `插件 ${记录.name} 的回复`,
            );
          }
        } catch (err) {
          this.日志.错误(`插件 ${记录.name} 命令处理失败：${String(err)}`);
        }
        return true;
      }
    }
    return false;
  }

  private 解析入口(目录: string, 指定?: string): string | null {
    const 候选 = [指定, "dist/index.js", "index.js"].filter(Boolean) as string[];
    for (const 相对 of 候选) {
      const 路径 = resolve(目录, 相对);
      if (existsSync(路径) && statSync(路径).isFile()) return 路径;
    }
    return null;
  }

  private 取消订阅(name: string): void {
    const 句柄列表 = this.句柄表.get(name) ?? [];
    for (const 句柄 of 句柄列表) {
      try {
        句柄.取消();
      } catch {
        // 忽略取消异常
      }
    }
    this.句柄表.delete(name);
  }
}
