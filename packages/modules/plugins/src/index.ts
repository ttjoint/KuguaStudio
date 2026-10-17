/**
 * 插件运行时模块（@kugua/module-plugins）
 *
 * 对应文章架构：
 *   - 运行时：扫描 ./plugins/ → 读取 kugua-plugin.json → 动态 import → Context 注入 → 生命周期钩子
 *   - 市场：plugins.market.list 读取 GitHub raw plugins.json 索引
 *   - 安装/更新：git clone / git pull + npm install + 热重载（plugins.install/update/uninstall）
 *   - 命令分发：订阅 napcat.message.* 事件，按插件命令正则路由并回复
 *
 * 配置（kugua.config.json 的 plugins 节，或环境变量覆盖）：
 *   { "plugins": { "dir": "plugins", "marketIndex": "https://raw.githubusercontent.com/.../plugins.json" } }
 */

import { existsSync, mkdirSync, watch as 监视目录 } from "node:fs";
import { join, resolve } from "node:path";
import { 安装进程兜底, 启动模块 } from "@kugua/module-kit";
import type { NiganeClient } from "@kugua/nigane";
import { 段, 提取纯文本, type 标识, type 消息段 } from "@kugua/onebot11";
import {
  创建日志器,
  type 插件宿主,
  type 消息上下文,
  type 订阅句柄,
} from "@kugua/plugin-sdk";
import { 插件加载器, 读取插件元数据 } from "./loader.js";
import {
  安装依赖,
  检查更新,
  从仓库URL取名,
  删除插件目录,
  克隆仓库,
  拉取更新,
  抓取市场,
  校验路径在目录内,
  type 市场条目,
} from "./installer.js";

/** 插件运行时配置（测试可直接传入） */
export interface 插件运行时配置 {
  插件目录: string;
  市场索引: string;
  gitTimeoutMs?: number;
  npmTimeoutMs?: number;
  /** 动态导入函数（测试可注入；生产默认 Node import + 时间戳缓存清理） */
  导入?: (url: string) => Promise<unknown>;
}

/**
 * 启动插件运行时（挂接苦音客户端）。
 * 测试可直接传入已连接的客户端与临时插件目录，无需真实主控。
 */
export function 启动插件运行时(
  客户端: NiganeClient,
  配置: 插件运行时配置,
): {
  加载器: 插件加载器;
  /** 把插件清单里的配置声明上报给主控（供配置页使用） */
  注册声明: () => Promise<void>;
  关闭: () => Promise<void>;
} {
  const 插件目录 = 配置.插件目录;
  const 市场索引 = 配置.市场索引;
  const 日志 = 创建日志器("[插件运行时]");

  // 插件与平台同进程（刻意的设计：常用功能不值得 IPC 往返，生命周期也归平台管），
  // 所以插件里任何逃逸到事件循环根部的错误都会带走整个 Studio。
  // 这里兜住，至少让用户能看到「哪个插件出了问题」而不是窗口直接消失。
  安装进程兜底({
    记录: (级别, 消息) => (级别 === "错误" ? 日志.错误(消息) : 日志.警告(消息)),
  });

  // —— 模块级事件扇出表：插件订阅与内部消息分发共享一个底层处理器，避免互相覆盖 ——
  const 事件表 = new Map<string, Set<(参数: unknown) => void | Promise<void>>>();
  const 订阅总线 = (动作: string, 处理: (参数: unknown) => void | Promise<void>): 订阅句柄 => {
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
    return { 取消: () => 集合?.delete(处理) };
  };

  // —— 插件宿主工厂：每个插件实例注入独立 Context（日志带插件名前缀）——
  // 注意这里是每个插件一套宿主：日志前缀、配置读取都要按插件区分，
  // 共用一个宿主会导致 A 插件读到 B 插件的配置。
  const 宿主工厂 = (插件名: string): 插件宿主 => ({
    日志: 创建日志器(`[插件:${插件名}]`),
    请求: (目标, 动作, 参数, 超时毫秒) => 客户端.request(目标, 动作, 参数, 超时毫秒 ?? 10000),
    广播: (动作, 参数) => 客户端.sendEvent(动作, 参数),
    订阅: 订阅总线,
    配置: async () => {
      try {
        const 值 = (await 客户端.request(
          "nigane",
          "nigane.moduleConfig.getModule",
          { name: 插件名 },
          5000,
        )) as Record<string, unknown> | null | undefined;
        return 值 && typeof 值 === "object" ? 值 : {};
      } catch {
        // 主控还没连上 / 该插件没声明配置：返回空对象，插件自行用默认值兜底。
        // 不抛异常——读配置失败不该让插件崩掉。
        return {};
      }
    },
  });

  const 加载器 = new 插件加载器({ 插件目录, 宿主工厂, 日志, 导入: 配置.导入 });

  /**
   * 把插件清单里声明的配置转给主控，让它出现在配置页里。
   *
   * 用 `nigane.moduleConfig.declare` 上报时把名字设成插件名——平台侧的
   * 声明表按名字索引，模块与插件共用一张表，因此表单、凭据隔离、
   * 热更新这些能力插件直接就复用了，不需要另做一套。
   *
   * 失败不影响插件本身：注册声明只是为了「能配」，不配也能跑。
   */
  const 注册插件声明 = async (): Promise<void> => {
    for (const 记录 of 加载器.列表()) {
      const 声明 = 记录.元数据.配置声明;
      if (!声明) continue;
      try {
        await 客户端.request(
          "nigane",
          "nigane.moduleConfig.declare",
          { 声明, name: 记录.name },
          5000,
        );
      } catch (err) {
        日志.警告(`注册插件配置声明失败（${记录.name}）：${String(err)}`);
      }
    }
  };

  // —— Napcat 桥接机器人信息（转发署名用，5 分钟缓存）——
  let 机器人缓存: { user_id: 标识; nickname: string } | null = null;
  let 缓存时间 = 0;
  const 请求Napcat = (action: string, params: unknown, 超时毫秒 = 15000): Promise<unknown> =>
    客户端.request("napcat", "api", { action, params }, 超时毫秒);
  const 取机器人信息 = async (): Promise<{ user_id: 标识; nickname: string }> => {
    if (机器人缓存 && Date.now() - 缓存时间 < 5 * 60 * 1000) return 机器人缓存;
    const 数据 = (await 请求Napcat("get_login_info", {})) as {
      user_id?: 标识;
      nickname?: string;
    };
    机器人缓存 = { user_id: 数据.user_id ?? "", nickname: 数据.nickname ?? "苦瓜" };
    缓存时间 = Date.now();
    return 机器人缓存;
  };

  // —— 构建消息上下文（命令处理入参）——
  const 构建消息上下文 = async (事件: unknown): Promise<消息上下文> => {
    const e = (事件 ?? {}) as {
      message?: 消息段[];
      message_type?: string;
      group_id?: 标识;
      user_id?: 标识;
      self_id?: 标识;
    };
    const 消息段列 = e.message ?? [];
    const 文本 = 提取纯文本(消息段列);
    const at们 = 消息段列
      .filter((s) => s.type === "at")
      .map((s) => String(s.data.qq))
      .filter((v) => v.length > 0);
    const 是群 = e.message_type === "group";
    const 群号 = e.group_id ?? "";
    const 用户号 = e.user_id ?? "";
    const 机器人号 = e.self_id ?? "";
    const 回复参数 = 是群 ? { group_id: 群号 } : { user_id: 用户号 };

    const 转发摘要 = (内容: string | 消息段[]): string => {
      const 段列 = typeof 内容 === "string" ? [段.文本(内容)] : 内容;
      return 段列
        .map((m) => {
          if (m.type === "text") return String(m.data.text ?? "");
          if (m.type === "image") return String(m.data.file ?? "");
          return `[${m.type}]`;
        })
        .filter(Boolean)
        .join("\n");
    };

    return {
      类型: 是群 ? "group" : "private",
      群号,
      用户号,
      机器人号,
      消息段: 消息段列,
      文本,
      at们,
      事件,
      回复: async (内容) => {
        const 消息 = typeof 内容 === "string" ? [段.文本(内容)] : 内容;
        return 请求Napcat(是群 ? "send_group_msg" : "send_private_msg", {
          ...回复参数,
          message: 消息,
        });
      },
      转发: async (内容, 目标群号) => {
        const 群 = 目标群号 ?? 群号;
        if (!群) return;
        if (!是群) {
          // 私聊无法合并转发，回文本摘要
          await 请求Napcat("send_private_msg", {
            ...回复参数,
            message: [段.文本(转发摘要(内容))],
          });
          return;
        }
        const 消息列 = typeof 内容 === "string" ? [段.文本(内容)] : 内容;
        const bot = await 取机器人信息();
        const 节点: 消息段[] = [];
        const 每批 = 10;
        for (let i = 0; i < 消息列.length; i += 每批) {
          节点.push(段.自定义节点(bot.user_id, bot.nickname, 消息列.slice(i, i + 每批)));
        }
        await 请求Napcat("send_forward_msg", { group_id: 群, messages: 节点 }, 60000);
      },
      请求: (目标, 动作, 参数, 超时毫秒) => 客户端.request(目标, 动作, 参数, 超时毫秒 ?? 10000),
    };
  };

  // —— 消息分发：Napcat 事件 → 插件命令 ——
  const 分发事件 = async (事件: unknown): Promise<void> => {
    try {
      const 上下文 = await 构建消息上下文(事件);
      await 加载器.分发消息(上下文);
    } catch (err) {
      日志.错误(`消息分发失败：${String(err)}`);
    }
  };
  订阅总线("napcat.message.group", 分发事件);
  订阅总线("napcat.message.private", 分发事件);

  // —— 序列化插件记录供外部展示（不暴露实例）——
  const 记录转对象 = (r: ReturnType<typeof 加载器.获取> | undefined) =>
    r
      ? {
          name: r.name,
          version: r.元数据.version,
          description: r.元数据.description ?? "",
          author: r.元数据.author ?? "",
          homepage: r.元数据.homepage ?? "",
          状态: r.状态,
          命令: r.命令.map((c) => ({ 匹配: c.匹配.source, 说明: c.说明 ?? "" })),
          错误: r.错误 ?? "",
          加载时间: r.加载时间 ?? 0,
        }
      : null;

  // —— 请求动作 ——
  客户端.onRequest("plugins.list", () => 加载器.列表().map(记录转对象));

  客户端.onRequest("plugins.refresh", async () => {
    const 全部 = 加载器.扫描();
    for (const 记录 of 全部) {
      if (!加载器.获取(记录.name)) {
        try {
          await 加载器.加载(记录.name);
          await 加载器.启用(记录.name);
        } catch (err) {
          日志.错误(`刷新加载 ${记录.name} 失败：${String(err)}`);
        }
      }
    }
    await 注册插件声明();
    return { count: 加载器.列表().length };
  });

  客户端.onRequest("plugins.info", (params) => {
    const { name } = (params ?? {}) as { name?: string };
    if (!name) throw new Error("缺少 name");
    return 记录转对象(加载器.获取(name)) ?? { error: `插件不存在：${name}` };
  });

  客户端.onRequest("plugins.enable", async (params) => {
    const { name } = (params ?? {}) as { name?: string };
    if (!name) throw new Error("缺少 name");
    const 记录 = await 加载器.启用(name);
    return 记录转对象(记录);
  });

  客户端.onRequest("plugins.disable", async (params) => {
    const { name } = (params ?? {}) as { name?: string };
    if (!name) throw new Error("缺少 name");
    const 记录 = await 加载器.禁用(name);
    return 记录转对象(记录);
  });

  客户端.onRequest("plugins.reload", async (params) => {
    const { name } = (params ?? {}) as { name?: string };
    if (!name) throw new Error("缺少 name");
    const 记录 = await 加载器.重载(name);
    return 记录转对象(记录);
  });

  客户端.onRequest("plugins.install", async (params) => {
    const { repo = "", name = "" } = (params ?? {}) as { repo?: string; name?: string };
    if (!repo.trim()) throw new Error("缺少 repo（git 仓库地址）");
    const 插件名 = name.trim() || 从仓库URL取名(repo);
    const 目标目录 = resolve(插件目录, 插件名);
    if (existsSync(目标目录)) throw new Error(`插件目录已存在：${插件名}`);
    日志.信息(`安装插件 ${插件名} ← ${repo}`);
    await 克隆仓库(repo.trim(), 目标目录, 配置.gitTimeoutMs ?? 180000);
    if (!读取插件元数据(目标目录)) {
      throw new Error(`仓库缺少 kugua-plugin.json / package.json 元数据：${插件名}`);
    }
    await 安装依赖(目标目录, 配置.npmTimeoutMs ?? 300000);
    const 记录 = await 加载器.加载(插件名);
    await 加载器.启用(插件名);
    return 记录转对象(记录);
  });

  客户端.onRequest("plugins.update", async (params) => {
    const { name } = (params ?? {}) as { name?: string };
    if (!name) throw new Error("缺少 name");
    const 记录 = 加载器.获取(name);
    if (!记录) throw new Error(`插件未安装：${name}`);
    if (!existsSync(join(记录.目录, ".git"))) throw new Error(`插件 ${name} 非 git 安装，无法自动更新`);
    const 检查 = await 检查更新(记录.目录, 配置.gitTimeoutMs ?? 60000);
    if (!检查.有更新) return { name, updated: false, from: 检查.原提交, to: 检查.新提交 };
    日志.信息(`更新插件 ${name}：${检查.原提交.slice(0, 7)} → ${检查.新提交.slice(0, 7)}`);
    await 拉取更新(记录.目录, 配置.gitTimeoutMs ?? 120000);
    await 安装依赖(记录.目录, 配置.npmTimeoutMs ?? 300000);
    const 新记录 = await 加载器.重载(name);
    return { name, updated: true, from: 检查.原提交, to: 检查.新提交, ...记录转对象(新记录) };
  });

  客户端.onRequest("plugins.uninstall", async (params) => {
    const { name } = (params ?? {}) as { name?: string };
    if (!name) throw new Error("缺少 name");
    const 记录 = 加载器.获取(name);
    if (!记录) throw new Error(`插件未安装：${name}`);
    if (!校验路径在目录内(记录.目录, resolve(插件目录))) {
      throw new Error(`插件目录越界，拒绝卸载：${记录.目录}`);
    }
    await 加载器.卸载(name);
    删除插件目录(记录.目录);
    日志.信息(`插件已卸载：${name}`);
    return { name, removed: true };
  });

  客户端.onRequest("plugins.market.list", async () => {
    if (!市场索引) throw new Error("未配置市场索引（kugua.config.json plugins.marketIndex）");
    const 条目 = await 抓取市场(市场索引);
    const 带状态 = 条目.map((m: 市场条目) => ({
      ...m,
      installed: Boolean(加载器.获取(m.name)),
      localVersion: 加载器.获取(m.name)?.元数据.version ?? "",
    }));
    return { url: 市场索引, entries: 带状态 };
  });

  // 动态探测插件目录：未加载的插件自动加载启用，已消失的插件自动卸载
  客户端.onRequest("plugins.detect", async () => {
    return 动态检测();
  });

  /** 扫描目录与当前加载表做差集：新增则加载启用，消失则卸载 */
  const 动态检测 = async (): Promise<{ 已加载: string[]; 已卸载: string[] }> => {
    const 已加载: string[] = [];
    const 已卸载: string[] = [];
    const 磁盘 = 加载器.扫描();
    const 磁盘名集 = new Set(磁盘.map((r) => r.name));
    // 新出现的插件：加载并启用
    for (const 记录 of 磁盘) {
      if (加载器.获取(记录.name)) continue;
      try {
        await 加载器.加载(记录.name);
        await 加载器.启用(记录.name);
        已加载.push(记录.name);
        日志.信息(`动态发现并启用插件：${记录.name}`);
      } catch (err) {
        日志.错误(`动态加载插件 ${记录.name} 失败：${String(err)}`);
      }
    }
    if (已加载.length > 0) await 注册插件声明();
    // 目录已消失的插件：卸载
    for (const 记录 of 加载器.列表()) {
      if (磁盘名集.has(记录.name)) continue;
      try {
        await 加载器.卸载(记录.name);
        已卸载.push(记录.name);
        日志.信息(`插件目录已消失，自动卸载：${记录.name}`);
      } catch (err) {
        日志.警告(`自动卸载 ${记录.name} 失败：${String(err)}`);
      }
    }
    if (已加载.length || 已卸载.length) {
      客户端.sendEvent("plugins.changed", { 已加载, 已卸载 });
    }
    return { 已加载, 已卸载 };
  };

  // —— 目录监听：插件目录下新增/删除目录时自动检测（防抖）——
  let 目录监听: import("node:fs").FSWatcher | null = null;
  let 防抖定时: NodeJS.Timeout | null = null;
  try {
    目录监听 = 监视目录(插件目录, () => {
      if (防抖定时) clearTimeout(防抖定时);
      防抖定时 = setTimeout(() => void 动态检测().catch((err) => 日志.错误(`自动检测插件失败：${String(err)}`)), 1200);
    });
  } catch (err) {
    日志.警告(`插件目录监听启动失败（将定时兜底）：${String(err)}`);
  }
  // 定时兜底：目录监听在部分平台（如网络盘）不可靠
  const 定时检测 = setInterval(() => void 动态检测().catch(() => undefined), 15000);
  if (typeof 定时检测.unref === "function") 定时检测.unref();

  return {
    加载器,
    注册声明: 注册插件声明,
    关闭: async () => {
      日志.信息("正在关闭插件运行时……");
      if (防抖定时) clearTimeout(防抖定时);
      clearInterval(定时检测);
      try {
        目录监听?.close();
      } catch {
        /* 忽略 */
      }
      await 加载器.卸载全部();
    },
  };
}

/** 由读配置阶段写入，供注册/就绪阶段使用 */
let 插件目录: string | null = null;
let 市场索引: string | null = null;
let gitTimeoutMs: number | undefined;
let npmTimeoutMs: number | undefined;
let 运行时实例: ReturnType<typeof 启动插件运行时> | null = null;

void 启动模块({
  name: "plugins",
  version: "0.1.0",
  仅在主模块启动: true,
  入口文件URL: import.meta.url,
  读配置: (文件配置: Record<string, unknown>) => {
    const p = (文件配置.plugins ?? {}) as {
      dir?: string;
      marketIndex?: string;
      gitTimeoutMs?: number;
      npmTimeoutMs?: number;
    };
    插件目录 = process.env.KUGUA_PLUGINS_DIR ?? p.dir ?? "plugins";
    市场索引 = process.env.KUGUA_PLUGINS_MARKET ?? p.marketIndex ?? "";
    gitTimeoutMs = p.gitTimeoutMs;
    npmTimeoutMs = p.npmTimeoutMs;
    return {};
  },
  注册: (客户端) => {
    mkdirSync(插件目录!, { recursive: true });
    const 运行时 = 启动插件运行时(客户端, {
      插件目录: 插件目录!,
      市场索引: 市场索引!,
      gitTimeoutMs,
      npmTimeoutMs,
    });
    运行时实例 = 运行时;
  },
  关闭: async () => {
    await 运行时实例?.关闭();
  },
  就绪: async () => {
    const 日志 = 创建日志器("[插件运行时]");
    日志.信息(`插件目录：${resolve(插件目录!)}，市场：${市场索引 || "未配置"}`);
    await 运行时实例?.加载器.加载全部();
    日志.信息(`已接入主控，在线插件 ${运行时实例?.加载器.列表().filter((r) => r.状态 === "enabled").length ?? 0} 个`);
    // 插件清单里声明的配置，上报给主控后就能在配置页里编辑。
    // 时机必须在「加载全部」之后——声明是从已加载的插件元数据里读的。
    await 运行时实例?.注册声明();
  },
});
