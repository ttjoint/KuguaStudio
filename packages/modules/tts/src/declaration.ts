/**
 * TTS 模块的配置声明。
 *
 * 平台读取这份声明后自动渲染配置页，模块不需要写任何前端代码。
 * 字段键用点号表达嵌套，对应 `kugua.config.json` 里 `tts` 节的结构。
 */

import type { 配置声明 } from "@kugua/nigane";

/** 引擎名 → 中文标题，用于 select 选项展示 */
const 引擎选项 = [
  { 值: "voxcpm", 标题: "VoxCPM1.5（快速，实时对话）" },
  { 值: "indextts", 标题: "IndexTTS-2.5（高质量，可调情绪）" },
  { 值: "gptSovits", 标题: "GPT-SoVITS（微调音色）" },
  { 值: "sherpa", 标题: "sherpa-onnx（CPU 兜底）" },
  { 值: "sapi", 标题: "Windows SAPI（系统语音）" },
];

export const TTS配置声明: 配置声明 = {
  说明:
    "语音合成引擎配置。fast 层用于实时对话，quality 层用于有声书等高质量场景，" +
    "fallback 层在其它引擎不可用时兜底（纯 CPU，不占显存）。",
  字段: [
    {
      键: "defaultEngine",
      标题: "默认引擎",
      类型: "select",
      选项: 引擎选项,
      说明: "留空则按 fast → quality → fallback 顺序自动选择第一个可用引擎。",
      提示: "自动选择",
      生效: "立即",
    },

    // —— VoxCPM（fast 层）——
    {
      键: "engines.voxcpm.enabled",
      标题: "启用 VoxCPM",
      类型: "boolean",
      默认值: false,
      说明: "0.6B 模型，约 6GB 显存，RTF≈0.15，44.1kHz。适合实时对话。",
    },
    {
      键: "engines.voxcpm.url",
      标题: "VoxCPM 服务地址",
      类型: "string",
      提示: "http://127.0.0.1:9881",
      说明: "VoxCPM 服务端地址。需先自行部署服务（见 docs/语音合成设计.md）。",
    },
    {
      键: "engines.voxcpm.defaultVoice",
      标题: "VoxCPM 默认音色",
      类型: "string",
      提示: "narrator",
    },
    {
      键: "engines.voxcpm.apiKey",
      标题: "VoxCPM 访问密钥",
      类型: "secret",
      凭据: true,
      说明: "可选。留空表示服务端未启用鉴权。此字段保存在 kugua.config.local.json。",
    },

    // —— IndexTTS（quality 层）——
    {
      键: "engines.indextts.enabled",
      标题: "启用 IndexTTS",
      类型: "boolean",
      默认值: false,
      说明: "1.5B 模型，支持 5 种情绪控制与时长控制。适合有声书批处理。",
    },
    {
      键: "engines.indextts.url",
      标题: "IndexTTS 服务地址",
      类型: "string",
      提示: "http://127.0.0.1:9882",
    },
    {
      键: "engines.indextts.defaultVoice",
      标题: "IndexTTS 默认音色",
      类型: "string",
      提示: "hero",
    },
    {
      键: "engines.indextts.apiKey",
      标题: "IndexTTS 访问密钥",
      类型: "secret",
      凭据: true,
      说明: "可选。此字段保存在 kugua.config.local.json。",
    },

    // —— GPT-SoVITS（微调音色）——
    {
      键: "engines.gptSovits.enabled",
      标题: "启用 GPT-SoVITS",
      类型: "boolean",
      默认值: false,
      说明: "需要已微调的权重。适合已有训练音色的场景。",
    },
    {
      键: "engines.gptSovits.url",
      标题: "GPT-SoVITS 服务地址",
      类型: "string",
      提示: "http://127.0.0.1:9880",
    },

    // —— 兜底引擎 ——
    {
      键: "engines.sherpa.enabled",
      标题: "启用 sherpa-onnx 兜底",
      类型: "boolean",
      默认值: false,
      说明: "纯 CPU 推理，不占显存。需自行下载 sherpa-onnx 与模型。",
      生效: "重启模块",
    },
    {
      键: "engines.sherpa.root",
      标题: "sherpa-onnx 目录",
      类型: "path",
      提示: "D:\\Downloads\\sherpa-onnx-v1.13.8-win-x64",
    },
    {
      键: "engines.sherpa.model",
      标题: "sherpa 模型目录名",
      类型: "string",
      提示: "vits-zh-hf-eula",
      说明: "相对于 sherpa 根目录下的模型文件夹名。",
      生效: "重启模块",
    },
    {
      键: "engines.sapi.enabled",
      标题: "启用 Windows SAPI 兜底",
      类型: "boolean",
      默认值: true,
      说明: "使用系统自带语音。无需任何依赖，质量一般但永远可用。",
    },

    // —— 通用默认值 ——
    {
      键: "defaultFormat",
      标题: "默认输出格式",
      类型: "select",
      选项: ["mp3", "wav", "ogg", "aac"],
      默认值: "wav",
      说明: "引擎不支持所选格式时会自动回落到它支持的最好格式。",
    },
    {
      键: "defaultSpeed",
      标题: "默认语速",
      类型: "number",
      默认值: 1,
      最小: 0.5,
      最大: 2,
      步进: 0.1,
      说明: "1 为原速，大于 1 更快，小于 1 更慢。",
    },
  ],
};
