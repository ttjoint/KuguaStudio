/**
 * 音视频模块（av）
 *
 * 封装 ffmpeg/ffprobe，作为**全平台唯一的音视频处理入口**：
 * 其他模块（如 music）需要 ffmpeg 时，应通过苦音调用本模块的 `av.*` 能力。
 *
 * 能力：probe / transcode / extractAudio / frames / trim / concat /
 *       videoToGif / reverse / enhance / toWav / toMp3 / toAmr
 * （按项目所有者要求，不做 silk 解码。）
 */

import { copyFileSync, existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { dirname, join, resolve } from "node:path";
import { 启动模块 } from "@kugua/module-kit";
import type { 能力声明 } from "@kugua/capability";
import {
  ffmpeg路径,
  运行FFmpeg,
  运行FFprobe,
  用临时目录,
  落盘输入,
  列文件,
  取时长,
} from "./ffmpeg.js";

/** 输入：base64 或磁盘路径 */
function 取输入(p: Record<string, unknown>): { base64?: string; path?: string } {
  return { base64: p.base64 as string | undefined, path: (p.path ?? p.路径) as string | undefined };
}

interface 媒体结果 {
  base64?: string;
  format: string;
  width?: number;
  height?: number;
  输出路径?: string;
  message?: string;
  images?: string[];
}

/** 输出：指定「输出路径」则写入并返回路径，否则返回 base64 */
function 结果(输出文件: string, 格式: string, 输出路径?: string): 媒体结果 {
  if (输出路径) {
    mkdirSync(dirname(输出路径), { recursive: true });
    copyFileSync(输出文件, 输出路径);
    return { format: 格式, 输出路径 };
  }
  return { base64: readFileSync(输出文件).toString("base64"), format: 格式 };
}

const 能力清单: 能力声明[] = [
  { 名称: "av.probe", 模块: "av", 标题: "媒体信息", 说明: "读取音视频信息（时长/流/编码）", 中文指令: ["媒体信息"], 参数: { type: "object", properties: { path: { type: "string" }, base64: { type: "string" } } }, 暴露: { 指令: true, GUI: true, 定时: false, MCP: true } },
  { 名称: "av.transcode", 模块: "av", 标题: "转码", 说明: "任意格式转码（可指定编码/码率/尺寸）", 中文指令: ["转码"], 参数: { type: "object", properties: { path: { type: "string" }, base64: { type: "string" }, 输出格式: { type: "string" }, 视频编码: { type: "string" }, 音频编码: { type: "string" }, 码率: { type: "string" }, 尺寸: { type: "string" }, 输出路径: { type: "string" } } }, 暴露: { 指令: true, GUI: true, 定时: false, MCP: true } },
  { 名称: "av.extractAudio", 模块: "av", 标题: "提取音频", 说明: "从视频提取音轨为 mp3/wav/aac", 中文指令: ["提取音频"], 参数: { type: "object", properties: { path: { type: "string" }, base64: { type: "string" }, 格式: { type: "string" }, 输出路径: { type: "string" } } }, 暴露: { 指令: true, GUI: true, 定时: false, MCP: true } },
  { 名称: "av.frames", 模块: "av", 标题: "视频抽帧", 说明: "按数量或间隔抽取帧为 PNG", 中文指令: ["抽帧"], 参数: { type: "object", properties: { path: { type: "string" }, base64: { type: "string" }, 数量: { type: "number" }, 间隔: { type: "number" } } }, 暴露: { 指令: true, GUI: true, 定时: false, MCP: true } },
  { 名称: "av.trim", 模块: "av", 标题: "剪辑", 说明: "剪辑音视频片段（起止时间，秒）", 中文指令: ["剪辑"], 参数: { type: "object", properties: { path: { type: "string" }, base64: { type: "string" }, 起始: { type: "number" }, 时长: { type: "number" }, 结束: { type: "number" }, 输出格式: { type: "string" }, 输出路径: { type: "string" } } }, 暴露: { 指令: true, GUI: true, 定时: false, MCP: true } },
  { 名称: "av.concat", 模块: "av", 标题: "拼接", 说明: "顺序拼接多个音视频（同编码）", 中文指令: ["拼接"], 参数: { type: "object", properties: { 输入列表: { type: "array", items: { type: "string" } }, 输出格式: { type: "string" }, 输出路径: { type: "string" } } }, 暴露: { 指令: true, GUI: true, 定时: false, MCP: true } },
  { 名称: "av.videoToGif", 模块: "av", 标题: "视频转 GIF", 说明: "视频转 GIF（调色板优化）", 中文指令: ["转GIF"], 参数: { type: "object", properties: { path: { type: "string" }, base64: { type: "string" }, fps: { type: "number" }, 宽度: { type: "number" }, 起始: { type: "number" }, 时长: { type: "number" }, 输出路径: { type: "string" } } }, 暴露: { 指令: true, GUI: true, 定时: false, MCP: true } },
  { 名称: "av.reverse", 模块: "av", 标题: "逆放", 说明: "音视频反转（复刻 WavReverse）", 中文指令: ["逆放"], 参数: { type: "object", properties: { path: { type: "string" }, base64: { type: "string" }, 输出格式: { type: "string" }, 输出路径: { type: "string" } } }, 暴露: { 指令: true, GUI: true, 定时: false, MCP: true } },
  { 名称: "av.enhance", 模块: "av", 标题: "音频增强", 说明: "音量+高低通+降噪（复刻 WavInc）", 中文指令: ["增强"], 参数: { type: "object", properties: { path: { type: "string" }, base64: { type: "string" }, 输出格式: { type: "string" }, 输出路径: { type: "string" } } }, 暴露: { 指令: true, GUI: true, 定时: false, MCP: true } },
  { 名称: "av.toWav", 模块: "av", 标题: "转 WAV", 说明: "转为 wav", 中文指令: ["转wav"], 参数: { type: "object", properties: { path: { type: "string" }, base64: { type: "string" }, 输出路径: { type: "string" } } }, 暴露: { 指令: true, GUI: true, 定时: false, MCP: true } },
  { 名称: "av.toMp3", 模块: "av", 标题: "转 MP3", 说明: "转为 mp3（libmp3lame -q:a 2）", 中文指令: ["转mp3"], 参数: { type: "object", properties: { path: { type: "string" }, base64: { type: "string" }, 输出路径: { type: "string" } } }, 暴露: { 指令: true, GUI: true, 定时: false, MCP: true } },
  { 名称: "av.toAmr", 模块: "av", 标题: "转 AMR", 说明: "转为 amr（复刻 Wav2Amr）", 中文指令: ["转amr"], 参数: { type: "object", properties: { path: { type: "string" }, base64: { type: "string" }, 高清: { type: "boolean" }, 输出路径: { type: "string" } } }, 暴露: { 指令: true, GUI: true, 定时: false, MCP: true } },
];

/** 判断是否含视频流 */
async function 有视频(文件: string): Promise<boolean> {
  try {
    const 出 = await 运行FFprobe([
      "-v", "error", "-select_streams", "v:0", "-show_entries", "stream=codec_type",
      "-of", "default=noprint_wrappers=1:nokey=1", 文件,
    ]);
    return 出.trim().length > 0;
  } catch {
    return false;
  }
}

function 扩展名(格式: string): string {
  const f = 格式.trim().toLowerCase().replace(/^\./, "");
  return f || "mp4";
}

void 启动模块({
  name: "av",
  version: "0.1.0",
  能力: 能力清单,
  注册: (客户端) => {
    客户端.onRequest("av.probe", async (params) => {
        const p = (params ?? {}) as Record<string, unknown>;
        return 用临时目录(async (dir) => {
            const 文件 = 落盘输入(dir, 取输入(p), "in");
            const 出 = await 运行FFprobe(["-v", "error", "-show_format", "-show_streams", "-of", "json", 文件]);
            return { info: JSON.parse(出) };
        });
    });

    客户端.onRequest("av.transcode", async (params) => {
        const p = (params ?? {}) as Record<string, unknown>;
        return 用临时目录(async (dir) => {
            const 文件 = 落盘输入(dir, 取输入(p), "in");
            const 格式 = 扩展名(String(p.输出格式 ?? "mp4"));
            const 出文件 = join(dir, `out.${格式}`);
            const 参数: string[] = ["-i", 文件];
            if (p.视频编码) 参数.push("-c:v", String(p.视频编码));
            if (p.音频编码) 参数.push("-c:a", String(p.音频编码));
            if (p.码率) 参数.push("-b:v", String(p.码率));
            if (p.尺寸) 参数.push("-vf", `scale=${String(p.尺寸)}`);
            参数.push(出文件);
            await 运行FFmpeg(参数);
            return 结果(出文件, 格式, p.输出路径 as string | undefined);
        });
    });

    客户端.onRequest("av.extractAudio", async (params) => {
        const p = (params ?? {}) as Record<string, unknown>;
        return 用临时目录(async (dir) => {
            const 文件 = 落盘输入(dir, 取输入(p), "in");
            const 格式 = 扩展名(String(p.格式 ?? "mp3"));
            const 出文件 = join(dir, `out.${格式}`);
            await 运行FFmpeg(["-i", 文件, "-vn", 出文件]);
            return 结果(出文件, 格式, p.输出路径 as string | undefined);
        });
    });

    客户端.onRequest("av.frames", async (params) => {
        const p = (params ?? {}) as Record<string, unknown>;
        return 用临时目录(async (dir) => {
            const 文件 = 落盘输入(dir, 取输入(p), "in.mp4");
            const 时长 = await 取时长(文件);
            const 间隔 = typeof p.间隔 === "number" && p.间隔 > 0 ? p.间隔 : 0;
            const 数量 = typeof p.数量 === "number" && p.数量 > 0 ? Math.min(p.数量, 100) : 9;
            const fps = 间隔 > 0 ? 1 / 间隔 : 时长 > 0 ? 数量 / 时长 : 1;
            await 运行FFmpeg(["-i", 文件, "-vf", `fps=${fps}`, "-frames:v", String(数量), join(dir, "f-%d.png")]);
            const 帧 = 列文件(dir, "f-", ".png").map((f) => readFileSync(f).toString("base64"));
            return { images: 帧, format: "png", message: `共 ${帧.length} 帧` };
        });
    });

    客户端.onRequest("av.trim", async (params) => {
        const p = (params ?? {}) as Record<string, unknown>;
        return 用临时目录(async (dir) => {
            const 源 = 落盘输入(dir, 取输入(p), "in");
            const 格式 = 扩展名(String(p.输出格式 ?? (String(p.path ?? p.路径 ?? "in").split(".").pop() || "mp4")));
            const 出文件 = join(dir, `out.${格式}`);
            const 参数: string[] = [];
            if (typeof p.起始 === "number") 参数.push("-ss", String(p.起始));
            else if (typeof p.开始 === "number") 参数.push("-ss", String(p.开始));
            参数.push("-i", 源);
            if (typeof p.时长 === "number") 参数.push("-t", String(p.时长));
            else if (typeof p.结束 === "number") 参数.push("-to", String(p.结束));
            参数.push("-c", "copy", 出文件);
            await 运行FFmpeg(参数);
            return 结果(出文件, 格式, p.输出路径 as string | undefined);
        });
    });

    客户端.onRequest("av.concat", async (params) => {
        const p = (params ?? {}) as Record<string, unknown>;
        return 用临时目录(async (dir) => {
            const 列表 = Array.isArray(p.输入列表) ? (p.输入列表 as string[]) : [];
            if (列表.length < 2) throw new Error("拼接需要至少两个输入（base64 或路径）");
            const 文件列表: string[] = [];
            for (let i = 0; i < 列表.length; i++) {
              const v = 列表[i];
              const 是路径 = existsSync(v);
              文件列表.push(落盘输入(dir, 是路径 ? { path: v } : { base64: v }, `in${i}.mp4`));
            }
          const 清单 = join(dir, "list.txt");
          writeFileSync(清单, 文件列表.map((f) => `file '${f.replace(/\\/g, "/")}'`).join("\n"), "utf-8");
          const 格式 = 扩展名(String(p.输出格式 ?? "mp4"));
          const 出文件 = join(dir, `out.${格式}`);
          await 运行FFmpeg(["-f", "concat", "-safe", "0", "-i", 清单, "-c", "copy", 出文件]);
          return 结果(出文件, 格式, p.输出路径 as string | undefined);
      });
    });

    客户端.onRequest("av.videoToGif", async (params) => {
        const p = (params ?? {}) as Record<string, unknown>;
        return 用临时目录(async (dir) => {
            const 文件 = 落盘输入(dir, 取输入(p), "in.mp4");
            const fps = typeof p.fps === "number" && p.fps > 0 ? p.fps : 10;
            const 宽 = typeof p.宽度 === "number" && p.宽度 > 0 ? p.宽度 : 480;
            const 出文件 = join(dir, "out.gif");
            const 参数: string[] = [];
            if (typeof p.起始 === "number") 参数.push("-ss", String(p.起始));
            参数.push("-i", 文件);
            if (typeof p.时长 === "number") 参数.push("-t", String(p.时长));
            参数.push(
              "-filter_complex",
              `[0:v] fps=${fps},scale=${宽}:-1:flags=lanczos,split [a][b];[a] palettegen [p];[b][p] paletteuse`,
              出文件,
            );
          await 运行FFmpeg(参数);
          return 结果(出文件, "gif", p.输出路径 as string | undefined);
      });
    });

    客户端.onRequest("av.reverse", async (params) => {
        const p = (params ?? {}) as Record<string, unknown>;
        return 用临时目录(async (dir) => {
            const 文件 = 落盘输入(dir, 取输入(p), "in");
            const 含视频 = await 有视频(文件);
            const 格式 = 扩展名(String(p.输出格式 ?? (含视频 ? "mp4" : "wav")));
            const 出文件 = join(dir, `out.${格式}`);
            await 运行FFmpeg(含视频 ? ["-i", 文件, "-vf", "reverse", "-af", "areverse", 出文件] : ["-i", 文件, "-af", "areverse", 出文件]);
            return 结果(出文件, 格式, p.输出路径 as string | undefined);
        });
    });

    客户端.onRequest("av.enhance", async (params) => {
        const p = (params ?? {}) as Record<string, unknown>;
        return 用临时目录(async (dir) => {
            const 文件 = 落盘输入(dir, 取输入(p), "in");
            const 含视频 = await 有视频(文件);
            const 格式 = 扩展名(String(p.输出格式 ?? (含视频 ? "mp4" : "wav")));
            const 出文件 = join(dir, `out.${格式}`);
            const 滤镜 = "volume=3.0,highpass=f=200,lowpass=f=3000,afftdn=nr=50";
            await 运行FFmpeg(含视频 ? ["-i", 文件, "-c:v", "copy", "-af", 滤镜, 出文件] : ["-i", 文件, "-af", 滤镜, 出文件]);
            return 结果(出文件, 格式, p.输出路径 as string | undefined);
        });
    });

    客户端.onRequest("av.toWav", async (params) => {
        const p = (params ?? {}) as Record<string, unknown>;
        return 用临时目录(async (dir) => {
            const 文件 = 落盘输入(dir, 取输入(p), "in");
            const 出文件 = join(dir, "out.wav");
            await 运行FFmpeg(["-i", 文件, 出文件]);
            return 结果(出文件, "wav", p.输出路径 as string | undefined);
        });
    });

    客户端.onRequest("av.toMp3", async (params) => {
        const p = (params ?? {}) as Record<string, unknown>;
        return 用临时目录(async (dir) => {
            const 文件 = 落盘输入(dir, 取输入(p), "in");
            const 出文件 = join(dir, "out.mp3");
            await 运行FFmpeg(["-i", 文件, "-codec:a", "libmp3lame", "-q:a", "2", 出文件]);
            return 结果(出文件, "mp3", p.输出路径 as string | undefined);
        });
    });

    客户端.onRequest("av.toAmr", async (params) => {
        const p = (params ?? {}) as Record<string, unknown>;
        return 用临时目录(async (dir) => {
            const 文件 = 落盘输入(dir, 取输入(p), "in");
            const 出文件 = join(dir, "out.amr");
            const 参数 = p.高清
            ? ["-i", 文件, "-c:a", "amr_nb", "-b:a", "12.20k", "-ar", "8000", "-af", "loudnorm=i=-14:tp=0.0", 出文件]
            : ["-i", 文件, "-acodec", "amr_wb", "-ar", "16000", "-ac", "1", 出文件];
            await 运行FFmpeg(参数);
            return 结果(出文件, "amr", p.输出路径 as string | undefined);
        });
    });

    },
  就绪: () => console.debug("[音视频模块] 已接入主控"),
});
