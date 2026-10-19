/**
 * 逐像素算子（ImageMagick 仅用于编解码）
 *
 * 复刻参考项目：
 *   - `ImgGreen`（做旧：YUV 绿移 + JPEG 压损）
 *   - `ImageBlend` / `ImageBlendColorful`（幻影坦克）
 *
 * 像素数学在 Node 内完成（ImageMagick 不擅长这类逐像素运算），编解码交给 ImageMagick。
 */

import { NextDouble } from "@kugua/random";
import { execFile } from "node:child_process";
import { existsSync, readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import {
  取原始RGBA,
  从原始RGBA,
  转JPEG,
  运行Magick,
  图片尺寸,
  成结果,
  用临时目录,
  magick单图,
} from "./magick.js";
import { 拆帧, 合帧为GIF, 帧延时, 帧数 } from "./gif.js";

export interface 像素结果 {
  base64: string;
  format: string;
  width: number;
  height: number;
  images?: string[];
  message?: string;
}

function clamp16(x: number): number {
  return x < 0 ? 0 : x > 65535 ? 65535 : Math.round(x);
}
function clamp(v: number, lo: number, hi: number): number {
  return v < lo ? lo : v > hi ? hi : v;
}

/** 取子进程执行的 Promise 化 */
function 执行(command: string, args: string[], timeout: number): Promise<void> {
  return new Promise((resolve, reject) => {
    execFile(command, args, { timeout, windowsHide: true }, (err: Error | null) =>
      err ? reject(err) : resolve(),
    );
  });
}

function rgb2yuv(r: number, g: number, b: number): [number, number, number] {
  const y = r * 0.299 + g * 0.587 + b * 0.114;
  const u = r * -0.168736 + g * -0.331264 + b * 0.5 + 32768;
  const v = r * 0.5 + g * -0.418688 + b * -0.081312 + 32768;
  return [clamp16(y), clamp16(u), clamp16(v)];
}
function yuv2rgb(y: number, u: number, v: number): [number, number, number] {
  const r = y + 1.4075 * (v - 32768);
  const g = y - 0.3455 * (u - 32768) - 0.7169 * (v - 32768);
  const b = y + 1.779 * (u - 32768);
  return [clamp16(r), clamp16(g), clamp16(b)];
}

/* ============ 做旧（ImgGreen） ============ */

/** 单帧做旧：YUV 绿移 + 多次低质量 JPEG 往返 */
export async function 做旧单帧(png: Buffer, quality: number): Promise<Buffer> {
  const q = clamp(quality, 0.1, 0.95);
  const iterations = Math.max(0, Math.floor(50 * (1 - q)));
  let 帧 = png;
  let { data, width: w, height: h } = await 取原始RGBA(帧);

  if (q < 0.5) {
    const 小宽 = Math.max(1, Math.round(w * Math.min(1, q * 1.5)));
    const 小高 = Math.max(1, Math.round((h / w) * 小宽));
    帧 = await 运行Magick(["-", "-resize", `${小宽}x${小高}!`, "-resize", `${w}x${h}!`, "png:-"], 帧);
    ({ data, width: w, height: h } = await 取原始RGBA(帧));
  }

  const 出 = Buffer.alloc(data.length);
  const 总数 = w * h;
  for (let i = 0; i < 总数; i++) {
    let r = data[i * 4] * 257;
    let g = data[i * 4 + 1] * 257;
    let b = data[i * 4 + 2] * 257;
    for (let k = 0; k < iterations; k++) {
      const yuv = rgb2yuv(r, g, b);
      [r, g, b] = yuv2rgb(yuv[0], yuv[1] - 255, yuv[2]);
    }
    出[i * 4] = Math.floor(r / 257);
    出[i * 4 + 1] = Math.floor(g / 257);
    出[i * 4 + 2] = Math.floor(b / 257);
    出[i * 4 + 3] = 255;
  }

  let pngOut = await 从原始RGBA(出, w, h);
  if (iterations > 0) {
    // JPEG 往返循环必须合并成**一条** magick 命令。
    //
    // 原来是每轮两个进程（转 JPEG 一个、转回 PNG 一个），iterations 默认到 35
    // 就是 70 次进程启动——实测 600x400 要 11.3 秒，其中绝大部分是启动开销。
    // 用 -write 写临时文件 + +delete/-read 读回来，同一条命令里跑完全部轮次，
    // 实测 790ms，快 14 倍，输出像素一致。
    //
    // 必须用临时文件而非管道：stdin 被第一轮 -read 消耗后，后续 -read 拿不到
    // 数据会报 "insufficient image data"。
    pngOut = await 用临时目录(async (dir) => {
      const 输入 = join(dir, "in.png");
      const 中转 = join(dir, "t.jpg");
      writeFileSync(输入, pngOut);
      const 参数 = [输入];
      for (let k = 0; k < iterations; k++) {
        const qv = Math.max(1, Math.floor(q * 90 * NextDouble()));
        参数.push("-quality", String(qv), "-write", 中转, "+delete", "-read", 中转);
      }
      参数.push("png:-");
      return 运行Magick(参数);
    });
  }
  return pngOut;
}

/** 做旧（支持动画 GIF：逐帧处理） */
export async function oldJpg(buf: Buffer, quality: number): Promise<像素结果> {
  const n = await 帧数(buf);
  if (n <= 1) {
    return 成结果(await 做旧单帧(buf, quality));
  }
  const frames = await 拆帧(buf);
  const delays = await 帧延时(buf);
  const 出帧: Buffer[] = [];
  for (const f of frames) 出帧.push(await 做旧单帧(f, quality));
  const gif = await 合帧为GIF(出帧, delays);
  return {
    ...成结果(gif, "gif"),
    images: 出帧.map((f) => f.toString("base64")),
  };
}

/* ============ 幻影坦克（ImageBlend） ============ */

function 混合黑白(front: Buffer, back: Buffer, w: number, h: number): Buffer {
  const out = Buffer.alloc(w * h * 4);
  for (let i = 0; i < w * h; i++) {
    const fr = front[i * 4] / 255;
    const fg = front[i * 4 + 1] / 255;
    const fb = front[i * 4 + 2] / 255;
    const br = back[i * 4] / 255;
    const bg = back[i * 4 + 1] / 255;
    const bb = back[i * 4 + 2] / 255;
    const gray1 = fr * 0.222 + fg * 0.707 + fb * 0.071;
    const gray2 = (br * 0.222 + bg * 0.707 + bb * 0.071) * 0.3;
    let a = 1.0 - gray1 + gray2;
    let r = a > 1e-8 ? gray2 / a : 0.0;
    r = clamp(r, 0, 1);
    a = clamp(a, 0, 1);
    const v = Math.round(r * 255);
    out[i * 4] = v;
    out[i * 4 + 1] = v;
    out[i * 4 + 2] = v;
    out[i * 4 + 3] = Math.round(a * 255);
  }
  return out;
}

function 混合彩色(front: Buffer, back: Buffer, w: number, h: number): Buffer {
  const out = Buffer.alloc(w * h * 4);
  const grayR = 0.334;
  const grayG = 0.333;
  const grayB = 0.333;
  for (let i = 0; i < w * h; i++) {
    let wr = front[i * 4] / 255;
    let wg = front[i * 4 + 1] / 255;
    let wb = front[i * 4 + 2] / 255;
    let br = back[i * 4] / 255;
    let bg = back[i * 4 + 1] / 255;
    let bb = back[i * 4 + 2] / 255;
    wr *= 1.0;
    wg *= 1.0;
    wb *= 1.0;
    br *= 0.35;
    bg *= 0.35;
    bb *= 0.35;
    const wgray = wr * grayR + wg * grayG + wb * grayB;
    const keep = 1.0 - 0.5;
    wr = wr * 0.5 + wgray * keep;
    wg = wg * 0.5 + wgray * keep;
    wb = wb * 0.5 + wgray * keep;
    const bgray = br * grayR + bg * grayG + bb * grayB;
    const keep2 = 1.0 - 0.7;
    br = br * 0.7 + bgray * keep2;
    bg = bg * 0.7 + bgray * keep2;
    bb = bb * 0.7 + bgray * keep2;
    const dr = 1.0 - wr + br;
    const dg = 1.0 - wg + bg;
    const db = 1.0 - wb + bb;
    const dgray = dr * 0.222 + dg * 0.707 + db * 0.071;
    const pr = dgray > 1e-8 ? (br / dgray) * 255 : 255;
    const pg = dgray > 1e-8 ? (bg / dgray) * 255 : 255;
    const pb = dgray > 1e-8 ? (bb / dgray) * 255 : 255;
    const pa = dgray * 255;
    out[i * 4] = Math.round(clamp(pr, 0, 255));
    out[i * 4 + 1] = Math.round(clamp(pg, 0, 255));
    out[i * 4 + 2] = Math.round(clamp(pb, 0, 255));
    out[i * 4 + 3] = Math.round(clamp(pa, 0, 255));
  }
  return out;
}

/** 幻影坦克：两张图叠加（黑白 / 彩色） */
export async function hytk(images: string[], colorful: boolean): Promise<像素结果> {
  if (images.length < 2) throw new Error("幻影坦克需要两张图片");
  const frontBuf = Buffer.from(images[0], "base64");
  let backBuf: Buffer = Buffer.from(images[1], "base64");
  const { width: w, height: h } = 图片尺寸(frontBuf);
  const bs = 图片尺寸(backBuf);
  if (bs.width !== w || bs.height !== h) {
    backBuf = await 运行Magick(["-", "-resize", `${w}x${h}!`, "png:-"], backBuf);
  }
  const front = (await 取原始RGBA(frontBuf)).data;
  const back = (await 取原始RGBA(backBuf)).data;
  const 出 = colorful ? 混合彩色(front, back, w, h) : 混合黑白(front, back, w, h);
  return 成结果(await 从原始RGBA(出, w, h));
}

/* ============ 图片相似度（ImageSimilar） ============ */

/** 8x8 差异哈希（复刻 ImageSimilar.GetHash：色彩矩阵 + 灰度 + 中位数 + 差异位） */
async function 相似哈希(buf: Buffer): Promise<string> {
  const 小 = await magick单图(buf, ["-filter", "Cubic", "-resize", "8x8!", "-alpha", "off"]);
  const { data, width, height } = await 取原始RGBA(小);
  const gray = new Uint8Array(width * height);
  for (let y = 0; y < height; y++) {
    for (let x = 0; x < width; x++) {
      const i = (y * width + x) * 4;
      const R = data[i];
      const G = data[i + 1];
      const B = data[i + 2];
      // GDI+ ColorMatrix：newR=0.1R+0.1G+0.1B, newG=0.1R+0.2G+0.1B, newB=0.1R+0.1G+0.1B
      const r2 = 0.1 * R + 0.1 * G + 0.1 * B;
      const g2 = 0.1 * R + 0.2 * G + 0.1 * B;
      const b2 = 0.1 * R + 0.1 * G + 0.1 * B;
      const gv = Math.floor(r2 * 0.299 + g2 * 0.587 + b2 * 0.114);
      gray[x * width + y] = gv & 0xff; // 列优先（复刻 C#）
    }
  }
  let bits = "";
  for (let i = 0; i < gray.length; i++) {
    if (i % 8 !== 7) bits += gray[i] > gray[i + 1] ? "1" : "0";
  }
  return bits;
}

/** 比较图片相似度（1 张返回哈希，2 张返回相似度） */
export async function similar(images: string[]): Promise<{ 相似度: number; 哈希: string[] }> {
  if (images.length < 1) throw new Error("需要至少一张图片");
  const 哈希: string[] = [];
  for (const b of images) 哈希.push(await 相似哈希(Buffer.from(b, "base64")));
  let 相似度 = 1;
  if (哈希.length >= 2) {
    const a = 哈希[0];
    const b = 哈希[1];
    if (a.length !== b.length) throw new Error("哈希长度不一致");
    let 差 = 0;
    for (let i = 0; i < a.length; i++) if (a[i] !== b[i]) 差++;
    相似度 = 1 - 差 / a.length;
  }
  return { 相似度, 哈希 };
}

/* ============ 抠图（ImgRemoveBackground2） ============ */

/** 抠图：边缘主色 + 四角泛洪去背景（逐像素，忠实复刻） */
export async function removeBg(buf: Buffer, tolerance: number): Promise<像素结果> {
  const { data, width: w, height: h } = await 取原始RGBA(buf);
  const rgba = Buffer.from(data);
  const colorStep = 16;
  const counts = new Map<number, number>();
  const key = (r: number, g: number, b: number): number =>
    ((r / colorStep) << 16) | ((g / colorStep) << 8) | (b / colorStep);
  const add = (x: number, y: number): void => {
    const i = (y * w + x) * 4;
    const k = key(data[i], data[i + 1], data[i + 2]);
    counts.set(k, (counts.get(k) ?? 0) + 1);
  };
  const lineNum = 3;
  for (let x = 0; x < w; x++) {
    for (let i = 0; i < lineNum; i++) {
      add(x, i);
      add(x, h - 1 - i);
    }
  }
  for (let y = lineNum; y < h - lineNum; y++) {
    for (let i = 0; i < lineNum; i++) {
      add(i, y);
      add(w - 1 - i, y);
    }
  }
  const top = [...counts.entries()]
    .sort((a, b) => b[1] - a[1])
    .slice(0, 3)
    .map(([k]) => [((k >> 16) & 0xff) * colorStep, ((k >> 8) & 0xff) * colorStep, (k & 0xff) * colorStep]);

  const dist2 = (r: number, g: number, b: number, c: number[]): number =>
    (r - c[0]) ** 2 + (g - c[1]) ** 2 + (b - c[2]) ** 2;
  const threshold = tolerance * 4.41;
  const t2 = threshold * threshold;
  const corners: Array<[number, number]> = [
    [0, 0],
    [w - 1, 0],
    [0, h - 1],
    [w - 1, h - 1],
  ];
  for (const seed of top) {
    for (const [sx, sy] of corners) {
      if (rgba[(sy * w + sx) * 4 + 3] === 0) continue;
      const bi = (sy * w + sx) * 4;
      const 常量命中 = dist2(data[bi], data[bi + 1], data[bi + 2], seed) <= t2;
      const stack: Array<[number, number]> = [[sx, sy]];
      const visited = new Set<number>();
      while (stack.length > 0) {
        const [cx, cy] = stack.pop()!;
        const vid = cy * w + cx;
        if (visited.has(vid)) continue;
        visited.add(vid);
        if (常量命中) rgba[vid * 4 + 3] = 0;
        for (const [dx, dy] of [
          [1, 0],
          [-1, 0],
          [0, 1],
          [0, -1],
        ] as Array<[number, number]>) {
          const nx = cx + dx;
          const ny = cy + dy;
          if (nx < 0 || ny < 0 || nx >= w || ny >= h) continue;
          const nid = ny * w + nx;
          if (visited.has(nid)) continue;
          const ni = nid * 4;
          if (dist2(data[ni], data[ni + 1], data[ni + 2], seed) <= t2) {
            rgba[ni + 3] = 0;
            stack.push([nx, ny]);
          }
        }
      }
    }
  }
  return 成结果(await 从原始RGBA(rgba, w, h));
}

/* ============ 高清放大（超分） ============ */

const ESRGAN脚本 =
  process.env.KUGUA_IMAGE_ESRGAN_SCRIPT ?? "D:\\Projects\\Real-ESRGAN\\inference_realesrgan.py";

function esr可用(): boolean {
  return existsSync(ESRGAN脚本);
}

async function esr单帧(frame: Buffer, scale: number, face: boolean): Promise<Buffer> {
  return 用临时目录(async (dir) => {
    const 输入 = join(dir, "in.png");
    writeFileSync(输入, frame);
    const args = [ESRGAN脚本, "-n", "RealESRGAN_x4plus", "-i", 输入, "-o", dir, "-s", String(scale)];
    if (face) args.push("--face_enhance");
    await 执行("python", args, 300000);
    const 出 = join(dir, "in_out.png");
    if (!existsSync(出)) throw new Error("Real-ESRGAN 未生成输出");
    return readFileSync(出);
  });
}

/** ImageMagick 降级：Lanczos 放大 + 轻度锐化 */
async function 降级放大(frame: Buffer, scale: number): Promise<Buffer> {
  return magick单图(frame, ["-resize", `${scale * 100}%`, "-unsharp", "2x1+1.2+0.03"]);
}

/** 高清放大：Real-ESRGAN 可用则用，否则 ImageMagick 回退 */
export async function upscale(
  buf: Buffer,
  scale: number,
  provider: string,
  faceEnhance: boolean,
): Promise<像素结果> {
  const s = scale === 2 || scale === 4 ? scale : 4;
  const useEsr = provider === "realesrgan" || (provider === "auto" && esr可用());
  if (provider === "realesrgan" && !esr可用()) {
    throw new Error("Real-ESRGAN 不可用（脚本缺失），请使用 provider=auto 或 provider=imagemagick");
  }
  const 方法 = useEsr ? "realesrgan" : "imagemagick";
  const n = await 帧数(buf);
  if (n <= 1) {
    const 出 = useEsr ? await esr单帧(buf, s, faceEnhance) : await 降级放大(buf, s);
    return { ...成结果(出), message: 方法 };
  }
  const frames = await 拆帧(buf);
  const delays = await 帧延时(buf);
  const 出帧: Buffer[] = [];
  for (const f of frames) 出帧.push(useEsr ? await esr单帧(f, s, faceEnhance) : await 降级放大(f, s));
  const gif = await 合帧为GIF(出帧, delays);
  return { ...成结果(gif, "gif"), images: 出帧.map((f) => f.toString("base64")), message: 方法 };
}
