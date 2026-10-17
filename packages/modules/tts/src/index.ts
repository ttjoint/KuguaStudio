/**
 * 语音合成模块（M6）
 *
 * 引擎无关的语音合成抽象：
 *  - 分层调度：`fast`（低占用/低延迟，实时对话）→ `quality`（高质量/可调情绪，有声书批处理）→ `fallback`（纯 CPU 兜底）
 *  - 内置引擎：voxcpm / indextts / gptSovits / sherpa / sapi
 *  - 音色统一为 `音色` 结构，零样本（参考音频）与微调（权重对）两类共用
 *
 * 配置见 `kugua.config.json` 的 `tts` 节；换引擎不需要改上层代码。
 * 配置声明上报给平台后，平台会自动渲染配置页；用户在 UI 改配置时
 * 平台推送 `module.config`，此处清缓存即可热重载。
 *
 * 详细设计见 docs/语音合成设计.md。
 */

import { 启动模块 } from "@kugua/module-kit";
import { 能力清单, 注册TTS处理器 } from "./handlers.js";
import { 登记内置引擎 } from "./engines/index.js";
import { 加载TTS配置, 清空配置缓存 } from "./config.js";
import { TTS配置声明 } from "./declaration.js";

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
  version: "0.8.0",
  能力: 能力清单,
  配置声明: TTS配置声明,
  注册: (客户端) => {
    登记内置引擎();
    注册TTS处理器(客户端);
  },
  /**
   * 热重载：平台推送新配置后清掉缓存，下次合成立即用新配置。
   *
   * 不用重启进程——引擎都是按需 HTTP 探活，没有长连接需要重建。
   * sherpa 的根目录/模型名变更例外，已在声明里标 `生效: 重启模块`。
   */
  配置变更: (载荷) => {
    清空配置缓存();
    const 变更 = 载荷.变更.length > 0 ? 载荷.变更.join("、") : "全量";
    console.log(`[TTS] 配置已更新（来源：${载荷.来源}，变更：${变更}）`);
  },
  就绪: async (_客户端, _配置, 连接) => {
    console.log(`[TTS] 已接入主控：${连接.url}（${await 当前情况()}）`);
  },
});
