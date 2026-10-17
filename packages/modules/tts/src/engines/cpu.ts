/**
 * 纯 CPU 兜底引擎（不占显存）
 *
 * 两种实现合一，因为它们定位相同：**显存被占满时仍要能出声**。
 *
 *  - `sherpa`：sherpa-onnx 本地 exe，纯 CPU（也可用 CUDA），支持多说话人模型
 *  - `sapi`：Windows 系统 TTS，零依赖，永远可用
 *
 * 分层标为 `fallback`，只在 fast / quality 都不可用时才被选中。
 *
 * sherpa 参数要点（`sherpa-onnx-offline-tts.exe`）：
 *  - `--vits-model` / `--vits-tokens` / `--vits-lexicon` / `--vits-dict-dir`  模型四件套
 *  - `--sid`            多说话人模型的说话人编号（aishell3 有 174 个）
 *  - `--vits-length-scale`  语速，**越大越慢**（与我们 speed>1 更快相反，需取倒数）
 *  - `--output-filename`    固定输出 wav 到文件
 */

import { execFile } from "node:child_process";
import { existsSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import type { 引擎能力, 音色, 合成请求, 合成结果, 语音引擎 } from "../types.js";
import { 取引擎配置, 解析音色路径, 加载TTS配置 } from "../config.js";
import { 默认超时 } from "./http-base.js";

export const Sherpa能力: 引擎能力 = {
  tier: "fallback",
  formats: ["wav"],
  zeroShot: false,
  finetune: false,
  emotion: { text: false, refAudio: false, vector: false },
  streaming: false,
  batch: false,
  vramGb: 0,
};

export const Sapi能力: 引擎能力 = {
  tier: "fallback",
  formats: ["wav"],
  zeroShot: false,
  finetune: false,
  emotion: { text: false, refAudio: false, vector: false },
  streaming: false,
  batch: false,
  vramGb: 0,
};

/** 项目里记录的 sherpa 默认安装位置（用户机器上的历史路径） */
export const 默认Sherpa根 = "D:\\Downloads\\sherpa-onnx-v1.12.14-win-x64-cuda";

export class Sherpa引擎 implements 语音引擎 {
  readonly name = "sherpa";
  readonly 能力 = Sherpa能力;

  private 配置() {
    return 取引擎配置(加载TTS配置(), this.name);
  }

  private 根(): string {
    const 配置 = this.配置();
    const root = 配置?.root ?? process.env.KUGUA_TTS_SHERPA_ROOT ?? 默认Sherpa根;
    return String(root);
  }

  private 可执行文件(): string {
    return join(this.根(), "bin", "sherpa-onnx-offline-tts.exe");
  }

  private 模型名(): string {
    return String(this.配置()?.model ?? process.env.KUGUA_TTS_MODEL ?? "vits-zh-hf-eula");
  }

  async 可用(): Promise<boolean> {
    if (this.配置()?.enabled === false) return false;
    return existsSync(this.可执行文件());
  }

  async 音色列表(): Promise<音色[]> {
    const 表 = this.配置()?.voices ?? [];
    // 没配音色表时，把模型本身当成一个音色（绝大多数模型是单说话人）
    return 表.length > 0 ? 表.map((v) => 解析音色路径(v)) : [{ id: this.模型名(), name: this.模型名() }];
  }

  private 找音色(id?: string): 音色 | undefined {
    const 表 = this.配置()?.voices ?? [];
    const 目标 = id ?? this.配置()?.defaultVoice;
    if (!目标) return 表[0];
    return 表.find((v) => v.id === 目标) ?? 表.find((v) => v.name === 目标);
  }

  async 合成(请求: 合成请求): Promise<合成结果> {
    const exe = this.可执行文件();
    if (!existsSync(exe)) throw new Error(`未找到 sherpa-onnx 可执行文件：${exe}`);

    const 根 = this.根();
    const 模型 = join(根, this.模型名());
    const 音色 = this.找音色(请求.voice);
    const 临时 = mkdtempSync(join(tmpdir(), "kugua-tts-"));
    const 输出 = join(临时, "out.wav");

    // 语速换算：sherpa 的 length-scale 越大越慢，与 speed 相反
    const 语速 = typeof 请求.speed === "number" && 请求.speed > 0 ? 1 / 请求.speed : 1;

    const 参数 = [
      `--vits-model=${join(模型, "model.onnx")}`,
      `--vits-tokens=${join(模型, "tokens.txt")}`,
      `--vits-lexicon=${join(模型, "lexicon.txt")}`,
      `--vits-dict-dir=${join(模型, "dict")}`,
      `--vits-length-scale=${语速.toFixed(4)}`,
      `--sid=${音色?.speakerId ?? 0}`,
      `--output-filename=${输出}`,
      请求.text,
    ];

    const 超时 = Number(this.配置()?.timeoutMs ?? 默认超时.fallback);
    await new Promise<void>((resolve, reject) => {
      execFile(exe, 参数, { timeout: 超时, windowsHide: true, maxBuffer: 64 * 1024 * 1024 }, (err) => {
        if (err || !existsSync(输出)) {
          reject(new Error(`sherpa 合成失败：${err instanceof Error ? err.message : String(err)}`));
          return;
        }
        resolve();
      });
    });

    try {
      const 音频 = readFileSync(输出);
      return { audio: 音频, format: "wav", engine: this.name, voice: 音色?.id };
    } finally {
      try {
        rmSync(临时, { recursive: true, force: true });
      } catch {
        /* 清理失败不影响结果 */
      }
    }
  }
}

export class Sapi引擎 implements 语音引擎 {
  readonly name = "sapi";
  readonly 能力 = Sapi能力;

  private 配置() {
    return 取引擎配置(加载TTS配置(), this.name);
  }

  async 可用(): Promise<boolean> {
    if (process.platform !== "win32") return false;
    return this.配置()?.enabled !== false;
  }

  async 音色列表(): Promise<音色[]> {
    // SAPI 的音色是系统语音包名字，配置里不写就用系统默认
    return (this.配置()?.voices ?? []).map((v) => ({ id: v.id, name: v.name ?? v.id }));
  }

  async 合成(请求: 合成请求): Promise<合成结果> {
    const 临时 = mkdtempSync(join(tmpdir(), "kugua-tts-"));
    const 文本文件 = join(临时, "text.txt");
    const 输出 = join(临时, "out.wav");
    writeFileSync(文本文件, 请求.text, "utf-8");

    // SAPI 的 Rate 是 -10~10 的整数档位，与倍率非线性的，这里做近似换算
    const 倍率 = 请求.speed ?? 1;
    const 语速 = Math.max(-10, Math.min(10, Math.round((倍率 - 1) * 10)));
    // 语音包名里可能有单引号，PowerShell 里需转义成两个单引号
    const 选声 = 请求.voice ? `try { $s.SelectVoice('${请求.voice.replace(/'/g, "''")}') } catch {}; ` : "";

    const 命令 = [
      "-NoProfile",
      "-NonInteractive",
      "-Command",
      `Add-Type -AssemblyName System.Speech; $ErrorActionPreference='Stop'; ` +
        `$t = Get-Content -Raw -Encoding UTF8 '${文本文件}'; ` +
        `$s = New-Object System.Speech.Synthesis.SpeechSynthesizer; $s.Rate = ${语速}; ${选声}` +
        `$s.SetOutputToWaveFile('${输出}'); $s.Speak($t); $s.Dispose();`,
    ];

    const 超时 = Number(this.配置()?.timeoutMs ?? 默认超时.fallback);
    await new Promise<void>((resolve, reject) => {
      execFile("powershell", 命令, { timeout: 超时, windowsHide: true }, (err) => {
        if (err || !existsSync(输出)) {
          reject(new Error(`Windows SAPI 合成失败（请确认系统已安装语音包）：${err instanceof Error ? err.message : String(err)}`));
          return;
        }
        resolve();
      });
    });

    try {
      const 音频 = readFileSync(输出);
      return { audio: 音频, format: "wav", engine: this.name, voice: 请求.voice };
    } finally {
      try {
        rmSync(临时, { recursive: true, force: true });
      } catch {
        /* 清理失败不影响结果 */
      }
    }
  }
}
