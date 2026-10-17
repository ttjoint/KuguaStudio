/**
 * TTS 处理器：tts.speak 合成、tts.status 状态、tts.voices 音色列表。
 *
 * 这一层只做「参数翻译 + 返回格式组装」，引擎选择全部交给 registry，
 * 所以换引擎、加引擎都不用改这里。
 */

import { mkdirSync, writeFileSync } from "node:fs";
import { dirname } from "node:path";
import type { NiganeClient } from "@kugua/nigane";
import type { 能力声明 } from "@kugua/capability";
import { 加载TTS配置 } from "./config.js";
import { 合成语音, 引擎状态 } from "./registry.js";
import { 登记内置引擎 } from "./engines/index.js";
import { 取引擎 } from "./registry.js";
import type { 音频格式, 情绪控制 } from "./types.js";

export const 能力清单: 能力声明[] = [
  {
    名称: "tts.speak",
    模块: "tts",
    标题: "语音合成",
    说明: "文本→音频。按「实时优先 → 高质量 → CPU 兜底」自动选引擎，可用 engine/voice/emotion 精确控制",
    中文指令: ["说话", "语音合成"],
    参数: {
      type: "object",
      properties: {
        text: { type: "string", description: "要合成的文本" },
        engine: { type: "string", description: "指定引擎：voxcpm / indextts / gptSovits / sherpa / sapi；不填自动选择" },
        voice: { type: "string", description: "音色 id（见 tts.voices）" },
        speed: { type: "number", description: "语速倍率，大于 1 更快" },
        format: { type: "string", description: "输出格式 wav/mp3/ogg/aac，默认随引擎能力" },
        lang: { type: "string", description: "语言，如 zh / en" },
        seed: { type: "number", description: "随机种子，便于复现同一份配音" },
        temperature: { type: "number", description: "采样温度，越大表现力越强" },
        emotion: {
          type: "object",
          description: "情绪控制（仅 indextts 完整支持，其余引擎忽略）",
          properties: {
            text: { type: "string", description: "情绪文字描述，如「低沉压抑地朗读」" },
            refAudio: { type: "string", description: "情绪参考音频路径" },
            intensity: { type: "number", description: "情绪强度 0~1" },
            vector: { type: "array", items: { type: "number" }, description: "8 维情绪向量：高兴/愤怒/悲伤/恐惧/厌恶/忧郁/惊讶/平静" },
          },
        },
        输出路径: { type: "string", description: "指定则写入文件而非返回 base64" },
      },
      required: ["text"],
    },
    暴露: { 指令: true, GUI: true, 定时: false, MCP: true },
  },
  {
    名称: "tts.status",
    模块: "tts",
    标题: "语音合成状态",
    说明: "各引擎的配置与可用性",
    参数: { type: "object", properties: {} },
    暴露: { 指令: false, GUI: true, 定时: false, MCP: true },
  },
  {
    名称: "tts.voices",
    模块: "tts",
    标题: "音色列表",
    说明: "列出所有引擎已知的音色及其能力",
    参数: {
      type: "object",
      properties: { engine: { type: "string", description: "只看某个引擎；不填返回全部" } },
    },
    暴露: { 指令: false, GUI: true, 定时: false, MCP: true },
  },
];

/** 允许的格式白名单，防止上层传奇怪的值 */
const 合法格式: 音频格式[] = ["wav", "mp3", "ogg", "aac"];

function 归一格式(值: unknown): 音频格式 | undefined {
  return typeof 值 === "string" && (合法格式 as string[]).includes(值) ? (值 as 音频格式) : undefined;
}

/** 归一情绪参数：接受 snake_case / 中文键，方便外部脚本调用 */
function 归一情绪(原始: unknown): 情绪控制 | undefined {
  if (!原始 || typeof 原始 !== "object") return undefined;
  const o = 原始 as Record<string, unknown>;
  const 情绪: 情绪控制 = {};
  const 文本 = o.text ?? o.情绪;
  if (typeof 文本 === "string" && 文本) 情绪.text = 文本;
  const 参考 = o.refAudio ?? o.ref_audio ?? o.emoRefPath;
  if (typeof 参考 === "string" && 参考) 情绪.refAudio = 参考;
  const 强度 = o.intensity ?? o.alpha ?? o.emoAlpha;
  if (typeof 强度 === "number") 情绪.intensity = Math.max(0, Math.min(1, 强度));
  const 向量 = o.vector ?? o.emoVector;
  if (Array.isArray(向量)) 情绪.vector = 向量.map(Number).filter((n) => Number.isFinite(n));
  return Object.keys(情绪).length > 0 ? 情绪 : undefined;
}

export function 注册TTS处理器(客户端: NiganeClient): 能力声明[] {
  登记内置引擎();

  客户端.onRequest("tts.speak", async (参数) => {
    const p = (参数 ?? {}) as {
      text?: string;
      文本?: string;
      参数文本?: string;
      原文?: string;
      engine?: string;
      provider?: string;
      voice?: string;
      音色?: string;
      speed?: number;
      format?: string;
      lang?: string;
      seed?: number;
      temperature?: number;
      emotion?: unknown;
      情绪?: unknown;
      sid?: number;
      输出路径?: string;
    };
    const text = (p.text ?? p.文本 ?? p.参数文本 ?? p.原文 ?? "").trim();
    if (!text) throw new Error("缺少文本");

    // engine 优先，兼收旧参数名 provider
    const engine = p.engine ?? p.provider;
    const 结果 = await 合成语音(
      {
        text,
        engine,
        voice: p.voice ?? p.音色,
        speed: p.speed,
        format: 归一格式(p.format),
        lang: p.lang,
        seed: p.seed,
        temperature: p.temperature,
        emotion: 归一情绪(p.emotion ?? p.情绪),
      },
      加载TTS配置(),
    );

    const 元信息 = {
      engine: 结果.engine,
      voice: 结果.voice ?? null,
      format: 结果.format,
      sampleRate: 结果.sampleRate ?? null,
      elapsedMs: 结果.elapsedMs ?? null,
    };

    if (p.输出路径) {
      mkdirSync(dirname(p.输出路径), { recursive: true });
      writeFileSync(p.输出路径, 结果.audio);
      return { 输出路径: p.输出路径, ...元信息 };
    }
    return { base64: 结果.audio.toString("base64"), ...元信息 };
  });

  客户端.onRequest("tts.status", async () => {
    const 状态 = await 引擎状态();
    const 配置 = 加载TTS配置();
    return {
      module: "tts",
      defaultEngine: 配置.defaultEngine ?? null,
      engines: 状态,
      // 便于快速判断「现在能不能出声」
      任可用: 状态.some((s) => s.可用),
    };
  });

  客户端.onRequest("tts.voices", async (参数) => {
    const p = (参数 ?? {}) as { engine?: string };
    const 状态 = await 引擎状态();
    const 结果: Array<Record<string, unknown>> = [];
    for (const s of 状态) {
      if (p.engine && p.engine !== s.name) continue;
      const 引擎 = 取引擎(s.name);
      if (!引擎) continue;
      let 音色表: unknown[] = [];
      try {
        音色表 = await 引擎.音色列表();
      } catch {
        /* 引擎列举失败不影响其它引擎 */
      }
      结果.push({
        engine: s.name,
        tier: s.tier,
        可用: s.可用,
        能力: s.能力,
        voices: 音色表,
      });
    }
    return { engines: 结果 };
  });

  return 能力清单;
}
