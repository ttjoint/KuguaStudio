/**
 * 模块注册表 / 启停 / 动态注册 / 主进程退出广播 集成测试
 */

import { afterEach, describe, expect, it, vi } from "vitest";
import type { ChildProcess, ChildProcessByStdio } from "node:child_process";
import { spawn } from "node:child_process";
import { resolve } from "node:path";
import type { Writable, Readable } from "node:stream";
import {
  NiganeClient,
  NiganeServer,
  type 模块描述,
  type 模块详情,
} from "../packages/nigane/src/index.js";

let 端口序号 = 25200;
const 待关闭: Array<() => unknown> = [];

async function 启动服务端(配置 = {}): Promise<{ server: NiganeServer; url: string; port: number }> {
  const port = ++端口序号;
  const server = new NiganeServer({ port, ...配置 });
  await server.start();
  待关闭.push(() => server.stop());
  return { server, url: `ws://127.0.0.1:${port}`, port };
}

async function 接入客户端(
  url: string,
  name: string,
  token = "",
  info?: { version?: string; capabilities?: string[] },
): Promise<NiganeClient> {
  const client = new NiganeClient({ name, url, token, ...info });
  await client.connect();
  待关闭.push(() => client.close());
  return client;
}

afterEach(async () => {
  while (待关闭.length) {
    await 待关闭.pop()?.();
  }
});

describe("NiganeServer 模块描述与详情", () => {
  it("setDescriptions + moduleDetails 组装正确", async () => {
    const { server, url } = await 启动服务端();
    server.setDescriptions([
      { name: "mkg", type: "process", entry: "packages/modules/mkg/dist/index.js", autoStart: true, description: "知识库" },
      { name: "math", type: "library", file: "bin/math.dll", description: "静态库" },
    ]);
    // mkg 没启动，math 没检测文件，所以由外部注入附加信息
    const 列表 = server.moduleDetails({
      mkg: { pid: 999, online: false },
      math: { fileExists: true, online: true },
    }) as 模块详情[];
    const mkg = 列表.find((x) => x.name === "mkg");
    const math = 列表.find((x) => x.name === "math");
    expect(mkg).toMatchObject({ type: "process", autoStart: true, description: "知识库", pid: 999, online: false });
    expect(math).toMatchObject({ type: "library", fileExists: true, online: true });
  });

  it("自定义处理器 handle 生效：nigane.registry.details", async () => {
    const { server, url } = await 启动服务端();
    const 模拟详情: 模块详情[] = [
      { name: "echo", type: "process", online: true, pid: 42, capabilities: ["echo"] },
    ];
    server.handle("nigane.registry.details", () => 模拟详情);
    const 调用方 = await 接入客户端(url, "调用方");
    const r = await 调用方.request("nigane", "nigane.registry.details", {});
    expect(r).toEqual(模拟详情);
  });
});

describe("顶号（握手替换）", () => {
  it("同名模块新连接顶掉旧连接，旧 socket 关闭，新的可用", async () => {
    const { server, url } = await 启动服务端();
    const 下线: string[] = [];
    server.on("unregistered", (n) => 下线.push(n));
    const 旧客户端 = await 接入客户端(url, "echo", "", { version: "0.1.0", capabilities: ["echo"] });
    await new Promise<void>((r) => setTimeout(r, 50));
    // 新客户端同名接入 → 顶号
    const 新客户端 = new NiganeClient({ name: "echo", url, version: "0.2.0", capabilities: ["echo.v2"] });
    await 新客户端.connect();
    待关闭.push(() => 新客户端.close());
    await new Promise<void>((r) => setTimeout(r, 100));

    expect(下线).toContain("echo");
    // 服务端注册表中只有新的
    const infos = server.moduleInfos();
    expect(infos).toHaveLength(1);
    expect(infos[0].version).toBe("0.2.0");
    expect(infos[0].capabilities).toEqual(["echo.v2"]);

    // 新客户端应该可以正常请求别人
    const 目标 = await 接入客户端(url, "目标");
    目标.onRequest("ping", () => "pong");
    const r = await 新客户端.request("目标", "ping", {});
    expect(r).toBe("pong");
    void 旧客户端;
  });
});

describe("system.shutdown 广播", () => {
  it("服务端 stop 前广播，客户端收到 shutdown 事件", async () => {
    const { server, url } = await 启动服务端();
    const c1 = await 接入客户端(url, "甲");
    const c2 = await 接入客户端(url, "乙");
    const 收到: Record<string, unknown> = {};
    c1.on("shutdown", (p) => (收到.甲 = p));
    c2.on("shutdown", (p) => (收到.乙 = p));
    await server.stop(100);
    await new Promise<void>((r) => setTimeout(r, 200));
    expect(收到.甲).toBeDefined();
    expect(收到.乙).toBeDefined();
  });
});

/** 启动主控独立进程，检测自动启动 echo 模块的功能 */
function 启动主控(端口: number, waitMs = 6000): Promise<{ proc: ChildProcess; output: string }> {
  return new Promise((resolve, reject) => {
    const proc = spawn(
      process.execPath,
      ["packages/main/dist/index.js"],
      {
        stdio: ["ignore", "pipe", "pipe"],
        cwd: process.cwd(),
        env: { ...process.env },
      },
    ) as unknown as ChildProcessByStdio<Writable, Readable, Readable>;
    let resolved = false;
    const 输出: string[] = [];
    const 完成 = (err?: Error): void => {
      if (!resolved) {
        resolved = true;
        if (err) reject(err);
        else resolve({ proc: proc as unknown as ChildProcess, output: 输出.join("") });
      }
    };
    const 定时器 = setTimeout(() => 完成(), waitMs);
    proc.stdout.on("data", (d: Buffer) => {
      输出.push(d.toString());
      if (输出.join("").includes("苦音服务端已启动")) {
        clearTimeout(定时器);
        setTimeout(() => 完成(), 100);
      }
    });
    proc.stderr.on("data", (d: Buffer) => 输出.push(d.toString()));
    proc.on("error", (err) => {
      clearTimeout(定时器);
      完成(err);
    });
    proc.on("exit", (code, sig) => {
      输出.push(`[主控 exit: code=${code ?? "?"} sig=${sig ?? "?"}]`);
    });
    void 端口;
  });
}

describe("主控（真实进程）自动启动 echo", () => {
  it("写配置后启动主控，echo 作为子进程被拉起并注册", async () => {
    const port = ++端口序号;
    // 备份 & 写入临时 kugua.config.json
    const fs = require("node:fs") as typeof import("node:fs");
    const cfgPath = resolve(process.cwd(), "kugua.config.json");
    const 备份 = fs.existsSync(cfgPath) ? fs.readFileSync(cfgPath, "utf-8") : null;
    let 主控输出 = "";
    try {
      fs.writeFileSync(
        cfgPath,
        JSON.stringify({
          host: "127.0.0.1",
          port,
          token: "",
          modules: [
            {
              name: "echo",
              type: "process",
              entry: "packages/modules/echo/dist/index.js",
              autoStart: true,
              description: "echo 示例模块",
            },
          ],
        }),
      );

      const { proc, output } = await 启动主控(port, 8000);
      主控输出 = output;
      try {
        // 等 echo 注册完成（给 3 秒）
        await new Promise<void>((r) => setTimeout(r, 3000));

        // 以一个新客户端连上去，查询模块详情
        const 检查器 = new NiganeClient({
          name: "测试检查器",
          url: `ws://127.0.0.1:${port}`,
        });
        await 检查器.connect();
        try {
          const 详情 = (await 检查器.request("nigane", "nigane.registry.details", {})) as 模块详情[];
          const echo = 详情.find((x) => x.name === "echo");
          expect(echo, `应找到 echo 模块。主控输出：${主控输出.slice(-400)}`).toBeDefined();
          expect(echo!.type).toBe("process");
          expect(echo!.autoStart).toBe(true);
          expect(echo!.online, `echo 应在线。主控输出：${主控输出.slice(-400)}`).toBe(true);
          expect(typeof echo!.pid === "number" && echo!.pid > 0).toBe(true);
          // 尝试请求 echo
          const 回 = await 检查器.request("echo", "echo", { hi: 1 });
          expect(回).toEqual({ hi: 1 });
        } finally {
          检查器.close();
        }
      } finally {
        try {
          proc.kill("SIGTERM");
          await new Promise<void>((r) => setTimeout(r, 2000));
          if (!proc.killed) proc.kill("SIGKILL");
        } catch {
          // ignore
        }
      }
    } finally {
      if (备份 === null) {
        try {
          fs.unlinkSync(cfgPath);
        } catch {
          // ignore
        }
      } else {
        fs.writeFileSync(cfgPath, 备份);
      }
    }
  }, 20000);
});
