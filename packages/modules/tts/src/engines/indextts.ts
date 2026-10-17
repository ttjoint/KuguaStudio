/**
 * IndexTTS 引擎（第二类：高质量 / 拟真 / 可调情绪）
 *
 * 定位：有声书批处理。IndexTTS-2.5（1.5B）中文 SS 相似度 76.5（人类基准 75.5），
 * 情绪控制有 5 种互相独立的方式，这是选它做有声书的核心原因：
 *
 *   1. `emo_ref_path`  情绪参考音频 —— 给一段"愤怒"样本直接迁移情绪
 *   2. `emo_alpha`     情绪强度 0~1 —— 同一情绪做强弱渐变
 *   3. `emo_vector`    8 维情绪向量 —— 可编程精确控制，批处理友好
 *   4. `use_emo_text`  从剧本文字自动推断情绪
 *   5. `emo_text`      单独指定"低沉压抑地朗读"这类文字描述
 *
 * 另有 `duration_factor`（0.5x–2.0x）精确控时长，用来对齐章节节奏。
 *
 * 接入方式：IndexTTS 官方提供 `webui.py` / `api_server`（FastAPI）以及 vLLM recipe。
 * 这里按 **FastAPI 服务 + 文件返回** 设计：请求给出输出路径，服务端写文件后我们读回。
 * 部分部署直接返回音频流，两种响应形态都兼容。
 */

import { existsSync, readFileSync, rmSync } from "node:fs";
import { randomUUID } from "node:crypto";
import { tmpdir } from "node:os";
import { join } from "node:path";
import type { 引擎能力, 音色, 合成请求, 合成结果, 语音引擎 } from "../types.js";
import { 取引擎配置, 解析音色路径, 加载TTS配置 } from "../config.js";
import { 服务可达, 提取错误, 默认超时 } from "./http-base.js";

export const IndexTTS能力: 引擎能力 = {
  tier: "quality",
  formats: ["wav"],
  zeroShot: true,
  finetune: false, // 官方主打零样本，未见公开微调流程
  emotion: { text: true, refAudio: true, vector: true },
  streaming: true,
  batch: true,
  vramGb: 8,
};

/** IndexTTS 的 8 维情绪顺序（与其 infer 代码一致） */
export const 情绪维度顺序 = ["高兴", "愤怒", "悲伤", "恐惧", "厌恶", "忧郁", "惊讶", "平静"] as const;

/** 把情绪向量归一成 8 个数；未给维度补 0 */
export function 归一情绪向量(向量: number[]): number[] {
  const 结果 = new Array<number>(8).fill(0);
  for (let i = 0; i < Math.min(8, 向量.length); i++) {
    const 值 = Number(向量[i]);
    结果[i] = Number.isFinite(值) ? Math.max(0, Math.min(1, 值)) : 0;
  }
  return 结果;
}

export class IndexTTS引擎 implements 语音引擎 {
  readonly name = "indextts";
  readonly 能力 = IndexTTS能力;

  private 配置() {
    return 取引擎配置(加载TTS配置(), this.name);
  }

  private 基址(): string {
    const 配置 = this.配置();
    const url = 配置?.url ?? process.env.KUGUA_TTS_INDEXTTS_URL;
    return typeof url === "string" ? url.replace(/\/+$/, "") : "";
  }

  private 音色表(): 音色[] {
    return this.配置()?.voices ?? [];
  }

  async 可用(): Promise<boolean> {
    if (this.配置()?.enabled === false) return false;
    return await 服务可达(this.基址(), 9882);
  }

  async 音色列表(): Promise<音色[]> {
    return this.音色表().map((v) => 解析音色路径(v));
  }

  private 找音色(id?: string): 音色 | undefined {
    const 表 = this.音色表();
    const 目标 = id ?? this.配置()?.defaultVoice;
    if (!目标) return 表[0];
    return 表.find((v) => v.id === 目标) ?? 表.find((v) => v.name === 目标);
  }

  async 合成(请求: 合成请求): Promise<合成结果> {
    const 基址 = this.基址();
    if (!基址) throw new Error("未配置 IndexTTS 服务地址（tts.engines.indextts.url）");

    const 音色 = this.找音色(请求.voice);
    const 解析后 = 音色 ? 解析音色路径(音色) : undefined;
    if (!解析后?.refAudio) {
      throw new Error(`IndexTTS 需要参考音频（音色 ${请求.voice ?? "默认"} 未配置 refAudio）`);
    }
    const 超时 = Number(this.配置()?.timeoutMs ?? 默认超时.quality);

    // 组装请求体：标准字段 + 情绪控制
    const 体: Record<string, unknown> = {
      text: 请求.text,
      ref_audio_path: 解析后.refAudio,
    };
    if (解析后.refText) 体.ref_text = 解析后.refText;
    // 不指定输出路径时服务端返回音频流；指定了则写文件
    if (typeof 请求.lang === "string") 体.lang = 请求.lang;

    // 时长倍率：IndexTTS 的 duration_factor 与「语速」相反，
    // 我们的 speed>1 表示更快，所以要取倒数
    if (typeof 请求.speed === "number" && 请求.speed > 0) {
      体.duration_factor = Number((1 / 请求.speed).toFixed(4));
    }
    if (typeof 请求.seed === "number") 体.seed = 请求.seed;
    if (typeof 请求.temperature === "number") 体.temperature = 请求.temperature;

    // ---- 情绪控制：五种方式按优先级依次映射 ----
    const 情绪 = 请求.emotion;
    if (情绪) {
      if (Array.isArray(情绪.vector) && 情绪.vector.length > 0) {
        体.emo_vector = 归一情绪向量(情绪.vector);
      }
      if (情绪.refAudio) {
        体.emo_ref_path = 情绪.refAudio;
        if (typeof 情绪.intensity === "number") {
          体.emo_alpha = Math.max(0, Math.min(1, 情绪.intensity));
        }
      } else if (情绪.text) {
        // 有文字描述但没参考音频：走 emo_text（独立控制剧本与情绪）
        体.emo_text = 情绪.text;
        体.use_emo_text = true;
        if (typeof 情绪.intensity === "number") {
          体.emo_alpha = Math.max(0, Math.min(1, 情绪.intensity));
        }
      }
    }

    const 响应 = await fetch(`${基址}/tts`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify(体),
      signal: AbortSignal.timeout(超时),
    });

    if (!响应.ok) {
      throw new Error(`IndexTTS 合成失败（${提取错误(响应.status, await 响应.text().catch(() => ""))}）`);
    }

    // 两种响应形态都要支持：
    //  a) 直接回音频流
    //  b) 回 JSON（含文件路径）
    const 类型 = 响应.headers.get("content-type") ?? "";
    if (类型.includes("application/json")) {
      const j = (await 响应.json()) as Record<string, unknown>;
      const 路径 = typeof j.audio_path === "string" ? j.audio_path : typeof j.filename === "string" ? j.filename : "";
      if (!路径) throw new Error("IndexTTS 响应 JSON 中缺少音频路径");
      if (!existsSync(路径)) throw new Error(`IndexTTS 声明的音频文件不存在：${路径}`);
      const 数据 = readFileSync(路径);
      // 服务端写在临时目录的文件顺手清掉，避免长期堆积
      if (路径.startsWith(tmpdir())) {
        try {
          rmSync(路径, { force: true });
        } catch {
          /* 清理失败不影响结果 */
        }
      }
      return { audio: 数据, format: "wav", engine: this.name, voice: 音色?.id };
    }

    const 音频 = Buffer.from(await 响应.arrayBuffer());
    if (音频.length < 44) throw new Error("IndexTTS 返回内容过短，合成可能失败");
    return { audio: 音频, format: "wav", engine: this.name, voice: 音色?.id };
  }
}

/** 生成一个临时输出路径（批处理时给服务端写文件用） */
export function 临时输出路径(后缀 = "wav"): string {
  return join(tmpdir(), `kugua-tts-${randomUUID()}.${后缀}`);
}
