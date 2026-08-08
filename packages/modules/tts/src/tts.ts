/**
 * 语音合成：多提供方（sherpa-onnx 离线 / ChatTTS HTTP / Windows SAPI），输出 base64 WAV。
 */

import { execFile } from "node:child_process";
import { existsSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";

export interface TTS结果 {
  base64: string;
  format: string;
  provider: string;
}

export interface TTS选项 {
  text: string;
  provider?: string;
  voice?: string;
  /** 语速（sherpa 忽略；SAPI 映射到 Rate -10..10） */
  speed?: number;
  /** sherpa-onnx 说话人 ID */
  sid?: number;
}

/** sherpa-onnx 根目录（参考项目同路径，可被环境变量覆盖） */
export const 默认Sherpa根 = resolve("D:\\Downloads\\sherpa-onnx-v1.12.14-win-x64-cuda");

/** 自动选择提供方：sherpa-onnx 可用则优先，其次 ChatTTS，最后 SAPI */
export function 解析提供方(provider?: string): string {
  if (provider) return provider;
  if (existsSync(join(默认Sherpa根, "bin", "sherpa-onnx-offline-tts.exe"))) return "sherpa-onnx";
  if (process.env.KUGUA_TTS_URL) return "chattts-http";
  return "windows-sapi";
}

export async function 合成语音(选项: TTS选项): Promise<TTS结果> {
  const 提供方 = 解析提供方(选项.provider);
  switch (提供方) {
    case "sherpa-onnx":
      return await 合成Sherpa(选项);
    case "chattts-http":
      return await 合成ChatTTS(选项);
    case "windows-sapi":
      return await 合成SAPI(选项);
    default:
      throw new Error(`未知 TTS 提供方：${提供方}`);
  }
}

/** sherpa-onnx 离线 TTS（复刻参考项目 SherpaOnnxTTS 命令行） */
function 合成Sherpa(选项: TTS选项): Promise<TTS结果> {
  return new Promise((resolvePromise, reject) => {
    const 根 = process.env.KUGUA_TTS_SHERP_ROOT ?? 默认Sherpa根;
    const 模型名 = process.env.KUGUA_TTS_MODEL ?? "vits-zh-hf-eula";
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
          // ignore
        }
      }
    });
  });
}

/** ChatTTS 本地 UI HTTP 服务（复刻参考项目 AITalkSingle 的协议） */
async function 合成ChatTTS(选项: TTS选项): Promise<TTS结果> {
  const url = process.env.KUGUA_TTS_URL ?? "http://127.0.0.1:9966";
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
  const 数据 = (await 响应.json()) as { code?: number; audio_files?: Array<{ filename?: string; url?: string }> };
  const 文件 = 数据.audio_files?.[0];
  if (!文件) throw new Error("ChatTTS 响应缺少 audio_files");

  let 音频: Buffer;
  if (typeof 文件.filename === "string" && existsSync(文件.filename)) {
    音频 = readFileSync(文件.filename);
  } else if (typeof 文件.url === "string" && 文件.url) {
    const 下载 = await fetch(文件.url, { signal: AbortSignal.timeout(60000) });
    if (!下载.ok) throw new Error(`下载音频失败 ${下载.status}`);
    音频 = Buffer.from(await 下载.arrayBuffer());
  } else {
    throw new Error("ChatTTS 响应缺少可用音频路径");
  }
  return { base64: 音频.toString("base64"), format: "wav", provider: "chattts-http" };
}

/** Windows SAPI（系统需已安装语音包）；文本经临时文件传递避免引号转义问题 */
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
          reject(
            new Error(
              `Windows SAPI 合成失败（请确认系统已安装语音包）：${err instanceof Error ? err.message : String(err)}`,
            ),
          );
          return;
        }
        resolvePromise({ base64: readFileSync(输出).toString("base64"), format: "wav", provider: "windows-sapi" });
      } finally {
        try {
          rmSync(临时, { recursive: true, force: true });
        } catch {
          // ignore
        }
      }
    });
  });
}
