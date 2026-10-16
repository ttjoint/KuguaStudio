/**
 * ffmpeg / ffprobe 运行器
 *
 * 路径解析：KUGUA_FFMPEG → `D:\ffmpeg\bin\ffmpeg.exe` → PATH 上的 `ffmpeg`。
 * ffprobe 默认取 ffmpeg 同目录；可用 KUGUA_FFPROBE 覆盖。
 *
 * 该模块是全平台唯一的音视频处理入口：其他模块（如 music）应通过苦音调用 av.* 能力，而非自行调用 ffmpeg。
 */

import { spawn } from "node:child_process";
import { existsSync, mkdtempSync, readFileSync, rmSync, writeFileSync, readdirSync } from "node:fs";
import { tmpdir } from "node:os";
import { basename, dirname, join } from "node:path";

let 缓存FFmpeg: string | null = null;

export function ffmpeg路径(): string {
  if (缓存FFmpeg) return 缓存FFmpeg;
  const 候选 = [process.env.KUGUA_FFMPEG, "D:\\ffmpeg\\bin\\ffmpeg.exe", "ffmpeg"].filter(
    (x): x is string => Boolean(x),
  );
  for (const c of 候选) {
    if (c === "ffmpeg" || existsSync(c)) {
      缓存FFmpeg = c;
      return c;
    }
  }
  缓存FFmpeg = "ffmpeg";
  return 缓存FFmpeg;
}

export function ffprobe路径(): string {
  const 显式 = process.env.KUGUA_FFPROBE;
  if (显式 && existsSync(显式)) return 显式;
  const ff = ffmpeg路径();
  if (ff !== "ffmpeg") {
    for (const 名 of ["ffprobe.exe", "ffprobe"]) {
      const p = join(dirname(ff), 名);
      if (existsSync(p)) return p;
    }
  }
  return "ffprobe";
}

/** 运行子进程，返回退出码与 stderr */
export function 运行(
  命令: string,
  参数: string[],
): Promise<{ 码: number; 输出: string; 错误: string }> {
  return new Promise((resolve) => {
    const 进程 = spawn(命令, 参数, { windowsHide: true });
    let 输出 = "";
    let 错误 = "";
    进程.stdout.on("data", (b: Buffer) => (输出 += b.toString()));
    进程.stderr.on("data", (b: Buffer) => (错误 += b.toString()));
    进程.on("error", (err) => resolve({ 码: -1, 输出, 错误: err.message }));
    进程.on("close", (码) => resolve({ 码: 码 ?? -1, 输出, 错误 }));
  });
}

/** 运行 ffmpeg（-y 覆盖输出），失败抛错 */
export async function 运行FFmpeg(参数: string[]): Promise<void> {
  const r = await 运行(ffmpeg路径(), ["-hide_banner", "-y", ...参数]);
  if (r.码 !== 0) {
    throw new Error(`ffmpeg 失败(${r.码})：${r.错误.trim().split("\n").slice(-3).join(" | ")}`);
  }
}

/** 运行 ffprobe，返回 stdout */
export async function 运行FFprobe(参数: string[]): Promise<string> {
  const r = await 运行(ffprobe路径(), ["-hide_banner", ...参数]);
  if (r.码 !== 0) throw new Error(`ffprobe 失败(${r.码})：${r.错误.trim()}`);
  return r.输出;
}

/** 临时目录包裹（结束清理） */
export async function 用临时目录<T>(fn: (dir: string) => Promise<T>): Promise<T> {
  const dir = mkdtempSync(join(tmpdir(), "kugua-av-"));
  try {
    return await fn(dir);
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
}

/** 把输入（base64 或磁盘路径）落为临时文件，返回文件路径 */
export function 落盘输入(dir: string, 输入: { base64?: string; path?: string }, 默认名: string): string {
  const 名 = 输入.path ? basename(输入.path) : 默认名;
  const 文件 = join(dir, 名);
  if (输入.base64) {
    writeFileSync(文件, Buffer.from(输入.base64, "base64"));
  } else if (输入.path && existsSync(输入.path)) {
    writeFileSync(文件, readFileSync(输入.path));
  } else {
    throw new Error("缺少媒体输入（base64 或 path）");
  }
  return 文件;
}

/** 读取目录内匹配文件（按数字后缀排序） */
export function 列文件(dir: string, 前缀: string, 后缀: string): string[] {
  return readdirSync(dir)
    .filter((f) => f.startsWith(前缀) && f.endsWith(后缀))
    .sort((a, b) => {
      const na = parseInt(a.replace(/\D+/g, ""), 10);
      const nb = parseInt(b.replace(/\D+/g, ""), 10);
      return (Number.isNaN(na) ? 0 : na) - (Number.isNaN(nb) ? 0 : nb);
    })
    .map((f) => join(dir, f));
}

/** 读取媒体时长（秒），失败返回 0 */
export async function 取时长(文件: string): Promise<number> {
  try {
    const 出 = await 运行FFprobe([
      "-v",
      "error",
      "-show_entries",
      "format=duration",
      "-of",
      "default=noprint_wrappers=1:nokey=1",
      文件,
    ]);
    const n = parseFloat(出.trim());
    return Number.isFinite(n) ? n : 0;
  } catch {
    return 0;
  }
}
