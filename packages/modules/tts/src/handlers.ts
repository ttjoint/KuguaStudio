/**
 * TTS 模块的苦音处理器：tts.speak 合成、tts.status 状态。
 */

import { existsSync } from "node:fs";
import { join } from "node:path";
import type { NiganeClient } from "@kugua/nigane";
import { 解析提供方, 合成语音, 默认Sherpa根 } from "./tts.js";

export function 注册TTS处理器(客户端: NiganeClient): void {
  客户端.onRequest("tts.speak", (参数) => {
    const p = (参数 ?? {}) as {
      text?: string;
      provider?: string;
      voice?: string;
      speed?: number;
      sid?: number;
    };
    if (typeof p.text !== "string" || !p.text.trim()) throw new Error("缺少 text");
    return 合成语音({ text: p.text.trim(), provider: p.provider, voice: p.voice, speed: p.speed, sid: p.sid });
  });

  客户端.onRequest("tts.status", () => {
    const 提供方 = 解析提供方();
    return {
      module: "tts",
      provider: 提供方,
      sherpaAvailable: existsSync(join(默认Sherpa根, "bin", "sherpa-onnx-offline-tts.exe")),
      sherpaRoot: 默认Sherpa根,
      chatttsUrl: process.env.KUGUA_TTS_URL ?? null,
    };
  });
}
