/**
 * TTS 模块（M6）：sherpa-onnx 真实合成、ChatTTS HTTP 模拟服务、苦音总线集成
 */

import { afterEach, describe, expect, it } from "vitest";
import { createServer as 创建HTTP服务器, type Server } from "node:http";
import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { NiganeClient, NiganeServer } from "../packages/nigane/src/index.js";
import { 合成语音, 解析提供方 } from "../packages/modules/tts/src/tts.js";
import { 注册TTS处理器 } from "../packages/modules/tts/src/handlers.js";

let 端口序号 = 25600;
const 待关闭: Array<() => unknown> = [];
const 临时目录: string[] = [];

/** 生成一个微型合法 WAV（RIFF + fmt + data） */
function 微型WAV(): Buffer {
  const 采样率 = 8000;
  const 数据 = Buffer.alloc(160, 0); // 20ms 静音
  const 头部 = Buffer.alloc(44);
  头部.write("RIFF", 0);
  头部.writeUInt32LE(36 + 数据.length, 4);
  头部.write("WAVE", 8);
  头部.write("fmt ", 12);
  头部.writeUInt32LE(16, 16);
  头部.writeUInt16LE(1, 20);
  头部.writeUInt16LE(1, 22);
  头部.writeUInt32LE(采样率, 24);
  头部.writeUInt32LE(采样率 * 2, 28);
  头部.writeUInt16LE(2, 32);
  头部.writeUInt16LE(16, 34);
  头部.write("data", 36);
  头部.writeUInt32LE(数据.length, 40);
  return Buffer.concat([头部, 数据]);
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

describe("sherpa-onnx 离线合成", () => {
  it("真实合成中文为 base64 WAV", async () => {
    const 结果 = await 合成语音({ text: "测试语音合成" });
    expect(结果.provider).toBe("sherpa-onnx");
    expect(结果.format).toBe("wav");
    expect(结果.base64.startsWith("UklGR")).toBe(true); // RIFF 头
    expect(结果.base64.length).toBeGreaterThan(1000);
  }, 60000);

  it("tts.status 自动解析提供方", async () => {
    expect(解析提供方()).toBe("sherpa-onnx");
  });
});

describe("ChatTTS HTTP 提供方", () => {
  it("按参考协议请求并读取返回的本地音频文件", async () => {
    const 目录 = mkdtempSync(join(tmpdir(), "kugua-tts-mock-"));
    临时目录.push(目录);
    const wav路径 = join(目录, "out.wav");
    writeFileSync(wav路径, 微型WAV());

    const server: Server = 创建HTTP服务器((req, res) => {
      let 数据 = "";
      req.on("data", (c: Buffer) => {
        数据 += c.toString();
      });
      req.on("end", () => {
        expect(decodeURIComponent(数据)).toContain("text=测试语音");
        res.setHeader("content-type", "application/json");
        res.end(JSON.stringify({ code: 0, audio_files: [{ filename: wav路径 }] }));
      });
    });
    await new Promise<void>((r) => server.listen(0, "127.0.0.1", r));
    const 端口 = (server.address() as { port: number }).port;
    const 恢复 = 覆盖环境({ KUGUA_TTS_URL: `http://127.0.0.1:${端口}` });
    try {
      const 结果 = await 合成语音({ text: "测试语音", provider: "chattts-http" });
      expect(结果.provider).toBe("chattts-http");
      expect(结果.base64.startsWith("UklGR")).toBe(true);
    } finally {
      恢复();
      await new Promise<void>((r) => server.close(() => r()));
    }
  });
});

describe("苦音总线集成", () => {
  it("tts.speak 经总线返回 base64 音频", async () => {
    const { url } = await 启动服务端();
    const tts端 = await 接入(url, "tts端");
    注册TTS处理器(tts端);
    const 调用方 = await 接入(url, "调用方");
    const 结果 = (await 调用方.request("tts端", "tts.speak", { text: "总线测试" })) as {
      base64: string;
      format: string;
      provider: string;
    };
    expect(结果.format).toBe("wav");
    expect(结果.provider).toBe("sherpa-onnx");
    expect(结果.base64.startsWith("UklGR")).toBe(true);
  }, 60000);
});
