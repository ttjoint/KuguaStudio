/**
 * 平台生命周期集成测试
 *
 * 覆盖三项平台级能力的端到端行为（均使用隔离端口/临时配置，绝不触碰用户实例）：
 *   1) 单实例守卫：第二个实例检测到已有实例并自行退出，且不影响第一个实例；
 *   2) 动态模块检测：新增/移除模块后，主控可重新检测并动态加载/卸载；
 *   3) 插件动态检测：向插件目录投放/删除插件时，自动加载/卸载。
 *
 * 这些用例需要已构建的 dist 产物（npm run build），未构建时自动跳过。
 */
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { spawn, type ChildProcess } from "node:child_process";
import { existsSync, mkdtempSync, mkdirSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { createRequire } from "node:module";

const 仓库根 = resolve(__dirname, "..", "..", "..");
const 主控脚本 = join(仓库根, "packages", "main", "dist", "index.js");
const WebUI脚本 = join(仓库根, "packages", "webui", "dist", "server.js");
const 已构建 = existsSync(主控脚本) && existsSync(WebUI脚本);

const require_ = createRequire(import.meta.url);
const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));
/** 取一个空闲端口 */
const 空闲端口 = (): Promise<number> =>
  new Promise((res, rej) => {
    // eslint-disable-next-line @typescript-eslint/no-var-requires
    const net = require_("node:net") as typeof import("node:net");
    const s = net.createServer();
    s.once("error", rej);
    s.listen(0, "127.0.0.1", () => {
      const p = (s.address() as { port: number }).port;
      s.close(() => res(p));
    });
  });

interface 子实例 {
  进程: ChildProcess;
  输出: () => string;
  退出码: () => number | null;
  结束: () => Promise<void>;
}

function 启动(脚本: string, 环境: Record<string, string>): 子实例 {
  const 进程 = spawn(process.execPath, [脚本, "--no-open"], {
    cwd: 仓库根,
    env: { ...process.env, ...环境 },
    stdio: ["ignore", "pipe", "pipe"],
    windowsHide: true,
  });
  let 文本 = "";
  进程.stdout?.on("data", (d: Buffer) => (文本 += d.toString()));
  进程.stderr?.on("data", (d: Buffer) => (文本 += d.toString()));
  let 码: number | null = null;
  进程.on("exit", (c) => (码 = c));
  return {
    进程,
    输出: () => 文本,
    退出码: () => 码,
    结束: async () => {
      try {
        进程.kill("SIGINT");
      } catch {
        /* ignore */
      }
      await sleep(1500);
      try {
        进程.kill("SIGKILL");
      } catch {
        /* ignore */
      }
    },
  };
}

/** 连接苦音主控的测试客户端 */
async function 连接主控(端口: number) {
  const { NiganeClient } = (await import("@kugua/nigane")) as typeof import("@kugua/nigane");
  const 客户端 = new NiganeClient({ name: "test", url: `ws://127.0.0.1:${端口}`, token: "", capabilities: ["test"] });
  await 客户端.connect();
  return 客户端;
}

describe.skipIf(!已构建)("平台生命周期", () => {
  const 临时目录 = mkdtempSync(join(tmpdir(), "kugua-lifecycle-"));
  const 数据目录 = join(临时目录, "data");

  afterAll(() => {
    rmSync(临时目录, { recursive: true, force: true });
  });

  it("单实例守卫：第二个实例检测到已有实例并退出，第一个不受影响", async () => {
    const 主控端口 = await 空闲端口();
    const webui端口 = await 空闲端口();
    const 配置路径 = join(临时目录, `single-${主控端口}.json`);
    writeFileSync(
      配置路径,
      JSON.stringify({
        host: "127.0.0.1",
        port: 主控端口,
        token: "",
        webui: { port: webui端口, open: false, tray: false },
        modules: [],
      }),
    );
    const 环境 = { KUGUA_CONFIG: 配置路径, KUGUA_DATA_DIR: 数据目录 };
    const a = 启动(WebUI脚本, 环境);
    try {
      // 等待 A 就绪
      let 就绪 = false;
      for (let i = 0; i < 40; i++) {
        try {
          const r = await fetch(`http://127.0.0.1:${webui端口}/api/status`);
          if (r.status === 200) {
            就绪 = true;
            break;
          }
        } catch {
          /* 未就绪 */
        }
        await sleep(500);
      }
      expect(就绪).toBe(true);
      const 前 = (await (await fetch(`http://127.0.0.1:${webui端口}/api/status`)).json()) as { pid: number };

      // 启动 B：应自行退出，且日志提示「已有实例」
      const b = 启动(WebUI脚本, 环境);
      await new Promise<void>((res) => {
        const 定时 = setTimeout(() => res(), 15000);
        b.进程.on("exit", () => {
          clearTimeout(定时);
          res();
        });
      });
      expect(b.退出码()).toBe(0);
      expect(b.输出()).toContain("已有苦瓜工作室实例在运行");
      await b.结束();

      // A 仍存活
      const 后 = (await (await fetch(`http://127.0.0.1:${webui端口}/api/status`)).json()) as { pid: number };
      expect(后.pid).toBe(前.pid);
    } finally {
      await a.结束();
    }
  }, 90000);

  it("动态模块检测：新增模块被加载、移除模块被卸载", async () => {
    const 主控端口 = await 空闲端口();
    const 临时数据 = join(临时目录, `dyn-${主控端口}`);
    const 配置路径 = join(临时目录, `dyn-${主控端口}.json`);
    const 写配置 = (模块: Array<Record<string, unknown>>) =>
      writeFileSync(配置路径, JSON.stringify({ host: "127.0.0.1", port: 主控端口, token: "", modules: 模块 }));
    写配置([{ name: "echo", type: "process", entry: "packages/modules/echo/dist/index.js", autoStart: true }]);
    const main = 启动(主控脚本, { KUGUA_CONFIG: 配置路径, KUGUA_DATA_DIR: 临时数据 });
    let 客户端: Awaited<ReturnType<typeof 连接主控>> | null = null;
    try {
      await sleep(4000);
      客户端 = await 连接主控(主控端口);
      await sleep(500);
      const 初 = (await 客户端.request("nigane", "nigane.registry.details", {})) as Array<{ name: string }>;
      expect(初.map((m) => m.name)).toContain("echo");
      expect(初.map((m) => m.name)).not.toContain("dice");

      // 新增 dice
      写配置([
        { name: "echo", type: "process", entry: "packages/modules/echo/dist/index.js", autoStart: true },
        { name: "dice", type: "process", entry: "packages/modules/dice/dist/index.js", autoStart: true },
      ]);
      const 增 = (await 客户端.request("nigane", "nigane.registry.reload", {})) as { 新增: string[]; 已启动: string[] };
      expect(增.新增).toContain("dice");
      expect(增.已启动).toContain("dice");
      await sleep(1500);
      const 中 = (await 客户端.request("nigane", "nigane.registry.details", {})) as Array<{
        name: string;
        online?: boolean;
      }>;
      expect(中.find((m) => m.name === "dice")?.online).toBe(true);

      // 移除 echo
      写配置([{ name: "dice", type: "process", entry: "packages/modules/dice/dist/index.js", autoStart: true }]);
      const 删 = (await 客户端.request("nigane", "nigane.registry.reload", {})) as { 移除: string[]; 已停止: string[] };
      expect(删.移除).toContain("echo");
      expect(删.已停止).toContain("echo");
      await sleep(1500);
      const 末 = (await 客户端.request("nigane", "nigane.registry.details", {})) as Array<{ name: string }>;
      expect(末.map((m) => m.name)).not.toContain("echo");
      expect(末.map((m) => m.name)).toContain("dice");
    } finally {
      客户端?.close();
      await main.结束();
    }
  }, 90000);

  it("插件动态检测：投放插件目录自动加载，删除后自动卸载", async () => {
    const 主控端口 = await 空闲端口();
    const 临时数据 = join(临时目录, `plug-${主控端口}`);
    // 插件目录放在仓库内，便于解析 @kugua/plugin-sdk 依赖
    const 插件根 = join(仓库根, `.tmp-plugin-test-${主控端口}`);
    rmSync(插件根, { recursive: true, force: true });
    mkdirSync(插件根, { recursive: true });
    const 配置路径 = join(临时目录, `plug-${主控端口}.json`);
    writeFileSync(
      配置路径,
      JSON.stringify({
        host: "127.0.0.1",
        port: 主控端口,
        token: "",
        plugins: { dir: 插件根 },
        modules: [{ name: "plugins", type: "process", entry: "packages/modules/plugins/dist/index.js", autoStart: true }],
      }),
    );
    const main = 启动(主控脚本, { KUGUA_CONFIG: 配置路径, KUGUA_DATA_DIR: 临时数据 });
    let 客户端: Awaited<ReturnType<typeof 连接主控>> | null = null;
    try {
      await sleep(5000);
      客户端 = await 连接主控(主控端口);
      await sleep(500);
      expect((await 客户端.request("plugins", "plugins.list", {})) as unknown[]).toHaveLength(0);

      // 投放插件
      const 插件目录 = join(插件根, "demo-plugin");
      mkdirSync(插件目录, { recursive: true });
      writeFileSync(
        join(插件目录, "kugua-plugin.json"),
        JSON.stringify({ name: "demo-plugin", version: "1.0.0", description: "测试", entry: "index.js" }),
      );
      writeFileSync(
        join(插件目录, "index.js"),
        [
          'import { BasePlugin } from "@kugua/plugin-sdk";',
          "export default class Demo extends BasePlugin {",
          '  static 插件元数据 = { name: "demo-plugin", version: "1.0.0" };',
          '  命令 = [{ 匹配: /^hello$/, 说明: "打招呼", 处理: async () => "hi" }];',
          "}",
        ].join("\n"),
      );
      // 等待目录监听/定时兜底自动检测
      let 已加载 = false;
      for (let i = 0; i < 20; i++) {
        const 列表 = (await 客户端.request("plugins", "plugins.list", {})) as Array<{ name: string; 状态: string }>;
        if (列表.some((p) => p.name === "demo-plugin" && p.状态 === "enabled")) {
          已加载 = true;
          break;
        }
        await sleep(1000);
      }
      expect(已加载).toBe(true);

      // 删除目录 → 手动 detect 应卸载
      rmSync(插件目录, { recursive: true, force: true });
      const 检测 = (await 客户端.request("plugins", "plugins.detect", {})) as { 已卸载: string[] };
      expect(检测.已卸载).toContain("demo-plugin");
      const 末尾 = (await 客户端.request("plugins", "plugins.list", {})) as Array<{ name: string }>;
      expect(末尾.map((p) => p.name)).not.toContain("demo-plugin");
    } finally {
      客户端?.close();
      await main.结束();
      rmSync(插件根, { recursive: true, force: true });
    }
  }, 90000);
});
