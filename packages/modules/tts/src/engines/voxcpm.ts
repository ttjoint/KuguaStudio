/**
 * VoxCPM 引擎（第一类：低占用 / 低延迟）
 *
 * 定位：实时对话配音。VoxCPM1.5（0.6B，~6GB 显存，RTF≈0.15）是推荐型号，
 * VoxCPM2（2B，~8GB）也兼容——两者服务端接口一致，差异在音质与显存。
 *
 * 接入方式：VoxCPM 官方提供 **OpenAI 兼容**端点 `POST /v1/audio/speech`，
 * 这个端点最稳定（vLLM-Omni / Nano-VLLM 也是同一形态），所以优先走它。
 *
 * 请求形态：
 * ```jsonc
 * POST {url}/v1/audio/speech
 * {
 *   "model": "voxcpm",
 *   "input": "要合成的文本",
 *   "voice": "音色id 或 参考音频路径",
 *   "response_format": "wav",       // wav / mp3 / ogg / aac
 *   "speed": 1.0,                    // 大于 1 更快
 *   "instructions": "情绪/风格描述",  // 部分实现支持
 *   "ref_audio": "/path/to/ref.wav", // VoxCPM 扩展字段
 *   "ref_text": "参考文本"
 * }
 * ```
 * 响应：**音频二进制**（不是 JSON）。
 *
 * 注意：不同部署（官方脚本 / vLLM-Omni / Nano-VLLM）对扩展字段的接受度不同。
 * 本实现先在请求里带扩展字段，若上游回 4xx 再退化为只用标准 OpenAI 字段，
 * 这样同一个引擎配置能同时兼容多种部署。
 */

import type { 引擎能力, 音色, 合成请求, 合成结果, 语音引擎 } from "../types.js";
import { 取引擎配置, 解析音色路径, 加载TTS配置 } from "../config.js";
import { 服务可达, 提取错误, 默认超时 } from "./http-base.js";

export const VoxCPM能力: 引擎能力 = {
  tier: "fast",
  formats: ["wav", "mp3", "ogg", "aac"],
  zeroShot: true,
  finetune: true, // 1.5 / 2 都支持 SFT / LoRA
  emotion: { text: true, refAudio: false, vector: false },
  streaming: true,
  batch: false,
  vramGb: 6,
};

/** VoxCPM1.5 与 VoxCPM2 的采样率差异；未知型号时不报，避免误导 */
function 推测采样率(): number | undefined {
  return undefined;
}

export class VoxCPM引擎 implements 语音引擎 {
  readonly name = "voxcpm";
  readonly 能力 = VoxCPM能力;

  private 配置() {
    return 取引擎配置(加载TTS配置(), this.name);
  }

  private 基址(): string {
    const 配置 = this.配置();
    const url = 配置?.url ?? process.env.KUGUA_TTS_VOXCPM_URL;
    return typeof url === "string" ? url.replace(/\/+$/, "") : "";
  }

  private 音色表(): 音色[] {
    return this.配置()?.voices ?? [];
  }

  async 可用(): Promise<boolean> {
    const 配置 = this.配置();
    if (配置?.enabled === false) return false;
    return await 服务可达(this.基址(), 9881);
  }

  async 音色列表(): Promise<音色[]> {
    return this.音色表().map((v) => 解析音色路径(v));
  }

  private 找音色(id: string | undefined): 音色 | undefined {
    const 表 = this.音色表();
    const 目标 = id ?? this.配置()?.defaultVoice;
    if (!目标) return undefined;
    return 表.find((v) => v.id === 目标) ?? (目标 ? 表.find((v) => v.name === 目标) : undefined);
  }

  async 合成(请求: 合成请求): Promise<合成结果> {
    const 基址 = this.基址();
    if (!基址) throw new Error("未配置 VoxCPM 服务地址（tts.engines.voxcpm.url）");

    const 音色 = this.找音色(请求.voice);
    const 参考 = 音色 ? 解析音色路径(音色) : undefined;
    const 超时 = Number(this.配置()?.timeoutMs ?? 默认超时.fast);
    const 格式 = 请求.format ?? "wav";

    // 标准 OpenAI 字段（所有部署都认）
    const 标准: Record<string, unknown> = {
      model: String(this.配置()?.model ?? "voxcpm"),
      input: 请求.text,
      voice: 音色?.id ?? 请求.voice ?? "default",
      response_format: 格式,
    };
    if (typeof 请求.speed === "number") 标准.speed = 请求.speed;

    // VoxCPM 扩展字段（官方脚本认，纯 OpenAI 实现不认）
    const 扩展: Record<string, unknown> = { ...标准 };
    if (参考?.refAudio) 扩展.ref_audio = 参考.refAudio;
    if (参考?.refText) 扩展.ref_text = 参考.refText;
    if (请求.emotion?.text) 扩展.instructions = 请求.emotion.text;
    if (typeof 请求.seed === "number") 扩展.seed = 请求.seed;
    if (typeof 请求.temperature === "number") 扩展.temperature = 请求.temperature;

    // 先试扩展版；失败且是 4xx（说明不认扩展字段）再退回标准版
    let 响应 = await this.发送(`${基址}/v1/audio/speech`, 扩展, 超时);
    if (!响应.ok && 响应.状态 >= 400 && 响应.状态 < 500) {
      响应 = await this.发送(`${基址}/v1/audio/speech`, 标准, 超时);
    }
    if (!响应.ok) throw new Error(`VoxCPM 合成失败（${提取错误(响应.状态, 响应.文本)}）`);

    if (响应.音频.length < 44) throw new Error("VoxCPM 返回内容过短，合成可能失败");
    return {
      audio: 响应.音频,
      format: 格式,
      engine: this.name,
      voice: 音色?.id,
      sampleRate: 推测采样率(),
    };
  }

  /** 发一次请求，把响应归一成 {ok, 状态, 音频, 文本} */
  private async 发送(
    url: string,
    体: Record<string, unknown>,
    超时: number,
  ): Promise<{ ok: boolean; 状态: number; 音频: Buffer; 文本: string }> {
    const 响应 = await fetch(url, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify(体),
      signal: AbortSignal.timeout(超时),
    });
    if (!响应.ok) {
      return { ok: false, 状态: 响应.status, 音频: Buffer.alloc(0), 文本: await 响应.text().catch(() => "") };
    }
    const 音频 = Buffer.from(await 响应.arrayBuffer());
    return { ok: true, 状态: 响应.status, 音频, 文本: "" };
  }
}
