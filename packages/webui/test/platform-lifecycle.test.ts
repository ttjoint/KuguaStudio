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
import { existsSync, mkdtempSync, mkdirSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { 取测试端口, 端口段 } from "./port-pool.js";

const 仓库根 = resolve(__dirname, "..", "..", "..");
const 主控脚本 = join(仓库根, "packages", "main", "dist", "index.js");
const WebUI脚本 = join(仓库根, "packages", "webui", "dist", "server.js");
const 已构建 = existsSync(主控脚本) && existsSync(WebUI脚本);

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

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
    const 主控端口 = await 取测试端口(端口段.平台生命周期);
    const webui端口 = await 取测试端口(端口段.平台生命周期);
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
    const 环境 = { KUGUA_CONFIG: 配置路径, KUGUA_DATA_DIR: 数据目录, KUGUA_GLOBAL_LOCK: join(临时目录, "single.lock") };
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
    const 主控端口 = await 取测试端口(端口段.平台生命周期);
    const 临时数据 = join(临时目录, `dyn-${主控端口}`);
    const 配置路径 = join(临时目录, `dyn-${主控端口}.json`);
    const 写配置 = (模块: Array<Record<string, unknown>>) =>
      writeFileSync(配置路径, JSON.stringify({ host: "127.0.0.1", port: 主控端口, token: "", modules: 模块 }));
    写配置([{ name: "echo", type: "process", entry: "packages/modules/echo/dist/index.js", autoStart: true }]);
    const main = 启动(主控脚本, { KUGUA_CONFIG: 配置路径, KUGUA_DATA_DIR: 临时数据, KUGUA_GLOBAL_LOCK: join(临时数据, "studio.lock") });
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

  it("配置写回保留不认识的顶层节（ai / plugins）", async () => {
    const 主控端口 = await 取测试端口(端口段.平台生命周期);
    const 临时数据 = join(临时目录, `keep-${主控端口}`);
    const 配置路径 = join(临时目录, `keep-${主控端口}.json`);
    writeFileSync(
      配置路径,
      JSON.stringify({
        host: "127.0.0.1",
        port: 主控端口,
        token: "",
        modules: [{ name: "echo", type: "process", entry: "packages/modules/echo/dist/index.js", autoStart: true }],
        // 主控自身不认识这两节，但落盘时必须原样保留，否则模块配置会被静默抹掉
        ai: { openwebui: { enabled: true, baseUrl: "http://127.0.0.1:8090" } },
        plugins: { dir: "./plugins" },
      }),
    );
    const main = 启动(主控脚本, { KUGUA_CONFIG: 配置路径, KUGUA_DATA_DIR: 临时数据, KUGUA_GLOBAL_LOCK: join(临时数据, "studio.lock") });
    let 客户端: Awaited<ReturnType<typeof 连接主控>> | null = null;
    try {
      await sleep(4000);
      客户端 = await 连接主控(主控端口);
      await sleep(500);
      // 触发一次落盘：reload 会写回配置
      await 客户端.request("nigane", "nigane.registry.reload", {});
      await sleep(800);
      const 回读 = JSON.parse(readFileSync(配置路径, "utf-8")) as Record<string, unknown>;
      expect(回读.ai).toEqual({ openwebui: { enabled: true, baseUrl: "http://127.0.0.1:8090" } });
      expect(回读.plugins).toEqual({ dir: "./plugins" });
    } finally {
      客户端?.close();
      await main.结束();
    }
  }, 60000);

  it("插件动态检测：投放插件目录自动加载，删除后自动卸载", async () => {
    const 主控端口 = await 取测试端口(端口段.平台生命周期);
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
    const main = 启动(主控脚本, { KUGUA_CONFIG: 配置路径, KUGUA_DATA_DIR: 临时数据, KUGUA_GLOBAL_LOCK: join(临时数据, "studio.lock") });
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

/**
 * 外部程序动态接入（docs/接入协议.md）
 *
 * 验证两条生命周期语义：
 *  1) 运行中接入的外部程序 → 其能力立即进注册表、断开后自动移除；
 *  2) 平台退出时只广播 system.shutdown，不对外部进程发信号、不强杀。
 */
describe.skipIf(!已构建)("外部程序动态接入", () => {
  const 临时目录 = mkdtempSync(join(tmpdir(), "kugua-external-"));

  afterAll(() => {
    rmSync(临时目录, { recursive: true, force: true });
  });

  it("接入后能力可见，断开后自动移除，平台退出只广播 system.shutdown", async () => {
    const 主控端口 = await 取测试端口(端口段.平台生命周期);
    const 配置路径 = join(临时目录, "kugua.config.json");
    writeFileSync(
      配置路径,
      JSON.stringify({ host: "127.0.0.1", port: 主控端口, token: "", modules: [] }),
      "utf-8",
    );

    const 主控 = 启动(主控脚本, {
      KUGUA_CONFIG: 配置路径,
      KUGUA_GLOBAL_LOCK: join(临时目录, `lock-${主控端口}.lock`),
      KUGUA_DATA_DIR: join(临时目录, "data"),
    });

    let 外部: 子实例 | null = null;
    let 观察者: Awaited<ReturnType<typeof 连接主控>> | null = null;
    try {
      // 等主控就绪
      for (let i = 0; i < 30; i += 1) {
        if (主控.输出().includes("苦音服务端已启动")) break;
        await sleep(500);
      }
      expect(主控.输出()).toContain("苦音服务端已启动");

      // 以「外部程序」身份接入：使用仓库里的示例（不依赖 @kugua/nigane）
      const 示例脚本 = join(仓库根, "examples", "external-module", "run.mjs");
      expect(existsSync(示例脚本)).toBe(true);
      外部 = 启动(示例脚本, { KUGUA_PORT: String(主控端口), KUGUA_TOKEN: "" });

      // 等它握手成功
      let 已接入 = false;
      for (let i = 0; i < 30; i += 1) {
        if (外部.输出().includes("握手成功")) {
          已接入 = true;
          break;
        }
        await sleep(500);
      }
      expect(已接入).toBe(true);

      // 1) 能力注册表里能看到外部模块声明的能力
      观察者 = await 连接主控(主控端口);
      const 能力 = (await 观察者.request("kugua-main", "capability.list", {})) as Array<{
        名称: string;
        模块: string;
        中文指令?: string[];
      }>;
      const 条目 = 能力.find((c) => c.名称 === "示例外部模块.回声");
      expect(条目).toBeTruthy();
      expect(条目?.模块).toBe("示例外部模块");
      expect(条目?.中文指令).toContain("回声");

      // 2) 动态接入的模块必须出现在管理列表里。
      //    回归：config.list 原来只遍历配置文件的 modules 数组，
      //    用户手动跑起来的外部程序在设置页里完全看不见——状态查得到、
      //    配置改不了，等于「东西在那儿但摸不到」。
      const 管理列表 = (await 观察者.request("kugua-main", "nigane.registry.config.list", {})) as Array<{
        name: string;
        在线: boolean;
      }>;
      const 管理项 = 管理列表.find((m) => m.name === "示例外部模块");
      expect(管理项).toBeTruthy();
      expect(管理项?.在线).toBe(true);

      // 3) 外部程序退出 → 能力自动移除（对方下线这边自动下线）
      外部.进程.kill();
      let 已移除 = false;
      for (let i = 0; i < 30; i += 1) {
        const 当前 = (await 观察者.request("kugua-main", "capability.list", {})) as Array<{ 名称: string }>;
        if (!当前.some((c) => c.名称 === "示例外部模块.回声")) {
          已移除 = true;
          break;
        }
        await sleep(500);
      }
      expect(已移除).toBe(true);
    } finally {
      观察者?.close();
      外部?.进程.kill();
      await 主控.结束();
    }
  }, 90000);
});

/**
 * 平台退出：外部程序应收到 system.shutdown 广播并自行退出。
 * 通过内置动作 nigane.shutdown 触发优雅关闭
 * （Windows 上对进程发 SIGTERM 是硬杀，收不到广播）。
 */
describe.skipIf(!已构建)("平台退出通知", () => {
  const 临时目录 = mkdtempSync(join(tmpdir(), "kugua-shutdown-"));

  afterAll(() => {
    rmSync(临时目录, { recursive: true, force: true });
  });

  it("nigane.shutdown 触发 system.shutdown 广播，外部程序收到后自行退出", async () => {
    const 主控端口 = await 取测试端口(端口段.平台生命周期);
    const 配置路径 = join(临时目录, "kugua.config.json");
    writeFileSync(
      配置路径,
      JSON.stringify({ host: "127.0.0.1", port: 主控端口, token: "", modules: [] }),
      "utf-8",
    );

    const 主控 = 启动(主控脚本, {
      KUGUA_CONFIG: 配置路径,
      KUGUA_GLOBAL_LOCK: join(临时目录, `lock-${主控端口}.lock`),
      KUGUA_DATA_DIR: join(临时目录, "data"),
    });

    let 外部: 子实例 | null = null;
    let 观察者: Awaited<ReturnType<typeof 连接主控>> | null = null;
    try {
      for (let i = 0; i < 30; i += 1) {
        if (主控.输出().includes("苦音服务端已启动")) break;
        await sleep(500);
      }

      const 示例脚本 = join(仓库根, "examples", "external-module", "run.mjs");
      外部 = 启动(示例脚本, { KUGUA_PORT: String(主控端口), KUGUA_TOKEN: "" });

      let 已接入 = false;
      for (let i = 0; i < 30; i += 1) {
        if (外部.输出().includes("握手成功")) {
          已接入 = true;
          break;
        }
        await sleep(500);
      }
      expect(已接入).toBe(true);

      观察者 = await 连接主控(主控端口);
      await 观察者.request("kugua-main", "nigane.shutdown", {});

      // 外部程序应收到 system.shutdown 并自行退出
      let 已收到通知 = false;
      for (let i = 0; i < 30; i += 1) {
        if (外部.输出().includes("收到 system.shutdown")) {
          已收到通知 = true;
          break;
        }
        await sleep(300);
      }
      expect(已收到通知).toBe(true);

      // 平台自己也要真的关掉（不是被硬杀）
      let 已关闭 = false;
      for (let i = 0; i < 30; i += 1) {
        if (主控.输出().includes("正在关闭")) {
          已关闭 = true;
          break;
        }
        await sleep(300);
      }
      expect(已关闭).toBe(true);
    } finally {
      观察者?.close();
      外部?.进程.kill();
      await 主控.结束();
    }
  }, 90000);
});

/**
 * 托管注册：外部模块自报「下次随平台启动」，平台写入配置。
 *
 * 关键约束（防止回归）：
 *   1) 首次注册 → 按上报信息写入配置（路径、参数、是否随平台启动）；
 *   2) 已有配置 → 绝不覆盖用户改过的值，两边都留痕；
 *   3) 管理接口能查看与编辑（路径 / 参数 / 启用状态）。
 */
describe.skipIf(!已构建)("托管注册", () => {
  const 临时目录 = mkdtempSync(join(tmpdir(), "kugua-managed-"));
  /** 用户路径用常量拼出，避开反斜杠转义 */
  const 用户路径 = ["D:", "custom", "x.exe"].join(String.fromCharCode(92));

  afterAll(() => {
    rmSync(临时目录, { recursive: true, force: true });
  });

  /** 起一个只做握手 + 上报托管信息的外部程序（真实脚本，不是 mock） */
  function 写托管探针(路径: string, 模块名: string, 入口: string, 参数: string[]): void {
    writeFileSync(
      路径,
      `// 托管注册探针：连上平台、上报托管意愿，然后保持在线
const 端口 = process.env.KUGUA_PORT;
const 令牌 = process.env.KUGUA_TOKEN ?? "";
const 信封 = (类型, 额外) => JSON.stringify({
  nigane: "0.2",
  id: Math.random().toString(36).slice(2),
  type: 类型,
  from: ${JSON.stringify(模块名)},
  time: Math.floor(Date.now() / 1000),
  ...额外,
});
const ws = new WebSocket("ws://127.0.0.1:" + 端口);
ws.addEventListener("open", () => {
  ws.send(信封("hello", {
    params: {
      name: ${JSON.stringify(模块名)},
      version: "0.0.1",
      capabilities: [],
      token: 令牌,
      托管: {
        enabled: true,
        entry: ${JSON.stringify(入口)},
        args: ${JSON.stringify(参数)},
      },
    },
  }));
});
ws.addEventListener("message", (e) => {
  const m = JSON.parse(e.data);
  if (m.type === "hello_ack") console.log("握手成功");
  // 协议要求：必须实现 module.query，否则平台判定为离线
  if (m.type === "request" && m.action === "module.query") {
    ws.send(信封("response", {
      to: "kugua-main",
      echo: m.id,
      data: {
        name: ${JSON.stringify(模块名)},
        version: "0.0.1",
        path: ${JSON.stringify(入口)},
        capabilityDefs: [],
      },
    }));
  }
  if (m.type === "event" && m.action === "system.shutdown") process.exit(0);
});
setInterval(() => {}, 1000);
`,
      "utf-8",
    );
  }

  it("首次注册写入配置；已有配置不覆盖；管理接口可查看与编辑", async () => {
    const 主控端口 = await 取测试端口(端口段.平台生命周期);
    const 配置路径 = join(临时目录, "kugua.config.json");
    writeFileSync(
      配置路径,
      JSON.stringify({ host: "127.0.0.1", port: 主控端口, token: "", modules: [] }),
      "utf-8",
    );

    const 主控 = 启动(主控脚本, {
      KUGUA_CONFIG: 配置路径,
      KUGUA_GLOBAL_LOCK: join(临时目录, `lock-${主控端口}.lock`),
      KUGUA_DATA_DIR: join(临时目录, "data"),
    });

    let 探针: 子实例 | null = null;
    let 观察者: Awaited<ReturnType<typeof 连接主控>> | null = null;
    try {
      for (let i = 0; i < 30; i += 1) {
        if (主控.输出().includes("苦音服务端已启动")) break;
        await sleep(500);
      }
      expect(主控.输出()).toContain("苦音服务端已启动");

      // —— 第一次接入：应新建配置项 ——
      const 探针脚本 = join(临时目录, "managed-probe.mjs");
      const 上报入口 = process.execPath;
      const 上报参数 = ["--demo", "--hosted"];
      写托管探针(探针脚本, "托管探针模块", 上报入口, 上报参数);
      探针 = 启动(探针脚本, { KUGUA_PORT: String(主控端口), KUGUA_TOKEN: "" });

      let 已接入 = false;
      for (let i = 0; i < 30; i += 1) {
        if (探针.输出().includes("握手成功")) { 已接入 = true; break; }
        await sleep(500);
      }
      expect(已接入).toBe(true);

      // 配置应已被写入
      let 配置对象 = JSON.parse(readFileSync(配置路径, "utf-8")) as {
        modules: Array<{ name: string; entry?: string; args?: string[]; autoStart?: boolean }>;
      };
      let 项 = 配置对象.modules.find((m) => m.name === "托管探针模块");
      expect(项).toBeTruthy();
      expect(项?.entry).toBe(上报入口);
      expect(项?.args).toEqual(上报参数);
      expect(项?.autoStart).toBe(true);
      expect(主控.输出()).toContain("托管注册：新建模块「托管探针模块」");

      // —— 模拟用户在管理界面改过配置 ——
      观察者 = await 连接主控(主控端口);
      await 观察者.request("kugua-main", "nigane.registry.config.set", {
        name: "托管探针模块",
        启用: false,
        路径: 用户路径,
        参数: ["--user-edited"],
      });

      // —— 再次接入：不得覆盖用户配置 ——
      探针.进程.kill();
      await sleep(1500);
      const 探针2 = 启动(探针脚本, { KUGUA_PORT: String(主控端口), KUGUA_TOKEN: "" });
      探针 = 探针2;
      for (let i = 0; i < 30; i += 1) {
        if (探针.输出().includes("握手成功")) break;
        await sleep(500);
      }
      await sleep(800); // 等主控处理完托管申请

      配置对象 = JSON.parse(readFileSync(配置路径, "utf-8"));
      项 = 配置对象.modules.find((m) => m.name === "托管探针模块");
      expect(项?.entry).toBe(用户路径); // 用户值保留
      expect(项?.args).toEqual(["--user-edited"]); // 用户值保留
      expect(项?.autoStart).toBe(false); // 用户值保留
      // 冲突应在主控日志里明确记录
      expect(主控.输出()).toContain("已有配置，本次不覆盖");
      expect(主控.输出()).toContain("保留本地");

      // —— 管理接口：可查看 ——
      const 列表 = (await 观察者.request("kugua-main", "nigane.registry.config.list", {})) as Array<{
        name: string;
        启用: boolean;
        路径: string;
        参数: string[];
      }>;
      const 查看项 = 列表.find((m) => m.name === "托管探针模块");
      expect(查看项?.启用).toBe(false);
      expect(查看项?.路径).toBe(用户路径);
      expect(查看项?.参数).toEqual(["--user-edited"]);
    } finally {
      观察者?.close();
      探针?.进程.kill();
      await 主控.结束();
    }
  }, 90000);
});
