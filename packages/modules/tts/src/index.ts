/**
 * 语音合成模块
 *
 * 主提供方 GPT-SoVITS（本地 HTTP，文本→wav，用于配音）；回退 sherpa-onnx / ChatTTS / SAPI。
 * 配置见 kugua.config.json 的 `tts` 节（亦可用环境变量）。
 * 启动样板（读配置 / 连主控 / 处理退出）已收敛到 @kugua/module-kit。
 */

import { 启动模块 } from "@kugua/module-kit";
import { 能力清单, 注册TTS处理器 } from "./handlers.js";
import { 加载TTS配置, 解析提供方 } from "./tts.js";

void 启动模块({
  name: "tts",
  version: "0.2.0",
  能力: 能力清单,
  注册: (客户端) => {
    注册TTS处理器(客户端);
  },
  就绪: (_客户端, _配置, 连接) => {
    const 配置 = 加载TTS配置();
    console.log(`[TTS] 已接入主控：${连接.url}（提供方：${解析提供方(配置)}）`);
  },
});
