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

    const 元数据 = 插件类.插件元数据 ?? 记录.元数据;
    const 更新: 插件记录 = {
      ...记录,
      元数据: { ...元数据, name: 元数据.name ?? 记录.元数据.name, version: 元数据.version ?? 记录.元数据.version },
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
   */
  async 分发消息(上下文: 消息上下文): Promise<boolean> {
    for (const 记录 of this.插件表.values()) {
      if (记录.状态 !== "enabled" || !记录.实例) continue;
      for (const 命令 of 记录.命令) {
        const 匹配 = 上下文.文本.match(命令.匹配);
        if (!匹配) continue;
        try {
          const 结果 = await 命令.处理(上下文, 匹配);
          if (结果 !== null && 结果 !== undefined) {
            await 上下文.回复(结果);
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
