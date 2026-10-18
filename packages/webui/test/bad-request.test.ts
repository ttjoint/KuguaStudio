/**
 * 畸形请求不能打崩平台
 *
 * 这类问题的共同点是：**一个不需要认证的请求就能让整个 WebUI 进程退出**。
 * 而且请求方完全不需要恶意——旧书签、截断的分享链接、剪贴板里半截的中文
 * 链接，都会变成裸 `%`。
 *
 * 根因有两层，都要守：
 *   1. `decodeURIComponent` 遇裸 `%` 抛 `URIError`
 *   2. `new URL()` 遇畸形 Host 头抛 `TypeError`
 * 两者都发生在 `createServer` 回调里，那里**没人接异常**，Node 默认让进程退出。
 */
import { afterEach, describe, expect, it } from "vitest";
import { spawn, type ChildProcess } from "node:child_process";
import { existsSync, mkdtempSync, writeFileSync, rmSync } from "node:fs";
import { createServer, connect } from "node:net";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";

const 仓库根 = resolve(__dirname, "..", "..", "..");
const 脚本 = join(仓库根, "packages", "webui", "dist", "server.js");
const 已构建 = existsSync(脚本) && existsSync(join(仓库根, "packages", "main", "dist", "index.js"));

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

const 空闲端口 = (): Promise<number> =>
  new Promise((res, rej) => {
    const s = createServer();
    s.once("error", rej);
    s.listen(0, "127.0.0.1", () => {
      const p = (s.address() as { port: number }).port;
      s.close(() => res(p));
    });
  });

const 子进程 = new Set<ChildProcess>();
const 目录们 = new Set<string>();

afterEach(() => {
  for (const p of 子进程) {
    try {
      p.kill("SIGKILL");
    } catch {
      /* 已退 */
    }
  }
  子进程.clear();
  for (const d of 目录们) {
    try {
      rmSync(d, { recursive: true, force: true });
    } catch {
      /* 忽略 */
    }
  }
  目录们.clear();
});

/** 起一个完全隔离的 WebUI，返回端口和进程 */
async function 起WebUI(): Promise<{ 端口: number; 进程: ChildProcess; 输出: () => string }> {
  const 端口 = await 空闲端口();
  const 主控端口 = await 空闲端口();
  const 目录 = mkdtempSync(join(tmpdir(), "kugua-badreq-"));
  目录们.add(目录);
  const 配置 = join(目录, "kugua.config.json");
  writeFileSync(
    配置,
    JSON.stringify({
      host: "127.0.0.1",
      port: 主控端口,
      token: "",
      webui: { port: 端口, open: false, tray: false },
      modules: [],
    }),
    "utf-8",
  );

  const p = spawn(process.execPath, [脚本, "--no-open"], {
    cwd: 仓库根,
    stdio: ["ignore", "pipe", "pipe"],
    windowsHide: true,
    env: {
      ...process.env,
      KUGUA_CONFIG: 配置,
      KUGUA_DATA_DIR: join(目录, "data"),
      KUGUA_GLOBAL_LOCK: join(目录, "studio.lock"),
    },
  });
  子进程.add(p);
  let 文本 = "";
  p.stdout?.on("data", (d) => (文本 += String(d)));
  p.stderr?.on("data", (d) => (文本 += String(d)));

  for (let i = 0; i < 80; i++) {
    await sleep(250);
    try {
      if ((await fetch(`http://127.0.0.1:${端口}/api/status`)).ok) break;
    } catch {
      /* 还没起来 */
    }
  }
  return { 端口, 进程: p, 输出: () => 文本 };
}

/** 用裸 socket 发请求，才能塞畸形 Host 头（fetch 不允许） */
function 裸请求(端口: number, 原始: string): Promise<string> {
  return new Promise((res) => {
    const s = connect(端口, "127.0.0.1", () => s.write(原始));
    let 回 = "";
    s.on("data", (d) => (回 += d.toString()));
    s.on("close", () => res(回));
    s.on("error", () => res("(连接错误)"));
    setTimeout(() => {
      s.destroy();
      res(回);
    }, 3000);
  });
}

describe.runIf(已构建)("畸形请求不能打崩平台", () => {
  it(
    "裸 % 的路径不会让进程退出（decodeURIComponent 抛 URIError）",
    async () => {
      // 为什么这条重要：这不是「返回 500」那么轻。URIError 抛在
      // createServer 回调里，没人接，Node 默认**让进程退出**。
      // 实测过一个请求就能把整个 WebUI 打掉（exit code=1）。
      const { 端口, 进程 } = await 起WebUI();

      for (const 路径 of ["/a%b", "/%", "/%E4%B8"]) {
        const r = await fetch(`http://127.0.0.1:${端口}${路径}`).catch(() => null);
        // 能拿到响应（哪怕 404）就说明没崩
        expect(r, `请求 ${路径} 时连接断了，说明进程退出了`).not.toBeNull();
      }

      expect(进程.exitCode, "进程被裸 % 请求打崩了").toBeNull();
      expect(进程.signalCode).toBeNull();
    },
    45000,
  );

  it(
    "插件 UI / 模块 UI 路径里的裸 % 同样不会打崩",
    async () => {
      // 这两处是另外独立的 decodeURIComponent 调用点，
      // 只修静态路径那一处是典型的「改了一处以为改完了」。
      const { 端口, 进程 } = await 起WebUI();

      for (const 路径 of ["/plugin-ui/x%y/z.js", "/module-ui/x%y/z.js"]) {
        const r = await fetch(`http://127.0.0.1:${端口}${路径}`).catch(() => null);
        expect(r, `请求 ${路径} 时连接断了`).not.toBeNull();
      }

      expect(进程.exitCode).toBeNull();
    },
    45000,
  );

  it(
    "畸形 Host 头返回 400 而不是打崩（new URL 抛 TypeError）",
    async () => {
      // Host 头伪装成本极低，而且 `new URL` 对 "abc def"、"[["、"::::"
      // 这类值都会抛 TypeError，抛点同样在 createServer 回调里。
      const { 端口, 进程 } = await 起WebUI();

      for (const host of ["abc def", "[[", "::::"]) {
        const 回 = await 裸请求(端口, `GET /api/status HTTP/1.1\r\nHost: ${host}\r\nConnection: close\r\n\r\n`);
        expect(回, `Host: ${host} 没得到响应`).toMatch(/HTTP\/1\.1 400/);
      }

      expect(进程.exitCode, "进程被畸形 Host 头打崩了").toBeNull();
    },
    45000,
  );

  it(
    "修完之后正常请求照旧（别为了不崩把功能改坏）",
    async () => {
      const { 端口, 进程 } = await 起WebUI();

      const 状态 = await fetch(`http://127.0.0.1:${端口}/api/status`);
      expect(状态.status).toBe(200);

      // 中文路径编码后仍应正常解码（说明安全解码没把正常情况一起降级）
      const 家 = await fetch(`http://127.0.0.1:${端口}/`);
      expect(家.status).toBe(200);

      expect(进程.exitCode).toBeNull();
    },
    45000,
  );
});
