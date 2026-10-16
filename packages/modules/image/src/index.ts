/**
 * 图片处理模块
 * 引擎：**ImageMagick CLI**（忠实复刻 C# 的 Magick.NET）；逐像素算子（做旧/幻影坦克/抠图）在 Node 内计算；
 * 超分优先 Real-ESRGAN（外部），不可用时回退 ImageMagick 放大。
 * 输入/输出走 base64。
 * 能力声明（33 项）：中文指令 / GUI / MCP 由能力注册表派生。
 */

import { existsSync, readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { 启动模块 } from "@kugua/module-kit";
import { magick单图, 成结果, 图片尺寸, 运行Magick, 用临时目录 } from "./magick.js";
import { NextInt, Pick } from "@kugua/random";
import type { 能力声明 } from "@kugua/capability";
import {
  gifSprite,
  gifUnzip,
  gifUnzipGrid,
  gifRemoveFrame,
  gifZip,
  gifShuffle,
  webpToGif,
  gifSpeed,
  combine,
  合帧为GIF,
  shake,
  rollImg,
  touchBall,
} from "./gif.js";
import { oldJpg, hytk, removeBg, upscale, similar } from "./pixels.js";

/** 能力声明：33 项图片能力（中文指令 + GUI + MCP） */
const 图片能力 = (
  名称: string,
  标题: string,
  说明: string,
  参数?: Record<string, unknown>,
): 能力声明 => ({
  名称: `image.${名称}`,
  模块: "image",
  标题,
  说明,
  参数: 参数 ?? {
    type: "object",
    properties: { base64: { type: "string" }, path: { type: "string" } },
  },
  暴露: { 指令: true, GUI: true, 定时: false, MCP: true },
});

const 能力清单: 能力声明[] = [
  图片能力("rotate", "旋转", "顺时针旋转图片"),
  图片能力("flipH", "水平翻转", "左右镜像"),
  图片能力("flipV", "垂直翻转", "上下镜像"),
  图片能力("resize", "缩放", "按宽度/高度或比例缩放"),
  图片能力("cut", "切边", "从四边切掉像素"),
  图片能力("mirror", "镜像", "保留一半并镜像拼接（mode 1-4）"),
  图片能力("negate", "反色", "颜色反相"),
  图片能力("grayscale", "灰度", "转为灰度"),
  图片能力("colorSample", "纯色方块", "生成指定颜色的方块"),
  图片能力("randomPixel", "随机像素", "生成随机像素图"),
  图片能力("grid", "网格化", "每个像素以步长放大"),
  图片能力("gridHole", "网格化(扣洞)", "棋盘间隔扣像素"),
  图片能力("oldJpg", "做旧", "YUV 绿移 + 压损"),
  图片能力("removeBg", "抠图", "去背景"),
  图片能力("pixelWords", "像素字", "逐字绘制像素字"),
  图片能力("captcha", "验证码", "生成扭曲验证码 GIF"),
  图片能力("cisColor", "CIS 色卡", "CIS 色卡转换"),
  图片能力("colorExtract", "取色", "提取主色"),
  图片能力("hytk", "幻影坦克", "双图叠加（幻影坦克）"),
  图片能力("combineH", "横向拼接", "两张图横向拼接"),
  图片能力("combineV", "纵向拼接", "两张图纵向拼接"),
  图片能力("gifSprite", "GIF 拆帧拼图", "拆帧并拼成平铺图"),
  图片能力("gifUnzip", "GIF 拆帧", "拆为多张图片"),
  图片能力("gifUnzipGrid", "GIF 拆帧网格", "拆帧成网格"),
  图片能力("gifRemoveFrame", "GIF 删帧", "删除指定帧"),
  图片能力("gifZip", "GIF 合成", "多帧合成 GIF"),
  图片能力("gifShuffle", "GIF 乱序", "打乱帧序"),
  图片能力("webpToGif", "WebP 转 GIF", "动画 WebP 转 GIF"),
  图片能力("gifSpeed", "GIF 倍速", "调整 GIF 播放速度"),
  图片能力("shake", "抖动", "抖动特效"),
  图片能力("roll", "滚动", "滚动特效"),
  图片能力("touchBall", "摸摸", "摸摸球特效"),
  图片能力("upscale", "高清放大", "Real-ESRGAN 超分"),
  图片能力("similar", "图片相似度", "比较两张图片相似度（8x8 差异哈希）", {
    type: "object",
    properties: { images: { type: "array", items: { type: "string" } } },
    required: ["images"],
  }),
];

/** 输入解析：把 params 里的 base64/path 规整为 图片输入 */
function 取输入(params: unknown): { base64?: string; path?: string } {
  const p = (params ?? {}) as { base64?: string; path?: string };
  return { base64: p.base64, path: p.path };
}

/** 取输入为 Buffer（供 ImageMagick 使用） */
function 取图Buffer(params: unknown): Buffer {
  const { base64, path } = 取输入(params);
  if (base64) return Buffer.from(base64, "base64");
  if (path && existsSync(path)) return readFileSync(path);
  throw new Error("缺少图片输入（base64 或 path）");
}

/** 可选字体（优先环境变量，其次 Windows 常见中文字体） */
function 字体路径(): string {
  const 候选 = [
    process.env.KUGUA_IMAGE_FONT,
    "C:/Windows/Fonts/msyh.ttc",
    "C:/Windows/Fonts/simhei.ttf",
    "C:/Windows/Fonts/simsun.ttc",
    "C:/Windows/Fonts/arial.ttf",
  ].filter((x): x is string => Boolean(x));
  for (const f of 候选) if (existsSync(f)) return f;
  return "C:/Windows/Fonts/arial.ttf";
}

void 启动模块({
  name: "image",
  version: "0.1.0",
  能力: 能力清单,
  注册: (客户端) => {
    // —— 旋转：顺时针 degrees 度（ImageMagick Rotate）——
    客户端.onRequest("image.rotate", async (params) => {
      const { degrees } = (params ?? {}) as { degrees?: number };
      const 出 = await magick单图(取图Buffer(params), ["-rotate", String(degrees ?? 0)]);
      return 成结果(出);
    });

    // —— 水平翻转（ImageMagick Flop）——
    客户端.onRequest("image.flipH", async (params) => {
      const 出 = await magick单图(取图Buffer(params), ["-flop"]);
      return 成结果(出);
    });

    // —— 垂直翻转（ImageMagick Flip）——
    客户端.onRequest("image.flipV", async (params) => {
      const 出 = await magick单图(取图Buffer(params), ["-flip"]);
      return 成结果(出);
    });

    // —— 缩放（复刻 op_resize）——
    客户端.onRequest("image.resize", async (params) => {
      const p = (params ?? {}) as {
        scaleX?: number;
        scaleY?: number;
        width?: number;
        height?: number;
      };
      const 图 = 取图Buffer(params);
      const { width: 原宽, height: 原高 } = 图片尺寸(图);
      let 新宽 = Math.round(原宽 * (p.scaleX ?? 1));
      let 新高 = Math.round(原高 * (p.scaleY ?? 1));
      if (typeof p.width === "number" && p.width > 0) 新宽 = Math.round(p.width);
      if (typeof p.height === "number" && p.height > 0) 新高 = Math.round(p.height);
      if (新宽 <= 0) 新宽 = 原宽;
      if (新高 <= 0) 新高 = 原高;
      const 出 = await magick单图(图, ["-resize", `${新宽}x${新高}!`]);
      return 成结果(出);
    });

    // —— 切边（复刻 op_cut）——
    客户端.onRequest("image.cut", async (params) => {
      const p = (params ?? {}) as {
        top?: number;
        bottom?: number;
        left?: number;
        right?: number;
        percent?: boolean;
      };
      const 图 = 取图Buffer(params);
      const { width: w, height: h } = 图片尺寸(图);
      const conv = (v: number | undefined, full: number): number => {
        const x = v ?? 0;
        if (x <= 0) return 0;
        if (p.percent || Math.abs(x) < 1) return Math.round(full * x);
        return Math.round(x);
      };
      const t = conv(p.top, h);
      const b = conv(p.bottom, h);
      const l = conv(p.left, w);
      const r = conv(p.right, w);
      const 新宽 = Math.max(1, w - l - r);
      const 新高 = Math.max(1, h - t - b);
      const 出 = await magick单图(图, ["-crop", `${新宽}x${新高}+${l}+${t}`, "+repage"]);
      return 成结果(出);
    });

    // —— 镜像（ImageMagick：裁半 + flop/flip + append，复刻 ImgMirror）——
    客户端.onRequest("image.mirror", async (params) => {
      const { mode } = (params ?? {}) as { mode?: number };
      const m = mode ?? 1;
      const 图 = 取图Buffer(params);
      const { width: w, height: h } = 图片尺寸(图);
      const hw = Math.floor(w / 2);
      const hh = Math.floor(h / 2);
      let 文件 = "";
      const clip = (x: number, y: number, cw: number, ch: number, 额外: string[] = []): string[] => [
        "(",
        文件,
        "-crop",
        `${cw}x${ch}+${x}+${y}`,
        "+repage",
        ...额外,
        ")",
      ];
      const 出 = await 用临时目录(async (dir) => {
        文件 = join(dir, "in.png");
        writeFileSync(文件, 图);
        let 参数: string[];
        if (m === 1)
          参数 = [...clip(0, 0, hw, h), ...clip(0, 0, hw, h, ["-flop"]), "+append", "png:-"];
        else if (m === 2)
          参数 = [...clip(hw, 0, hw, h, ["-flop"]), ...clip(hw, 0, hw, h), "+append", "png:-"];
        else if (m === 3)
          参数 = [...clip(0, 0, w, hh), ...clip(0, 0, w, hh, ["-flip"]), "-append", "png:-"];
        else if (m === 4)
          参数 = [...clip(0, hh, w, hh, ["-flip"]), ...clip(0, hh, w, hh), "-append", "png:-"];
        else throw new Error(`不支持的镜像模式：${m}（应为 1/2/3/4）`);
        return 运行Magick(参数);
      });
      return 成结果(出);
    });

    // —— 反色（ImageMagick Negate，保留 alpha）——
    客户端.onRequest("image.negate", async (params) => {
      const 出 = await magick单图(取图Buffer(params), ["-channel", "RGB", "-negate", "+channel"]);
      return 成结果(出);
    });

    // —— 灰度/遗像（ImageMagick 灰度）——
    客户端.onRequest("image.grayscale", async (params) => {
      const 出 = await magick单图(取图Buffer(params), ["-colorspace", "Gray"]);
      return 成结果(出);
    });

    // —— 生成纯色方块（ImageMagick）——
    客户端.onRequest("image.colorSample", async (params) => {
      const p = (params ?? {}) as { size?: number; color?: string };
      const size = p.size ?? 80;
      const 出 = await 运行Magick(["-size", `${size}x${size}`, `xc:${p.color ?? "#000000"}`, "png:-"]);
      return 成结果(出);
    });

    // —— 生成随机像素点图片（ImageMagick +noise Random）——
    客户端.onRequest("image.randomPixel", async (params) => {
      const { size } = (params ?? {}) as { size?: number };
      const n = size ?? 100;
      const 出 = await 运行Magick(["-size", `${n}x${n}`, "xc:", "+noise", "Random", "png:-"]);
      return 成结果(出);
    });

    // —— 网格化：每个像素以 scale 为步长放大（ImageMagick）——
    客户端.onRequest("image.grid", async (params) => {
      const p = (params ?? {}) as { scale?: number };
      const scale = Math.max(1, Math.floor(p.scale ?? 2));
      const 图 = 取图Buffer(params);
      const { width: w, height: h } = 图片尺寸(图);
      const W = w * scale;
      const H = h * scale;
      const 出 = await 用临时目录(async (dir) => {
        const 输入 = join(dir, "in.png");
        writeFileSync(输入, 图);
        const 放大 = join(dir, "up.png");
        await 运行Magick([输入, "-sample", `${W}x${H}`, 放大]);
        const 瓦片 = join(dir, "tile.png");
        await 运行Magick([
          "-size", `${scale}x${scale}`, "xc:none", "-fill", "white", "-draw", "point 0,0", 瓦片,
        ]);
        const 遮罩 = join(dir, "mask.png");
        await 运行Magick(["-size", `${W}x${H}`, `tile:${瓦片}`, 遮罩]);
        return 运行Magick([放大, 遮罩, "-compose", "CopyOpacity", "-composite", "png:-"]);
      });
      return 成结果(出);
    });

    // —— 网格化2：棋盘间隔扣像素（ImageMagick -fx）——
    客户端.onRequest("image.gridHole", async (params) => {
      const 出 = await magick单图(取图Buffer(params), [
        "-channel", "A", "-fx", "((i+j)%2==1)?0:u", "+channel",
      ]);
      return 成结果(出);
    });

    // —— 做旧：YUV 绿移 + 压损（复刻 ImgGreen，逐像素）——
    客户端.onRequest("image.oldJpg", async (params) => {
      const p = (params ?? {}) as { quality?: number };
      return oldJpg(取图Buffer(params), p.quality ?? 0.75);
    });

    // —— 抠图：边缘主色泛洪去背景（逐像素，复刻 ImgRemoveBackground2）——
    客户端.onRequest("image.removeBg", async (params) => {
      const p = (params ?? {}) as { tolerance?: number };
      return removeBg(取图Buffer(params), p.tolerance ?? 10);
    });

    // —— 像素字：红字逐字绘制（ImageMagick，复刻 ImgGeneratePixel2）——
    客户端.onRequest("image.pixelWords", async (params) => {
      const p = (params ?? {}) as { text?: string; fontSize?: number; lineMax?: number };
      const text = p.text ?? "";
      if (!text) throw new Error("缺少文字 text");
      const fontSize = p.fontSize ?? 12;
      const lineMax = p.lineMax ?? 20;
      const slide = Math.floor(fontSize * 0.1);
      const lineNum = Math.floor(text.length / lineMax);
      const width = Math.floor(fontSize * Math.min(lineMax, text.length) + slide * 2);
      const height = Math.floor(fontSize * (lineNum + 1) + slide * 2);
      const 参数 = [
        "-size", `${Math.max(1, width)}x${Math.max(1, height)}`, "xc:none",
        "-font", 字体路径(), "-pointsize", String(fontSize), "-fill", "red",
      ];
      [...text].forEach((ch, i) => {
        const x = (i % lineMax) * fontSize;
        const y = Math.floor(i / lineMax) * fontSize;
        参数.push("-annotate", `+${x}+${y}`, ch);
      });
      参数.push("png:-");
      return 成结果(await 运行Magick(参数));
    });

    // —— 验证码：10 帧随机字体/颜色/抖动 GIF（ImageMagick，复刻 ImgGenerateCaptcha）——
    客户端.onRequest("image.captcha", async (params) => {
      const p = (params ?? {}) as { text?: string };
      const text = p.text ?? "";
      if (!text) throw new Error("缺少文字 text");
      const fontsize = 33;
      const slide = Math.floor(fontsize * 0.3);
      const lineMax = 10;
      const lineNum = Math.floor(text.length / lineMax);
      const width = Math.floor(fontsize * Math.min(lineMax, text.length) + slide * 2);
      const height = Math.floor(fontsize * (lineNum + 1) + slide * 2);
      const colors = ["#000000", "#ff0000", "#ffff00", "#00ff00", "#00ffff", "#0000ff", "#ff00ff"];
      const 帧: Buffer[] = [];
      for (let n = 0; n < 10; n++) {
        const 参数 = ["-size", `${Math.max(1, width)}x${Math.max(1, height)}`, "xc:none", "-font", 字体路径()];
        [...text].forEach((ch, i) => {
          const size = fontsize + NextInt(-5, 6);
          const x = (i % lineMax) * fontsize + NextInt(5, 16) + slide;
          const y = Math.floor(i / lineMax) * fontsize + NextInt(-5, 6) + slide;
          参数.push("-pointsize", String(Math.max(1, size)), "-fill", Pick(colors), "-annotate", `+${x}+${y}`, ch);
        });
        参数.push("-attenuate", "0.35", "+noise", "Gaussian", "png:-");
        帧.push(await 运行Magick(参数));
      }
      const gif = await 合帧为GIF(帧, 帧.map(() => 10));
      return {
        ...成结果(gif, "gif"),
        images: 帧.map((f) => f.toString("base64")),
        message: `一共${帧.length}帧`,
      };
    });

    // —— CIS 色卡：xyY 转 RGB（复刻 ColorConvert.xyYtoRGB）——
    客户端.onRequest("image.cisColor", async (params) => {
      const p = (params ?? {}) as { x?: number; y?: number; Y?: number; size?: number };
      const x = p.x ?? 0.3127;
      const y = p.y ?? 0.329;
      const Y = p.Y ?? 1.0;
      const X = y === 0 ? 0 : (x * Y) / y;
      const Z = y === 0 ? 0 : ((1 - x - y) * Y) / y;
      const m = [
        [3.2404542, -1.5371385, -0.4985314],
        [-0.969266, 1.8760108, 0.041556],
        [0.0556434, -0.2040259, 1.0572252],
      ];
      const clamp = (v: number, lo: number, hi: number): number => (v < lo ? lo : v > hi ? hi : v);
      const rl = clamp(m[0][0] * X + m[0][1] * Y + m[0][2] * Z, 0, 1);
      const gl = clamp(m[1][0] * X + m[1][1] * Y + m[1][2] * Z, 0, 1);
      const bl = clamp(m[2][0] * X + m[2][1] * Y + m[2][2] * Z, 0, 1);
      const r = Math.round(Math.pow(rl, 1 / 2.2) * 255);
      const g = Math.round(Math.pow(gl, 1 / 2.2) * 255);
      const b = Math.round(Math.pow(bl, 1 / 2.2) * 255);
      const hex = `#${[r, g, b].map((v) => v.toString(16).padStart(2, "0")).join("")}`;
      const size = p.size ?? 200;
      const 出 = await 运行Magick(["-size", `${size}x${size}`, `xc:${hex}`, "png:-"]);
      return { ...成结果(出), message: `${r},${g},${b}(${hex})` };
    });

    // —— 取色：提取主色生成色卡条（ImageMagick -colors -unique-colors）——
    客户端.onRequest("image.colorExtract", async (params) => {
      const p = (params ?? {}) as { count?: number; size?: number };
      const count = Math.max(1, Math.floor(p.count ?? 3));
      const size = p.size ?? 80;
      const 图 = 取图Buffer(params);
      const { 出, hexes } = await 用临时目录(async (dir) => {
        const 输入 = join(dir, "in.png");
        writeFileSync(输入, 图);
        const txt = (
          await 运行Magick([输入, "-colors", String(count), "-unique-colors", "-depth", "8", "txt:-"])
        ).toString();
        const hs = [...new Set([...txt.matchAll(/#([0-9A-Fa-f]{6})/g)].map((mm) => mm[1].toUpperCase()))];
        const 清单 = hs.length > 0 ? hs : ["000000"];
        const 参数 = ["-size", `${size}x${size}`];
        for (const hx of 清单) 参数.push(`xc:#${hx}`);
        参数.push("+append", "png:-");
        return { 出: await 运行Magick(参数), hexes: 清单 };
      });
      return { ...成结果(出), message: hexes.map((h) => `#${h}`).join("   ") };
    });

    // —— 幻影坦克：两张图叠加（逐像素，复刻 ImageBlend / ImageBlendColorful）——
    客户端.onRequest("image.hytk", async (params) => {
      const p = (params ?? {}) as { images?: string[]; colorful?: boolean };
      return hytk(p.images ?? [], p.colorful ?? false);
    });

    // —— 横向拼接（ImageMagick，复刻 combineImage）——
    客户端.onRequest("image.combineH", async (params) => {
      const p = (params ?? {}) as { images?: string[] };
      return combine(p.images ?? [], true);
    });

    // —— 纵向拼接（ImageMagick，复刻 combineImage）——
    客户端.onRequest("image.combineV", async (params) => {
      const p = (params ?? {}) as { images?: string[] };
      return combine(p.images ?? [], false);
    });

    // —— 拆帧平铺成序列图（ImageMagick）——
    客户端.onRequest("image.gifSprite", async (params) => {
      const p = (params ?? {}) as { row?: string; col?: number };
      const col = p.row === "竖" ? 1 : (p.col ?? 1);
      return gifSprite(取图Buffer(params), col);
    });

    // —— 拆帧成一组图（ImageMagick）——
    客户端.onRequest("image.gifUnzip", async (params) => {
      return gifUnzip(取图Buffer(params));
    });

    // —— 拆成 col x row 碎片（ImageMagick）——
    客户端.onRequest("image.gifUnzipGrid", async (params) => {
      const p = (params ?? {}) as { col?: number; row?: number };
      return gifUnzipGrid(取图Buffer(params), p.col ?? 1, p.row ?? 1);
    });

    // —— 删帧（ImageMagick）——
    客户端.onRequest("image.gifRemoveFrame", async (params) => {
      const p = (params ?? {}) as { begin?: number; count?: number };
      return gifRemoveFrame(取图Buffer(params), p.begin ?? 0, p.count ?? 1);
    });

    // —— 合成 GIF：多图或序列图（ImageMagick）——
    客户端.onRequest("image.gifZip", async (params) => {
      const p = (params ?? {}) as { images?: string[]; row?: number; col?: number; sprite?: boolean };
      return gifZip(p.images ?? [], p.row ?? 1, p.col ?? 1, p.sprite ?? false);
    });

    // —— 乱序：打乱 gif 帧顺序（ImageMagick）——
    客户端.onRequest("image.gifShuffle", async (params) => {
      return gifShuffle(取图Buffer(params));
    });

    // —— webp 转 gif/png（ImageMagick）——
    客户端.onRequest("image.webpToGif", async (params) => {
      return webpToGif(取图Buffer(params));
    });

    // —— 倍速：调整 gif 播放速率，负数倒放（ImageMagick）——
    客户端.onRequest("image.gifSpeed", async (params) => {
      const p = (params ?? {}) as { speed?: number };
      return gifSpeed(取图Buffer(params), p.speed ?? 1.0);
    });

    // —— 抖动动画（ImageMagick，复刻 ImgShake）——
    客户端.onRequest("image.shake", async (params) => {
      const p = (params ?? {}) as { degree?: number };
      return shake(取图Buffer(params), p.degree ?? 0.5);
    });

    // —— 滚动动画（ImageMagick，复刻 ImgRoll）——
    客户端.onRequest("image.roll", async (params) => {
      const p = (params ?? {}) as { degree?: number };
      return rollImg(取图Buffer(params), p.degree ?? 0);
    });

    // —— 摸摸：弹性压扁回弹（ImageMagick，复刻 ToElasticBounceGif）——
    客户端.onRequest("image.touchBall", async (params) => {
      return touchBall(取图Buffer(params));
    });

    // —— 高清放大：Real-ESRGAN 超分，缺依赖自动回退（ImageMagick 降级）——
    客户端.onRequest("image.upscale", async (params) => {
      const p = (params ?? {}) as { scale?: number; provider?: string; faceEnhance?: boolean };
      return upscale(取图Buffer(params), p.scale ?? 4, p.provider ?? "auto", p.faceEnhance ?? false);
    });

    // —— 图片相似度（逐像素 8x8 差异哈希，复刻 ImageSimilar）——
    客户端.onRequest("image.similar", async (params) => {
      const p = (params ?? {}) as { images?: string[] };
      const r = await similar(p.images ?? []);
      return { ...r, message: `相似度 ${(r.相似度 * 100).toFixed(2)}%` };
    });
  },
  就绪: () => console.log("[图片模块] 已接入主控（ImageMagick 引擎），等待图片处理请求"),
});
