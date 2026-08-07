/**
 * 图片处理模块
 * 调用 Python(Image) 引擎（engine/image_engine.py）实现图片处理，输入/输出走 base64。
 * 功能（严格复刻 C# 参考项目 ModImages + ImageHandler 的全部方法）：
 *   - 基础编辑：image.rotate / flipH / flipV / resize / cut / mirror / negate / grayscale
 *   - 单图处理：image.grid / gridHole / oldJpg / removeBg
 *   - 生成类：image.colorSample / randomPixel / pixelWords / captcha / cisColor / colorExtract
 *   - 幻影坦克：image.hytk
 *   - 拼接：image.combineH / combineV
 *   - GIF 系列：image.gifSprite / gifUnzip / gifUnzipGrid / gifRemoveFrame / gifZip / gifShuffle / webpToGif / gifSpeed
 *   - 特效：image.shake / roll / touchBall
 */

import { existsSync, readFileSync } from "node:fs";
import { resolve, dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { spawn } from "node:child_process";
import { NiganeClient } from "@kugua/nigane";

interface 模块配置 {
  host?: string;
  port?: number;
  token?: string;
  /** Python 可执行文件路径；默认用 PATH 上的 python */
  python?: string;
}

function 加载配置(): 模块配置 {
  const 路径 = resolve(process.cwd(), "kugua.config.json");
  if (!existsSync(路径)) return {};
  try {
    return JSON.parse(readFileSync(路径, "utf-8")) as 模块配置;
  } catch {
    return {};
  }
}

/** 输入图片：base64 或磁盘路径二选一 */
interface 图片输入 {
  base64?: string;
  path?: string;
}

/** 处理结果 */
interface 处理结果 {
  base64: string;
  format: string;
  width: number;
  height: number;
}

/** 引擎返回的 JSON 载荷 */
interface 引擎响应 {
  ok: boolean;
  error?: string;
  base64?: string;
  width?: number;
  height?: number;
  format?: string;
}

/** 引擎脚本路径（相对本模块） */
const 引擎脚本 = (() => {
  const 当前 = dirname(fileURLToPath(import.meta.url));
  return join(当前, "..", "engine", "image_engine.py");
})();

/** 图片处理引擎：调用 Python(Image) 子进程，stdin/stdout 传 JSON */
class 图片引擎 {
  private python: string;

  constructor(python = "python") {
    this.python = python;
  }

  /** 发起一次引擎调用，返回 JSON 载荷 */
  调用(op: string, params: unknown, 输入?: 图片输入): Promise<引擎响应> {
    const payload = { op, params: params ?? {}, ...输入 };
    return new Promise((resolve, reject) => {
      const 子进程 = spawn(this.python, [引擎脚本], {
        stdio: ["pipe", "pipe", "pipe"] as const,
      });
      let 输出 = "";
      let 错误 = "";
      子进程.stdout.on("data", (b: Buffer) => (输出 += b.toString()));
      子进程.stderr.on("data", (b: Buffer) => (错误 += b.toString()));
      子进程.on("error", (err) =>
        reject(new Error(`无法启动 Python 引擎：${err.message}（请确认已安装 Python 与 Pillow）`)),
      );
      子进程.on("close", (code) => {
        if (code !== 0) {
          reject(new Error(`Python 引擎退出码 ${code ?? "?"}：${错误.trim() || "未知错误"}`));
          return;
        }
        try {
          const 解析 = JSON.parse(输出) as 引擎响应;
          if (!解析.ok) {
            reject(new Error(`图片处理失败：${解析.error ?? "未知错误"}`));
            return;
          }
          resolve(解析);
        } catch (err) {
          reject(new Error(`引擎返回无法解析：${String(err)}。原始输出：${输出.slice(0, 200)}`));
        }
      });
      // 注意：输入为 base64 时直接传给引擎，避免文件系统依赖
      子进程.stdin.write(JSON.stringify(payload));
      子进程.stdin.end();
    });
  }

  /** 通用处理：base64 输入 → 引擎 → base64 输出 */
  async 处理(op: string, 输入: 图片输入, params: unknown): Promise<处理结果> {
    const 响应 = await this.调用(op, params, 输入);
    return {
      base64: 响应.base64 ?? "",
      format: 响应.format ?? "png",
      width: 响应.width ?? 0,
      height: 响应.height ?? 0,
    };
  }

  /** 校验 Python + Pillow 是否可用 */
  async 校验(): Promise<boolean> {
    try {
      const 响应 = await this.调用("colorSample", { color: "#000000", size: 1 });
      return 响应.ok;
    } catch {
      return false;
    }
  }
}

/** 输入解析：把 params 里的 base64/path 规整为 图片输入 */
function 取输入(params: unknown): { base64?: string; path?: string } {
  const p = (params ?? {}) as { base64?: string; path?: string };
  return { base64: p.base64, path: p.path };
}

async function 启动(): Promise<void> {
  const 配置 = 加载配置();
  const host = 配置.host ?? "127.0.0.1";
  const port = 配置.port ?? 24601;
  const envURL = process.env.NIGANE_URL ?? process.argv[2];
  const envToken = process.env.NIGANE_TOKEN ?? process.argv[3];

  const 引擎 = new 图片引擎(配置.python);
  const 可用 = await 引擎.校验();
  if (!可用) {
    console.warn("[图片模块] 警告：Python/Pillow 不可用，图片处理能力将不可用。");
  }

  const 客户端 = new NiganeClient({
    name: "image",
    url: envURL ?? `ws://${host}:${port}`,
    token: envToken ?? 配置.token ?? "",
    version: "0.1.0",
    capabilities: [
      // 基础编辑
      "image.rotate",
      "image.flipH",
      "image.flipV",
      "image.resize",
      "image.cut",
      "image.mirror",
      "image.negate",
      "image.grayscale",
      // 生成/取色
      "image.colorSample",
      "image.randomPixel",
      // 新增单图处理
      "image.grid",
      "image.gridHole",
      "image.oldJpg",
      "image.removeBg",
      // 生成类
      "image.pixelWords",
      "image.captcha",
      "image.cisColor",
      "image.colorExtract",
      // 幻影坦克
      "image.hytk",
      // 拼接
      "image.combineH",
      "image.combineV",
      // GIF 系列
      "image.gifSprite",
      "image.gifUnzip",
      "image.gifUnzipGrid",
      "image.gifRemoveFrame",
      "image.gifZip",
      "image.gifShuffle",
      "image.webpToGif",
      "image.gifSpeed",
      // 特效
      "image.shake",
      "image.roll",
      "image.touchBall",
    ],
  });

  // —— 旋转：顺时针 degrees 度（参考 Magick Rotate）——
  客户端.onRequest("image.rotate", async (params) => {
    const { degrees } = (params ?? {}) as { degrees?: number };
    return 引擎.处理("rotate", 取输入(params), { degrees: degrees ?? 0 });
  });

  // —— 水平翻转（参考 Flop）——
  客户端.onRequest("image.flipH", async (params) => {
    return 引擎.处理("flipH", 取输入(params), {});
  });

  // —— 垂直翻转（参考 Flip）——
  客户端.onRequest("image.flipV", async (params) => {
    return 引擎.处理("flipV", 取输入(params), {});
  });

  // —— 缩放（参考 Resize）——
  客户端.onRequest("image.resize", async (params) => {
    const p = (params ?? {}) as { width?: number; height?: number; scaleX?: number; scaleY?: number };
    return 引擎.处理("resize", 取输入(params), p);
  });

  // —— 切边（参考 setCut + ImgCut）——
  客户端.onRequest("image.cut", async (params) => {
    const p = (params ?? {}) as {
      top?: number; bottom?: number; left?: number; right?: number; percent?: boolean;
    };
    return 引擎.处理("cut", 取输入(params), p);
  });

  // —— 镜像（参考 ImgMirror）——
  客户端.onRequest("image.mirror", async (params) => {
    const { mode } = (params ?? {}) as { mode?: number };
    return 引擎.处理("mirror", 取输入(params), { mode: mode ?? 1 });
  });

  // —— 反色（参考 Negate）——
  客户端.onRequest("image.negate", async (params) => {
    return 引擎.处理("negate", 取输入(params), {});
  });

  // —— 灰度/遗像（参考 Rec601Luminance）——
  客户端.onRequest("image.grayscale", async (params) => {
    return 引擎.处理("grayscale", 取输入(params), {});
  });

  // —— 生成纯色方块（参考 GetColorSample）——
  客户端.onRequest("image.colorSample", async (params) => {
    const p = (params ?? {}) as { color?: string; size?: number };
    return 引擎.处理("colorSample", {}, { color: p.color ?? "#000000", size: p.size ?? 80 });
  });

  // —— 生成随机像素点图片（参考 ImgGenerateRandomPixel）——
  客户端.onRequest("image.randomPixel", async (params) => {
    const { size } = (params ?? {}) as { size?: number };
    return 引擎.处理("randomPixel", {}, { size: size ?? 100 });
  });

  // —— 网格化：每个像素以 scale 为步长放大（参考 setPixelChange1）——
  客户端.onRequest("image.grid", async (params) => {
    const p = (params ?? {}) as { scale?: number };
    return 引擎.处理("grid", 取输入(params), { scale: p.scale ?? 2 });
  });

  // —— 网格化2：棋盘间隔扣像素（参考 setPixelChange2）——
  客户端.onRequest("image.gridHole", async (params) => {
    return 引擎.处理("gridHole", 取输入(params), {});
  });

  // —— 做旧：YUV 绿移 + 压损（参考 ImgGreen）——
  客户端.onRequest("image.oldJpg", async (params) => {
    const p = (params ?? {}) as { quality?: number };
    return 引擎.处理("oldJpg", 取输入(params), { quality: p.quality ?? 0.75 });
  });

  // —— 抠图：边缘主色泛洪去背景（参考 ImgRemoveBackground2）——
  客户端.onRequest("image.removeBg", async (params) => {
    const p = (params ?? {}) as { tolerance?: number };
    return 引擎.处理("removeBg", 取输入(params), { tolerance: p.tolerance ?? 10 });
  });

  // —— 像素字：红字逐字绘制（参考 ImgGeneratePixel2）——
  客户端.onRequest("image.pixelWords", async (params) => {
    const p = (params ?? {}) as { text?: string; fontSize?: number; lineMax?: number };
    return 引擎.处理("pixelWords", {}, {
      text: p.text ?? "", fontSize: p.fontSize ?? 12, lineMax: p.lineMax ?? 20,
    });
  });

  // —— 验证码：10 帧随机扭曲 GIF（参考 ImgGenerateCaptcha）——
  客户端.onRequest("image.captcha", async (params) => {
    const p = (params ?? {}) as { text?: string };
    return 引擎.处理("captcha", {}, { text: p.text ?? "" });
  });

  // —— CIS 色卡：xyY 转 RGB（参考 ColorConvert.xyYtoRGB）——
  客户端.onRequest("image.cisColor", async (params) => {
    const p = (params ?? {}) as { x?: number; y?: number; Y?: number; size?: number };
    return 引擎.处理("cisColor", {}, {
      x: p.x ?? 0.3127, y: p.y ?? 0.329, Y: p.Y ?? 1.0, size: p.size ?? 200,
    });
  });

  // —— 取色：提取主色生成色卡条（参考 ImageColorExtract）——
  客户端.onRequest("image.colorExtract", async (params) => {
    const p = (params ?? {}) as { count?: number; size?: number };
    return 引擎.处理("colorExtract", 取输入(params), { count: p.count ?? 3, size: p.size ?? 80 });
  });

  // —— 幻影坦克：两张图叠加（参考 ImageBlend / ImageBlendColorful）——
  客户端.onRequest("image.hytk", async (params) => {
    const p = (params ?? {}) as { images?: string[]; colorful?: boolean };
    return 引擎.处理("hytk", 取输入(params), { images: p.images ?? [], colorful: p.colorful ?? false });
  });

  // —— 横向拼接（参考 combineImage）——
  客户端.onRequest("image.combineH", async (params) => {
    const p = (params ?? {}) as { images?: string[] };
    return 引擎.处理("combineH", 取输入(params), { images: p.images ?? [] });
  });

  // —— 纵向拼接（参考 combineImage）——
  客户端.onRequest("image.combineV", async (params) => {
    const p = (params ?? {}) as { images?: string[] };
    return 引擎.处理("combineV", 取输入(params), { images: p.images ?? [] });
  });

  // —— 拆帧平铺成序列图（参考 unzipGifFrameImg）——
  客户端.onRequest("image.gifSprite", async (params) => {
    const p = (params ?? {}) as { col?: number };
    return 引擎.处理("gifSprite", 取输入(params), { col: p.col ?? 1 });
  });

  // —— 拆帧成一组图（参考 unzipGif）——
  客户端.onRequest("image.gifUnzip", async (params) => {
    return 引擎.处理("gifUnzip", 取输入(params), {});
  });

  // —— 拆成 col x row 碎片（参考 unzipImage）——
  客户端.onRequest("image.gifUnzipGrid", async (params) => {
    const p = (params ?? {}) as { col?: number; row?: number };
    return 引擎.处理("gifUnzipGrid", 取输入(params), { col: p.col ?? 1, row: p.row ?? 1 });
  });

  // —— 删帧（参考 removeGifFrame）——
  客户端.onRequest("image.gifRemoveFrame", async (params) => {
    const p = (params ?? {}) as { begin?: number; count?: number };
    return 引擎.处理("gifRemoveFrame", 取输入(params), { begin: p.begin ?? 0, count: p.count ?? 1 });
  });

  // —— 合成 GIF：多图或序列图（参考 zipGif）——
  客户端.onRequest("image.gifZip", async (params) => {
    const p = (params ?? {}) as { images?: string[]; row?: number; col?: number; sprite?: boolean };
    return 引擎.处理("gifZip", 取输入(params), {
      images: p.images ?? [], row: p.row ?? 1, col: p.col ?? 1, sprite: p.sprite ?? false,
    });
  });

  // —— 乱序：打乱 gif 帧顺序（参考 randGif）——
  客户端.onRequest("image.gifShuffle", async (params) => {
    return 引擎.处理("gifShuffle", 取输入(params), {});
  });

  // —— gif：webp 转 gif/png（参考 webpToGif）——
  客户端.onRequest("image.webpToGif", async (params) => {
    return 引擎.处理("webpToGif", 取输入(params), {});
  });

  // —— 倍速：调整 gif 播放速率，负数倒放（参考 ImgSetGifSpeed）——
  客户端.onRequest("image.gifSpeed", async (params) => {
    const p = (params ?? {}) as { speed?: number };
    return 引擎.处理("gifSpeed", 取输入(params), { speed: p.speed ?? 1.0 });
  });

  // —— 抖动动画（参考 ImgShake）——
  客户端.onRequest("image.shake", async (params) => {
    const p = (params ?? {}) as { degree?: number };
    return 引擎.处理("shake", 取输入(params), { degree: p.degree ?? 0.5 });
  });

  // —— 滚动动画（参考 ImgRoll）——
  客户端.onRequest("image.roll", async (params) => {
    const p = (params ?? {}) as { degree?: number };
    return 引擎.处理("roll", 取输入(params), { degree: p.degree ?? 0 });
  });

  // —— 摸摸：弹性压扁回弹（参考 ToElasticBounceGif）——
  客户端.onRequest("image.touchBall", async (params) => {
    return 引擎.处理("touchBall", 取输入(params), {});
  });

  await 客户端.connect();
  console.log(`[图片模块] 已接入主控，Python 引擎 ${可用 ? "就绪" : "缺失"}，等待图片处理请求`);

  const 关闭 = (): void => {
    console.log("[图片模块] 正在关闭……");
    客户端.close();
    process.exit(0);
  };
  客户端.on("shutdown", 关闭);
  process.on("SIGINT", 关闭);
  process.on("SIGTERM", 关闭);
}

启动().catch((err: unknown) => {
  console.error("[图片模块] 启动失败：", err);
  process.exit(1);
});