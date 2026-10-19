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
import { 动作声明表, 动作schema, 查声明, 归一参数 } from "./actions.js";

/** 能力声明：33 项图片能力（中文指令 + GUI + MCP） */
/**
 * 能力清单由 动作声明表 生成。
 *
 * 改造前这里是 34 行手写 `图片能力(...)`，参数 schema 另写一份、默认值
 * 再散落在各处理函数里——三份描述之间没有约束，参数改了漏改一处就是
 * 「用户填了不生效」且毫无日志。现在只有一个来源。
 */
const 能力清单: 能力声明[] = 动作声明表.map((d) => ({
  名称: `image.${d.动作}`,
  模块: "image",
  标题: d.标题,
  说明: d.说明,
  参数: 动作schema(d) as never,
  暴露: { 指令: true, GUI: true, 定时: false, MCP: true },
}));

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
      const np = 归一参数(查声明("rotate")!, params) as Record<string, any>;
      const 出 = await magick单图(取图Buffer(params), ["-rotate", String(np.degrees)]);
      return 成结果(出);
    });

    // —— 水平翻转（ImageMagick Flop）——
    客户端.onRequest("image.flipH", async (params) => {
      const np = 归一参数(查声明("flipH")!, params) as Record<string, any>;
      const 出 = await magick单图(取图Buffer(params), ["-flop"]);
      return 成结果(出);
    });

    // —— 垂直翻转（ImageMagick Flip）——
    客户端.onRequest("image.flipV", async (params) => {
      const np = 归一参数(查声明("flipV")!, params) as Record<string, any>;
      const 出 = await magick单图(取图Buffer(params), ["-flip"]);
      return 成结果(出);
    });

    // —— 缩放（复刻 op_resize）——
    客户端.onRequest("image.resize", async (params) => {
      const np = 归一参数(查声明("resize")!, params) as Record<string, any>;
      const 图 = 取图Buffer(params);
      const { width: 原宽, height: 原高 } = 图片尺寸(图);
      let 新宽 = Math.round(原宽 * (np.scaleX));
      let 新高 = Math.round(原高 * (np.scaleY));
      if (typeof np.width === "number" && np.width > 0) 新宽 = Math.round(np.width);
      if (typeof np.height === "number" && np.height > 0) 新高 = Math.round(np.height);
      if (新宽 <= 0) 新宽 = 原宽;
      if (新高 <= 0) 新高 = 原高;
      const 出 = await magick单图(图, ["-resize", `${新宽}x${新高}!`]);
      return 成结果(出);
    });

    // —— 切边（复刻 op_cut）——
    客户端.onRequest("image.cut", async (params) => {
      const np = 归一参数(查声明("cut")!, params) as Record<string, any>;
      const 图 = 取图Buffer(params);
      const { width: w, height: h } = 图片尺寸(图);
      const conv = (v: number | undefined, full: number): number => {
        const x = v ?? 0;
        if (x <= 0) return 0;
        if (np.percent || Math.abs(x) < 1) return Math.round(full * x);
        return Math.round(x);
      };
      const t = conv(np.top, h);
      const b = conv(np.bottom, h);
      const l = conv(np.left, w);
      const r = conv(np.right, w);
      const 新宽 = Math.max(1, w - l - r);
      const 新高 = Math.max(1, h - t - b);
      const 出 = await magick单图(图, ["-crop", `${新宽}x${新高}+${l}+${t}`, "+repage"]);
      return 成结果(出);
    });

    // —— 镜像（ImageMagick：裁半 + flop/flip + append，复刻 ImgMirror）——
    客户端.onRequest("image.mirror", async (params) => {
      const np = 归一参数(查声明("mirror")!, params) as Record<string, any>;
      const m = np.mode;
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
      const np = 归一参数(查声明("negate")!, params) as Record<string, any>;
      const 出 = await magick单图(取图Buffer(params), ["-channel", "RGB", "-negate", "+channel"]);
      return 成结果(出);
    });

    // —— 灰度/遗像（ImageMagick 灰度）——
    客户端.onRequest("image.grayscale", async (params) => {
      const np = 归一参数(查声明("grayscale")!, params) as Record<string, any>;
      const 出 = await magick单图(取图Buffer(params), ["-colorspace", "Gray"]);
      return 成结果(出);
    });

    // —— 生成纯色方块（ImageMagick）——
    客户端.onRequest("image.colorSample", async (params) => {
      const np = 归一参数(查声明("colorSample")!, params) as Record<string, any>;
      const size = np.size;
      const 出 = await 运行Magick(["-size", `${size}x${size}`, `xc:${np.color}`, "png:-"]);
      return 成结果(出);
    });

    // —— 生成随机像素点图片（ImageMagick +noise Random）——
    客户端.onRequest("image.randomPixel", async (params) => {
      const np = 归一参数(查声明("randomPixel")!, params) as Record<string, any>;
      const n = np.size;
      const 出 = await 运行Magick(["-size", `${n}x${n}`, "xc:", "+noise", "Random", "png:-"]);
      return 成结果(出);
    });

    // —— 网格化：每个像素以 scale 为步长放大（ImageMagick）——
    客户端.onRequest("image.grid", async (params) => {
      const np = 归一参数(查声明("grid")!, params) as Record<string, any>;
      const scale = Math.max(1, Math.floor(np.scale));
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
      const np = 归一参数(查声明("gridHole")!, params) as Record<string, any>;
      const 出 = await magick单图(取图Buffer(params), [
        "-channel", "A", "-fx", "((i+j)%2==1)?0:u", "+channel",
      ]);
      return 成结果(出);
    });

    // —— 做旧：YUV 绿移 + 压损（复刻 ImgGreen，逐像素）——
    客户端.onRequest("image.oldJpg", async (params) => {
      const np = 归一参数(查声明("oldJpg")!, params) as Record<string, any>;
      return oldJpg(取图Buffer(params), np.quality);
    });

    // —— 抠图：边缘主色泛洪去背景（逐像素，复刻 ImgRemoveBackground2）——
    客户端.onRequest("image.removeBg", async (params) => {
      const np = 归一参数(查声明("removeBg")!, params) as Record<string, any>;
      return removeBg(取图Buffer(params), np.tolerance);
    });

    // —— 像素字：红字逐字绘制（ImageMagick，复刻 ImgGeneratePixel2）——
    客户端.onRequest("image.pixelWords", async (params) => {
      const np = 归一参数(查声明("pixelWords")!, params) as Record<string, any>;
      const text = np.text;
      if (!text) throw new Error("缺少文字 text");
      const fontSize = np.fontSize;
      const lineMax = np.lineMax;
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
      const np = 归一参数(查声明("captcha")!, params) as Record<string, any>;
      const text = np.text;
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
      const np = 归一参数(查声明("cisColor")!, params) as Record<string, any>;
      const x = np.x;
      const y = np.y;
      const Y = np.Y;
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
      const size = np.size;
      const 出 = await 运行Magick(["-size", `${size}x${size}`, `xc:${hex}`, "png:-"]);
      return { ...成结果(出), message: `${r},${g},${b}(${hex})` };
    });

    // —— 取色：提取主色生成色卡条（ImageMagick -colors -unique-colors）——
    客户端.onRequest("image.colorExtract", async (params) => {
      const np = 归一参数(查声明("colorExtract")!, params) as Record<string, any>;
      const count = Math.max(1, Math.floor(np.count));
      const size = np.size;
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
      const np = 归一参数(查声明("hytk")!, params) as Record<string, any>;
      return hytk(np.images, np.colorful);
    });

    // —— 横向拼接（ImageMagick，复刻 combineImage）——
    客户端.onRequest("image.combineH", async (params) => {
      const np = 归一参数(查声明("combineH")!, params) as Record<string, any>;
      return combine(np.images, true);
    });

    // —— 纵向拼接（ImageMagick，复刻 combineImage）——
    客户端.onRequest("image.combineV", async (params) => {
      const np = 归一参数(查声明("combineV")!, params) as Record<string, any>;
      return combine(np.images, false);
    });

    // —— 拆帧平铺成序列图（ImageMagick）——
    客户端.onRequest("image.gifSprite", async (params) => {
      const np = 归一参数(查声明("gifSprite")!, params) as Record<string, any>;
      const col = np.row === "竖" ? 1 : (np.col);
      return gifSprite(取图Buffer(params), col);
    });

    // —— 拆帧成一组图（ImageMagick）——
    客户端.onRequest("image.gifUnzip", async (params) => {
      const np = 归一参数(查声明("gifUnzip")!, params) as Record<string, any>;
      return gifUnzip(取图Buffer(params));
    });

    // —— 拆成 col x row 碎片（ImageMagick）——
    客户端.onRequest("image.gifUnzipGrid", async (params) => {
      const np = 归一参数(查声明("gifUnzipGrid")!, params) as Record<string, any>;
      return gifUnzipGrid(取图Buffer(params), np.col, np.row);
    });

    // —— 删帧（ImageMagick）——
    客户端.onRequest("image.gifRemoveFrame", async (params) => {
      const np = 归一参数(查声明("gifRemoveFrame")!, params) as Record<string, any>;
      return gifRemoveFrame(取图Buffer(params), np.begin, np.count);
    });

    // —— 合成 GIF：多图或序列图（ImageMagick）——
    客户端.onRequest("image.gifZip", async (params) => {
      const np = 归一参数(查声明("gifZip")!, params) as Record<string, any>;
      return gifZip(np.images, np.row, np.col, np.sprite);
    });

    // —— 乱序：打乱 gif 帧顺序（ImageMagick）——
    客户端.onRequest("image.gifShuffle", async (params) => {
      const np = 归一参数(查声明("gifShuffle")!, params) as Record<string, any>;
      return gifShuffle(取图Buffer(params));
    });

    // —— webp 转 gif/png（ImageMagick）——
    客户端.onRequest("image.webpToGif", async (params) => {
      const np = 归一参数(查声明("webpToGif")!, params) as Record<string, any>;
      return webpToGif(取图Buffer(params));
    });

    // —— 倍速：调整 gif 播放速率，负数倒放（ImageMagick）——
    客户端.onRequest("image.gifSpeed", async (params) => {
      const np = 归一参数(查声明("gifSpeed")!, params) as Record<string, any>;
      return gifSpeed(取图Buffer(params), np.speed);
    });

    // —— 抖动动画（ImageMagick，复刻 ImgShake）——
    客户端.onRequest("image.shake", async (params) => {
      const np = 归一参数(查声明("shake")!, params) as Record<string, any>;
      return shake(取图Buffer(params), np.degree);
    });

    // —— 滚动动画（ImageMagick，复刻 ImgRoll）——
    客户端.onRequest("image.roll", async (params) => {
      const np = 归一参数(查声明("roll")!, params) as Record<string, any>;
      return rollImg(取图Buffer(params), np.degree);
    });

    // —— 摸摸：弹性压扁回弹（ImageMagick，复刻 ToElasticBounceGif）——
    客户端.onRequest("image.touchBall", async (params) => {
      const np = 归一参数(查声明("touchBall")!, params) as Record<string, any>;
      return touchBall(取图Buffer(params));
    });

    // —— 高清放大：Real-ESRGAN 超分，缺依赖自动回退（ImageMagick 降级）——
    客户端.onRequest("image.upscale", async (params) => {
      const np = 归一参数(查声明("upscale")!, params) as Record<string, any>;
      return upscale(取图Buffer(params), np.scale, np.provider, np.faceEnhance);
    });

    // —— 图片相似度（逐像素 8x8 差异哈希，复刻 ImageSimilar）——
    客户端.onRequest("image.similar", async (params) => {
      const np = 归一参数(查声明("similar")!, params) as Record<string, any>;
      const r = await similar(np.images);
      return { ...r, message: `相似度 ${(r.相似度 * 100).toFixed(2)}%` };
    });
  },
  就绪: () => console.debug("[图片模块] 已接入主控（ImageMagick 引擎），等待图片处理请求"),
});
