/**
 * GPT-SoVITS 引擎（微调类，兼容保留）
 *
 * 与零样本引擎的关键差异：音色 = **权重对**（GPT ckpt + SoVITS pth）+ 参考音频。
 * 切换音色需要先调 `/set_gpt_weights` 与 `/set_sovits_weights` 让服务端重载权重，
 * 实测每次重载 3–10 秒——所以这里做了「已加载就跳过」的缓存。
 *
 * 服务端：`api_v2.py`，默认 `127.0.0.1:9880`。
 * 接口：
 *   GET  /tts                文本→音频（参数在 query 上）
 *   GET  /set_gpt_weights    切换 GPT 权重
 *   GET  /set_sovits_weights 切换 SoVITS 权重
 *   GET  /control            重启/退出
 *
 * 输出格式：`media_type` 支持 wav / ogg / aac / raw（aac 依赖服务端装了 ffmpeg）。
 *
 * 注意：本引擎存在意义是「跑已有的微调权重」。若要零样本克隆，
 * 用 voxcpm / indextts 更省事（不用训练、不用换权重）。
 */

import type { 引擎能力, 音色, 合成请求, 合成结果, 语音引擎 } from "../types.js";
import { 取引擎配置, 解析音色路径, 加载TTS配置 } from "../config.js";
import { 服务可达, 提取错误, 默认超时 } from "./http-base.js";

export const GptSoVits能力: 引擎能力 = {
  tier: "fallback",
  formats: ["wav", "ogg", "aac"],
  zeroShot: false,
  finetune: true,
  emotion: { text: false, refAudio: false, vector: false },
  streaming: true,
  batch: true,
  vramGb: 4,
};

/** 记录服务端当前加载的权重，避免每次合成都重载 */
const 已加载权重 = new Map<string, { gpt: string; sovits: string }>();

/** 测试用：清空权重缓存 */
export function 清空权重缓存(): void {
  已加载权重.clear();
}

export class GptSoVits引擎 implements 语音引擎 {
  readonly name = "gptSovits";
  readonly 能力 = GptSoVits能力;

  private 配置() {
    return 取引擎配置(加载TTS配置(), this.name);
  }

  private 基址(): string {
    const 配置 = this.配置();
    const url = 配置?.url ?? process.env.KUGUA_TTS_GPT_SOVITS_URL;
    return typeof url === "string" ? url.replace(/\/+$/, "") : "";
  }

  private 音色表(): 音色[] {
    return this.配置()?.voices ?? [];
  }

  async 可用(): Promise<boolean> {
    if (this.配置()?.enabled === false) return false;
    return await 服务可达(this.基址(), 9880);
  }

  async 音色列表(): Promise<音色[]> {
    return this.音色表().map((v) => 解析音色路径(v));
  }

  private 找音色(id?: string): 音色 {
    const 表 = this.音色表();
    if (表.length === 0) throw new Error("未配置 GPT-SoVITS 音色（tts.engines.gptSovits.voices）");
    const 目标 = id ?? this.配置()?.defaultVoice;
    if (!目标) return 表[0];
    const 命中 = 表.find((v) => v.id === 目标) ?? 表.find((v) => v.name === 目标);
    if (!命中) throw new Error(`未知音色：${目标}（可用：${表.map((v) => v.id).join(", ")}）`);
    return 命中;
  }

  /**
   * 切换到目标音色的权重。
   *
   * 只有音色声明了权重路径才切换；只配了参考音频的音色直接跳过，
   * 这样同一个引擎既能跑微调音色也能跑「仅换参考音频」的临时音色。
   */
  private async 切换权重(基址: string, 音色: 音色, 超时: number): Promise<void> {
    const 解析后 = 解析音色路径(音色);
    if (!解析后.gptWeights && !解析后.sovitsWeights) return;

    const 当前 = 已加载权重.get(基址);
    const 目标GPT = 解析后.gptWeights ?? "";
    const 目标SoVITS = 解析后.sovitsWeights ?? "";
    if (当前 && 当前.gpt === 目标GPT && 当前.sovits === 目标SoVITS) return;

    const 调用 = async (端点: string, 参数名: string, 值: string): Promise<void> => {
      const u = new URL(`${基址}/${端点}`);
      u.searchParams.set(参数名, 值);
      const 响应 = await fetch(u, { signal: AbortSignal.timeout(超时) });
      if (!响应.ok) throw new Error(`切换权重失败（${提取错误(响应.status, await 响应.text().catch(() => ""))}）`);
    };

    if (目标GPT) await 调用("set_gpt_weights", "weights_path", 目标GPT);
    if (目标SoVITS) await 调用("set_sovits_weights", "weights_path", 目标SoVITS);
    已加载权重.set(基址, { gpt: 目标GPT, sovits: 目标SoVITS });
  }

  async 合成(请求: 合成请求): Promise<合成结果> {
    const 基址 = this.基址();
    if (!基址) throw new Error("未配置 GPT-SoVITS 服务地址（tts.engines.gptSovits.url）");

    const 音色 = this.找音色(请求.voice);
    const 解析后 = 解析音色路径(音色);
    const 超时 = Number(this.配置()?.timeoutMs ?? 默认超时.fallback);

    // 先切权重（有缓存，重复调用几乎无开销）
    await this.切换权重(基址, 音色, 超时);

    // aac 依赖服务端 ffmpeg；不可用时回落到 wav
    const 格式 = 请求.format && this.能力.formats.includes(请求.format) ? 请求.format : "wav";

    const u = new URL(`${基址}/tts`);
    u.searchParams.set("text", 请求.text);
    u.searchParams.set("text_lang", 请求.lang ?? 解析后.refLang ?? "zh");
    // 未配参考音频时用服务端已加载权重的默认表现（部分部署允许空）
    if (解析后.refAudio) u.searchParams.set("ref_audio_path", 解析后.refAudio);
    u.searchParams.set("prompt_text", 解析后.refText ?? "");
    u.searchParams.set("prompt_lang", 解析后.refLang ?? "zh");
    u.searchParams.set("text_split_method", String(this.配置()?.textSplitMethod ?? "cut5"));
    u.searchParams.set("batch_size", "1");
    u.searchParams.set("media_type", 格式);
    u.searchParams.set("streaming_mode", "false");
    // speed_factor：大于 1 更快，语义与我们一致，直接用
    if (typeof 请求.speed === "number") u.searchParams.set("speed_factor", String(请求.speed));
    if (typeof 请求.seed === "number") u.searchParams.set("seed", String(请求.seed));
    if (typeof 请求.temperature === "number") u.searchParams.set("temperature", String(请求.temperature));

    const 响应 = await fetch(u, { signal: AbortSignal.timeout(超时) });
    if (!响应.ok) {
      throw new Error(`GPT-SoVITS 合成失败（${提取错误(响应.status, await 响应.text().catch(() => ""))}）`);
    }
    const 音频 = Buffer.from(await 响应.arrayBuffer());
    // ogg/aac 容器更小，不能再用 44 字节的 wav 头长度判断
    const 最小长度 = 格式 === "wav" ? 44 : 16;
    if (音频.length < 最小长度) throw new Error("GPT-SoVITS 返回内容过短，合成可能失败");

    return { audio: 音频, format: 格式, engine: this.name, voice: 音色.id };
  }
}
