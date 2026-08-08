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

import { existsSync, readFileSync } from "node:fs";
import { resolve as pathResolve } from "node:path";
import { spawn, type ChildProcess } from "node:child_process";
import { createServer as 创建探测服务器 } from "node:net";
import {
  NiganeServer,
  type 模块信息,
  type 模块描述,
  type 模块详情,
} from "@kugua/nigane";

interface 主控配置 {
  host: string;
  port: number;
  token: string;
  /** 模块注册表：主控侧管理的模块定义 */
  modules?: 模块描述[];
}

/** 加载配置：文件缺失或非法时回落到默认值 */
function 加载配置(): 主控配置 {
  const 默认: 主控配置 = { host: "127.0.0.1", port: 24601, token: "", modules: [] };
  const 路径 = process.env.KUGUA_CONFIG
    ? pathResolve(process.cwd(), process.env.KUGUA_CONFIG)
    : pathResolve(process.cwd(), "kugua.config.json");
  if (!existsSync(路径)) return 默认;
  try {
    const 文本 = readFileSync(路径, "utf-8");
    const 对象 = JSON.parse(文本) as Partial<主控配置>;
    return {
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

/** 探测指定端口是否已被占用（用于单实例守卫，避免重复启动主控） */
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

const 子进程表 = new Map<string, 子进程记录>();
const 库文件状态 = new Map<string, boolean>(); // name → exists?

/** 运行时共享（由 启动() 初始化后可用） */
let 配置: 主控配置 = { host: "127.0.0.1", port: 24601, token: "", modules: [] };
let 服务端: NiganeServer | null = null;

async function 启动(): Promise<void> {
  配置 = 加载配置();

  // —— 单实例守卫：端口已被占用说明已有主控在运行，直接退出，避免重复启动模块 ——
  if (await 端口被占用(配置.host, 配置.port)) {
    console.log(`[主控] 检测到 ${配置.host}:${配置.port} 已有主控在运行，本实例退出（不重复启动）。`);
    process.exit(0);
  }

  服务端 = new NiganeServer(配置);

  // —— 注入模块描述表 ——
  for (const m of 配置.modules ?? []) 服务端.setDescription(m);

  // —— 注册自定义内置动作：详情 / 启动 / 停止 ——
  注册内置动作(服务端);

  // —— 日志 ——
  服务端.on("registered", (信息: 模块信息) => {
    const 记录 = 子进程表.get(信息.name);
    if (记录) 记录.registered = true;
    console.log(
      `[主控] 模块上线：${信息.name}（版本 ${信息.version ?? "未知"}，能力：${(信息.capabilities ?? []).join("、") || "无"}）`,
    );
  });
  服务端.on("unregistered", (名: string) => {
    const 记录 = 子进程表.get(名);
    if (记录) 记录.registered = false;
    console.log(`[主控] 模块离线：${名}`);
  });

  await 服务端.start();
  console.log(`[主控] 苦音服务端已启动：ws://${配置.host}:${配置.port}`);
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

  // —— 进程型模块：依次启动 autoStart=true 的项 ——
  const 启动列表 = (配置.modules ?? []).filter((m) => m.type === "process" && m.autoStart);
  console.log(`[主控] 自动启动模块（${启动列表.length} 项）`);
  for (const m of 启动列表) {
    try {
      await 启动模块(m);
    } catch (err) {
      console.error(`[主控] 自动启动失败：${m.name} — ${String(err)}`);
    }
  }

  // —— 关闭 ——
  const 关闭 = async (): Promise<void> => {
    console.log("[主控] 正在关闭……");
    if (!服务端) return;
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
    process.exit(0);
  };
  process.on("SIGINT", () => void 关闭());
  process.on("SIGTERM", () => void 关闭());
}

function 注册内置动作(服务端: NiganeServer): void {
  // 模块详情：供 GUI/其他模块查询运行时状态
  服务端.handle("nigane.registry.details", () => 构造详情(服务端));

  // 启动模块（仅 process 型；已运行则忽略；未在描述表的话报错）
  服务端.handle("nigane.registry.start", (params) => {
    const { name } = (params ?? {}) as { name?: string };
    if (!name) throw new Error("缺少 name");
    const 描述 = 服务端.getDescription(name);
    if (!描述) throw new Error(`模块未在注册表：${name}`);
    if (描述.type !== "process") throw new Error(`模块非 process 类型：${name}`);
    if (子进程表.has(name) && !子进程表.get(name)!.proc.killed) {
      return { started: false, reason: "already", pid: 子进程表.get(name)!.proc.pid ?? null };
    }
    return 启动模块(描述).then((r) => ({ started: true, pid: r?.pid ?? null }));
  });

  // 停止模块（仅 process 型；未运行忽略）
  服务端.handle("nigane.registry.stop", (params) => {
    const { name } = (params ?? {}) as { name?: string };
    if (!name) throw new Error("缺少 name");
    const 记录 = 子进程表.get(name);
    if (!记录) return { stopped: false, reason: "not_running" };
    return 停止模块(name).then(() => ({ stopped: true }));
  });
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
    const args: string[] = [主控URL, 配置.token, ...(描述.args ?? [])];
    const proc = spawn(process.execPath, [入口, ...args], {
      stdio: ["ignore", "pipe", "pipe"] as const,
      cwd: process.cwd(),
      env: {
        ...process.env,
        NODE_ENV: process.env.NODE_ENV ?? "production",
        NIGANE_URL: 主控URL,
        NIGANE_TOKEN: 配置.token,
      },
    }) as ChildProcess;
    const 记录: 子进程记录 = { proc, name: 描述.name, registered: false };
    子进程表.set(描述.name, 记录);

    let 已决议 = false;
    const 定时 = setTimeout(() => {
      if (!已决议) {
        已决议 = true;
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
      if (!已决议 && code !== 0) {
        已决议 = true;
        clearTimeout(定时);
        reject(new Error(`启动 ${描述.name} 失败，退出码 ${code ?? "?"}`));
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

启动().catch((err) => {
  console.error("[主控] 启动失败：", err);
  process.exit(1);
});
