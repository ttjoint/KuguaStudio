/**
 * TTS 处理器：tts.speak 合成、tts.status 状态。
 */

import { existsSync, mkdirSync, writeFileSync } from "node:fs";
import { dirname } from "node:path";
import type { NiganeClient } from "@kugua/nigane";
import type { 能力声明 } from "@kugua/capability";
import { 加载TTS配置, 合成语音, 解析提供方, 提供方可用 } from "./tts.js";

export const 能力清单: 能力声明[] = [
  {
    名称: "tts.speak",
    模块: "tts",
    标题: "语音合成",
    说明: "文本→wav（默认 GPT-SoVITS；可指定音色/提供方/输出路径）",
    中文指令: ["说话", "语音合成"],
    参数: {
      type: "object",
      properties: {
        text: { type: "string", description: "要合成的文本" },
        provider: { type: "string", description: "gpt-sovits / sherpa-onnx / chattts-http / windows-sapi" },
        voice: { type: "string", description: "GPT-SoVITS 音色名" },
        speed: { type: "number" },
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
    说明: "当前提供方与可用性",
    参数: { type: "object", properties: {} },
    暴露: { 指令: false, GUI: true, 定时: false, MCP: true },
  },
];

export function 注册TTS处理器(客户端: NiganeClient): 能力声明[] {
  客户端.onRequest("tts.speak", async (参数) => {
    const p = (参数 ?? {}) as {
      text?: string;
      文本?: string;
      provider?: string;
      voice?: string;
      音色?: string;
      speed?: number;
      sid?: number;
      输出路径?: string;
      参数文本?: string;
      原文?: string;
    };
    const text = (p.text ?? p.文本 ?? p.参数文本 ?? p.原文 ?? "").trim();
    if (!text) throw new Error("缺少文本");
    const 配置 = 加载TTS配置();
    let 结果;
    try {
      结果 = await 合成语音(配置, {
        text,
        provider: p.provider,
        voice: p.voice ?? p.音色,
        speed: p.speed,
        sid: p.sid,
      });
    } catch (err) {
      throw new Error(err instanceof Error ? err.message : String(err));
    }
    if (p.输出路径) {
      mkdirSync(dirname(p.输出路径), { recursive: true });
      writeFileSync(p.输出路径, Buffer.from(结果.base64, "base64"));
      return { 输出路径: p.输出路径, format: 结果.format, provider: 结果.provider };
    }
    return 结果;
  });

  客户端.onRequest("tts.status", () => {
    const 配置 = 加载TTS配置();
    return {
      module: "tts",
      provider: 解析提供方(配置),
      gptSovitsUrl: 配置.gptSovits?.url ?? null,
      voices: (配置.gptSovits?.voices ?? []).map((v) => v.name),
      sherpaAvailable: 提供方可用(配置, "sherpa-onnx"),
      chatttsUrl: 配置.chatttsUrl ?? process.env.KUGUA_TTS_URL ?? null,
    };
  });

  return 能力清单;
}

// 保留 existsSync 导入以备扩展（音色文件校验等）
void existsSync;
