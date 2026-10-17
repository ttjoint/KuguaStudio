import { describe, expect, it, beforeEach } from "vitest";
import { mkdtempSync, writeFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { 迁移旧配置, 解析音色路径, 清空配置缓存, 加载TTS配置 } from "../src/config.js";
import { 归一情绪向量, 情绪维度顺序 } from "../src/engines/indextts.js";
import {
  注册引擎,
  清空引擎注册表,
  选择引擎,
  合成语音,
  选定格式,
  引擎状态,
  引擎名单,
} from "../src/registry.js";
import type { 引擎能力, 合成结果, 语音引擎, 合成请求 } from "../src/types.js";

/** 造一个可控的假引擎，便于测调度而不碰真实服务 */
function 造引擎(
  名: string,
  tier: 引擎能力["tier"],
  可选: { 可用?: boolean; 失败?: boolean; formats?: 引擎能力["formats"] } = {},
): 语音引擎 & { 调用次数: number; 最近请求?: 合成请求 } {
  const 假: 语音引擎 & { 调用次数: number; 最近请求?: 合成请求 } = {
    调用次数: 0,
    name: 名,
    能力: {
      tier,
      formats: 可选.formats ?? ["wav"],
      zeroShot: true,
      finetune: false,
      emotion: { text: false, refAudio: false, vector: false },
      streaming: false,
      batch: false,
      vramGb: 0,
    },
    async 可用() {
      return 可选.可用 ?? true;
    },
    async 音色列表() {
      return [{ id: "v1", name: "音色一" }];
    },
    async 合成(请求: 合成请求): Promise<合成结果> {
      假.调用次数++;
      假.最近请求 = 请求;
      if (可选.失败) throw new Error("故意失败");
      return { audio: Buffer.from("fake-audio"), format: 请求.format ?? "wav", engine: 名 };
    },
  };
  return 假;
}

/** 造一份只含指定引擎的配置 */
function 造配置(引擎名: string[], 默认?: string) {
  return {
    defaultEngine: 默认,
    engines: Object.fromEntries(引擎名.map((n) => [n, { enabled: true }])),
  };
}

describe("情绪向量归一", () => {
  it("补齐到 8 维", () => {
    expect(归一情绪向量([0.5, 0.2])).toEqual([0.5, 0.2, 0, 0, 0, 0, 0, 0]);
  });

  it("超出 8 维的部分被丢弃", () => {
    expect(归一情绪向量([1, 1, 1, 1, 1, 1, 1, 1, 1, 1])).toHaveLength(8);
  });

  it("钳制到 0~1，非法值归零", () => {
    expect(归一情绪向量([2, -1, Number.NaN])).toEqual([1, 0, 0, 0, 0, 0, 0, 0]);
  });

  it("维度顺序与 IndexTTS 约定一致", () => {
    expect(情绪维度顺序).toEqual(["高兴", "愤怒", "悲伤", "恐惧", "厌恶", "忧郁", "惊讶", "平静"]);
  });
});

describe("旧配置迁移", () => {
  it("把 gptSovits 旧节搬到 engines", () => {
    const 结果 = 迁移旧配置({ gptSovits: { url: "http://127.0.0.1:9880", voices: [] } });
    expect(结果.engines?.gptSovits.url).toBe("http://127.0.0.1:9880");
  });

  it("把 chatttsUrl / sherpaRoot / sherpaModel 迁移成引擎节", () => {
    const 结果 = 迁移旧配置({
      chatttsUrl: "http://127.0.0.1:9966",
      sherpaRoot: "D:/sherpa",
      sherpaModel: "vits-zh-hf-eula",
    });
    expect(结果.engines?.chattts.url).toBe("http://127.0.0.1:9966");
    expect(结果.engines?.sherpa.root).toBe("D:/sherpa");
    expect(结果.engines?.sherpa.model).toBe("vits-zh-hf-eula");
  });

  it("旧顶层 provider 变成 defaultEngine", () => {
    expect(迁移旧配置({ provider: "gpt-sovits" }).defaultEngine).toBe("gpt-sovits");
  });

  it("已有的 engines 节不被旧键覆盖", () => {
    const 结果 = 迁移旧配置({
      chatttsUrl: "http://旧地址",
      engines: { chattts: { url: "http://新地址" } },
    });
    expect(结果.engines?.chattts.url).toBe("http://新地址");
  });

  it("音色的旧字段名被归一（refAudioPath/promptText/promptLang/sid）", () => {
    const 结果 = 迁移旧配置({
      engines: {
        gptSovits: {
          voices: [
            {
              name: "旁白",
              refAudioPath: "a.wav",
              promptText: "参考文本",
              promptLang: "zh",
              sid: 3,
            },
          ],
        },
      },
    });
    const 音色 = 结果.engines?.gptSovits.voices?.[0];
    expect(音色).toMatchObject({
      id: "旁白",
      refAudio: "a.wav",
      refText: "参考文本",
      refLang: "zh",
      speakerId: 3,
    });
  });

  it("没有 id 也没有 name 的音色被丢弃", () => {
    const 结果 = 迁移旧配置({ engines: { gptSovits: { voices: [{ refAudio: "x.wav" }] } } });
    expect(结果.engines?.gptSovits.voices).toEqual([]);
  });

  it("url 末尾斜杠被去掉", () => {
    const 结果 = 迁移旧配置({ engines: { voxcpm: { url: "http://127.0.0.1:9881//" } } });
    expect(结果.engines?.voxcpm.url).toBe("http://127.0.0.1:9881");
  });
});

describe("音色路径解析", () => {
  it("相对路径按基准目录解析", () => {
    const r = 解析音色路径({ id: "a", refAudio: "data/x.wav" }, "D:/proj");
    expect(r.refAudio).toBe("D:\\proj\\data\\x.wav");
  });

  it("Windows 绝对路径原样保留", () => {
    const r = 解析音色路径({ id: "a", refAudio: "D:\\w\\x.wav" }, "C:/other");
    expect(r.refAudio).toBe("D:\\w\\x.wav");
  });

  it("未设置的字段保持未设置", () => {
    const r = 解析音色路径({ id: "a" }, "D:/proj");
    expect(r.refAudio).toBeUndefined();
    expect(r.gptWeights).toBeUndefined();
  });
});

describe("配置两层合并", () => {
  let 目录: string;

  beforeEach(() => {
    目录 = mkdtempSync(join(tmpdir(), "kugua-tts-cfg-"));
    清空配置缓存();
  });

  const 写配置 = (名: string, 内容: unknown) => writeFileSync(join(目录, 名), JSON.stringify(内容), "utf-8");

  it("local 覆盖主配置里的同名字段", () => {
    写配置("kugua.config.json", { tts: { defaultEngine: "voxcpm", engines: { voxcpm: { url: "http://a" } } } });
    写配置("kugua.config.local.json", { tts: { engines: { voxcpm: { url: "http://b" } } } });
    const 原cwd = process.cwd();
    process.chdir(目录);
    try {
      const 配置 = 加载TTS配置();
      expect(配置.engines?.voxcpm.url).toBe("http://b");
      expect(配置.defaultEngine).toBe("voxcpm");
    } finally {
      process.chdir(原cwd);
      清空配置缓存();
      rmSync(目录, { recursive: true, force: true });
    }
  });

  it("local 里的空串不覆盖已有值", () => {
    写配置("kugua.config.json", { tts: { engines: { voxcpm: { url: "http://a", defaultVoice: "narrator" } } } });
    写配置("kugua.config.local.json", { tts: { engines: { voxcpm: { defaultVoice: "" } } } });
    const 原cwd = process.cwd();
    process.chdir(目录);
    try {
      expect(加载TTS配置().engines?.voxcpm.defaultVoice).toBe("narrator");
    } finally {
      process.chdir(原cwd);
      清空配置缓存();
      rmSync(目录, { recursive: true, force: true });
    }
  });

  it("配置文件不存在时返回空结构而不抛异常", () => {
    清空配置缓存();
    const 原cwd = process.cwd();
    process.chdir(目录);
    try {
      expect(加载TTS配置().engines).toEqual({});
    } finally {
      process.chdir(原cwd);
      清空配置缓存();
      rmSync(目录, { recursive: true, force: true });
    }
  });
});

describe("格式回落", () => {
  it("引擎支持请求格式时原样返回", () => {
    const e = 造引擎("x", "fast", { formats: ["wav", "mp3"] });
    expect(选定格式(e, "mp3")).toBe("mp3");
  });

  it("不支持时回落到引擎支持的格式", () => {
    const e = 造引擎("x", "fast", { formats: ["ogg"] });
    expect(选定格式(e, "mp3")).toBe("ogg");
  });

  it("多个可选项时优先体积小的格式", () => {
    const e = 造引擎("x", "fast", { formats: ["wav", "mp3"] });
    expect(选定格式(e, undefined)).toBe("mp3");
  });
});

describe("引擎调度", () => {
  beforeEach(() => {
    清空引擎注册表();
  });

  it("按分层顺序排列候选：fast 先于 quality 先于 fallback", async () => {
    注册引擎(造引擎("c-cpu", "fallback"));
    注册引擎(造引擎("b-quality", "quality"));
    注册引擎(造引擎("a-fast", "fast"));
    const 候选 = await 选择引擎(undefined, 造配置(["a-fast", "b-quality", "c-cpu"]));
    expect(候选.map((c) => c.引擎.name)).toEqual(["a-fast", "b-quality", "c-cpu"]);
  });

  it("配置默认引擎排在最前", async () => {
    注册引擎(造引擎("a-fast", "fast"));
    注册引擎(造引擎("b-quality", "quality"));
    const 候选 = await 选择引擎(undefined, 造配置(["a-fast", "b-quality"], "b-quality"));
    expect(候选[0].引擎.name).toBe("b-quality");
  });

  it("不可用的引擎被排除", async () => {
    注册引擎(造引擎("a-fast", "fast", { 可用: false }));
    注册引擎(造引擎("b-quality", "quality"));
    const 候选 = await 选择引擎(undefined, 造配置(["a-fast", "b-quality"]));
    expect(候选.map((c) => c.引擎.name)).toEqual(["b-quality"]);
  });

  it("enabled:false 的引擎被排除", async () => {
    注册引擎(造引擎("a-fast", "fast"));
    const 候选 = await 选择引擎(undefined, { engines: { "a-fast": { enabled: false } } });
    expect(候选).toEqual([]);
  });

  it("完全未配置的引擎被排除（避免误连默认端口）", async () => {
    注册引擎(造引擎("a-fast", "fast"));
    const 候选 = await 选择引擎(undefined, { engines: {} });
    expect(候选).toEqual([]);
  });

  it("未配置的 fallback 引擎仍参与兜底（意义就是别的不可用时还能出声）", async () => {
    注册引擎(造引擎("a-fast", "fast"));
    注册引擎(造引擎("z-cpu", "fallback"));
    const 候选 = await 选择引擎(undefined, { engines: { "a-fast": { enabled: true } } });
    expect(候选.map((c) => c.引擎.name)).toEqual(["a-fast", "z-cpu"]);
  });

  it("fallback 引擎显式 enabled:false 时依然被排除", async () => {
    注册引擎(造引擎("z-cpu", "fallback"));
    const 候选 = await 选择引擎(undefined, { engines: { "z-cpu": { enabled: false } } });
    expect(候选).toEqual([]);
  });

  it("显式指定引擎时只返回该引擎", async () => {
    注册引擎(造引擎("a-fast", "fast"));
    注册引擎(造引擎("b-quality", "quality"));
    const 候选 = await 选择引擎("b-quality", 造配置(["a-fast", "b-quality"]));
    expect(候选).toHaveLength(1);
    expect(候选[0].引擎.name).toBe("b-quality");
  });

  it("显式指定未知引擎时报错并列出可用引擎", async () => {
    注册引擎(造引擎("a-fast", "fast"));
    await expect(选择引擎("不存在", 造配置(["a-fast"]))).rejects.toThrow(/未知语音引擎.*a-fast/);
  });

  it("显式指定的引擎不可用时报错，不静默换引擎", async () => {
    注册引擎(造引擎("a-fast", "fast", { 可用: false }));
    await expect(选择引擎("a-fast", 造配置(["a-fast"]))).rejects.toThrow(/不可用/);
  });

  it("显式指定时即使未写配置也能用（有环境变量兜底的场景）", async () => {
    注册引擎(造引擎("a-fast", "fast"));
    const 候选 = await 选择引擎("a-fast", { engines: {} });
    expect(候选).toHaveLength(1);
  });
});

describe("合成语音", () => {
  beforeEach(() => {
    清空引擎注册表();
  });

  it("首选引擎成功即返回，不调用后续引擎", async () => {
    const fast = 造引擎("a-fast", "fast");
    const quality = 造引擎("b-quality", "quality");
    注册引擎(fast);
    注册引擎(quality);
    const 结果 = await 合成语音({ text: "你好" }, 造配置(["a-fast", "b-quality"]));
    expect(结果.engine).toBe("a-fast");
    expect(fast.调用次数).toBe(1);
    expect(quality.调用次数).toBe(0);
  });

  it("首选失败时自动回落到下一个引擎", async () => {
    const fast = 造引擎("a-fast", "fast", { 失败: true });
    const quality = 造引擎("b-quality", "quality");
    注册引擎(fast);
    注册引擎(quality);
    const 结果 = await 合成语音({ text: "你好" }, 造配置(["a-fast", "b-quality"]));
    expect(结果.engine).toBe("b-quality");
    expect(fast.调用次数).toBe(1);
  });

  it("全部失败时汇总每个引擎的错误", async () => {
    注册引擎(造引擎("a-fast", "fast", { 失败: true }));
    注册引擎(造引擎("b-quality", "quality", { 失败: true }));
    await expect(合成语音({ text: "你好" }, 造配置(["a-fast", "b-quality"]))).rejects.toThrow(/a-fast[\s\S]*b-quality/);
  });

  it("没有可用引擎时给出配置指引", async () => {
    await expect(合成语音({ text: "你好" }, { engines: {} })).rejects.toThrow(/tts\.engines/);
  });

  it("前两类都不可用时回落到未配置的 fallback 引擎", async () => {
    const fast = 造引擎("a-fast", "fast", { 失败: true });
    const cpu = 造引擎("z-cpu", "fallback");
    注册引擎(fast);
    注册引擎(cpu);
    const 结果 = await 合成语音({ text: "你好" }, { engines: { "a-fast": { enabled: true } } });
    expect(结果.engine).toBe("z-cpu");
  });

  it("缺文本时报错", async () => {
    await expect(合成语音({ text: "   " }, 造配置([]))).rejects.toThrow(/缺少文本/);
  });

  it("补齐耗时字段", async () => {
    注册引擎(造引擎("a-fast", "fast"));
    const 结果 = await 合成语音({ text: "你好" }, 造配置(["a-fast"]));
    expect(typeof 结果.elapsedMs).toBe("number");
  });

  it("请求的格式被回落后传给引擎", async () => {
    const e = 造引擎("a-fast", "fast", { formats: ["wav"] });
    注册引擎(e);
    await 合成语音({ text: "你好", format: "mp3" }, 造配置(["a-fast"]));
    expect(e.最近请求?.format).toBe("wav");
  });
});

describe("引擎状态汇总", () => {
  beforeEach(() => {
    清空引擎注册表();
  });

  it("按分层排序并标出可用性", async () => {
    注册引擎(造引擎("a-fast", "fast", { 可用: false }));
    注册引擎(造引擎("c-cpu", "fallback"));
    const 状态 = await 引擎状态(造配置(["a-fast", "c-cpu"]));
    expect(状态.map((s) => s.name)).toEqual(["a-fast", "c-cpu"]);
    expect(状态[0].可用).toBe(false);
    expect(状态[1].可用).toBe(true);
  });

  it("标出哪些引擎已配置", async () => {
    注册引擎(造引擎("a-fast", "fast"));
    注册引擎(造引擎("b-quality", "quality"));
    const 状态 = await 引擎状态(造配置(["a-fast"]));
    expect(状态.find((s) => s.name === "a-fast")?.已配置).toBe(true);
    expect(状态.find((s) => s.name === "b-quality")?.已配置).toBe(false);
  });

  it("enabled:false 的引擎显示为不可用但不报错", async () => {
    注册引擎(造引擎("a-fast", "fast"));
    const 状态 = await 引擎状态({ engines: { "a-fast": { enabled: false } } });
    expect(状态[0].可用).toBe(false);
    expect(状态[0].错误).toBeUndefined();
  });

  it("供 tts.status 用的引擎名单非空", () => {
    注册引擎(造引擎("a-fast", "fast"));
    expect(引擎名单()).toContain("a-fast");
  });
});
