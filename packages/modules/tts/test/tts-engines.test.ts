import { describe, expect, it, beforeEach, afterEach } from "vitest";
import { createServer, type Server } from "node:http";
import type { AddressInfo } from "node:net";
import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { 清空配置缓存 } from "../src/config.js";
import { VoxCPM引擎 } from "../src/engines/voxcpm.js";
import { IndexTTS引擎 } from "../src/engines/indextts.js";
import { GptSoVits引擎, 清空权重缓存 } from "../src/engines/gpt-sovits.js";
import { 提取错误, 拆地址, 端口可用 } from "../src/engines/http-base.js";

/** 一段合法的小 WAV（44 字节头 + 若干采样），让长度校验能通过 */
function 假Wav(): Buffer {
  return Buffer.concat([Buffer.from("RIFF"), Buffer.alloc(40, 1), Buffer.alloc(60, 2)]);
}

interface 收到的请求 {
  路径: string;
  查询: URLSearchParams;
  体: Record<string, unknown>;
  头: Record<string, string | string[] | undefined>;
}

/** 起一个 mock 服务，记录所有请求并按回调决定响应 */
async function 起服务(
  处理: (req: 收到的请求, res: import("node:http").ServerResponse) => void,
): Promise<{ 服务: Server; 地址: string; 请求: 收到的请求[] }> {
  const 请求: 收到的请求[] = [];
  const 服务 = createServer((req, res) => {
    const 块: Buffer[] = [];
    req.on("data", (c) => 块.push(c));
    req.on("end", () => {
      const 文本 = Buffer.concat(块).toString("utf-8");
      const u = new URL(req.url ?? "/", "http://x");
      const 记 = {
        路径: u.pathname,
        查询: u.searchParams,
        体: 文本 ? (JSON.parse(文本) as Record<string, unknown>) : {},
        头: req.headers,
      };
      请求.push(记);
      处理(记, res);
    });
  });
  await new Promise<void>((r) => 服务.listen(0, "127.0.0.1", r));
  const 端口 = (服务.address() as AddressInfo).port;
  return { 服务, 地址: `http://127.0.0.1:${端口}`, 请求 };
}

/** 把配置写进临时目录并切换过去，模拟真实的两层配置读取 */
function 用配置(内容: unknown): { 还原: () => void } {
  const 目录 = mkdtempSync(join(tmpdir(), "kugua-tts-http-"));
  writeFileSync(join(目录, "kugua.config.json"), JSON.stringify({ tts: 内容 }), "utf-8");
  const 原cwd = process.cwd();
  process.chdir(目录);
  清空配置缓存();
  return {
    还原: () => {
      process.chdir(原cwd);
      清空配置缓存();
      rmSync(目录, { recursive: true, force: true });
    },
  };
}

describe("HTTP 工具", () => {
  it("从错误体里优先取 detail", () => {
    expect(提取错误(500, '{"detail":"模型未加载"}')).toBe("500：模型未加载");
  });

  it("退而取 msg / message", () => {
    expect(提取错误(400, '{"msg":"参数错误"}')).toBe("400：参数错误");
    expect(提取错误(400, '{"message":"坏请求"}')).toBe("400：坏请求");
  });

  it("取嵌套 error.message", () => {
    expect(提取错误(500, '{"error":{"message":"内部错误"}}')).toBe("500：内部错误");
  });

  it("非 JSON 时回落到原文片段", () => {
    expect(提取错误(502, "Bad Gateway")).toBe("502：Bad Gateway");
  });

  it("空响应体只报状态码", () => {
    expect(提取错误(503, "")).toBe("HTTP 503");
  });

  it("拆地址取出主机与端口", () => {
    expect(拆地址("http://127.0.0.1:9881", 1)).toEqual({ 主机: "127.0.0.1", 端口: 9881 });
  });

  it("url 没写端口时用默认端口", () => {
    expect(拆地址("http://localhost", 9880)).toEqual({ 主机: "localhost", 端口: 9880 });
  });

  it("非法 url 回落到本地默认值", () => {
    expect(拆地址("不是地址", 1234)).toEqual({ 主机: "127.0.0.1", 端口: 1234 });
  });

  it("端口未监听时探活返回 false", async () => {
    expect(await 端口可用("127.0.0.1", 1, 300)).toBe(false);
  });
});

describe("VoxCPM 引擎", () => {
  beforeEach(() => 清空配置缓存());

  it("优先走 OpenAI 兼容端点并带扩展字段", async () => {
    const { 服务, 地址, 请求 } = await 起服务((_r, res) => {
      res.writeHead(200, { "content-type": "audio/wav" });
      res.end(假Wav());
    });
    const 配置 = 用配置({
      engines: { voxcpm: { url: 地址, defaultVoice: "narrator", voices: [{ id: "narrator", refAudio: "D:/a.wav", refText: "参考" }] } },
    });
    try {
      const 结果 = await new VoxCPM引擎().合成({ text: "你好", emotion: { text: "温柔地" }, speed: 1.2 });
      expect(结果.engine).toBe("voxcpm");
      expect(结果.format).toBe("wav");
      expect(请求[0].路径).toBe("/v1/audio/speech");
      expect(请求[0].体).toMatchObject({
        input: "你好",
        voice: "narrator",
        response_format: "wav",
        speed: 1.2,
        ref_audio: "D:/a.wav",
        ref_text: "参考",
        instructions: "温柔地",
      });
    } finally {
      配置.还原();
      服务.close();
    }
  });

  it("上游 4xx 时退回纯标准 OpenAI 字段重试", async () => {
    let 次 = 0;
    const { 服务, 地址, 请求 } = await 起服务((_r, res) => {
      次++;
      if (次 === 1) {
        res.writeHead(400, { "content-type": "application/json" });
        res.end(JSON.stringify({ detail: "未知字段 ref_audio" }));
        return;
      }
      res.writeHead(200, { "content-type": "audio/wav" });
      res.end(假Wav());
    });
    const 配置 = 用配置({ engines: { voxcpm: { url: 地址, voices: [{ id: "v", refAudio: "D:/a.wav" }] } } });
    try {
      const 结果 = await new VoxCPM引擎().合成({ text: "你好", voice: "v" });
      expect(结果.engine).toBe("voxcpm");
      expect(请求).toHaveLength(2);
      expect(请求[1].体.ref_audio).toBeUndefined();
      expect(请求[1].体.input).toBe("你好");
    } finally {
      配置.还原();
      服务.close();
    }
  });

  it("两次都 4xx 时抛出带上游信息的错误", async () => {
    const { 服务, 地址 } = await 起服务((_r, res) => {
      res.writeHead(400, { "content-type": "application/json" });
      res.end(JSON.stringify({ detail: "模型不存在" }));
    });
    const 配置 = 用配置({ engines: { voxcpm: { url: 地址 } } });
    try {
      await expect(new VoxCPM引擎().合成({ text: "你好" })).rejects.toThrow(/模型不存在/);
    } finally {
      配置.还原();
      服务.close();
    }
  });

  it("未配置 url 时报配置指引", async () => {
    const 配置 = 用配置({ engines: {} });
    try {
      await expect(new VoxCPM引擎().合成({ text: "你好" })).rejects.toThrow(/tts\.engines\.voxcpm\.url/);
    } finally {
      配置.还原();
    }
  });

  it("服务静默时可用() 返回 false", async () => {
    const 配置 = 用配置({ engines: { voxcpm: { url: "http://127.0.0.1:1" } } });
    try {
      expect(await new VoxCPM引擎().可用()).toBe(false);
    } finally {
      配置.还原();
    }
  });
});

describe("IndexTTS 引擎", () => {
  beforeEach(() => 清空配置缓存());

  /** 起一个必然成功的 IndexTTS mock，返回发出的请求体 */
  async function 跑(请求: Parameters<IndexTTS引擎["合成"]>[0]) {
    const { 服务, 地址, 请求: 请求列表 } = await 起服务((_r, res) => {
      res.writeHead(200, { "content-type": "audio/wav" });
      res.end(假Wav());
    });
    const 配置 = 用配置({
      engines: { indextts: { url: 地址, defaultVoice: "hero", voices: [{ id: "hero", refAudio: "D:/hero.wav", refText: "我是主角" }] } },
    });
    try {
      const 结果 = await new IndexTTS引擎().合成(请求);
      return { 结果, 体: 请求列表[0].体 };
    } finally {
      配置.还原();
      服务.close();
    }
  }

  it("带上参考音频与参考文本", async () => {
    const { 体 } = await 跑({ text: "第一章" });
    expect(体.text).toBe("第一章");
    expect(体.ref_audio_path).toBe("D:/hero.wav");
    expect(体.ref_text).toBe("我是主角");
  });

  it("语速换算：speed>1 时 duration_factor<1", async () => {
    const { 体, 结果 } = await 跑({ text: "快一点", speed: 2 });
    expect(体.duration_factor).toBe(0.5);
    expect(结果.format).toBe("wav");
  });

  it("8 维情绪向量被归一后发送", async () => {
    const { 体 } = await 跑({ text: "愤怒地", emotion: { vector: [0.1, 0.9] } });
    expect(体.emo_vector).toEqual([0.1, 0.9, 0, 0, 0, 0, 0, 0]);
  });

  it("情绪参考音频 + 强度映射到 emo_ref_path / emo_alpha", async () => {
    const { 体 } = await 跑({ text: "悲伤", emotion: { refAudio: "D:/sad.wav", intensity: 0.7 } });
    expect(体.emo_ref_path).toBe("D:/sad.wav");
    expect(体.emo_alpha).toBe(0.7);
    expect(体.emo_text).toBeUndefined();
  });

  it("只有文字描述时走 emo_text 并开 use_emo_text", async () => {
    const { 体 } = await 跑({ text: "叙述", emotion: { text: "低沉压抑地朗读" } });
    expect(体.emo_text).toBe("低沉压抑地朗读");
    expect(体.use_emo_text).toBe(true);
    expect(体.emo_ref_path).toBeUndefined();
  });

  it("情绪参考音频优先于文字描述", async () => {
    const { 体 } = await 跑({ text: "x", emotion: { text: "高兴", refAudio: "D:/happy.wav" } });
    expect(体.emo_ref_path).toBe("D:/happy.wav");
    expect(体.emo_text).toBeUndefined();
  });

  it("没有参考音频的音色直接报错", async () => {
    const 配置 = 用配置({ engines: { indextts: { url: "http://127.0.0.1:1", defaultVoice: "无参考", voices: [{ id: "无参考" }] } } });
    try {
      await expect(new IndexTTS引擎().合成({ text: "你好" })).rejects.toThrow(/需要参考音频/);
    } finally {
      配置.还原();
    }
  });

  it("服务返回 JSON 时按 audio_path 读文件", async () => {
    const 目录 = mkdtempSync(join(tmpdir(), "kugua-tts-out-"));
    const 音频路径 = join(目录, "out.wav");
    writeFileSync(音频路径, 假Wav());
    const { 服务, 地址 } = await 起服务((_r, res) => {
      res.writeHead(200, { "content-type": "application/json" });
      res.end(JSON.stringify({ audio_path: 音频路径 }));
    });
    const 配置 = 用配置({ engines: { indextts: { url: 地址, voices: [{ id: "v", refAudio: "D:/a.wav" }] } } });
    try {
      const 结果 = await new IndexTTS引擎().合成({ text: "你好", voice: "v" });
      expect(结果.audio.length).toBe(假Wav().length);
    } finally {
      配置.还原();
      服务.close();
      rmSync(目录, { recursive: true, force: true });
    }
  });

  it("上游报错时带上错误信息", async () => {
    const { 服务, 地址 } = await 起服务((_r, res) => {
      res.writeHead(500, { "content-type": "application/json" });
      res.end(JSON.stringify({ detail: "显存不足" }));
    });
    const 配置 = 用配置({ engines: { indextts: { url: 地址, voices: [{ id: "v", refAudio: "D:/a.wav" }] } } });
    try {
      await expect(new IndexTTS引擎().合成({ text: "你好", voice: "v" })).rejects.toThrow(/显存不足/);
    } finally {
      配置.还原();
      服务.close();
    }
  });
});

describe("GPT-SoVITS 引擎", () => {
  beforeEach(() => {
    清空配置缓存();
    清空权重缓存();
  });

  it("首次用某音色时切换权重，重复使用不再切换", async () => {
    const { 服务, 地址, 请求 } = await 起服务((r, res) => {
      if (r.路径.startsWith("/set_")) {
        res.writeHead(200, { "content-type": "application/json" });
        res.end('{"message":"ok"}');
        return;
      }
      res.writeHead(200, { "content-type": "audio/wav" });
      res.end(假Wav());
    });
    const 配置 = 用配置({
      engines: {
        gptSovits: {
          url: 地址,
          voices: [{ id: "class1-3", gptWeights: "D:/g.ckpt", sovitsWeights: "D:/s.pth", refAudio: "D:/r.wav", refText: "参考", refLang: "zh" }],
        },
      },
    });
    try {
      const 引擎 = new GptSoVits引擎();
      await 引擎.合成({ text: "第一句" });
      await 引擎.合成({ text: "第二句" });
      const 权重请求 = 请求.filter((r) => r.路径.startsWith("/set_"));
      expect(权重请求.map((r) => r.路径)).toEqual(["/set_gpt_weights", "/set_sovits_weights"]);
      expect(权重请求[0].查询.get("weights_path")).toBe("D:/g.ckpt");
      expect(权重请求[1].查询.get("weights_path")).toBe("D:/s.pth");
      expect(请求.filter((r) => r.路径 === "/tts")).toHaveLength(2);
    } finally {
      配置.还原();
      服务.close();
    }
  });

  it("请求里带上格式与语速", async () => {
    const { 服务, 地址, 请求 } = await 起服务((_r, res) => {
      res.writeHead(200, { "content-type": "audio/wav" });
      res.end(假Wav());
    });
    const 配置 = 用配置({
      engines: { gptSovits: { url: 地址, voices: [{ id: "v", refAudio: "D:/r.wav" }] } },
    });
    try {
      await new GptSoVits引擎().合成({ text: "你好", speed: 1.3, format: "ogg" });
      const tts = 请求.find((r) => r.路径 === "/tts");
      expect(tts?.查询.get("media_type")).toBe("ogg");
      expect(tts?.查询.get("speed_factor")).toBe("1.3");
    } finally {
      配置.还原();
      服务.close();
    }
  });

  it("只配参考音频的音色不触发权重切换", async () => {
    const { 服务, 地址, 请求 } = await 起服务((_r, res) => {
      res.writeHead(200, { "content-type": "audio/wav" });
      res.end(假Wav());
    });
    const 配置 = 用配置({ engines: { gptSovits: { url: 地址, voices: [{ id: "v", refAudio: "D:/r.wav" }] } } });
    try {
      await new GptSoVits引擎().合成({ text: "你好" });
      expect(请求.filter((r) => r.路径.startsWith("/set_"))).toHaveLength(0);
    } finally {
      配置.还原();
      服务.close();
    }
  });

  it("未配音色时报配置指引", async () => {
    const 配置 = 用配置({ engines: { gptSovits: { url: "http://127.0.0.1:1" } } });
    try {
      await expect(new GptSoVits引擎().合成({ text: "你好" })).rejects.toThrow(/未配置 GPT-SoVITS 音色/);
    } finally {
      配置.还原();
    }
  });

  it("未知音色时报错并列出可用音色", async () => {
    const 配置 = 用配置({ engines: { gptSovits: { url: "http://127.0.0.1:1", voices: [{ id: "a" }, { id: "b" }] } } });
    try {
      await expect(new GptSoVits引擎().合成({ text: "你好", voice: "zzz" })).rejects.toThrow(/a, b/);
    } finally {
      配置.还原();
    }
  });
});
