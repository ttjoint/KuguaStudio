/**
 * ImageMagick CLI 运行器（忠实复刻 Magick.NET 的引擎）
 *
 * 定位 `magick`：优先环境变量 `KUGUA_MAGICK`，其次项目内便携版 `tools/imagemagick/magick.exe`，
 * 最后回退到 PATH 上的 `magick`。
 */

import { spawn } from "node:child_process";
import { existsSync, mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";

let 缓存路径: string | null = null;

/** 解析 magick 可执行文件路径 */
export function magick路径(): string {
  if (缓存路径) return 缓存路径;
  const 候选 = [
    process.env.KUGUA_MAGICK,
    resolve(process.cwd(), "tools", "imagemagick", "magick.exe"),
    resolve(process.cwd(), "tools", "imagemagick", "magick"),
    "magick",
  ].filter((x): x is string => Boolean(x));
  for (const c of 候选) {
    if (c === "magick" || existsSync(c)) {
      缓存路径 = c;
      return c;
    }
  }
  缓存路径 = "magick";
  return 缓存路径;
}

/** 运行 magick；可选输入经 stdin，返回 stdout 二进制 */
export function 运行Magick(参数: string[], 输入?: Buffer): Promise<Buffer> {
  return new Promise((resolveP, reject) => {
    const 进程 = spawn(magick路径(), 参数, { windowsHide: true });
    const 出: Buffer[] = [];
    const 错: Buffer[] = [];
    进程.stdout.on("data", (d: Buffer) => 出.push(d));
    进程.stderr.on("data", (d: Buffer) => 错.push(d));
    进程.on("error", reject);
    进程.on("close", (码) => {
      if (码 === 0) {
        resolveP(Buffer.concat(出));
      } else {
        reject(new Error(`magick 失败(${码})：${Buffer.concat(错).toString().slice(0, 400)}`));
      }
    });
    if (输入) 进程.stdin.write(输入);
    进程.stdin.end();
  });
}

/** 单图操作：输入经 stdin（`-`），输出到 stdout（默认 PNG） */
export function magick单图(输入: Buffer, 操作: string[], 输出格式 = "png"): Promise<Buffer> {
  return 运行Magick(["-", ...操作, `${输出格式}:-`], 输入);
}

/** 临时目录包裹（结束清理） */
export async function 用临时目录<T>(fn: (dir: string) => Promise<T>): Promise<T> {
  const dir = mkdtempSync(join(tmpdir(), "kugua-img-"));
  try {
    return await fn(dir);
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
}

/** 解码为原始 RGBA 像素（每像素 4 字节，8bit） */
export async function 取原始RGBA(buf: Buffer): Promise<{ data: Buffer; width: number; height: number }> {
  const { width, height } = 图片尺寸(buf);
  const data = await 运行Magick(["-", "-depth", "8", "rgba:-"], buf);
  return { data, width, height };
}

/** 从原始 RGBA 像素编码为 PNG */
export function 从原始RGBA(data: Buffer, width: number, height: number): Promise<Buffer> {
  return 运行Magick(
    ["-size", `${width}x${height}`, "-depth", "8", "rgba:-", "-type", "TrueColorAlpha", "png:-"],
    data,
  );
}

/** 转为 JPEG（指定质量 1-100） */
export function 转JPEG(buf: Buffer, quality: number): Promise<Buffer> {
  return 运行Magick(["-", "-quality", String(Math.max(1, Math.round(quality))), "jpg:-"], buf);
}

/** 解析图片尺寸（PNG/GIF/JPEG 头部），失败返回 0 尺寸 */
export function 图片尺寸(buf: Buffer): { width: number; height: number } {
  if (buf.length >= 24 && buf[0] === 0x89 && buf[1] === 0x50) {
    return { width: buf.readUInt32BE(16), height: buf.readUInt32BE(20) };
  }
  if (buf.length >= 10 && buf[0] === 0x47 && buf[1] === 0x49 && buf[2] === 0x46) {
    return { width: buf.readUInt16LE(6), height: buf.readUInt16LE(8) };
  }
  // JPEG: 扫描 SOF 段
  if (buf.length >= 4 && buf[0] === 0xff && buf[1] === 0xd8) {
    let i = 2;
    while (i + 9 < buf.length) {
      if (buf[i] !== 0xff) {
        i++;
        continue;
      }
      const 标记 = buf[i + 1];
      if (标记 >= 0xc0 && 标记 <= 0xcf && 标记 !== 0xc4 && 标记 !== 0xc8 && 标记 !== 0xcc) {
        return { height: buf.readUInt16BE(i + 5), width: buf.readUInt16BE(i + 7) };
      }
      const 长度 = buf.readUInt16BE(i + 2);
      i += 2 + 长度;
    }
  }
  return { width: 0, height: 0 };
}

/** 组装为处理结果（base64 + 尺寸） */
export function 成结果(buf: Buffer, 格式 = "png"): {
  base64: string;
  format: string;
  width: number;
  height: number;
} {
  const { width, height } = 图片尺寸(buf);
  return { base64: buf.toString("base64"), format: 格式, width, height };
}
