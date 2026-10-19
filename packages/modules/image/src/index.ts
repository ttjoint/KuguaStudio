/**
 * 图片处理模块
 * 引擎：**ImageMagick CLI**（忠实复刻 C# 的 Magick.NET）；逐像素算子（做旧/幻影坦克/抠图）在 Node 内计算；
 * 超分优先 Real-ESRGAN（外部），不可用时回退 ImageMagick 放大。
 * 输入/输出走 base64。
 * 能力声明（33 项）：中文指令 / GUI / MCP 由能力注册表派生。
 */

import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
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
import { 动作声明表, 系统动作, 动作schema, 查声明, 归一参数, 需要源图 } from "./actions.js";
import { 打开会话, 释放会话, 释放全部会话, 在会话内, 会话合法, 会话目录 } from "./session.js";

/** 能力声明：33 项图片能力（中文指令 + GUI + MCP） */
/**
 * 把动作结果写成会话文件，并把路径一并返回。
 *
 * ## 为什么不在每个动作里各自处理
 *
 * 34 个动作全部是 `return 成结果(出)`，返回 base64。想让编辑页拿到路径，
 * 改 34 处意味着 34 个地方都可能漏改——而漏改的表现是「前端显示不了图」，
 * 不是报错。所以收成一个函数，动作体一行不加。
 *
 * ## 双契约
 *
 * 聊天框那条路径要 base64，编辑页要 path。两者**同时给**：
 * - 有 `session` → 额外写文件、多一个 `path` 字段
 * - 没 `session` → 原样返回，与改造前完全一致
 *
 * 不把 base64 去掉：聊天附件、外部接入方都在用它，改了就是破契约。
 */
/**
 * 把多图参数里的**路径**就地换成 base64。
 *
 * 编辑页手里的图是路径（第 3 步的路径契约），而 `combine` / `gifZip` 这类
 * 底层函数的入参一直是 base64 数组（聊天框从第一天就这样传）。
 *
 * 两套契约都没错，错在中间没人做转换。不转的后果极除——甚至不报错：
 * `Buffer.from("D:\\x\\a.png", "base64")` 会静默返回一堆垃圾字节，
 * ImageMagick 照样能把它当成一张乱码图处理完，最后给用户一张 600x400 的
 * 怪东西，而两张 200x150 的图纵向拼接本该是 200x300。
 *
 * 所以统一在注册层转换：不管上游给的是路径还是 base64，下游只看到 base64。
 */
export function 补多图(声明: { 参数?: { 键: string; 类型: string }[] } | undefined, params: unknown): unknown {
  if (!声明 || !params || typeof params !== "object") return params;
  const 入 = params as Record<string, unknown>;
  const 多图键 = (声明.参数 ?? []).filter((p) => p.类型 === "images").map((p) => p.键);
  if (!多图键.length) return params;

  let 出: Record<string, unknown> | null = null;
  for (const 键 of 多图键) {
    const 列 = 入[键];
    if (!Array.isArray(列) || !列.length) continue;
    const 换 = 列.map((项) => {
      const s = String(项 ?? "");
      // 只有「看着像本地路径」且文件真实存在时才读。
      // 不靠长度/字符集猜 base64：base64 里不会有盘符冒号或路径分隔符。
      if (!s || /^[A-Za-z0-9+/=\r\n]+$/.test(s)) return s;
      try {
        if (!existsSync(s)) return s;
        return readFileSync(s).toString("base64");
      } catch (err) {
        console.debug(`[图片模块] 多图参数 ${键} 读文件失败：${String(err)}`);
        return s;
      }
    });
    出 ??= { ...入 };
    出[键] = 换;
  }
  return 出 ?? params;
}

function 落会话(
  结果: { base64?: string; format?: string; width?: number; height?: number; images?: string[] },
  会话: unknown,
  名: string,
): Record<string, unknown> {
  if (!会话合法(会话) || !结果?.base64) return 结果 as unknown as Record<string, unknown>;
  const 目录 = 会话目录(会话);
  if (!existsSync(目录)) return 结果 as unknown as Record<string, unknown>;
  try {
    const 扩 = (结果.format ?? "png").toLowerCase();
    // 时间戳只算一次：多帧的目录名和帧文件名用同一个，好对得上
    const 标 = Date.now().toString(36);
    const 主路径 = join(目录, `${名}-${标}.${扩}`);
    writeFileSync(主路径, Buffer.from(结果.base64, "base64"));
    const 出: Record<string, unknown> = { ...结果, path: 主路径 };

    // 多帧动作（拆帧、拆碎片）会带一个 `images` 数组，里面全是 base64。
    // 30 帧就是 3.7MB——这正是编辑页不能靠 base64 的原因。
    //
    // 所以帧也一并落盘，额外给一个 `frames` 路径数组。**`images` 原样保留**：
    // 聊天框和外接方都在用它，删了就是破契约。
    if (Array.isArray(结果.images) && 结果.images.length) {
      const 帧目录 = join(目录, `${名}-${标}-frames`);
      // 帧可能是带透明的 GIF 帧，统一存 png（存 jpg 会丢 alpha）
      if (!existsSync(帧目录)) mkdirSync(帧目录, { recursive: true });
      const 帧路径: string[] = [];
      结果.images.forEach((b64, i) => {
        const p = join(帧目录, `${String(i).padStart(4, "0")}.png`);
        writeFileSync(p, Buffer.from(b64, "base64"));
        帧路径.push(p);
      });
      出.frames = 帧路径;
    }
    return 出;
  } catch (err) {
    // 写盘失败不能把已算好的结果弄丢：退回 base64，前端照样能显示
    console.debug(`[图片模块] 结果写会话失败：${String(err)}`);
    return 结果 as unknown as Record<string, unknown>;
  }
}
/**
 * 能力清单由 动作声明表 生成。
 *
 * 改造前这里是 34 行手写 `图片能力(...)`，参数 schema 另写一份、默认值
 * 再散落在各处理函数里——三份描述之间没有约束，参数改了漏改一处就是
 * 「用户填了不生效」且毫无日志。现在只有一个来源。
 */
const 能力清单: 能力声明[] = [...动作声明表, ...系统动作].map((d) => ({
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
  // 图片编辑页。`entry` 相对本模块入口文件（dist/index.js）所在目录，
  // 所以是 `ui/index.html` —— 构建时 copy-ui.mjs 把 src/ui 拷到 dist/ui。
  界面: {
    title: "图片编辑",
    entry: "ui/index.html",
  },
  注册: (客户端) => {
    /**
     * 注册 34 个图片动作的统一入口。
     *
     * 每个动作只需要写「怎么算」，落会话目录、同时返回 path 这件事
     * 在这里做一次。好处是：
     * - 34 个动作体一个字不用改，不用担心漏改
     * - 以后新加动作自动拥有路径能力
     * - 没传 `session` 时行为与改造前完全一致
     */
    const 图片动作 = (名: string, 干活: (params: unknown) => Promise<unknown>) => {
      客户端.onRequest(名, async (params) => {
        const 结 = await 干活(补多图(查声明(名.replace(/^image\./, "")), params));
        if (!结 || typeof 结 !== "object") return 结;
        const 对象 = 结 as { base64?: string; format?: string };
        if (!对象.base64) return 结;
        const 会话 = (params as { session?: unknown } | undefined)?.session;
        return 落会话(对象, 会话, 名.replace(/^image\./, ""));
      });
    };

    // —— 旋转：顺时针 degrees 度（ImageMagick Rotate）——
    图片动作("image.rotate", async (params) => {
      const np = 归一参数(查声明("rotate")!, params) as Record<string, any>;
      const 出 = await magick单图(取图Buffer(params), ["-rotate", String(np.degrees)]);
      return 成结果(出);
    });

    // —— 水平翻转（ImageMagick Flop）——
    图片动作("image.flipH", async (params) => {
      const np = 归一参数(查声明("flipH")!, params) as Record<string, any>;
      const 出 = await magick单图(取图Buffer(params), ["-flop"]);
      return 成结果(出);
    });

    // —— 垂直翻转（ImageMagick Flip）——
    图片动作("image.flipV", async (params) => {
      const np = 归一参数(查声明("flipV")!, params) as Record<string, any>;
      const 出 = await magick单图(取图Buffer(params), ["-flip"]);
      return 成结果(出);
    });

    // —— 缩放（复刻 op_resize）——
    图片动作("image.resize", async (params) => {
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
    图片动作("image.cut", async (params) => {
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
    图片动作("image.mirror", async (params) => {
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
    图片动作("image.negate", async (params) => {
      const np = 归一参数(查声明("negate")!, params) as Record<string, any>;
      const 出 = await magick单图(取图Buffer(params), ["-channel", "RGB", "-negate", "+channel"]);
      return 成结果(出);
    });

    // —— 灰度/遗像（ImageMagick 灰度）——
    图片动作("image.grayscale", async (params) => {
      const np = 归一参数(查声明("grayscale")!, params) as Record<string, any>;
      const 出 = await magick单图(取图Buffer(params), ["-colorspace", "Gray"]);
      return 成结果(出);
    });

    // —— 生成纯色方块（ImageMagick）——
    图片动作("image.colorSample", async (params) => {
      const np = 归一参数(查声明("colorSample")!, params) as Record<string, any>;
      const size = np.size;
      const 出 = await 运行Magick(["-size", `${size}x${size}`, `xc:${np.color}`, "png:-"]);
      return 成结果(出);
    });

    // —— 生成随机像素点图片（ImageMagick +noise Random）——
    图片动作("image.randomPixel", async (params) => {
      const np = 归一参数(查声明("randomPixel")!, params) as Record<string, any>;
      const n = np.size;
      const 出 = await 运行Magick(["-size", `${n}x${n}`, "xc:", "+noise", "Random", "png:-"]);
      return 成结果(出);
    });

    // —— 网格化：每个像素以 scale 为步长放大（ImageMagick）——
    图片动作("image.grid", async (params) => {
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
    图片动作("image.gridHole", async (params) => {
      const np = 归一参数(查声明("gridHole")!, params) as Record<string, any>;
      const 出 = await magick单图(取图Buffer(params), [
        "-channel", "A", "-fx", "((i+j)%2==1)?0:u", "+channel",
      ]);
      return 成结果(出);
    });

    // —— 做旧：YUV 绿移 + 压损（复刻 ImgGreen，逐像素）——
    图片动作("image.oldJpg", async (params) => {
      const np = 归一参数(查声明("oldJpg")!, params) as Record<string, any>;
      return oldJpg(取图Buffer(params), np.quality);
    });

    // —— 抠图：边缘主色泛洪去背景（逐像素，复刻 ImgRemoveBackground2）——
    图片动作("image.removeBg", async (params) => {
      const np = 归一参数(查声明("removeBg")!, params) as Record<string, any>;
      return removeBg(取图Buffer(params), np.tolerance);
    });

    // —— 像素字：红字逐字绘制（ImageMagick，复刻 ImgGeneratePixel2）——
    图片动作("image.pixelWords", async (params) => {
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
    图片动作("image.captcha", async (params) => {
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
    图片动作("image.cisColor", async (params) => {
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
    图片动作("image.colorExtract", async (params) => {
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
    图片动作("image.hytk", async (params) => {
      const np = 归一参数(查声明("hytk")!, params) as Record<string, any>;
      return hytk(np.images, np.colorful);
    });

    // —— 横向拼接（ImageMagick，复刻 combineImage）——
    图片动作("image.combineH", async (params) => {
      const np = 归一参数(查声明("combineH")!, params) as Record<string, any>;
      return combine(np.images, true);
    });

    // —— 纵向拼接（ImageMagick，复刻 combineImage）——
    图片动作("image.combineV", async (params) => {
      const np = 归一参数(查声明("combineV")!, params) as Record<string, any>;
      return combine(np.images, false);
    });

    // —— 拆帧平铺成序列图（ImageMagick）——
    图片动作("image.gifSprite", async (params) => {
      const np = 归一参数(查声明("gifSprite")!, params) as Record<string, any>;
      const col = np.row === "竖" ? 1 : (np.col);
      return gifSprite(取图Buffer(params), col);
    });

    // —— 拆帧成一组图（ImageMagick）——
    图片动作("image.gifUnzip", async (params) => {
      const np = 归一参数(查声明("gifUnzip")!, params) as Record<string, any>;
      return gifUnzip(取图Buffer(params));
    });

    // —— 拆成 col x row 碎片（ImageMagick）——
    图片动作("image.gifUnzipGrid", async (params) => {
      const np = 归一参数(查声明("gifUnzipGrid")!, params) as Record<string, any>;
      return gifUnzipGrid(取图Buffer(params), np.col, np.row);
    });

    // —— 删帧（ImageMagick）——
    图片动作("image.gifRemoveFrame", async (params) => {
      const np = 归一参数(查声明("gifRemoveFrame")!, params) as Record<string, any>;
      return gifRemoveFrame(取图Buffer(params), np.begin, np.count);
    });

    // —— 合成 GIF：多图或序列图（ImageMagick）——
    图片动作("image.gifZip", async (params) => {
      const np = 归一参数(查声明("gifZip")!, params) as Record<string, any>;
      return gifZip(np.images, np.row, np.col, np.sprite);
    });

    // —— 乱序：打乱 gif 帧顺序（ImageMagick）——
    图片动作("image.gifShuffle", async (params) => {
      const np = 归一参数(查声明("gifShuffle")!, params) as Record<string, any>;
      return gifShuffle(取图Buffer(params));
    });

    // —— webp 转 gif/png（ImageMagick）——
    图片动作("image.webpToGif", async (params) => {
      const np = 归一参数(查声明("webpToGif")!, params) as Record<string, any>;
      return webpToGif(取图Buffer(params));
    });

    // —— 倍速：调整 gif 播放速率，负数倒放（ImageMagick）——
    图片动作("image.gifSpeed", async (params) => {
      const np = 归一参数(查声明("gifSpeed")!, params) as Record<string, any>;
      return gifSpeed(取图Buffer(params), np.speed);
    });

    // —— 抖动动画（ImageMagick，复刻 ImgShake）——
    图片动作("image.shake", async (params) => {
      const np = 归一参数(查声明("shake")!, params) as Record<string, any>;
      return shake(取图Buffer(params), np.degree);
    });

    // —— 滚动动画（ImageMagick，复刻 ImgRoll）——
    图片动作("image.roll", async (params) => {
      const np = 归一参数(查声明("roll")!, params) as Record<string, any>;
      return rollImg(取图Buffer(params), np.degree);
    });

    // —— 摸摸：弹性压扁回弹（ImageMagick，复刻 ToElasticBounceGif）——
    图片动作("image.touchBall", async (params) => {
      const np = 归一参数(查声明("touchBall")!, params) as Record<string, any>;
      return touchBall(取图Buffer(params));
    });

    // —— 高清放大：Real-ESRGAN 超分，缺依赖自动回退（ImageMagick 降级）——
    图片动作("image.upscale", async (params) => {
      const np = 归一参数(查声明("upscale")!, params) as Record<string, any>;
      return upscale(取图Buffer(params), np.scale, np.provider, np.faceEnhance);
    });

    // —— 图片相似度（逐像素 8x8 差异哈希，复刻 ImageSimilar）——
    图片动作("image.similar", async (params) => {
      const np = 归一参数(查声明("similar")!, params) as Record<string, any>;
      const r = await similar(np.images);
      return { ...r, message: `相似度 ${(r.相似度 * 100).toFixed(2)}%` };
    });

    // ================= 系统动作：编辑页的路径契约 =================
    //
    // 编辑页不拿 base64。30 帧 GIF 的 base64 塞进 JSON 是 3.7 MB，
    // 只用路径是 1.4 KB（差 2687 倍），而且前端拿到路径后交给浏览器
    // 自己流式加载，还能吃 HTTP 缓存。

    客户端.onRequest("image.session.open", async (params) => {
      const np = 归一参数(查声明("session.open")!, params) as Record<string, any>;
      const 想复用 = 会话合法(np.session);
      const { 会话: id, 目录 } = 打开会话(想复用 ? np.session : undefined);
      return {
        会话: id,
        目录,
        复用: 想复用,
        message: `${想复用 ? "复用" : "新建"}会话 ${id}`,
      };
    });

    客户端.onRequest("image.session.release", async (params) => {
      const np = 归一参数(查声明("session.release")!, params) as Record<string, any>;
      const 删了 = 释放会话(np.session);
      return {
        已释放: 删了,
        message: 删了 ? `已删除会话 ${np.session}` : `会话 ${np.session} 不存在或已删除`,
      };
    });

    客户端.onRequest("image.file.read", async (params) => {
      const np = 归一参数(查声明("file.read")!, params) as Record<string, any>;
      const 路径 = String(np.path ?? "");
      // 只认会话目录里的文件。这条检查是 `/api/file` 白名单的另一半：
      // 前端会把模块返回的路径原样发回去，服务端那边没法判断路径是不是
      // 我们自己给的，只能靠这里不产出越界路径。
      if (!在会话内(路径)) throw new Error("只允许读取图片会话目录内的文件");
      if (!existsSync(路径)) throw new Error(`文件不存在：${路径}`);
      const buf = readFileSync(路径);
      const { width, height } = 图片尺寸(buf);
      const ext = 路径.toLowerCase().match(/\.[a-z0-9]+$/)?.[0].slice(1) ?? "png";
      return {
        路径,
        宽: width,
        高: height,
        格式: ext,
        字节: buf.length,
        message: `${width}x${height} ${ext.toUpperCase()} ${(buf.length / 1024).toFixed(1)} KB`,
      };
    });

    // 编辑页拖图进来时用：前端读成 base64 → 写进会话目录 → 后续全走路径
    客户端.onRequest("image.file.save", async (params) => {
      const np = 归一参数(查声明("file.save")!, params) as Record<string, any>;
      const 会话 = String(np.session ?? "");
      if (!会话合法(会话)) throw new Error("缺少或非法的会话号");
      const 原 = String(np.base64 ?? "");
      if (!原) throw new Error("没有图像内容");

      // 文件名只取纯名称部分。不剥路径的话 `../../x.png` 能写到会话目录外面：
      // 入参来自前端，不能当可信。
      const 原始名 = String(np.name ?? "src.png");
      const 纯名 = 原始名.split(/[\\/]/).pop() ?? "src.png";
      if (!/^[A-Za-z0-9._-]{1,64}$/.test(纯名)) throw new Error(`文件名不合法：${纯名}`);

      const 目录 = 会话目录(会话);
      if (!existsSync(目录)) throw new Error(`会话不存在：${会话}`);
      const 路径 = join(目录, 纯名);

      // 去掉可能带的 data: 前缀。前端已经剥了，但外部调用方不一定。
      const 净 = 原.includes(",") ? 原.slice(原.indexOf(",") + 1) : 原;
      const buf = Buffer.from(净, "base64");
      if (!buf.length) throw new Error("图像内容解码后为空");
      writeFileSync(路径, buf);

      const { width, height } = 图片尺寸(buf);
      return {
        路径,
        宽: width,
        高: height,
        字节: buf.length,
        message: `已写入 ${纯名}（${width}x${height}）`,
      };
    });

    // 编辑页靠这张表生成所有控件，自己不硬编码任何动作
    客户端.onRequest("image.actions.declare", async () => {
      return 动作声明表.map((d) => ({
        动作: d.动作,
        标题: d.标题,
        说明: d.说明,
        分组: d.分组,
        参数: d.参数,
        源图: 需要源图(d),
        预览: d.预览 ?? "none",
        常用: d.常用 === true,
      }));
    });

    // 模块退出时把所有会话目录删掉。`taskkill` 不会走到这里——那种情况
    // 靠 `清掉过旧会话()` 在下次启动时兜底。
    return () => {
      const n = 释放全部会话();
      if (n > 0) console.debug(`[图片模块] 退出清理：删除 ${n} 个会话目录`);
    };
  },
  就绪: () => console.debug("[图片模块] 已接入主控（ImageMagick 引擎），等待图片处理请求"),
});
