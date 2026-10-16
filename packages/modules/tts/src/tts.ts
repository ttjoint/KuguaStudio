/**
 * 语音合成
 *
 * 主提供方：**GPT-SoVITS**（本地 HTTP API，文本 → wav，非实时，用于配音）。
 * 回退：sherpa-onnx 离线 / ChatTTS HTTP / Windows SAPI。
 *
 * 配置见 `kugua.config.json` 的 `tts` 节；亦可用环境变量覆盖。
 */

import { execFile } from "node:child_process";
import { existsSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { resolve } from "node:path";
import { join } from "node:path";

export interface TTS结果 {
  base64: string;
  format: string;
  provider: string;
}

export interface TTS选项 {
  text: string;
  provider?: string;
  voice?: string;
  speed?: number;
  sid?: number;
}

export interface GPTSoVits音色 {
  name: string;
  refAudioPath: string;
  promptText?: string;
  promptLang?: string;
  textLang?: string;
}

export interface TTS配置 {
  provider?: string;
  gptSovits?: { url?: string; voices?: GPTSoVits音色[] };
  sherpaRoot?: string;
  sherpaModel?: string;
  chatttsUrl?: string;
}

import { readFileSync as 读配置 } from "node:fs";

export function 加载TTS配置(): TTS配置 {
  if (process.env.KUGUA_TTS_GPT_SOVITS_URL) {
    return { provider: process.env.KUGUA_TTS_PROVIDER ?? "gpt-sovits", gptSovits: { url: process.env.KUGUA_TTS_GPT_SOVITS_URL } };
  }
  const 路径 = resolve(process.cwd(), "kugua.config.json");
  if (!existsSync(路径)) return {};
  try {
    const j = JSON.parse(读配置(路径, "utf-8")) as { tts?: TTS配置 };
    return j.tts ?? {};
  } catch {
    return {};
  }
}

export const 默认Sherpa根 = resolve(process.env.KUGUA_TTS_SHERP_ROOT ?? "D:\\Downloads\\sherpa-onnx-v1.12.14-win-x64-cuda");

/** 判断某提供方是否可用 */
export function 提供方可用(配置: TTS配置, provider: string): boolean {
  switch (provider) {
    case "gpt-sovits":
      return Boolean(配置.gptSovits?.url);
    case "sherpa-onnx":
      return existsSync(join(配置.sherpaRoot ?? 默认Sherpa根, "bin", "sherpa-onnx-offline-tts.exe"));
    case "chattts-http":
      return Boolean(配置.chatttsUrl ?? process.env.KUGUA_TTS_URL);
    case "windows-sapi":
      return process.platform === "win32";
    default:
      return false;
  }
}

/** 解析提供方：显式 → 配置 → 自动（gpt-sovits → sherpa → chattts → sapi） */
export function 解析提供方(配置: TTS配置, provider?: string): string {
  if (provider) return provider;
  if (配置.provider) return 配置.provider;
  for (const p of ["gpt-sovits", "sherpa-onnx", "chattts-http", "windows-sapi"]) {
    if (提供方可用(配置, p)) return p;
  }
  return "windows-sapi";
}

export async function 合成语音(配置: TTS配置, 选项: TTS选项): Promise<TTS结果> {
  const 提供方 = 解析提供方(配置, 选项.provider);
  switch (提供方) {
    case "gpt-sovits":
      return await 合成GptSoVits(配置, 选项);
    case "sherpa-onnx":
      return await 合成Sherpa(配置, 选项);
    case "chattts-http":
      return await 合成ChatTTS(配置, 选项);
    case "windows-sapi":
      return await 合成SAPI(选项);
    default:
      throw new Error(`未知 TTS 提供方：${提供方}`);
  }
}

function 取音色(配置: TTS配置, 名称?: string): GPTSoVits音色 {
  const 列表 = 配置.gptSovits?.voices ?? [];
  if (列表.length === 0) {
    throw new Error("未配置 GPT-SoVITS 音色（kugua.config.json 的 tts.gptSovits.voices）");
  }
  if (!名称) return 列表[0];
  const 命中 = 列表.find((v) => v.name === 名称);
  if (!命中) throw new Error(`未知音色：${名称}（可用：${列表.map((v) => v.name).join(", ")}）`);
  return 命中;
}

/** GPT-SoVITS HTTP API（api_v2 的 /tts） */
async function 合成GptSoVits(配置: TTS配置, 选项: TTS选项): Promise<TTS结果> {
  const 基址 = (配置.gptSovits?.url ?? "").replace(/\/+$/, "");
  if (!基址) throw new Error("未配置 GPT-SoVITS 服务地址（tts.gptSovits.url）");
  const 音色 = 取音色(配置, 选项.voice);
  const u = new URL(`${基址}/tts`);
  u.searchParams.set("text", 选项.text);
  u.searchParams.set("text_lang", 音色.textLang ?? "zh");
  u.searchParams.set("ref_audio_path", 音色.refAudioPath);
  u.searchParams.set("prompt_text", 音色.promptText ?? "");
  u.searchParams.set("prompt_lang", 音色.promptLang ?? "zh");
  u.searchParams.set("text_split_method", "cut5");
  u.searchParams.set("batch_size", "1");
  u.searchParams.set("media_type", "wav");
  u.searchParams.set("streaming_mode", "false");
  const 响应 = await fetch(u, { signal: AbortSignal.timeout(300000) });
  if (!响应.ok) throw new Error(`GPT-SoVITS 接口返回 ${响应.status}：${(await 响应.text()).slice(0, 200)}`);
  const buf = Buffer.from(await 响应.arrayBuffer());
  if (buf.length < 44) throw new Error("GPT-SoVITS 返回内容过短，合成可能失败");
  return { base64: buf.toString("base64"), format: "wav", provider: "gpt-sovits" };
}

/** sherpa-onnx 离线 TTS（保留回退） */
function 合成Sherpa(配置: TTS配置, 选项: TTS选项): Promise<TTS结果> {
  return new Promise((resolvePromise, reject) => {
    const 根 = 配置.sherpaRoot ?? 默认Sherpa根;
    const 模型名 = 配置.sherpaModel ?? process.env.KUGUA_TTS_MODEL ?? "vits-zh-hf-eula";
    const exe = join(根, "bin", "sherpa-onnx-offline-tts.exe");
    const 模型 = join(根, 模型名);
    const 临时 = mkdtempSync(join(tmpdir(), "kugua-tts-"));
    const 输出 = join(临时, "out.wav");
    const args = [
      `--vits-model=${join(模型, "model.onnx")}`,
      `--vits-lexicon=${join(模型, "lexicon.txt")}`,
      `--vits-tokens=${join(模型, "tokens.txt")}`,
      `--vits-dict-dir=${join(模型, "dict")}`,
      `--sid=${选项.sid ?? 0}`,
      `--output-filename=${输出}`,
      选项.text,
    ];
    execFile(exe, args, { timeout: 60000, windowsHide: true, maxBuffer: 64 * 1024 * 1024 }, (err) => {
      try {
        if (err || !existsSync(输出)) {
          reject(new Error(`Sherpa TTS 合成失败：${err instanceof Error ? err.message : String(err)}`));
          return;
        }
        resolvePromise({ base64: readFileSync(输出).toString("base64"), format: "wav", provider: "sherpa-onnx" });
      } finally {
        try {
          rmSync(临时, { recursive: true, force: true });
        } catch {
          /* ignore */
        }
      }
    });
  });
}

/** ChatTTS 本地 HTTP 服务（保留回退） */
async function 合成ChatTTS(配置: TTS配置, 选项: TTS选项): Promise<TTS结果> {
  const url = 配置.chatttsUrl ?? process.env.KUGUA_TTS_URL ?? "http://127.0.0.1:9966";
  const 参数 = new URLSearchParams();
  参数.set("text", 选项.text);
  参数.set("prompt", 选项.text.length < 10 ? "[oral_0][laugh_0][break_0]" : "[oral_3][laugh_5][break_5]");
  参数.set("voice", 选项.voice ?? "seed_1694_restored_emb-covert.pt");
  参数.set("speed", String(选项.speed ?? 1));
  参数.set("temperature", "0.01");
  参数.set("top_p", "0.07");
  参数.set("top_k", "15");
  参数.set("refine_max_new_token", "384");
  参数.set("infer_max_new_token", "2048");
  参数.set("text_seed", String(40 + Math.floor(Math.random() * 10)));
  参数.set("skip_refine", "1");
  参数.set("is_stream", "0");
  参数.set("custom_voice", "0");
  const 响应 = await fetch(url, { method: "POST", body: 参数, signal: AbortSignal.timeout(120000) });
  if (!响应.ok) throw new Error(`ChatTTS 接口返回 ${响应.status}`);
  const 数据 = (await 响应.json()) as { audio_files?: Array<{ filename?: string; url?: string }> };
  const 文件 = 数据.audio_files?.[0];
  if (!文件) throw new Error("ChatTTS 响应缺少 audio_files");
  if (typeof 文件.filename === "string" && existsSync(文件.filename)) {
    return { base64: readFileSync(文件.filename).toString("base64"), format: "wav", provider: "chattts-http" };
  }
  if (typeof 文件.url === "string" && 文件.url) {
    const 下载 = await fetch(文件.url, { signal: AbortSignal.timeout(60000) });
    if (!下载.ok) throw new Error(`下载音频失败 ${下载.status}`);
    return { base64: Buffer.from(await 下载.arrayBuffer()).toString("base64"), format: "wav", provider: "chattts-http" };
  }
  throw new Error("ChatTTS 响应缺少可用音频路径");
}

/** Windows SAPI（保留回退） */
function 合成SAPI(选项: TTS选项): Promise<TTS结果> {
  return new Promise((resolvePromise, reject) => {
    const 临时 = mkdtempSync(join(tmpdir(), "kugua-tts-"));
    const 文本文件 = join(临时, "text.txt");
    const 输出 = join(临时, "out.wav");
    try {
      writeFileSync(文本文件, 选项.text, "utf-8");
    } catch (err) {
      reject(err);
      return;
    }
    const 语速 = Math.max(-10, Math.min(10, Math.round(((选项.speed ?? 1) - 1) * 10)));
    const 选声 = 选项.voice ? `try { $s.SelectVoice('${选项.voice.replace(/'/g, "''")}') } catch {}; ` : "";
    const 命令 = [
      "-NoProfile",
      "-NonInteractive",
      "-Command",
      `Add-Type -AssemblyName System.Speech; $ErrorActionPreference='Stop'; $t = Get-Content -Raw -Encoding UTF8 '${文本文件}'; $s = New-Object System.Speech.Synthesis.SpeechSynthesizer; $s.Rate = ${语速}; ${选声}$s.SetOutputToWaveFile('${输出}'); $s.Speak($t); $s.Dispose();`,
    ];
    execFile("powershell", 命令, { timeout: 60000, windowsHide: true }, (err) => {
      try {
        if (err || !existsSync(输出)) {
          reject(new Error(`Windows SAPI 合成失败（请确认系统已安装语音包）：${err instanceof Error ? err.message : String(err)}`));
          return;
        }
        resolvePromise({ base64: readFileSync(输出).toString("base64"), format: "wav", provider: "windows-sapi" });
      } finally {
        try {
          rmSync(临时, { recursive: true, force: true });
        } catch {
          /* ignore */
        }
      }
    });
  });
}
