/**
 * 苦瓜工作室主控守护进程
 * 职责：
 *   - 监听本地端口、认证并注册模块、路由模块间消息
 *   - 根据 kugua.config.json 的 modules 配置，自动启动「autoStart」的进程型模块
 *   - 对 library 型模块，检测文件存在性
 *   - 通过内置动作提供「模块详情 / 启动 / 停止」能力
 *   - 退出时广播 system.shutdown 事件，再依次关闭子进程
 * 配置：读取 KUGUA_CONFIG 指定的文件，缺省为当前目录下 kugua.config.json（可选）
 */

import { existsSync, readFileSync, renameSync, statSync, writeFileSync } from "node:fs";
import { resolve as pathResolve } from "node:path";
import { spawn, type ChildProcess } from "node:child_process";
import { createServer as 创建探测服务器 } from "node:net";
import {
  NiganeServer,
  type 模块信息,
  type 模块描述,
  type 模块详情,
} from "@kugua/nigane";
import { 能力注册表, type 能力声明, type 能力入口 } from "@kugua/capability";
import { 归一全部能力 } from "./capability-normalize.js";
import type { 配置声明 } from "@kugua/nigane";
import { 审计日志, type 审计过滤 } from "@kugua/audit";
import { 日志器, type 日志级别 } from "@kugua/logger";
import { 抢占全局单例锁, 读取单实例锁, 全局单例锁路径 } from "@kugua/paths";
import {
  判定重新接入,
  能力指纹,
  规整路径,
  type 上报快照,
} from "./module-identity.js";
import {
  保存模块配置,
  全部声明,
  取声明,
  构造表单模型,
  构造载荷,
  记录声明,
  读取模块配置,
} from "./module-config.js";

interface 主控配置 {
  host: string;
  port: number;
  token: string;
  /** 模块注册表：主控侧管理的模块定义 */
  modules?: 模块描述[];
  /**
   * 其它顶层配置节（如 `ai`、`plugins`）原样透传。
   * 主控只读写自己认识的字段，但**必须把不认识的节原样写回**，
   * 否则每次落盘都会静默抹掉模块自己的配置。
   */
  [其它节: string]: unknown;
}

/** 加载配置：文件缺失或非法时回落到默认值 */
function 加载配置(): 主控配置 {
  const 默认: 主控配置 = { host: "127.0.0.1", port: 24601, token: "", modules: [] };
  const 路径 = 配置路径();
  if (!existsSync(路径)) return 默认;
  try {
    const 文本 = readFileSync(路径, "utf-8");
    const 对象 = JSON.parse(文本) as Partial<主控配置>;
    return {
      // 先展开原文件，保留本次不认识的配置节（ai / plugins / …）
      ...对象,
      host: typeof 对象.host === "string" ? 对象.host : 默认.host,
      port: typeof 对象.port === "number" ? 对象.port : 默认.port,
      token: typeof 对象.token === "string" ? 对象.token : 默认.token,
      modules: Array.isArray(对象.modules) ? (对象.modules as 模块描述[]) : [],
    };
  } catch (err) {
    console.warn(`[主控] 配置文件解析失败，使用默认配置：${String(err)}`);
    return 默认;
  }
}

/** 配置文件路径 */
function 配置路径(): string {
  return process.env.KUGUA_CONFIG
    ? pathResolve(process.cwd(), process.env.KUGUA_CONFIG)
    : pathResolve(process.cwd(), "kugua.config.json");
}

/** 配置指纹：文件不存在返回空串，存在返回修改时间+大小 */
function 配置指纹(): string {
  try {
    const st = statSync(配置路径());
    return `${st.mtimeMs}:${st.size}`;
  } catch {
    return "";
  }
}

/**
 * 探测指定端口是否已被占用。
 *
 * 注意：端口占用**不等于**已有工作室实例——可能是其他程序占了这个端口。
 * 单例判定一律以全局锁为准；本函数只用于启动前报“端口冲突”。
 */
function 端口被占用(host: string, port: number): Promise<boolean> {
  return new Promise((resolve) => {
    const 探测器 = 创建探测服务器();
    探测器.once("error", (err: NodeJS.ErrnoException) => {
      resolve(err.code === "EADDRINUSE");
    });
    探测器.once("listening", () => 探测器.close(() => resolve(false)));
    探测器.listen(port, host);
  });
}

/** 子进程运行时信息 */
interface 子进程记录 {
  proc: ChildProcess;
  name: string;
  /** 模块是否已通过 hello 注册到主控（online） */
  registered: boolean;
}

/** 平台版本（供外部模块查询；与根 package.json 保持同步） */
const 平台版本 = "0.9.0";
/** 平台启动时间（毫秒） */
const 平台启动时间 = Date.now();

const 子进程表 = new Map<string, 子进程记录>();
const 库文件状态 = new Map<string, boolean>(); // name → exists?
/** 全局能力注册表：由模块握手声明汇总而来，驱动指令/GUI/定时/MCP */
const 能力表 = new 能力注册表();
/** 审计日志（启动时初始化） */
let 审计: 审计日志 | null = null;
/** 日志器（启动时初始化） */
let 日志器实例: 日志器 | null = null;

/** 运行时共享（由 启动() 初始化后可用） */
let 配置: 主控配置 = { host: "127.0.0.1", port: 24601, token: "", modules: [] };
let 服务端: NiganeServer | null = null;
/** 全局单例锁的释放函数（退出时调用） */
let 释放全局锁: () => void = () => undefined;

/**
 * 全系统单例守卫（第一道，且是强制的）。
 *
 * 锁文件位置与 cwd / 配置 / KUGUA_DATA_DIR 全部无关，
 * 因此改端口、改配置、改数据目录、换目录启动都无法绕过。
 */
function 全局单例守卫(): void {
  // 由 WebUI 拉起的子主控：锁应由父进程持有，同一个 Studio 实例无需重复抢锁。
  // 为防止环境变量被滥用绕过单例，还要验证锁确实存在且不属于自己。
  if (process.env.KUGUA_LOCK_HELD === "1") {
    const 现有 = 读取单实例锁(全局单例锁路径());
    if (现有 && 现有.pid !== process.pid) {
      释放全局锁 = () => undefined;
      return;
    }
    console.error("[主控] KUGUA_LOCK_HELD 声明了锁但未找到有效的实例锁，按独立实例处理。");
  }
  const 锁 = 抢占全局单例锁(全局单例锁路径(), "studio", {
    pid: process.pid,
    入口: "main",
  });
  if (!锁.获得) {
    console.error(
      `[主控] 已有工作室实例在运行（pid=${锁.已有?.pid ?? "?"}），本实例退出。\n` +
        `[主控] 单例锁：${锁.锁路径}`,
    );
    process.exit(0);
  }
  释放全局锁 = 锁.释放;
}

/** 当前是否有其它工作室实例在运行（不抢锁，仅供探测） */
export function 已有实例运行(锁路径: string = 全局单例锁路径()): {
  pid: number;
  附加?: Record<string, unknown>;
} | null {
  const 信息 = 读取单实例锁(锁路径);
  return 信息 ? { pid: 信息.pid, 附加: 信息.附加 } : null;
}

/**
 * 优雅关闭入口。
 *
 * 为什么要暴露成模块级变量：Windows 上对子进程 `kill("SIGTERM")` 实际上是
 * `TerminateProcess` 硬杀，Node 的 `process.on("SIGTERM")` 处理器不会执行，
 * 导致 `服务端.stop()` 里的 `system.shutdown` 广播永远发不出去。
 * 所以由 WebUI 通过内置动作 `nigane.shutdown` 主动请求主控优雅关闭。
 */
let 请求关闭: (() => Promise<void>) | null = null;

/** 内置动作：请求主控优雅关闭（先广播 system.shutdown，再结束托管子进程） */
function 注册关闭动作(服务端: NiganeServer): void {
  服务端.handle("nigane.shutdown", async () => {
    // 不阻塞响应：先回执，再异步关闭
    setTimeout(() => void 请求关闭?.(), 100);
    return { shuttingDown: true };
  });
}

async function 启动(): Promise<void> {
  // —— 第一道守卫：全局单例锁（与端口/配置无关）——
  全局单例守卫();

  配置 = 加载配置();

  // —— 第二道：端口冲突检查（与单例无关，只报“端口被占”，绝不当作已有实例）——
  if (await 端口被占用(配置.host, 配置.port)) {
    console.error(
      `[主控] 启动失败：端口 ${配置.host}:${配置.port} 已被其他程序占用。\n` +
        `[主控] 请在 kugua.config.json 中修改 port（或设置环境变量 KUGUA_PORT）后重试。`,
    );
    释放全局锁();
    process.exit(1);
  }

  服务端 = new NiganeServer(配置);

  // —— 审计日志 ——
  审计 = new 审计日志(process.env.KUGUA_AUDIT_DB ?? pathResolve(process.cwd(), "data/audit.db"));

  // —— 日志：环形缓冲 + 限流落盘；捕获控制台输出（含各模块）——
  日志器实例 = new 日志器({
    文件: process.env.KUGUA_LOG_FILE ?? pathResolve(process.cwd(), "data/logs/main.log"),
    容量: 4000,
    落盘间隔毫秒: 2000,
  });
  安装日志捕获(日志器实例);

  // —— 注入模块描述表 ——
  for (const m of 配置.modules ?? []) 服务端.setDescription(m);

  // —— 注册自定义内置动作：详情 / 启动 / 停止 ——
  注册内置动作(服务端);
  注册关闭动作(服务端);

  // —— 日志 ——
  服务端.on("registered", (信息: 模块信息) => {
    const 记录 = 子进程表.get(信息.name);
    if (记录) 记录.registered = true;
    汇总能力(信息);
    服务端?.broadcast("capability.changed", { 模块: 信息.name, 数量: 能力表.按模块(信息.name).length });
    // 能力可能只声明在 capabilityDefs 里（不填 capabilities 字段），故两处合并展示
    const 能力名集 = new Set<string>([
      ...(信息.capabilities ?? []),
      ...(信息.capabilityDefs ?? []).map((c) => c.名称),
    ]);
    console.log(
      `[主控] 模块上线：${信息.name}（版本 ${信息.version ?? "未知"}，路径 ${信息.path ?? "未上报"}，能力：${[...能力名集].join("、") || "无"}）`,
    );
    // 外部模块自报托管意愿 → 首次注册写入配置；已有配置则不覆盖
    if (信息.托管) 处理托管申请(信息);
    // 记录配置声明（供配置页渲染，离线后仍可用）
    记录声明(信息.name, 信息.配置声明);
    // 推送当前配置：模块首次上线就拿到自己的配置，免去自行读盘
    服务端?.sendEventTo(信息.name, "module.config", 构造载荷(信息.name, "初始化", []));
    // 记录本次成功上线使用的版本与能力指纹（供下次接入时比对）
    记录模块快照(信息);
    // 首次上线后探测是否实现 module.query，结果持久化供下次握手门禁使用
    void 探测可查询性(信息.name);
  });
  服务端.on("unregistered", (名: string) => {
    const 记录 = 子进程表.get(名);
    if (记录) 记录.registered = false;
    能力表.移除模块(名);
    服务端?.broadcast("capability.changed", { 模块: 名, 数量: 0 });    console.log(`[主控] 模块离线：${名}`);
  });

  await 服务端.start();
  // 通知已在线的模块：平台已就绪（模块可选择处理或忽略）
  服务端.broadcast("system.startup", {
    版本: 平台版本,
    协议: "0.2",
    启动时间: 平台启动时间,
  });
  console.log(`[主控] 苦音服务端已启动：ws://${配置.host}:${配置.port}`);

  // —— 握手门禁：按身份/版本/路径决定是否允许接入 ——
  服务端.握手校验 = (信息: 模块信息) => 校验接入(信息);
  if (!配置.token) {
    console.warn("[主控] 警告：未配置 token，任何本地进程均可接入，请在 kugua.config.json 中设置。");
  }

  // —— 库型模块：检测文件存在 ——
  for (const m of 配置.modules ?? []) {
    if (m.type === "library" && m.file) {
      const ok = existsSync(pathResolve(process.cwd(), m.file));
      库文件状态.set(m.name, ok);
      console.log(`[主控] 库模块 ${m.name}：${ok ? "就绪" : "未找到文件：" + m.file}`);
    }
  }

  // —— 进程型模块：并行启动 autoStart=true 的项（不互相阻塞，注册即视为就绪） ——
  const 启动列表 = (配置.modules ?? []).filter((m) => m.type === "process" && m.autoStart);
  console.log(`[主控] 自动启动模块（${启动列表.length} 项）`);
  const 启动结果 = await Promise.allSettled(启动列表.map((m) => 启动模块(m)));
  启动结果.forEach((r, i) => {
    if (r.status === "rejected") {
      console.error(`[主控] 自动启动失败：${启动列表[i].name} — ${String(r.reason)}`);
    }
  });

  // —— 配置热检测：kugua.config.json 变化后自动重新检测模块（新增/卸载/变更）——
  let 上次配置指纹 = 配置指纹();
  const 检测定时器 = setInterval(() => {
    const 指纹 = 配置指纹();
    if (指纹 === 上次配置指纹) return;
    上次配置指纹 = 指纹;
    console.log("[主控] 检测到 kugua.config.json 变更，自动重新检测模块……");
    重新检测模块(true).catch((err) => console.error("[主控] 自动检测模块失败：" + String(err)));
  }, 5000);
  if (typeof 检测定时器.unref === "function") 检测定时器.unref();

  // —— 关闭 ——
  const 关闭 = async (): Promise<void> => {
    clearInterval(检测定时器);
    console.log("[主控] 正在关闭……");
    // 1) 先广播 system.shutdown：运行中接入的外部程序据此自行决定是否退出
    //    （平台不持有它们的进程，也不对其发信号）
    //    这一步必须在结束任何进程之前，否则外部程序看不到通知。
    if (!服务端) {
      释放全局锁();
      process.exit(0);
    }
    // 1) 广播 system.shutdown，同时等待 server.stop 内置的 200ms
    await 服务端.stop(500);
    // 2) 逐个关闭进程型子进程
    for (const [name, 记录] of 子进程表) {
      try {
        if (!记录.proc.killed) {
          console.log(`[主控] 终止子进程：${name}（pid=${记录.proc.pid ?? "?"}）`);
          记录.proc.kill("SIGTERM");
        }
      } catch (err) {
        console.warn(`[主控] 终止 ${name} 失败：${String(err)}`);
      }
    }
    // 3) 兜底：再等 2 秒后强制 kill
    const 等待 = new Promise<void>((resolve) => setTimeout(resolve, 2000));
    await 等待;
    for (const [name, 记录] of 子进程表) {
      if (!记录.proc.killed) {
        try {
          记录.proc.kill("SIGKILL");
        } catch {
          // ignore
        }
      }
      void name;
    }
    审计?.close();
    await 日志器实例?.关闭();
    释放全局锁();
    process.exit(0);
  };
  // 暴露给内置动作 nigane.shutdown（Windows 上 SIGTERM 会被硬杀，靠它才能优雅退出）
  请求关闭 = 关闭;
  process.on("SIGINT", () => void 关闭());
  process.on("SIGTERM", () => void 关闭());  // 异常/意外退出也释放全局锁，避免遗留陈旧锁阻止下次启动
  process.on("exit", () => 释放全局锁());
}

function 注册内置动作(服务端: NiganeServer): void {
  // ===== 模块配置（声明式、双向推送） =====

  /** 列出所有模块的配置声明，供 UI 渲染表单 */
  服务端.handle("nigane.moduleConfig.declarations", () => 全部声明());

  /**
   * 为**其他名字**注册配置声明。
   *
   * 模块自己用 `moduleConfig.report` 就够了（名字就是发送者）。
   * 但插件不是独立进程：它们的声明要由 plugins 模块代报，
   * 而发送者是 `plugins`、声明却属于各个插件——名字对不上。
   * 这个接口专门解决代报场景，只允许用于**已注册模块代其管理的子项**
   * （本机进程同一信任域，不做更细的鉴权）。
   */
  服务端.handle("nigane.moduleConfig.declare", (params) => {
    const p = (params ?? {}) as { name?: string; 声明?: 配置声明 };
    if (!p.name) throw new Error("缺少 name");
    if (!p.声明) throw new Error("缺少 声明");
    记录声明(p.name, p.声明);
    return { 名称: p.name, 字段数: p.声明.字段.length };
  });

  /**
   * 读取某模块/插件的**原始配置值**（已合并 local 覆盖层，凭据为明文）。
   *
   * 与 `moduleConfig.get` 的区别：那个是给 UI 用的表单模型（带标题、
   * 类型、脱敏占位），这个是给**代码**用的——模块/插件自己要读配置，
   * 需要的是真实值而不是「已设置」这种展示态。
   *
   * 仅供本机进程内使用（同一信任域），不对外暴露。
   */
  服务端.handle("nigane.moduleConfig.getModule", (params) => {
    const p = (params ?? {}) as { name?: string };
    if (!p.name) throw new Error("缺少 name");
    return 读取模块配置(p.name);
  });

  /**
   * 获取某模块的配置表单模型。
   *
   * 值已合并 local 覆盖层；凭据字段不回传明文，只标 `已设置`。
   */
  服务端.handle("nigane.moduleConfig.get", (params) => {
    const p = (params ?? {}) as { name?: string };
    if (!p.name) throw new Error("缺少 name");
    return 构造表单模型(p.name);
  });

  /**
   * 写入某模块的配置并推送给它。
   *
   * 凭据字段自动落入 `kugua.config.local.json`；写盘成功后向该模块
   * 推送 `module.config`，它自行热重载。
   */
  服务端.handle("nigane.moduleConfig.set", (params, 发送者) => {
    const p = (params ?? {}) as { name?: string; 变更?: Record<string, unknown> };
    if (!p.name) throw new Error("缺少 name");
    if (!p.变更 || typeof p.变更 !== "object") throw new Error("缺少 变更");
    const 变更列表 = 保存模块配置(p.name, p.变更, 取声明(p.name));
    if (变更列表.length > 0) {
      console.log(`[主控] 模块「${p.name}」配置已更新：${变更列表.join("；")}（操作者：${发送者}）`);
    }
    // 推送合并后的完整配置（含凭据）给该模块，让它热重载
    服务端.sendEventTo(p.name, "module.config", 构造载荷(p.name, "用户", 变更列表));
    // 同时广播节名，供 UI 刷新
    服务端.broadcast("module.config.changed", { 模块: p.name, 变更: 变更列表 });
    return { 更新: 变更列表.length > 0, 变更: 变更列表, 配置: 读取模块配置(p.name) };
  });

  /**
   * 模块主动上报自己的配置变更。
   *
   * 平台写盘成功后，把结果**广播给所有模块**（含自己），
   * 这样其他模块也能感知到变化（例如 AI 模型列表更新后 UI 跟着刷新）。
   */
  服务端.handle("nigane.moduleConfig.report", (params, 发送者) => {
    const p = (params ?? {}) as { 变更?: Record<string, unknown>; 声明?: 配置声明 };
    if (!p.变更 || typeof p.变更 !== "object") throw new Error("缺少 变更");
    // 模块可能同时更新自己的字段声明（例如动态音色列表）
    if (p.声明) 记录声明(发送者, p.声明);
    const 变更列表 = 保存模块配置(发送者, p.变更, 取声明(发送者));
    const 载荷 = 构造载荷(发送者, "模块", 变更列表);
    for (const 名 of 服务端.moduleNames()) 服务端.sendEventTo(名, "module.config", 载荷);
    服务端.broadcast("module.config.changed", { 模块: 发送者, 变更: 变更列表 });
    return { 更新: 变更列表.length > 0, 变更: 变更列表 };
  });

  // 模块详情：供 WebUI/其他模块查询运行时状态
  服务端.handle("nigane.registry.details", () => 构造详情(服务端));

  // ===== 模块状态与身份管理 =====

  /**
   * 向指定模块发送状态查询（module.query），要求其重报自身信息。
   * 模块必须实现该动作；超时或不回则判为离线（状态灯标红）。
   *
   * 平台也用它做「刷新」：刷新后若模块上线且版本/路径/名称一致，则重新变绿。
   */
  服务端.handle("nigane.registry.query", async (params) => {
    const { name } = (params ?? {}) as { name?: string };
    if (!name) throw new Error("缺少 name");
    try {
      const 结果 = (await 服务端.request(name, "module.query", {}, 3000)) as {
        name?: string;
        version?: string;
        path?: string;
        capabilityDefs?: 能力声明[];
        托管?: { entry?: string };
      } | null;
      if (!结果) throw new Error("模块未返回状态");
      const 在线 =
        结果.name === undefined || 结果.name === name;
      if (!在线) throw new Error(`模块名不匹配（期望 ${name}，返回 ${结果.name}）`);

      // 刷新成功后：比对版本/路径/能力，决定是否允许恢复上线
      const 配置项 = (加载配置().modules ?? []).find((m) => m.name === name);
      if (!配置项) return { 在线: true, 状态: "unregistered", 版本: 结果.version };

      const 上报: 上报快照 = {
        name,
        version: 结果.version,
        path: 结果.path ?? 结果.托管?.entry,
        capabilityHash: 能力指纹(结果.capabilityDefs as unknown as Array<Record<string, unknown>>),
      };
      const 判定 = 判定重新接入(
        {
          name: 配置项.name,
          version: 配置项.version,
          path: 配置项.modulePath ?? 配置项.entry ?? 配置项.file,
          capabilityHash: 配置项.capabilityHash,
          autoUpdate: 配置项.autoUpdate,
        },
        上报,
      );
      if (判定.类型 === "online" || 判定.类型 === "first") {
        待确认模块.delete(name);
        拒绝模块.delete(name);
        return { 在线: true, 状态: "online", 版本: 结果.version };
      }
      if (判定.类型 === "auto-update") {
        记录模块快照({
          name,
          version: 结果.version,
          capabilityDefs: 结果.capabilityDefs,
        } as 模块信息);
        待确认模块.delete(name);
        拒绝模块.delete(name);
        return { 在线: true, 状态: "auto-update", 旧版本: 判定.旧版本, 新版本: 判定.新版本 };
      }
      return { 在线: true, 状态: "需人工确认", 判定 };
    } catch (err) {
      // 查不到状态 → 视为离线
      服务端?.broadcast("module.offline", { 模块: name, 原因: String(err) });
      return { 在线: false, 状态: "offline", 原因: String(err) };
    }
  });

  /** 手动确认采纳模块的新信息（信息变化 / 版本回退 / 关闭自动更新时的升级） */
  服务端.handle("nigane.registry.apply", async (params) => {
    const { name } = (params ?? {}) as { name?: string };
    if (!name) throw new Error("缺少 name");

    // 情形一：有新版本但自动更新关闭 → 接受后重启模块使其生效
    const 升级 = 手动更新提示.get(name);
    if (升级) {
      const 当前配置0 = 加载配置();
      const 表0 = 当前配置0.modules ?? [];
      const 项0 = 表0.find((m) => m.name === name);
      if (!项0) throw new Error(`模块不存在：${name}`);
      项0.version = 升级.新版本;
      if (!保存配置({ ...当前配置0, modules: 表0 })) throw new Error("保存配置失败");
      服务端?.setDescription(项0);
      手动更新提示.delete(name);
      待确认模块.delete(name);
      // 重启模块以加载新版本代码（失败不影响版本记录）
      try {
        if (子进程表.has(name)) {
          await 停止模块(name);
        }
        await 启动模块(项0);
      } catch (err) {
        console.warn(`[主控] 模块「${name}」重启失败：${String(err)}`);
      }
      console.log(`[主控] 模块「${name}」已手动更新到版本 ${升级.新版本}。`);
      服务端?.broadcast("registry.changed", { 变更: "手动更新", 模块: name });
      return { 更新: true, 版本: 升级.新版本 };
    }

    const 待确认 = 待确认模块.get(name);
    if (!待确认) throw new Error(`模块 ${name} 没有待确认的信息更新`);
    const 当前配置 = 加载配置();
    const 表 = 当前配置.modules ?? [];
    const 项 = 表.find((m) => m.name === name);
    if (!项) throw new Error(`模块不存在：${name}`);
    项.version = 待确认.新版本 === "?" ? 项.version : 待确认.新版本;
    if (待确认.上报.path) 项.entry = 待确认.上报.path;
    if (待确认.上报.capabilityHash) 项.capabilityHash = 待确认.上报.capabilityHash;
    if (!保存配置({ ...当前配置, modules: 表 })) throw new Error("保存配置失败");
    服务端?.setDescription(项);
    待确认模块.delete(name);
    console.log(`[主控] 模块「${name}」已按手动确认更新到版本 ${项.version ?? "?"}。`);
    服务端?.broadcast("registry.changed", { 变更: "手动更新", 模块: name });
    return { 更新: true, 版本: 项.version };
  });

  /** 取消注册（移除模块定义；运行中的外部模块会被要求退出但不强杀） */
  服务端.handle("nigane.registry.remove", async (params) => {
    const { name } = (params ?? {}) as { name?: string };
    if (!name) throw new Error("缺少 name");
    const 当前配置 = 加载配置();
    const 表 = 当前配置.modules ?? [];
    const 索引 = 表.findIndex((m) => m.name === name);
    if (索引 < 0) return { 移除: false, 原因: "不存在" };
    表.splice(索引, 1);
    if (!保存配置({ ...当前配置, modules: 表 })) throw new Error("保存配置失败");
    // 先请模块自行退出，再断开连接（外部模块不强杀）
    try {
      await 服务端.request(name, "module.shutdown", {}, 1500);
    } catch {
      // 模块不在线或未实现：忽略
    }
    待确认模块.delete(name);
    拒绝模块.delete(name);
    手动更新提示.delete(name);
    console.log(`[主控] 模块「${name}」已取消注册。`);
    服务端?.broadcast("registry.changed", { 变更: "移除", 模块: name });
    return { 移除: true };
  });

  /** 待确认 / 被拒绝模块列表（供管理界面显示红灯） */
  服务端.handle("nigane.registry.pending", () => ({
    待确认: [...待确认模块.entries()].map(([名, v]) => ({ name: 名, ...v })),
    拒绝: [...拒绝模块.entries()].map(([名, v]) => ({ name: 名, ...v })),
  }));

  /**
   * 平台健康与版本：外部模块可通过 SDK 查询平台在线状态与版本信息。
   */
  服务端.handle("nigane.platform.info", () => ({
    在线: true,
    平台: "苦瓜工作室",
    版本: 平台版本,
    协议: "0.2",
    启动时间: 平台启动时间,
    运行秒数: Math.floor((Date.now() - 平台启动时间) / 1000),
    模块数: 服务端.descriptionNames().length,
  }));

  // ===== 能力注册表 =====
  // 列出能力（可按入口/模块过滤）
  服务端.handle("capability.list", (params) => {
    const p = (params ?? {}) as { 入口?: 能力入口; 模块?: string; 允许危险?: boolean };
    return 能力表.列表({ 入口: p.入口, 模块: p.模块, 允许危险: p.允许危险 });
  });

  // 获取单个能力声明
  服务端.handle("capability.get", (params) => {
    const { 名称 } = (params ?? {}) as { 名称?: string };
    return 名称 ? (能力表.获取(名称) ?? null) : null;
  });

  // 统一调用：按能力名路由到提供者模块
  服务端.handle("capability.call", async (params, 发送者) => {
    const { 名称, 参数 } = (params ?? {}) as { 名称?: string; 参数?: unknown };
    if (!名称) throw new Error("缺少 名称");
    const 声明 = 能力表.获取(名称);
    return 带审计(
      "capability.call",
      发送者,
      { capability: 名称, module: 声明?.模块 ?? "", action: 声明?.动作 ?? 名称, params: 参数 },
      () => 能力表.调用(名称, 参数, 主控调用器, "capability.call"),
    );
  });

  // 中文指令：匹配指令并调用（供 WebUI/会话入口使用）
  服务端.handle("capability.command", async (params, 发送者) => {
    const { 文本 } = (params ?? {}) as { 文本?: string };
    const 命中 = 能力表.匹配指令(String(文本 ?? ""));
    if (!命中) return { 命中: false };
    const 结果 = await 带审计(
      "capability.command",
      发送者,
      {
        capability: 命中.能力.名称,
        module: 命中.能力.模块,
        action: 命中.能力.动作 ?? 命中.能力.名称,
        params: { 原文: 文本 },
      },
      () =>
        能力表.调用(
          命中.能力.名称,
          { 参数文本: 命中.参数文本, 原文: 文本 },
          主控调用器,
          "capability.command",
        ),
    );
    return { 命中: true, 能力: 命中.能力.名称, 模块: 命中.能力.模块, 参数文本: 命中.参数文本, 结果 };
  });

  // ===== 审计查询 =====
  服务端.handle("audit.list", (params) => 审计?.查询((params ?? {}) as 审计过滤) ?? []);
  服务端.handle("audit.stats", () => 审计?.统计() ?? null);
  服务端.handle("audit.clear", (params) => {
    const { 早于 } = (params ?? {}) as { 早于?: number };
    const 阈值 = typeof 早于 === "number" ? 早于 : Math.floor(Date.now() / 1000) - 7 * 86400;
    return { 已删除: 审计?.清理(阈值) ?? 0 };
  });

  // ===== 日志查询 =====
  服务端.handle("log.tail", (params) => {
    const p = (params ?? {}) as {
      模块?: string;
      级别?: 日志级别;
      since?: number;
      关键词?: string;
      limit?: number;
    };
    return (
      日志器实例?.查询({
        模块: p.模块,
        级别: p.级别,
        since: p.since,
        关键词: p.关键词,
        limit: typeof p.limit === "number" ? p.limit : 200,
      }) ?? []
    );
  });
  服务端.handle("log.stats", () => 日志器实例?.统计() ?? []);
  服务端.handle("log.clear", () => {
    日志器实例?.清空();
    return { cleared: true };
  });

  // ===== 通信日志（主控视角的总线收发，含调用双方与传参）=====
  服务端.handle("nigane.traffic.tail", (params) => {
    const p = (params ?? {}) as { limit?: number };
    return 服务端.trafficTail(typeof p.limit === "number" ? p.limit : 300);
  });
  服务端.handle("nigane.traffic.clear", () => {
    服务端.trafficClear();
    return { cleared: true };
  });
  // 实时转发给 WebUI（若已接入总线）
  服务端.on("log", (条目: unknown) => {
    服务端?.sendEventTo("webui", "nigane.traffic", 条目);
  });

  // 启动模块（仅 process 型；已运行则忽略；未在描述表的话报错）
  服务端.handle("nigane.registry.start", (params, 发送者) => {
    const { name } = (params ?? {}) as { name?: string };
    if (!name) throw new Error("缺少 name");
    const 描述 = 服务端.getDescription(name);
    if (!描述) throw new Error(`模块未在注册表：${name}`);
    if (描述.type !== "process") throw new Error(`模块非 process 类型：${name}`);
    if (子进程表.has(name) && !子进程表.get(name)!.proc.killed) {
      return { started: false, reason: "already", pid: 子进程表.get(name)!.proc.pid ?? null };
    }
    return 带审计("registry.start", 发送者, { capability: "", module: name, action: "start", params: undefined }, () =>
      启动模块(描述).then((r) => ({ started: true, pid: r?.pid ?? null })),
    );
  });

  // 停止模块（仅 process 型；未运行忽略）
  服务端.handle("nigane.registry.stop", (params, 发送者) => {
    const { name } = (params ?? {}) as { name?: string };
    if (!name) throw new Error("缺少 name");
    const 记录 = 子进程表.get(name);
    if (!记录) return { stopped: false, reason: "not_running" };
    return 带审计("registry.stop", 发送者, { capability: "", module: name, action: "stop", params: undefined }, () =>
      停止模块(name).then(() => ({ stopped: true })),
    );
  });

  // 重新检测模块：重读配置/目录，动态加载新增、卸载已移除
  服务端.handle("nigane.registry.reload", async (params) => {
    const p = (params ?? {}) as { autoStart新增?: boolean };
    return 重新检测模块(p.autoStart新增 !== false);
  });

  // 模块配置管理：列出（含托管状态、路径、参数、运行时状态）
  服务端.handle("nigane.registry.config.list", () => {
    // 以「注册表里实际存在的模块」为准，而不是配置文件里的 modules 数组。
    //
    // 外部程序可能不通过配置文件启动（用户自己手动跑起来连上来），
    // 这类模块以前完全不出现在设置页里——找得到状态、改不了配置，
    // 属于「东西在那儿但摸不到」。配置只是它的**补充**信息，不是存在性来源。
    const 配置表 = 加载配置().modules ?? [];
    const 配置索引 = new Map(配置表.map((m) => [m.name, m]));
    const 详情表 = 构造详情(服务端!);
    return 详情表.map((d) => {
      const m: 模块描述 = 配置索引.get(d.name) ?? {
        name: d.name,
        type: (d.type ?? "process") as 模块描述["type"],
        autoStart: false,
        entry: d.entry,
        file: d.file,
        args: [],
        description: d.description,
        autoUpdate: true,
      };
      const 待 = 待确认模块.get(d.name);
      const 拒 = 拒绝模块.get(d.name);
      // 状态灯：待确认/被拒 → 红；在线 → 绿；否则灰
      const 状态 = 待 || 拒 ? "blocked" : d.online ? "online" : "offline";
      return {
        name: d.name,
        类型: m.type,
        启用: m.autoStart ?? false,
        路径: m.entry ?? m.file ?? "",
        参数: m.args ?? [],
        说明: m.description ?? "",
        在线: d.online,
        子进程: d.pid ?? null,
        // —— 版本与更新状态 ——
        版本: d.version ?? m.version ?? "",
        自动更新: m.autoUpdate ?? true,
        外部: !是内置模块(m),
        状态,
        // 待确认（信息变化 / 版本回退）：需人工点「替换」
        待确认: 待
          ? { 原因: 待.原因, 旧版本: 待.旧版本, 新版本: 待.新版本, 差异: 待.差异 }
          : null,
        // 有新版本但未自动更新（开关关闭）：显示绿色「更新」按钮
        待更新版本: 手动更新提示.get(d.name)?.新版本 ?? null,
        // 被拒绝（非原位 / 重复注册 / 缺少状态查询）
        拒绝原因: 拒 ? 拒.原因 : null,
        拒绝详情: 拒 ? 拒.详情 : null,
      };
    });
  });

  // 模块配置管理：更新单项（启用状态 / 路径 / 参数）
  服务端.handle("nigane.registry.config.set", (params, 发送者) => {
    const p = (params ?? {}) as {
      name?: string;
      启用?: boolean;
      路径?: string;
      参数?: string[];
      说明?: string;
      自动更新?: boolean;
    };
    if (!p.name) throw new Error("缺少 name");
    const 名 = p.name;
    const 当前配置 = 加载配置();
    const 表 = 当前配置.modules ?? [];
    const 项 = 表.find((m) => m.name === 名);
    if (!项) throw new Error(`模块不存在：${名}`);

    const 变更: string[] = [];
    if (typeof p.启用 === "boolean" && (项.autoStart ?? false) !== p.启用) {
      变更.push(`启用 ${项.autoStart ?? false} → ${p.启用}`);
      项.autoStart = p.启用;
    }
    if (typeof p.自动更新 === "boolean" && (项.autoUpdate ?? true) !== p.自动更新) {
      // 内置模块强制自动更新，不重复设置
      if (是内置模块(项)) {
        变更.push("内置模块自动更新不可更改");
      } else {
        变更.push(`自动更新 ${项.autoUpdate ?? true} → ${p.自动更新}`);
        项.autoUpdate = p.自动更新;
      }
    }
    if (typeof p.路径 === "string" && p.路径 !== (项.entry ?? 项.file ?? "")) {
      变更.push(`路径 ${项.entry ?? 项.file ?? ""} → ${p.路径}`);
      if (项.type === "library") 项.file = p.路径;
      else 项.entry = p.路径;
    }
    if (Array.isArray(p.参数)) {
      const 旧 = JSON.stringify(项.args ?? []);
      const 新 = JSON.stringify(p.参数);
      if (旧 !== 新) {
        变更.push(`参数 ${旧} → ${新}`);
        项.args = p.参数.length > 0 ? p.参数 : undefined;
      }
    }
    if (typeof p.说明 === "string" && p.说明 !== (项.description ?? "")) {
      变更.push("说明变更");
      项.description = p.说明;
    }
    if (变更.length === 0) return { 更新: false, 原因: "无变更" };

    if (!保存配置({ ...当前配置, modules: 表 })) throw new Error("保存配置失败");
    服务端?.setDescription(项);
    const 摘要 = `模块「${名}」配置已更新：${变更.join("；")}`;
    console.log(`[主控] ${摘要}（操作者：${发送者}）`);
    服务端?.broadcast("registry.changed", { 变更: "配置更新", 模块: 名 });
    return { 更新: true, 变更, 需重启模块生效: true };
  });
}

/**
 * 动态检测模块表：重新读取 kugua.config.json，与当前描述表做差集。
 *
 *   - 新增模块：写入描述表；若为 process 且 autoStart 且请求了自动启动，则拉起。
 *   - 移除模块：从描述表移除；若其子进程在跑，则先停掉。
 *   - 变更模块：更新描述（入口/自启等）；若进程在跑且入口变化，重启它。
 *
 * 返回本次变更摘要，供 WebUI/定时/MCP 展示。整个过程不误杀非本平台的进程。
 */
async function 重新检测模块(自动启动新增: boolean): Promise<{
  新增: string[];
  移除: string[];
  更新: string[];
  已启动: string[];
  已停止: string[];
}> {
  const 新配置 = 加载配置();
  const 新表 = new Map<string, 模块描述>();
  for (const m of 新配置.modules ?? []) 新表.set(m.name, m);

  const 旧名集 = new Set(服务端?.descriptionNames() ?? []);
  const 新名集 = new Set(新表.keys());
  const 新增: string[] = [];
  const 移除: string[] = [];
  const 更新: string[] = [];
  const 已启动: string[] = [];
  const 已停止: string[] = [];

  // —— 新增 + 更新 ——
  for (const [名, 描述] of 新表) {
    if (!旧名集.has(名)) {
      新增.push(名);
      服务端?.setDescription(描述);
      if (描述.type === "library" && 描述.file) {
        库文件状态.set(名, existsSync(pathResolve(process.cwd(), 描述.file)));
      }
    } else {
      const 旧 = 服务端?.getDescription(名);
      if (旧 && (旧.entry !== 描述.entry || 旧.autoStart !== 描述.autoStart || 旧.type !== 描述.type)) {
        更新.push(名);
        服务端?.setDescription(描述);
        // 入口/类型变更时，若旧进程在跑则重启以加载新代码
        if (旧.entry !== 描述.entry && 子进程表.has(名)) {
          await 停止模块(名);
          已停止.push(名);
        }
      }
    }
  }

  // —— 移除 ——
  for (const 名 of 旧名集) {
    if (新名集.has(名)) continue;
    移除.push(名);
    if (子进程表.has(名)) {
      await 停止模块(名);
      已停止.push(名);
    }
    库文件状态.delete(名);
    服务端?.removeDescription(名);
  }

  // —— 自动启动新增模块 ——
  if (自动启动新增) {
    for (const 名 of 新增) {
      const 描述 = 新表.get(名)!;
      if (描述.type !== "process" || !描述.autoStart) continue;
      if (子进程表.has(名)) continue;
      try {
        await 启动模块(描述);
        已启动.push(名);
      } catch (err) {
        console.error(`[主控] 动态启动新模块失败：${名} — ${String(err)}`);
      }
    }
  }

  const 变更 = 新增.length + 移除.length + 更新.length + 已停止.length + 已启动.length;
  if (变更 > 0) {
    console.log(
      `[主控] 模块重新检测：新增 [${新增.join("、") || "-"}]，移除 [${移除.join("、") || "-"}]，` +
        `更新 [${更新.join("、") || "-"}]，已启动 [${已启动.join("、") || "-"}]，已停止 [${已停止.join("、") || "-"}]`,
    );
  }
  // 广播变更，让 WebUI 等实时刷新
  服务端?.broadcast("registry.changed", { 新增, 移除, 更新, 已启动, 已停止 });
  return { 新增, 移除, 更新, 已启动, 已停止 };
}

/** 组装模块详情（把子进程 pid / library 存在性塞进去） */
function 构造详情(服务端: NiganeServer): 模块详情[] {
  const 附加: Record<string, Partial<Pick<模块详情, "pid" | "fileExists" | "online">>> = {};
  for (const [name, 记录] of 子进程表) {
    附加[name] = {
      pid: 记录.proc.pid,
      online: 记录.registered && 记录.proc.exitCode === null,
    };
  }
  for (const [name, ok] of 库文件状态) {
    附加[name] = { ...(附加[name] ?? {}), fileExists: ok, online: ok };
  }
  return 服务端.moduleDetails(附加);
}

/** 启动一个 process 类型模块，返回子进程 */
/** 根据入口路径推断启动命令（可执行文件直接跑，脚本靠对应解释器） */
function 推断启动命令(入口: string): { 命令: string; 前置参数: string[]; 直传协议: boolean } {
  const 扩展 = 入口.toLowerCase().slice(入口.lastIndexOf("."));
  switch (扩展) {
    case ".js":
    case ".mjs":
    case ".cjs":
      // Node 模块：沿用约定，把 ws url / token 作为位置参数传入
      return { 命令: process.execPath, 前置参数: [], 直传协议: true };
    case ".py":
    case ".pyw":
      // Python：优先环境变量 KUGUA_PYTHON，否则用平台自带的 python
      return { 命令: process.env.KUGUA_PYTHON || "python", 前置参数: [], 直传协议: false };
    case ".bat":
    case ".cmd":
      return { 命令: process.env.ComSpec || "cmd.exe", 前置参数: ["/c"], 直传协议: false };
    default:
      // .exe / 无扩展字或其他：当作可直接执行的程序（外部程序自报托管的主要场景）
      return { 命令: 入口, 前置参数: [], 直传协议: false };
  }
}

function 启动模块(描述: 模块描述): Promise<ChildProcess | null> {
  return new Promise((resolve, reject) => {
    if (!描述.entry) {
      reject(new Error(`模块 ${描述.name} 缺少 entry`));
      return;
    }
    const 入口 = pathResolve(process.cwd(), 描述.entry);
    if (!existsSync(入口)) {
      reject(new Error(`模块 ${描述.name} 入口不存在：${入口}`));
      return;
    }
    const 主控URL = `ws://${配置.host}:${配置.port}`;
    // 仅 Node 模块追加位置参数（旧约定）；其他语言靠 KUGUA_* 环境变量取连接信息
    const 启动 = 推断启动命令(入口);
    const 追加 = 描述.args ?? [];
    const 位置参数 = 启动.直传协议 ? [主控URL, 配置.token, ...追加] : 追加;
    // Node / Python 这类解释器需要把入口作为第一个参数；可执行文件本身不需要
    const 脚本参数 = 启动.命令 === 入口 ? 位置参数 : [入口, ...位置参数];
    const 工作目录 = 描述.cwd ? pathResolve(process.cwd(), 描述.cwd) : process.cwd();
    const proc = spawn(启动.命令, [...启动.前置参数, ...脚本参数], {
      stdio: ["ignore", "pipe", "pipe"] as const,
      cwd: 工作目录,
      env: {
        ...process.env,
        NODE_ENV: process.env.NODE_ENV ?? "production",
        NIGANE_URL: 主控URL,
        NIGANE_TOKEN: 配置.token,
        // 通用接入约定：任何语言的模块都能靠这三个变量连上平台
        KUGUA_URL: 主控URL,
        KUGUA_PORT: String(配置.port),
        KUGUA_TOKEN: 配置.token,
        KUGUA_HOSTED: "1",
      },
      // Windows 上 spawn 默认给子进程新开一个控制台窗口。模块是常驻的，
      // 不隐藏的话桌面上会随着模块数量堆出一片黑框，重启平台时还会重来一遍。
      windowsHide: true,
    }) as ChildProcess;
    const 记录: 子进程记录 = { proc, name: 描述.name, registered: false };
    子进程表.set(描述.name, 记录);

    let 已决议 = false;
    // 模块完成 hello 注册即视为启动成功，无需等满 3 秒
    const 注册监听 = (信息: 模块信息): void => {
      if (信息.name === 描述.name && !已决议) {
        已决议 = true;
        clearTimeout(定时);
        服务端?.removeListener("registered", 注册监听);
        resolve(proc);
      }
    };
    服务端?.on("registered", 注册监听);
    const 定时 = setTimeout(() => {
      if (!已决议) {
        已决议 = true;
        服务端?.removeListener("registered", 注册监听);
        resolve(proc); // 3s 内未 exit 就算启动成功（后续 registered 会更新 online）
      }
    }, 3000);

    proc.stdout?.on("data", (buf: Buffer) => {
      const 文本 = buf.toString();
      for (const 行 of 文本.split("\n").filter((s) => s.trim())) {
        console.log(`[${描述.name}]`, 行);
      }
    });
    proc.stderr?.on("data", (buf: Buffer) => {
      const 文本 = buf.toString();
      for (const 行 of 文本.split("\n").filter((s) => s.trim())) {
        console.error(`[${描述.name}:err]`, 行);
      }
    });
    proc.on("error", (err) => {
      console.error(`[主控] 启动 ${描述.name} 出错：${err.message}`);
      子进程表.delete(描述.name);
      服务端?.removeListener("registered", 注册监听);
      if (!已决议) {
        已决议 = true;
        clearTimeout(定时);
        reject(err);
      }
    });
    proc.on("exit", (code, sig) => {
      console.log(`[主控] 子进程退出：${描述.name}（code=${code ?? "?"}，sig=${sig ?? "-"}）`);
      记录.registered = false;
      子进程表.delete(描述.name);
      服务端?.removeListener("registered", 注册监听);
      if (!已决议 && code !== 0) {
        已决议 = true;
        clearTimeout(定时);
        reject(new Error(`启动 ${描述.name} 失败，退出码 ${code ?? "?"}`));
      } else if (!已决议 && code === 0) {
        已决议 = true;
        clearTimeout(定时);
        resolve(proc);
      }
    });
    void 已决议;
  });
}

/** 停止一个 process 类型模块：先关连接（会触发其 close 事件），再 SIGTERM，最后兜底 SIGKILL */
function 停止模块(name: string): Promise<void> {
  return new Promise((resolve) => {
    const 记录 = 子进程表.get(name);
    if (!记录) {
      resolve();
      return;
    }
    const proc = 记录.proc;
    let done = false;
    const 收尾 = (): void => {
      if (done) return;
      done = true;
      子进程表.delete(name);
      resolve();
    };
    if (proc.exitCode !== null || proc.killed) {
      收尾();
      return;
    }
    proc.on("exit", 收尾);
    proc.kill("SIGTERM");
    setTimeout(() => {
      if (!done && !proc.killed) {
        try {
          proc.kill("SIGKILL");
        } catch {
          // ignore
        }
      }
    }, 3000);
    setTimeout(() => {
      if (!done) 收尾();
    }, 5000);
  });
}

/** 带审计执行：记录耗时与结果（成功/失败） */
async function 带审计<T>(
  channel: string,
  source: string,
  info: { capability: string; module: string; action: string; params?: unknown },
  任务: () => Promise<T>,
): Promise<T> {
  const 开始 = Date.now();
  try {
    const 结果 = await 任务();
    审计?.记录({
      source,
      channel,
      capability: info.capability,
      module: info.module,
      action: info.action,
      params: info.params,
      ok: true,
      durationMs: Date.now() - 开始,
    });
    return 结果;
  } catch (err) {
    const 错误 = err instanceof Error ? err.message : String(err);
    审计?.记录({
      source,
      channel,
      capability: info.capability,
      module: info.module,
      action: info.action,
      params: info.params,
      ok: false,
      error: 错误,
      durationMs: Date.now() - 开始,
    });
    throw err;
  }
}

/** 安全字符串化（用于日志捕获） */
function 安全字符串(值: unknown): string {
  if (typeof 值 === "string") return 值;
  try {
    return JSON.stringify(值);
  } catch {
    return String(值);
  }
}

/**
 * 捕获控制台输出到日志器：从 `[模块]` 前缀解析来源，无前缀归为 main。
 * 这样主控自身与各模块子进程的输出都会进入环形缓冲。
 */
function 安装日志捕获(实例: 日志器): void {
  const 原始log = console.log.bind(console);
  const 原始warn = console.warn.bind(console);
  const 原始error = console.error.bind(console);
  const 包裹 = (级别: 日志级别, 原始: (...参数: unknown[]) => void) =>
    (...参数: unknown[]): void => {
      const 文本 = 参数.map(安全字符串).join(" ");
      const m = /^\[([^\]]+)\]\s*([\s\S]*)$/.exec(文本);
      实例.写(m ? m[1] : "main", 级别, m ? m[2] : 文本);
      原始(...参数);
    };
  console.log = 包裹("info", 原始log);
  console.warn = 包裹("warn", 原始warn);
  console.error = 包裹("error", 原始error);
}

/** 主控侧能力调用器：把能力调用路由到模块 */const 主控调用器 = {
  请求: (目标: string, 动作: string, 参数?: unknown, 超时毫秒?: number): Promise<unknown> => {
    if (!服务端) return Promise.reject(new Error("主控尚未启动"));
    return 服务端.request(目标, 动作, 参数, 超时毫秒);
  },
};

/**
 * 汇总某模块的能力声明：
 *   1) 由 capabilities 名称合成基础声明（GUI 可见、可被统一调用）；
 *   2) 用显式 capabilityDefs 覆盖/补充（可带中文指令、参数 Schema、权限等）。
 */
/** 待人工确认的模块（信息变化/版本回退 → 暂下线，红灯） */
const 待确认模块 = new Map<
  string,
  {
    原因: "信息变化" | "版本回退";
    旧版本: string;
    新版本: string;
    差异: string[];
    上报: 上报快照;
    能力声明?: 能力声明[];
  }
>();

/** 被拒绝的模块（非原位 / 同路径不同名 / 缺少状态查询） */
const 拒绝模块 = new Map<string, { 原因: string; 详情: string }>();

/** 已上线但存在更新版本（用户关闭了自动更新，等待手动确认） */
const 手动更新提示 = new Map<string, { 旧版本: string; 新版本: string }>();

/**
 * 判断一条模块配置是否为平台自带（内置）模块。
 *
 * 内置模块的入口位于仓库的 ``packages/modules/<name>/`` 下，随平台发布、
 * 不参与外部版本/身份管理；其余均为外部模块。
 */
function 是内置模块(项: 模块描述): boolean {
  if (项.external === false) return true;
  if (项.external === true) return false;
  const 入口 = 规整路径(项.entry ?? 项.file);
  if (!入口) return false;
  return 入口.includes("/packages/modules/") || 入口.includes("/modules/") && 入口.includes("packages/");
}

/**
 * 探测模块是否实现 ``module.query``，结果写回配置（``queryable``）。
 *
 * 不依赖模块自报能力列表，因此模块无需把协议动作当作业务能力暴露；
 * 模块若未实现该动作，下次接入时会被拒绝（避免无法校验身份/版本）。
 */
async function 探测可查询性(名: string): Promise<void> {
  const 配置项 = (加载配置().modules ?? []).find((m) => m.name === 名);
  if (!配置项) return;
  if (是内置模块(配置项)) return;

  let 可查 = false;
  try {
    const 结果 = await 服务端?.request(名, "module.query", {}, 2000);
    可查 = Boolean(结果) && typeof 结果 === "object";
  } catch {
    可查 = false;
  }

  if (配置项.queryable === 可查) return;
  const 当前配置 = 加载配置();
  const 表 = 当前配置.modules ?? [];
  const 项 = 表.find((m) => m.name === 名);
  if (!项) return;
  项.queryable = 可查;
  if (保存配置({ ...当前配置, modules: 表 })) {
    服务端?.setDescription(项);
    if (!可查) {
      console.warn(
        `[主控] WARN 模块「${名}」未实现 module.query，下次接入将无法校验身份与版本。`,
      );
    }
  }
}

/** 记录本次成功上线使用的版本与能力指纹（写回配置供下次比对） */
function 记录模块快照(信息: 模块信息): void {
  const 当前配置 = 加载配置();
  const 表 = 当前配置.modules ?? [];
  const 项 = 表.find((m) => m.name === 信息.name);
  if (!项) return;
  const 新指纹 = 能力指纹(信息.capabilityDefs as unknown as Array<Record<string, unknown>>);
  const 新自报路径 = 信息.path ?? 信息.托管?.entry;
  const 变了 =
    项.version !== 信息.version ||
    项.capabilityHash !== 新指纹 ||
    (新自报路径 !== undefined && 项.modulePath !== 新自报路径);
  if (!变了) return;
  项.version = 信息.version ?? 项.version;
  if (新指纹) 项.capabilityHash = 新指纹;
  if (新自报路径) 项.modulePath = 新自报路径;
  if (保存配置({ ...当前配置, modules: 表 })) {
    服务端?.setDescription(项);
  }
}

/** 查同路径但不同名的已注册模块 */
function 找同路径模块(名: string, 上报路径: string | undefined): 模块描述 | undefined {
  if (!上报路径) return undefined;
  const 目标 = 规整路径(上报路径);
  return (加载配置().modules ?? []).find(
    (m) => m.name !== 名 && 规整路径(m.modulePath ?? m.entry ?? m.file) === 目标,
  );
}

/**
 * 握手门禁：在服务端完成注册**之前**判定本次接入是否允许。
 *
 * 被拒绝的模块不会进入注册表，不会汚染能力注册表，并被记录以供
 * 管理界面展示（状态灯标红 + 警告/错误说明）。
 */
function 校验接入(信息: 模块信息): { 允许: boolean; 理由?: string } {
  const 名 = 信息.name;
  const 配置项 = (加载配置().modules ?? []).find((m) => m.name === 名);
  if (!配置项) {
    // 无注册记录的模块：首次注册直接放行（后续由 registered 事件写入快照）
    return { 允许: true };
  }
  // 内置（进程内）模块不参与外部身份管理：版本随平台发布，无路径可辨
  if (是内置模块(配置项)) return { 允许: true };

  // 原位比较以模块自报路径优先：entry 可能是解释器（如 python.exe），
  // 模块自报的 path 才是模块本体（如 example.py）
  const 上报路径 = 信息.path ?? 信息.托管?.entry;
  const 上报: 上报快照 = {
    name: 名,
    version: 信息.version,
    path: 上报路径,
    capabilityHash: 能力指纹(信息.capabilityDefs as unknown as Array<Record<string, unknown>>),
  };

  // 同路径不同名 → 拒绝（含重复注册保护）
  const 同路径 = 找同路径模块(名, 上报路径);  if (同路径) {
    const 详情 =
      `模块「${名}」上报路径 ${上报路径} 已被已注册模块「${同路径.name}」占用。` +
      `已拒绝本次接入，请确认是否重复注册或先移除旧模块。`;
    console.warn(`[主控] WARN 重复注册：${详情}`);
    拒绝模块.set(名, { 原因: "同路径不同名", 详情 });
    服务端?.broadcast("module.rejected", { 模块: 名, 原因: "同路径不同名", 详情, 级别: "warning" });
    return { 允许: false, 理由: 详情 };
  }

  // 是否确认实现 module.query（首次上线时探测并写入配置）
  const 支持查询 = 配置项.queryable === true;

  const 判定 = 判定重新接入(
    {
      name: 配置项.name,
      version: 配置项.version,
      path: 配置项.modulePath ?? 配置项.entry ?? 配置项.file,
      capabilityHash: 配置项.capabilityHash,
      autoUpdate: 配置项.autoUpdate,
      builtin: 是内置模块(配置项),
    },
    上报,
    支持查询,
  );

  switch (判定.类型) {
    case "first":
    case "online":
    case "auto-update": {
      if (判定.类型 === "auto-update") {
        console.log(
          `[主控] 模块「${名}」检测到新版本 ${判定.旧版本} → ${判定.新版本}，已按自动更新策略接受。`,
        );
      }
      拒绝模块.delete(名);
      待确认模块.delete(名);
      return { 允许: true };
    }

    case "manual-update": {
      // 版本更新但用户关闭了自动更新 → 暂不下线，只提示可手动更新
      手动更新提示.set(名, { 旧版本: 判定.旧版本, 新版本: 判定.新版本 });
      拒绝模块.delete(名);
      待确认模块.delete(名);
      console.log(
        `[主控] 模块「${名}」有新版本 ${判定.旧版本} → ${判定.新版本}，` +
          `自动更新已关闭，等待手动确认。`,
      );
      服务端?.broadcast("module.updateAvailable", {
        模块: 名,
        旧版本: 判定.旧版本,
        新版本: 判定.新版本,
      });
      return { 允许: true };
    }

    case "replace": {
      待确认模块.set(名, {
        原因: 判定.原因,
        旧版本: 判定.旧版本,
        新版本: 判定.新版本,
        差异: 判定.差异,
        上报,
        能力声明: 信息.capabilityDefs,
      });
      手动更新提示.delete(名);
      const 详情 =
        `模块「${名}」上报信息与已注册不一致（${判定.差异.join("；")}），已暂下线。` +
        `请在模块管理中选择是否按其新信息更新。`;
      console.error(`[主控] ERROR ${详情}`);
      服务端?.broadcast("module.held", {
        模块: 名,
        原因: 判定.原因,
        旧版本: 判定.旧版本,
        新版本: 判定.新版本,
        差异: 判定.差异,
        级别: "error",
      });
      return { 允许: false, 理由: 详情 };
    }

    case "reject": {
      console.warn(`[主控] WARN ${判定.详情}`);
      拒绝模块.set(名, { 原因: 判定.原因, 详情: 判定.详情 });
      服务端?.broadcast("module.rejected", {
        模块: 名,
        原因: 判定.原因,
        详情: 判定.详情,
        级别: "warning",
      });
      return { 允许: false, 理由: 判定.详情 };
    }
  }
}

/**
 * 处理外部模块的托管申请（握手时上报）。
 *
 * 冲突键采用**模块名**（协议层已保证全局唯一，顶号语义也基于它）。
 * 物理路径不作为主键：它会随目录迁移、相对/绝对写法改变，
 * 用它做主键会把同一模块当成新模块。但路径仍参与校验：
 * 若发现不同模块名指向同一路径，记警告。
 *
 * 合并策略（关键）：
 *   - 模块名不存在   → 用上报信息新建配置项并写盘（日志：“新建托管注册”）。
 *   - 模块名已存在   → **保留用户配置不动**，仅做差异比对（两边都记日志）。
 * 这样用户在管理界面改过的值不会因为模块重启而被覆盖。
 */
function 处理托管申请(信息: 模块信息): void {
  const 申请 = 信息.托管;
  if (!申请) return;

  const 名 = 信息.name;
  const 当前配置 = 加载配置();
  const 表 = 当前配置.modules ?? [];
  const 已有 = 表.find((m) => m.name === 名);

  // 上报的规范化形态（用于比对/写入）
  const 上报入口 = 申请.entry ? pathResolve(process.cwd(), 申请.entry) : undefined;
  const 上报参数 = 申请.args ?? [];
  const 上报描述: 模块描述 = {
    name: 名,
    type: "process",
    entry: 上报入口,
    args: 上报参数.length > 0 ? 上报参数 : undefined,
    autoStart: 申请.enabled,
    description: 申请.description ?? `外部模块 ${名}（自报托管）`,
  };

  // —— 同路径不同名的可疑情况 ——
  if (上报入口) {
    const 同名路径项 = 表.find(
      (m) => m.name !== 名 && m.entry && pathResolve(process.cwd(), m.entry) === 上报入口,
    );
    if (同名路径项) {
      console.warn(
        `[主控] 托管注册警告：模块「${名}」与已有模块「${同名路径项.name}」使用同一路径：${上报入口}。` +
          `已保留两者各自的配置，请确认是否为同一程序。`,
      );
      服务端?.broadcast("registry.conflict", {
        模块: 名,
        冲突模块: 同名路径项.name,
        原因: "同一物理路径",
        路径: 上报入口,
      });
    }
  }

  // —— 已存在：不覆盖，只比对并记日志 ——
  if (已有) {
    const 差异: string[] = [];
    if ((已有.autoStart ?? false) !== (上报描述.autoStart ?? false)) {
      差异.push(`autoStart：本地 ${已有.autoStart ?? false} ← 上报 ${上报描述.autoStart ?? false}（保留本地）`);
    }
    if (上报入口 && 已有.entry && pathResolve(process.cwd(), 已有.entry) !== 上报入口) {
      差异.push(`entry：本地 ${已有.entry} ← 上报 ${上报入口}（保留本地）`);
    }
    if (差异.length > 0) {
      console.log(
        `[主控] 托管注册：模块「${名}」已有配置，本次不覆盖。差异：\n  - ${差异.join("\n  - ")}`,
      );
      服务端?.broadcast("registry.conflict", {
        模块: 名,
        原因: "已有配置，保留本地",
        差异,
      });
    } else {
      console.log(`[主控] 托管注册：模块「${名}」已有配置且与上报一致，无需变更。`);
    }
    return;
  }

  // —— 不存在：首次注册，按上报信息新建 ——
  if (!上报入口) {
    console.warn(
      `[主控] 托管注册：模块「${名}」申请托管但未提供 entry（物理路径），已忽略。` +
        `请在管理界面手动配置后再启用。`,
    );
    return;
  }

  表.push(上报描述);
  if (保存配置({ ...当前配置, modules: 表 })) {
    服务端?.setDescription(上报描述);
    console.log(
      `[主控] 托管注册：新建模块「${名}」，入口 ${上报入口}，` +
        `随平台启动 ${上报描述.autoStart ? "是" : "否"}。`,
    );
    服务端?.broadcast("registry.changed", { 变更: "托管注册", 模块: 名 });
  }
}

/** 写回配置文件（原子写）；成功返回 true */
function 保存配置(配置对象: 主控配置): boolean {
  const 路径 = 配置路径();
  try {
    const 临时 = `${路径}.tmp`;
    writeFileSync(临时, JSON.stringify(配置对象, null, 2) + "\n", "utf-8");
    renameSync(临时, 路径);
    return true;
  } catch (err) {
    console.error(`[主控] 保存配置失败（${路径}）：${String(err)}`);
    return false;
  }
}

function 汇总能力(信息: 模块信息): void {
  能力表.移除模块(信息.name);
  const { 合法: 显式, 问题 } = 归一全部能力(信息.capabilityDefs);
  for (const { 声明, 原因 } of 问题) {
    console.warn(
      `[主控] 警告：模块「${信息.name}」上报的能力声明被忽略（${原因}）：` +
        JSON.stringify(声明).slice(0, 200),
    );
  }
  const 名称集 = new Set<string>([...(信息.capabilities ?? []), ...显式.keys()]);
  for (const 名称 of 名称集) {
    const 声明 = 显式.get(名称);
    if (声明) {
      try {
        能力表.注册({ ...声明, 模块: 声明.模块 || 信息.name });
      } catch (err) {
        // 单条能力声明不合法不应拖垮整个平台
        console.warn(`[主控] 警告：模块「${信息.name}」的能力「${名称}」注册失败：${String(err)}`);
      }
    } else {
      // 跳过与模块同名的自标识（如 capabilities: ["webui"]）
      if (名称 === 信息.name) continue;
      能力表.注册({
        名称,
        模块: 信息.name,
        动作: 名称,
        暴露: { 指令: false, GUI: true, 定时: false, MCP: false },
      });
    }
  }
  if (显式.size === 0 && (信息.capabilities ?? []).length > 0) {
    console.log(`[主控] 能力汇总：${信息.name} 声明 ${名称集.size} 项（无显式元数据）`);
  }
}

启动().catch((err) => {
  console.error("[主控] 启动失败：", err);
  process.exit(1);
});
