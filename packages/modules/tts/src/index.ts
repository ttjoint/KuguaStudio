/**
 * 语音合成模块（M6）
 *
 * 引擎无关的语音合成抽象：
 *  - 分层调度：`fast`（低占用/低延迟，实时对话）→ `quality`（高质量/可调情绪，有声书批处理）→ `fallback`（纯 CPU 兜底）
 *  - 内置引擎：voxcpm / indextts / gptSovits / sherpa / sapi
 *  - 音色统一为 `音色` 结构，零样本（参考音频）与微调（权重对）两类共用
 *
 * 配置见 `kugua.config.json` 的 `tts` 节；换引擎不需要改上层代码。
 * 详细设计见 docs/语音合成设计.md。
 */

import { 启动模块 } from "@kugua/module-kit";
import { 能力清单, 注册TTS处理器 } from "./handlers.js";
import { 登记内置引擎 } from "./engines/index.js";
import { 加载TTS配置 } from "./config.js";

/** 描述当前配置，供启动日志用 */
async function 当前情况(): Promise<string> {
  const 配置 = 加载TTS配置();
  const 已配 = Object.entries(配置.engines ?? {})
    .filter(([, v]) => v?.enabled !== false)
    .map(([k]) => k);
  if (已配.length === 0) return "未配置任何引擎（仅 SAPI 兜底可用）";
  return `已配置 ${已配.join(" / ")}，默认 ${配置.defaultEngine ?? "自动"}`;
}

void 启动模块({
  name: "tts",
  version: "0.7.0",
  能力: 能力清单,
  注册: (客户端) => {
    登记内置引擎();
    注册TTS处理器(客户端);
  },
  就绪: async (_客户端, _配置, 连接) => {
    console.log(`[TTS] 已接入主控：${连接.url}（${await 当前情况()}）`);
  },
});
