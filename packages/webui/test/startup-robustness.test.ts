/**
 * 启动 / 退出 / 重连健壮性测试
 *
 * 这些用例对应一类真实发生过的故障：**平台看起来起来了，其实是空壳**，
 * 或者**重启之后平台彻底消失**。它们都很难从日志上看出来，只能靠行为验证。
 *
 * 覆盖：
 *   1) 从任意工作目录启动都能找到主控（不依赖 cwd）
 *   2) 主控起不来时，WebUI 必须退出并释放实例锁，不留空壳
 *   3) 命令行 --port 覆盖配置端口（计划任务靠它传端口）
 *   4) 重启后平台能重新接管（含"新实例抢在旧实例退出前启动"的窗口期）
 *   5) 带重启标记也不能绕过单实例保护
 *
 * 全部使用隔离端口、临时配置、独立全局锁，**绝不触碰用户正在运行的实例**。
 */
import { afterEach, beforeAll, describe, expect, it } from "vitest";
import { spawn, type ChildProcess } from "node:child_process";
import { existsSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { createServer } from "node:net";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";

const 仓库根 = resolve(__dirname, "..", "..", "..");
const WebUI脚本 = join(仓库根, "packages", "webui", "dist", "server.js");
const 已构建 = existsSync(WebUI脚本) && existsSync(join(仓库根, "packages", "main", "dist", "index.js"));

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

/** 取一个空闲端口 */
const 空闲端口 = (): Promise<number> =>
  new Promise((res, rej) => {
    const s = createServer();
    s.once("error", rej);
    s.listen(0, "127.0.0.1", () => {
      const p = (s.address() as { port: number }).port;
      s.close(() => res(p));
    });
  });

const 可访问 = async (端口: number): Promise<boolean> => {
  try {
    const r = await fetch(`http://127.0.0.1:${端口}/api/status`);
    return r.status === 200;
  } catch {
    return false;
  }
};

const 等待可访问 = async (端口: number, 毫秒: number): Promise<boolean> => {
  const 截止 = Date.now() + 毫秒;
  while (Date.now() < 截止) {
    if (await 可访问(端口)) return true;
    await sleep(300);
  }
  return false;
};

interface 临时环境 {
  目录: string;
  配置: string;
  锁: string;
  WebUI端口: number;
  主控端口: number;
}

/** 造一套完全隔离的运行环境 */
async function 造环境(): Promise<临时环境> {
  const 目录 = mkdtempSync(join(tmpdir(), "kugua-lifecycle-"));
  const WebUI端口 = await 空闲端口();
  const 主控端口 = await 空闲端口();
  const 配置 = join(目录, "kugua.config.json");
  writeFileSync(
    配置,
    JSON.stringify({
      host: "127.0.0.1",
      port: 主控端口,
      token: "",
      webui: { port: WebUI端口, open: false, tray: false },
      modules: [],
    }),
    "utf-8",
  );
  return { 目录, 配置, 锁: join(目录, "studio.lock"), WebUI端口, 主控端口 };
}

const 所有子进程 = new Set<ChildProcess>();
const 所有目录 = new Set<string>();

/** 启动一个 WebUI 实例 */
function 起WebUI(环境: 临时环境, 额外: { args?: string[]; cwd?: string; env?: Record<string, string> } = {}): ChildProcess {
  const p = spawn(process.execPath, [WebUI脚本, ...(额外.args ?? ["--no-open"])], {
    cwd: 额外.cwd ?? 仓库根,
    stdio: ["ignore", "pipe", "pipe"],
    windowsHide: true,
    env: {
      ...process.env,
      KUGUA_CONFIG: 环境.配置,
      KUGUA_DATA_DIR: join(环境.目录, "data"),
      KUGUA_GLOBAL_LOCK: 环境.锁,
      ...(额外.env ?? {}),
    },
  });
  所有子进程.add(p);
  p.once("exit", () => 所有子进程.delete(p));
  return p;
}

/** 收集进程输出，便于断言 */
function 收集(p: ChildProcess): () => string {
  let 文本 = "";
  p.stdout?.on("data", (d) => (文本 += String(d)));
  p.stderr?.on("data", (d) => (文本 += String(d)));
  return () => 文本;
}

/** 等进程退出，返回退出码（超时返回 "timeout"） */
function 等退出(p: ChildProcess, 毫秒: number): Promise<number | null | "timeout"> {
  return new Promise((r) => {
    p.once("exit", (码) => r(码));
    setTimeout(() => r("timeout"), 毫秒);
  });
}

beforeAll(() => {
  if (!已构建) {
    console.warn("[跳过] 启动健壮性测试需要先 npm run build");
  }
});

afterEach(() => {
  for (const p of 所有子进程) {
    try {
      p.kill();
    } catch {
      /* 忽略 */
    }
  }
  所有子进程.clear();
  for (const 目录 of 所有目录) {
    try {
      rmSync(目录, { recursive: true, force: true });
    } catch {
      /* 文件可能仍被占用，留给系统清理临时目录 */
    }
  }
  所有目录.clear();
});

describe.runIf(已构建)("启动健壮性", () => {
  it(
    "从任意工作目录启动都能找到主控（不依赖 cwd）",
    async () => {
      // 回归点：以前用 process.cwd() 拼主控路径，从子目录启动得到
      // packages/packages/main/dist/index.js，主控根本没起来，
      // 但 WebUI 仍然"启动成功"。
      const 环境 = await 造环境();
      所有目录.add(环境.目录);
      const p = 起WebUI(环境, { cwd: join(仓库根, "packages") });
      const 输出 = 收集(p);

      expect(await 等待可访问(环境.WebUI端口, 20000)).toBe(true);
      // 关键：主控也必须真的起来了，而不是只有个空壳界面
      expect(输出()).toContain("苦音服务端已启动");
    },
    30000,
  );

  it(
    "主控起不来时 WebUI 退出并释放锁，不留空壳",
    async () => {
      // 回归点：主控失败时 WebUI 仍然对外服务，而且占着全局锁，
      // 用户再启动只会被告知"已有实例在运行"——彻底卡死。
      const 环境 = await 造环境();
      所有目录.add(环境.目录);

      // 抢先占住主控端口，让主控必然起不来
      const 占用 = createServer();
      await new Promise<void>((r) => 占用.listen(环境.主控端口, "127.0.0.1", () => r()));

      try {
        const p = 起WebUI(环境);
        const 输出 = 收集(p);
        const 码 = await 等退出(p, 25000);

        expect(码).toBe(1);
        // 核心：锁必须被释放，否则用户再启动会被"已有实例"挡住
        expect(existsSync(环境.锁)).toBe(false);
        // 端口被占会在启动主控之前就被拦下，报的是更准确的"端口已被占用"；
        // 若真走到主控启动失败，报的是"主控未能启动"。两者都必须退出。
        expect(输出()).toMatch(/主控未能启动|已被其他程序占用/);
      } finally {
        占用.close();
      }
    },
    35000,
  );

  it(
    "--port 能覆盖配置文件里的端口",
    async () => {
      // 回归点：登录计划任务用 -Port 传端口，而端口只能靠命令行传进任务
      //（安装脚本里的 $env: 到不了计划任务）。
      const 环境 = await 造环境();
      所有目录.add(环境.目录);
      const 指定端口 = await 空闲端口();
      expect(指定端口).not.toBe(环境.WebUI端口);

      const p = 起WebUI(环境, { args: ["--port", String(指定端口), "--no-open"] });
      收集(p);

      expect(await 等待可访问(指定端口, 25000)).toBe(true);
      // 配置里的端口不应被使用
      expect(await 可访问(环境.WebUI端口)).toBe(false);
    },
    35000,
  );
  it(
    "WebUI 从任意目录启动也能找对配置、插件、桌面端（不依赖 cwd）",
    async () => {
      // 回归点：server.ts 里 6 处 process.cwd() —— 配置、插件目录、模块 UI 目录、
      // 桌面端 exe、数据目录、托盘 -Root。从子目录启动时它们全部指错地方，
      // 而且大多是**静默降级**：插件"消失"、模块页打不开、莫名回落浏览器模式、
      // 托盘不出现。用户看不出是路径错了，只觉得功能坏了。
      const 环境 = await 造环境();
      所有目录.add(环境.目录);
      const p = spawn(process.execPath, [join(仓库根, "packages", "webui", "dist", "server.js")], {
        cwd: tmpdir(),
        stdio: ["ignore", "pipe", "pipe"],
        windowsHide: true,
        env: {
          ...process.env,
          KUGUA_CONFIG: 环境.配置,
          KUGUA_DATA_DIR: join(环境.目录, "data"),
          KUGUA_GLOBAL_LOCK: 环境.锁,
          KUGUA_NO_OPEN: "1",
        },
      });
      所有子进程.add(p);
      const 输出 = 收集(p);

      const 截止 = Date.now() + 20000;
      while (Date.now() < 截止 && !输出().includes("苦音服务端已启动")) await sleep(300);
      // 关键：不能出现「主控未能启动」这类路径错误
      expect(输出()).not.toMatch(/找不到主控|MODULE_NOT_FOUND|ENOENT/);
      expect(输出()).toContain("苦音服务端已启动");
    },
    30000,
  );

  it(
    "直接运行主控时也不依赖 cwd（外部接入 / 调试 / 脚本）",
    async () => {
      // 回归点：主控里到处用 process.cwd() 解析配置、模块入口、data 目录。
      // 由 WebUI 拉起时没问题，但直接运行主控（外部接入、调试、第三方脚本、
      // 开机任务）时 cwd 是调用者所在目录，于是模块入口拼成不存在的路径。
      const 环境 = await 造环境();
      所有目录.add(环境.目录);
      const p = spawn(process.execPath, [join(仓库根, "packages", "main", "dist", "index.js")], {
        // 关键：从一个与仓库无关的目录启动
        cwd: tmpdir(),
        stdio: ["ignore", "pipe", "pipe"],
        windowsHide: true,
        env: {
          ...process.env,
          KUGUA_CONFIG: 环境.配置,
          KUGUA_DATA_DIR: join(环境.目录, "data"),
          KUGUA_GLOBAL_LOCK: 环境.锁,
        },
      });
      所有子进程.add(p);
      const 输出 = 收集(p);

      // 等主控打印就绪
      const 截止 = Date.now() + 20000;
      while (Date.now() < 截止 && !输出().includes("苦音服务端已启动")) await sleep(300);
      expect(输出()).toContain("苦音服务端已启动");
      // 不能出现入口解析错误
      expect(输出()).not.toMatch(/入口不存在|ENOENT/);
    },
    30000,
  );
});

describe.runIf(已构建)("退出与重启", () => {
  it(
    "重启接管：新实例会等旧实例放锁，而不是自己放弃",
    async () => {
      // 这条是重启最危险的一环：/api/restart 先 spawn 新实例、再释放锁、最后 exit。
      // 如果新实例在锁还没释放时就跑到单实例守卫，它会看到"旧实例还活着"而自行退出
      // ——一次重启就把平台彻底搞没了，用户只看到页面断开。
      //
      // 直接复现这个窗口期：用一把指向**真实存活进程**的锁模拟"旧实例尚未退出"，
      // 然后以重启身份启动实例。它必须等、并最终接管。
      const 环境 = await 造环境();
      所有目录.add(环境.目录);
      const 存活 = spawn(process.execPath, ["-e", "setInterval(()=>{},1000)"], {
        stdio: "ignore",
        windowsHide: true,
      });
      所有子进程.add(存活);

      // 写一把"活锁"：pid 是真实存活的进程
      writeFileSync(
        环境.锁,
        JSON.stringify({ pid: 存活.pid, 启动时间: Date.now(), 标识: "studio", 附加: { 入口: "webui" } }),
        "utf-8",
      );
      expect(existsSync(环境.锁)).toBe(true);

      const p = 起WebUI(环境, { env: { KUGUA_RESTART_TAKEOVER: "1" } });
      const 输出 = 收集(p);

      // 让出等待窗口：实例应当先等，而不是立刻退出
      await sleep(1500);
      expect(p.exitCode).toBeNull(); // 还在等，没放弃

      // 旧实例"退出"：杀掉占位进程 + 删锁，模拟重启交接完成
      存活.kill();
      await sleep(300);
      rmSync(环境.锁, { force: true });

      expect(await 等待可访问(环境.WebUI端口, 30000)).toBe(true);
      expect(输出()).toContain("已接管上一个实例");
    },
    60000,
  );

  it(
    "带重启标记也不能绕过单实例保护",
    async () => {
      // 重启接管靠 KUGUA_RESTART_TAKEOVER=1 放行短暂等待锁，
      // 但等待期过了仍然必须放弃——否则设个环境变量就能开第二个实例。
      const 环境 = await 造环境();
      所有目录.add(环境.目录);

      const 甲 = 起WebUI(环境);
      收集(甲);
      expect(await 等待可访问(环境.WebUI端口, 25000)).toBe(true);

      // 第二个实例：换端口、同锁、带重启标记
      const 乙端口 = await 空闲端口();
      const 乙目录 = await 造环境();
      所有目录.add(乙目录.目录);
      const 乙 = 起WebUI(乙目录, {
        args: ["--port", String(乙端口), "--no-open"],
        env: { KUGUA_GLOBAL_LOCK: 环境.锁, KUGUA_RESTART_TAKEOVER: "1" },
      });
      const 乙输出 = 收集(乙);

      const 码 = await 等退出(乙, 30000);
      expect(码).toBe(0);
      expect(乙输出()).toContain("已有苦瓜工作室实例在运行");
      expect(await 可访问(乙端口)).toBe(false);

      // 原来的实例不能被影响
      expect(await 可访问(环境.WebUI端口)).toBe(true);
    },
    70000,
  );
});
