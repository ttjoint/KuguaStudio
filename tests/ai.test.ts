/**
 * AI 模块（M6）：OpenAI 兼容客户端（模拟服务）、对话记忆、苦音总线集成、真实主控端到端
 */

import { afterEach, describe, expect, it } from "vitest";
import { createServer as 创建HTTP服务器, type Server } from "node:http";
import { spawn, type ChildProcess } from "node:child_process";
import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { resolve } from "node:path";
import { NiganeClient, NiganeServer, type 模块详情 } from "../packages/nigane/src/index.js";
import { 聊天, 生成图像, 默认配置 } from "../packages/modules/ai/src/client.js";
import { 注册AI处理器 } from "../packages/modules/ai/src/handlers.js";

let 端口序号 = 25500;
const 待关闭: Array<() => unknown> = [];
const 临时目录: string[] = [];

interface 记录请求 {
  path: string;
  body: unknown;
}

/** 模拟 OpenAI 兼容服务：chat completions / images generations / 图片下载 */
function 创建模拟AI服务(行为: { 图像?: "b64" | "url" } = {}): Promise<{
  url: string;
  收到的请求: 记录请求[];
  close: () => Promise<void>;
}> {
  return new Promise((resolvePromise) => {
    const 收到的请求: 记录请求[] = [];
    const server = 创建HTTP服务器((req, res) => {
      let 数据 = "";
      req.on("data", (c: Buffer) => {
        数据 += c.toString();
      });
      req.on("end", () => {
        let body: unknown = null;
        try {
          body = JSON.parse(数据);
        } catch {
          // 非 JSON
        }
        收到的请求.push({ path: req.url ?? "", body });
        if (req.url?.endsWith("/chat/completions")) {
          res.setHeader("content-type", "application/json");
          res.end(
            JSON.stringify({
              choices: [{ message: { content: "你好，我是模拟 AI" } }],
              model: "mock-chat",
              usage: { total_tokens: 7 },
            }),
          );
          return;
        }
        if (req.url?.endsWith("/images/generations")) {
          const 基址 = `http://127.0.0.1:${(server.address() as { port: number }).port}`;
          if (行为.图像 === "url") {
            res.setHeader("content-type", "application/json");
            res.end(JSON.stringify({ data: [{ url: `${基址}/img.png` }], model: "mock-img" }));
          } else {
            res.setHeader("content-type", "application/json");
            res.end(JSON.stringify({ data: [{ b64_json: "aGVsbG8=", mime_type: "image/png" }], model: "mock-img" }));
          }
          return;
        }
        if (req.url === "/img.png") {
          res.setHeader("content-type", "image/png");
          res.end(Buffer.from([0x89, 0x50, 0x4e, 0x47]));
          return;
        }
        res.statusCode = 404;
        res.end("{}");
      });
    });
    server.listen(0, "127.0.0.1", () => {
      const 端口 = (server.address() as { port: number }).port;
      resolvePromise({
        url: `http://127.0.0.1:${端口}/v1`,
        收到的请求,
        close: () => new Promise<void>((r) => server.close(() => r())),
      });
    });
  });
}

async function 启动服务端(): Promise<{ url: string }> {
  const port = ++端口序号;
  const server = new NiganeServer({ port });
  await server.start();
  待关闭.push(() => server.stop());
  return { url: `ws://127.0.0.1:${port}` };
}

async function 接入(url: string, name: string): Promise<NiganeClient> {
  const client = new NiganeClient({ name, url });
  await client.connect();
  待关闭.push(() => client.close());
  return client;
}

function 临时目录创建(前缀: string): string {
  const dir = mkdtempSync(resolve(tmpdir(), 前缀));
  临时目录.push(dir);
  return dir;
}

/** 备份并临时覆盖环境变量 */
function 覆盖环境(补丁: Record<string, string>): () => void {
  const 备份: Record<string, string | undefined> = {};
  for (const [k, v] of Object.entries(补丁)) {
    备份[k] = process.env[k];
    process.env[k] = v;
  }
  return () => {
    for (const [k, v] of Object.entries(备份)) {
      if (v === undefined) delete process.env[k];
      else process.env[k] = v;
    }
  };
}

afterEach(async () => {
  while (待关闭.length) await 待关闭.pop()?.();
  while (临时目录.length) {
    try {
      rmSync(临时目录.pop()!, { recursive: true, force: true });
    } catch {
      // ignore
    }
  }
});

describe("OpenAI 兼容客户端", () => {
  it("聊天与图像生成走模拟服务并正确解析", async () => {
    const 模拟 = await 创建模拟AI服务({ 图像: "b64" });
    const 配置 = { baseUrl: 模拟.url, apiKey: "sk-test", chatModel: "mock-chat", imageModel: "mock-img" };
    try {
      const 聊 = await 聊天(配置, { messages: [{ role: "user", content: "你好" }] });
      expect(聊.reply).toBe("你好，我是模拟 AI");
      expect(聊.model).toBe("mock-chat");

      const 图 = await 生成图像(配置, { prompt: "一只猫" });
      expect(图.base64).toBe("aGVsbG8=");
      expect(图.format).toBe("png");

      const 请求 = 模拟.收到的请求;
      expect(请求).toHaveLength(2);
      expect(请求[0].path).toContain("/chat/completions");
      expect(请求[0].body).toMatchObject({ model: "mock-chat", stream: false });
      expect(请求[1].body).toMatchObject({ model: "mock-img", response_format: "b64_json" });
    } finally {
      await 模拟.close();
    }
  });

  it("图像返回 url 时自动下载为 base64", async () => {
    const 模拟 = await 创建模拟AI服务({ 图像: "url" });
    const 配置 = { baseUrl: 模拟.url, apiKey: "", chatModel: "mock", imageModel: "mock-img" };
    try {
      const 图 = await 生成图像(配置, { prompt: "风景" });
      expect(图.base64).toBe(Buffer.from([0x89, 0x50, 0x4e, 0x47]).toString("base64"));
      expect(图.format).toBe("png");
    } finally {
      await 模拟.close();
    }
  });
});

describe("苦音总线集成（进程内）", () => {
  it("ai.chat 携带记忆、ai.memory.clear 重置、ai.image 与 ai.status 正常", async () => {
    const 恢复 = 覆盖环境({
      KUGUA_AI_BASE_URL: "http://127.0.0.1:9/v1", // 占位，稍后覆盖
      KUGUA_AI_MEMORY_DIR: 临时目录创建("kugua-ai-mem-"),
      KUGUA_AI_CHAT_MODEL: "mock-chat",
      KUGUA_AI_IMAGE_MODEL: "mock-img",
    });
    const 模拟 = await 创建模拟AI服务();
    process.env.KUGUA_AI_BASE_URL = 模拟.url;
    try {
      const { url } = await 启动服务端();
      const ai端 = await 接入(url, "ai端");
      注册AI处理器(ai端);
      const 调用方 = await 接入(url, "调用方");

      const 一 = (await 调用方.request("ai端", "ai.chat", { prompt: "第一问", chatId: "群1" })) as {
        reply: string;
        model: string;
      };
      expect(一.reply).toBe("你好，我是模拟 AI");
      expect(一.model).toBe("mock-chat");

      const 二 = (await 调用方.request("ai端", "ai.chat", { prompt: "第二问", chatId: "群1" })) as { reply: string };
      expect(二.reply).toBe("你好，我是模拟 AI");
      // 第二次请求应携带历史（system + user + assistant + user）
      const 第二请求 = 模拟.收到的请求[1].body as { messages: Array<{ role: string; content: string }> };
      expect(第二请求.messages.map((m) => m.role)).toEqual(["system", "user", "assistant", "user"]);
      expect(第二请求.messages[1].content).toBe("第一问");
      expect(第二请求.messages[3].content).toBe("第二问");

      await 调用方.request("ai端", "ai.memory.clear", { chatId: "群1" });
      const 三 = (await 调用方.request("ai端", "ai.chat", { prompt: "第三问", chatId: "群1" })) as { reply: string };
      expect(三.reply).toBe("你好，我是模拟 AI");
      const 第三请求 = 模拟.收到的请求[2].body as { messages: Array<{ role: string }> };
      expect(第三请求.messages.map((m) => m.role)).toEqual(["system", "user"]);

      const 图 = (await 调用方.request("ai端", "ai.image", { prompt: "测试图" })) as { base64: string; format: string };
      expect(图.base64).toBe("aGVsbG8=");

      const 状态 = (await 调用方.request("ai端", "ai.status", {})) as { baseUrl: string; chatModel: string };
      expect(状态.baseUrl).toBe(模拟.url);
      expect(状态.chatModel).toBe("mock-chat");
    } finally {
      await 模拟.close();
      恢复();
    }
  });
});

describe("默认配置读取环境变量", () => {
  it("baseUrl 去除尾部斜杠、无 key 时不带认证", () => {
    const 恢复 = 覆盖环境({
      KUGUA_AI_BASE_URL: "http://example.com/v1/",
      KUGUA_AI_API_KEY: "key-123",
      KUGUA_AI_CHAT_MODEL: "qwen2.5:7b",
    });
    try {
      const 配置 = 默认配置();
      expect(配置.baseUrl).toBe("http://example.com/v1");
      expect(配置.apiKey).toBe("key-123");
      expect(配置.chatModel).toBe("qwen2.5:7b");
    } finally {
      恢复();
    }
  });
});

/** 启动主控独立进程（真实链路） */
function 启动主控(端口: number, 环境: Record<string, string>): Promise<{ proc: ChildProcess; output: string }> {
  return new Promise((resolvePromise, reject) => {
    const proc = spawn(process.execPath, ["packages/main/dist/index.js"], {
      stdio: ["ignore", "pipe", "pipe"],
      cwd: process.cwd(),
      env: { ...process.env, ...环境 },
    });
    let resolved = false;
    const 输出: string[] = [];
    const 完成 = (err?: Error): void => {
      if (!resolved) {
        resolved = true;
        if (err) reject(err);
        else resolvePromise({ proc, output: 输出.join("") });
      }
    };
    const 定时器 = setTimeout(() => 完成(), 8000);
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
  });
}

describe("真实主控端到端：ai + tts 模块", () => {
  it("主控拉起 ai/tts，ai.chat 走模拟服务、tts.status 正常", async () => {
    const port = ++端口序号;
    const 模拟 = await 创建模拟AI服务();
    // 使用临时配置文件（KUGUA_CONFIG），避免改写仓库内真实配置
    const 目录 = mkdtempSync(resolve(tmpdir(), "kugua-ai-e2e-"));
    const 配置路径 = resolve(目录, "kugua.config.json");
    try {
      writeFileSync(
        配置路径,
        JSON.stringify({
          host: "127.0.0.1",
          port,
          token: "",
          modules: [
            { name: "ai", type: "process", entry: "packages/modules/ai/dist/index.js", autoStart: true },
            { name: "tts", type: "process", entry: "packages/modules/tts/dist/index.js", autoStart: true },
          ],
        }),
      );
      const 恢复 = 覆盖环境({ KUGUA_AI_BASE_URL: 模拟.url });
      const { proc, output } = await 启动主控(port, {
        KUGUA_AI_BASE_URL: 模拟.url,
        KUGUA_AI_MEMORY_DIR: resolve(目录, "memory"),
        KUGUA_CONFIG: 配置路径,
      });
      try {
        await new Promise<void>((r) => setTimeout(r, 8000));
        const 检查器 = new NiganeClient({ name: "测试检查器", url: `ws://127.0.0.1:${port}` });
        await 检查器.connect();
        try {
          const 详情 = (await 检查器.request("nigane", "nigane.registry.details", {})) as 模块详情[];
          const 在线 = 详情.filter((m) => m.online).map((m) => m.name);
          for (const 名 of ["ai", "tts"]) {
            expect(在线, `模块 ${名} 应在线。主控输出：${output.slice(-300)}`).toContain(名);
          }
          const 回 = (await 检查器.request("ai", "ai.chat", { prompt: "端到端提问" })) as { reply: string };
          expect(回.reply).toBe("你好，我是模拟 AI");
          const 状态 = (await 检查器.request("tts", "tts.status", {})) as { module: string; provider: string };
          expect(状态.module).toBe("tts");
          expect(状态.provider).toBe("sherpa-onnx");
        } finally {
          检查器.close();
        }
      } finally {
        恢复();
        try {
          proc.kill("SIGTERM");
          await new Promise<void>((r) => setTimeout(r, 2500));
          if (!proc.killed) proc.kill("SIGKILL");
        } catch {
          // ignore
        }
      }
    } finally {
      await 模拟.close();
      try {
        rmSync(目录, { recursive: true, force: true });
      } catch {
        // ignore
      }
    }
  }, 30000);
});
