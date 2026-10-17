/**
 * TTS 配置加载
 *
 * 读取 `kugua.config.json` 的 `tts` 节，并支持 `kugua.config.local.json` 覆盖
 * （与 ai.openwebui 同一套两层策略：后者优先，空串视为未设置）。
 *
 * 配置形态：
 * ```jsonc
 * "tts": {
 *   "defaultEngine": "voxcpm",
 *   "engines": {
 *     "voxcpm": {
 *       "enabled": true,
 *       "url": "http://127.0.0.1:9881",
 *       "defaultVoice": "narrator",
 *       "voices": [
 *         { "id": "narrator", "name": "旁白", "refAudio": "data/tts/voices/narrator.wav",
 *           "refText": "参考音频里说的那句话", "refLang": "zh" }
 *       ]
 *     }
 *   }
 * }
 * ```
 *
 * 兼容旧的扁平写法（`tts.gptSovits.url` 等）：`迁移旧配置()` 会把它转成新结构，
 * 这样已有部署不会因为升级而失效。
 */

import { existsSync, readFileSync } from "node:fs";
import { resolve } from "node:path";
import type { TTS配置, 引擎配置基类, 音色 } from "./types.js";

/** 只挑出配置里认识的字段，其余原样保留给具体引擎自行解释 */
function 归一引擎配置(原始: Record<string, unknown>): 引擎配置基类 & Record<string, unknown> {
  const 配置: 引擎配置基类 & Record<string, unknown> = { ...原始 };
  if (typeof 原始.enabled === "boolean") 配置.enabled = 原始.enabled;
  // 统一去掉 url 末尾斜杠，省得每个引擎各自处理
  if (typeof 原始.url === "string") 配置.url = 原始.url.replace(/\/+$/, "");
  if (原始.root !== undefined) 配置.root = String(原始.root);
  if (typeof 原始.defaultVoice === "string") 配置.defaultVoice = 原始.defaultVoice;
  if (typeof 原始.timeoutMs === "number") 配置.timeoutMs = 原始.timeoutMs;
  if (Array.isArray(原始.voices)) {
    配置.voices = (原始.voices as unknown[])
      .map(归一音色)
      .filter((v): v is 音色 => v !== null);
  }
  return 配置;
}

/** 校验并补齐单个音色；缺 id 视为无效 */
function 归一音色(原始: unknown): 音色 | null {
  if (!原始 || typeof 原始 !== "object") return null;
  const o = 原始 as Record<string, unknown>;
  const id = typeof o.id === "string" ? o.id.trim() : typeof o.name === "string" ? o.name.trim() : "";
  if (!id) return null;
  const 音: 音色 = { id };
  if (typeof o.name === "string") 音.name = o.name;
  if (typeof o.description === "string") 音.description = o.description;
  // 参考音频旧字段名是 refAudioPath
  const 参考 = o.refAudio ?? o.refAudioPath;
  if (typeof 参考 === "string" && 参考) 音.refAudio = 参考;
  if (typeof o.refText === "string") 音.refText = o.refText;
  // 旧的 promptText 就是参考文本
  if (音.refText === undefined && typeof o.promptText === "string") 音.refText = o.promptText;
  const 参考语言 = o.refLang ?? o.promptLang;
  if (typeof 参考语言 === "string") 音.refLang = 参考语言;
  if (typeof o.gptWeights === "string") 音.gptWeights = o.gptWeights;
  if (typeof o.sovitsWeights === "string") 音.sovitsWeights = o.sovitsWeights;
  if (typeof o.speakerId === "number") 音.speakerId = o.speakerId;
  // 旧配置里 sid 是说话人编号
  if (音.speakerId === undefined && typeof o.sid === "number") 音.speakerId = o.sid;
  return 音;
}

/**
 * 把旧版扁平配置迁移成 `engines` 结构。
 *
 * 旧形态（2024–2025 年写下的）：
 * ```
 * { provider, gptSovits: {url, voices}, sherpaRoot, sherpaModel, chatttsUrl }
 * ```
 * 迁移只补不覆盖：目标键已存在就保留用户现值。
 */
export function 迁移旧配置(原始: Record<string, unknown>): TTS配置 {
  const 结果: TTS配置 = {};
  const 引擎 = (原始.engines && typeof 原始.engines === "object" ? { ...(原始.engines as Record<string, unknown>) } : {}) as Record<
    string,
    Record<string, unknown>
  >;

  const 取值 = (v: unknown): string | undefined => (typeof v === "string" && v ? v : undefined);

  // GPT-SoVITS：旧键 gptSovits
  const 旧Sovits = 原始.gptSovits as { url?: string; voices?: unknown[] } | undefined;
  if (旧Sovits && !引擎.gptSovits) {
    const 项: Record<string, unknown> = {};
    if (旧Sovits.url) 项.url = 旧Sovits.url;
    if (Array.isArray(旧Sovits.voices)) 项.voices = 旧Sovits.voices;
    引擎.gptSovits = 项;
  }

  // ChatTTS：旧键 chatttsUrl
  const 旧Chattts = 取值(原始.chatttsUrl);
  if (旧Chattts && !引擎.chattts) 引擎.chattts = { url: 旧Chattts };

  // sherpa-onnx：旧键 sherpaRoot / sherpaModel
  const 旧Sherpa = 取值(原始.sherpaRoot);
  const 旧Sherpa模型 = 取值(原始.sherpaModel);
  if ((旧Sherpa || 旧Sherpa模型) && !引擎.sherpa) {
    const 项: Record<string, unknown> = {};
    if (旧Sherpa) 项.root = 旧Sherpa;
    if (旧Sherpa模型) 项.model = 旧Sherpa模型;
    引擎.sherpa = 项;
  }

  // windows-sapi：旧版只要在 win32 就可用，迁移时显式写一条
  if (原始.provider === "windows-sapi" && !引擎.sapi) 引擎.sapi = {};

  const 归一化后: Record<string, 引擎配置基类 & Record<string, unknown>> = {};
  for (const [名, 值] of Object.entries(引擎)) {
    if (值 && typeof 值 === "object") 归一化后[名] = 归一引擎配置(值 as Record<string, unknown>);
  }
  结果.engines = 归一化后;

  // 旧的顶层 provider 就是当年的默认引擎
  const 默认 = 取值(原始.defaultEngine) ?? 取值(原始.provider);
  if (默认) 结果.defaultEngine = 默认;
  return 结果;
}

/** 读一个配置文件里的 tts 节 */
function 读配置文件(路径: string): Record<string, unknown> | null {
  if (!existsSync(路径)) return null;
  try {
    const j = JSON.parse(readFileSync(路径, "utf-8")) as { tts?: Record<string, unknown> };
    return j.tts && typeof j.tts === "object" ? j.tts : null;
  } catch {
    return null;
  }
}

/** 深合并两层配置：覆盖层优先，空字符串视为未设置 */
function 合并(主: Record<string, unknown>, 覆盖: Record<string, unknown>): Record<string, unknown> {
  const 合: Record<string, unknown> = { ...主 };
  for (const [键, 值] of Object.entries(覆盖)) {
    if (值 === "" || 值 === null || 值 === undefined) continue;
    if (键 === "engines" && 值 && typeof 值 === "object") {
      const 主引擎 = (主.engines as Record<string, unknown>) ?? {};
      const 覆盖引擎 = 值 as Record<string, unknown>;
      const 合引擎: Record<string, unknown> = { ...主引擎 };
      for (const [引擎名, 引擎值] of Object.entries(覆盖引擎)) {
        const 已有 = 主引擎[引擎名];
        if (已有 && typeof 已有 === "object" && 引擎值 && typeof 引擎值 === "object") {
          const 合项: Record<string, unknown> = { ...(已有 as Record<string, unknown>) };
          for (const [k, v] of Object.entries(引擎值 as Record<string, unknown>)) {
            if (v !== "" && v !== null && v !== undefined) 合项[k] = v;
          }
          合引擎[引擎名] = 合项;
        } else {
          合引擎[引擎名] = 引擎值;
        }
      }
      合[键] = 合引擎;
      continue;
    }
    合[键] = 值;
  }
  return 合;
}

/** 配置缓存：避免每次合成都读盘；`清空配置缓存()` 供测试与热重载使用 */
let 缓存: TTS配置 | null = null;

export function 清空配置缓存(): void {
  缓存 = null;
}

/** 加载 tts 配置（含两层合并与旧格式迁移） */
export function 加载TTS配置(): TTS配置 {
  if (缓存) return 缓存;
  const 主路径 = resolve(process.cwd(), process.env.KUGUA_CONFIG ?? "kugua.config.json");
  const 覆盖路径 = resolve(process.cwd(), "kugua.config.local.json");
  const 主 = 读配置文件(主路径) ?? {};
  const 覆盖 = 读配置文件(覆盖路径) ?? {};
  const 合 = 合并(主, 覆盖);
  缓存 = 迁移旧配置(合);
  return 缓存;
}

/** 取某引擎的配置；未配置返回 undefined */
export function 取引擎配置(配置: TTS配置, 引擎名: string): (引擎配置基类 & Record<string, unknown>) | undefined {
  return 配置.engines?.[引擎名];
}

/**
 * 把音色里的相对路径按项目根解析成绝对路径。
 *
 * 配置里写 `data/tts/voices/x.wav` 比写绝对路径更可移植（换机器不用改配置）。
 */
export function 解析音色路径(音色: 音色, 基准目录?: string): 音色 {
  const 根 = 基准目录 ?? process.cwd();
  const 解析 = (p?: string): string | undefined => {
    if (!p) return undefined;
    // 已是绝对路径（含盘符）则原样返回
    if (/^[a-zA-Z]:[\\/]/.test(p) || p.startsWith("/") || p.startsWith("\\\\")) return p;
    return resolve(根, p);
  };
  return {
    ...音色,
    refAudio: 解析(音色.refAudio),
    gptWeights: 解析(音色.gptWeights),
    sovitsWeights: 解析(音色.sovitsWeights),
  };
}
