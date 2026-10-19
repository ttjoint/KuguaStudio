/**
 * 模块 / 插件装卸测试的共用沙盒。
 *
 * ## 这组测试要回答的问题
 *
 * 整个项目的架构承诺是：**每个模块独立可装卸，彼此只通过消息互通，
 * 不共享进程、不共享内存、不直接 import**。这个承诺如果破了，
 * 症状往往不是崩溃，而是「同时开着 A 和 B 时某个行为悄悄变了」。
 *
 * 所以每个用例都是：**只起主控 + 指定的模块子集**，然后看行为。
 *
 * ## 为什么不是「起一个完整实例，然后手工点点看」
 *
 * 那不可重复，也覆盖不了排列组合。这里每个用例都从空列表开始，
 * 按需加模块，天然覆盖「A 单独」「A+B」「只有 C」这些形态。
 *
 * ## 隔离要求（绝不能省）
 *
 * - `KUGUA_GLOBAL_LOCK` 必须独立：否则会跟用户正在运行的实例抢锁
 * - 端口必须从固定段内递增分配：`listen(0)` 在 Windows 上会撞
 *   Hyper-V 保留的动态段，报 EACCES
 * - 数据目录、配置文件全部临时目录，退出即删
 */

import { spawn, type ChildProcess } from "node:child_process";
import { existsSync, mkdtempSync, mkdirSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";

export const 仓库根 = resolve(__dirname, "..", "..", "..");
export const 主控脚本 = join(仓库根, "packages", "main", "dist", "index.js");
export const WebUI脚本 = join(仓库根, "packages", "webui", "dist", "server.js");

/** 全部模块名（从仓库目录猜，不依赖配置——配置可能被测试改过） */
export function 全部模块名(): string[] {
  const 目录 = join(仓库根, "packages", "modules");
  if (!existsSync(目录)) return [];
  return (require("node:fs") as typeof import("node:fs"))
    .readdirSync(目录, { withFileTypes: true })
    .filter((d) => d.isDirectory() && existsSync(join(目录, d.name, "package.json")))
    .map((d) => d.name)
    .sort();
}

/** 某模块的入口（相对仓库根）；产物不存在就是 null */
export function 模块入口(名: string): string | null {
  const 相对 = `packages/modules/${名}/dist/index.js`;
  return existsSync(join(仓库根, 相对)) ? 相对 : null;
}

export interface 模块声明输入 {
  name: string;
  /** 默认 true */
  autoStart?: boolean;
  /** 默认按仓库路径推断 */
  entry?: string;
}

export interface 沙盒选项 {
  /** 要挂哪些模块。**空数组就是「只有主控」这个基准形态** */
  模块: (string | 模块声明输入)[];
  /** 主控端口（必须从测试端口段取） */
  端口: number;
  /** 额外配置项，会并进配置根 */
  额外配置?: Record<string, unknown>;
}

export interface 沙盒 {
  主控端口: number;
  临时目录: string;
  数据目录: string;
  配置路径: string;
  输出: () => string;
  /** 已注册到主控的模块名（经 nigane.registry.list） */
  在线模块: () => Promise<string[]>;
  /** 列出各模块声明的能力名 */
  能力表: () => Promise<Record<string, string[]>>;
  /** 直接向某模块发一个动作 */
  请求: (目标: string, 动作: string, 参数?: unknown, 超时?: number) => Promise<unknown>;
  /**
   * 同 `请求`，但**不包装**错误信息。
   *
   * `请求` 会包成 `${目标}.${动作} 失败：${原错}`，方便定位是哪条
   * 断言挂的。但这样一来 message 里**永远**含有目标模块名，
   * 想验证「底层错误本身点没点名模块」就永远成立——那种断言是假的。
   */
  裸请求: (目标: string, 动作: string, 参数?: unknown, 超时?: number) => Promise<unknown>;
  /**
   * 改配置里的模块列表并让主控重新探测。
   *
   * 这是「装卸模块」的真实形态：注册表来自配置，不能凭空 start 一个
   * 配置里没有的模块。改完 reload，主控会重新读配置、起新模块、
   * 停掉已经不在列表里的。
   */
  装载: (名们: string[]) => Promise<void>;
  /** 列出模块贡献的界面页 */
  模块页: () => Promise<Array<{ name: string; title: string; entry: string }>>;
  /** 查询注册表详情（含 ui 字段） */
  详情: () => Promise<Array<{ name: string; ui?: unknown }>>;
  关停: () => Promise<void>;
}

/** 测试客户端在注册表里的名字。见 在线模块() 里的说明 */
const 测试客户端名 = "iso-test";

const 稍等 = (ms: number) => new Promise((r) => setTimeout(r, ms));

/**
 * 起一个隔离的主控实例。
 *
 * 只连主控、不起 WebUI：这组测试关心的是「模块在不在、能不能通」，
 * 不是 HTTP 界面。少一层进程，启动快一半，也少一处可能失败的地方。
 */
export async function 起沙盒(选项: 沙盒选项): Promise<沙盒> {
  const 临时目录 = mkdtempSync(join(tmpdir(), "kugua-iso-"));
  const 数据目录 = join(临时目录, "data");
  mkdirSync(数据目录, { recursive: true });
  const 配置路径 = join(临时目录, "kugua.config.json");

  const 模块 = 选项.模块.map((项) => {
    const 名 = typeof 项 === "string" ? 项 : 项.name;
    const 入口 = typeof 项 === "string" ? 模块入口(名) : (项.entry ?? 模块入口(名));
    return {
      name: 名,
      type: "process" as const,
      entry: 入口,
      autoStart: typeof 项 === "string" ? true : (项.autoStart ?? true),
    };
  });

  writeFileSync(
    配置路径,
    JSON.stringify({
      host: "127.0.0.1",
      port: 选项.端口,
      token: "",
      modules: 模块,
      ...选项.额外配置,
    }),
  );

  const 主控 = spawn(process.execPath, [主控脚本], {
    cwd: 仓库根,
    env: {
      ...process.env,
      KUGUA_CONFIG: 配置路径,
      // 本地覆盖也指到临时目录，免得读到仓库里的 kugua.config.local.json
      KUGUA_CONFIG_LOCAL: join(临时目录, "kugua.config.local.json"),
      KUGUA_DATA_DIR: 数据目录,
      KUGUA_GLOBAL_LOCK: join(临时目录, "studio.lock"),
    },
    stdio: ["ignore", "pipe", "pipe"],
    windowsHide: true,
  });

  let 文本 = "";
  主控.stdout?.on("data", (d: Buffer) => (文本 += d.toString()));
  主控.stderr?.on("data", (d: Buffer) => (文本 += d.toString()));

  const { NiganeClient } = (await import("@kugua/nigane")) as typeof import("@kugua/nigane");

  /** 连上主控；连不上就是 null（调用方自己决定要不要失败） */
  const 连 = async (): Promise<InstanceType<typeof NiganeClient> | null> => {
    for (let i = 0; i < 40; i++) {
      try {
        const c = new NiganeClient({
          name: 测试客户端名,
          url: `ws://127.0.0.1:${选项.端口}`,
          token: "",
          capabilities: ["test"],
        });
        await c.connect();
        return c;
      } catch {
        await 稍等(500);
      }
    }
    return null;
  };

  const 客户端 = await 连();
  if (!客户端) {
    try {
      主控.kill("SIGKILL");
    } catch {
      /* ignore */
    }
    rmSync(临时目录, { recursive: true, force: true });
    throw new Error(`主控没起来（端口 ${选项.端口}）：\n${文本}`);
  }

  const 请求 = async (目标: string, 动作: string, 参数: unknown = {}, 超时 = 20000): Promise<unknown> => {
    try {
      return await 客户端.request(目标, 动作, 参数, 超时);
    } catch (err) {
      throw new Error(`${目标}.${动作} 失败：${String(err)}`);
    }
  };

  const 裸请求 = async (目标: string, 动作: string, 参数: unknown = {}, 超时 = 20000): Promise<unknown> =>
    客户端.request(目标, 动作, 参数, 超时);

  return {
    裸请求,
    主控端口: 选项.端口,
    临时目录,
    数据目录,
    配置路径,
    输出: () => 文本,
    在线模块: async () => {
      const 列 = (await 请求("nigane", "nigane.modules.list")) as Array<{ name: string }>;
      // 测试客户端自己也是「接进来的一方」，会出现在这张表里。
      // 不滤掉的话「只装了 X」永远断不过——而且这正说明外接方和被管理
      // 模块在注册表里是同一等公民，架构上没给模块开后门。
      return (列 ?? [])
        .map((m) => m.name)
        .filter((n) => n !== 测试客户端名)
        .sort();
    },
    能力表: async () => {
      const 列 = (await 请求("nigane", "nigane.modules.list")) as Array<{
        name: string;
        capabilities?: string[];
      }>;
      const 出: Record<string, string[]> = {};
      for (const m of 列 ?? []) {
        if (m.name === 测试客户端名) continue;
        出[m.name] = [...(m.capabilities ?? [])].sort();
      }
      return 出;
    },
    请求,
    装载: async (名们: string[]) => {
      const 原始 = JSON.parse(readFileSync(配置路径, "utf8")) as Record<string, unknown> & {
        modules?: Array<Record<string, unknown>>;
      };
      // 按名字保留原有的条目（可能带 version/capabilityHash），新名字现造
      const 旧表 = new Map((原始.modules ?? []).map((m) => [String(m.name), m]));
      原始.modules = 名们.map(
        (名) =>
          旧表.get(名) ?? {
            name: 名,
            type: "process",
            entry: 模块入口(名),
            autoStart: true,
          },
      );
      writeFileSync(配置路径, JSON.stringify(原始, null, 2));
      await 请求("nigane", "nigane.registry.reload").catch(() => undefined);
    },
    模块页: async () => {
      const 列 = (await 请求("nigane", "nigane.registry.details")) as Array<{
        name: string;
        ui?: { title?: string; entry?: string };
      }>;
      return (列 ?? [])
        .filter((d) => d.ui)
        .map((d) => ({ name: d.name, title: d.ui?.title ?? d.name, entry: d.ui?.entry ?? "index.html" }));
    },
    详情: async () => {
      const 列 = (await 请求("nigane", "nigane.registry.details")) as Array<{ name: string; ui?: unknown }>;
      return 列 ?? [];
    },
    关停: async () => {
      try {
        客户端.close();
      } catch {
        /* ignore */
      }
      try {
        主控.kill("SIGINT");
      } catch {
        /* ignore */
      }
      await 稍等(1500);
      try {
        主控.kill("SIGKILL");
      } catch {
        /* ignore */
      }
      await 稍等(500);
      rmSync(临时目录, { recursive: true, force: true });
    },
  };
}

/** 等某个条件成立，超时就返回 false（不抛） */
export async function 等到(条件: () => Promise<boolean>, 次数 = 30, 间隔 = 500): Promise<boolean> {
  for (let i = 0; i < 次数; i++) {
    if (await 条件()) return true;
    await 稍等(间隔);
  }
  return false;
}

/** 读一份配置文件（用于断言「用户配置没被测试写坏」） */
export function 读配置(路径: string): Record<string, unknown> {
  return JSON.parse(readFileSync(路径, "utf8")) as Record<string, unknown>;
}
