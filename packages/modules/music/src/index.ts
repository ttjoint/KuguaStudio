/**
 * 音乐模块
 *
 * 实测（2026）：多源搜索中 **网易云 / QQ / 酷狗** 可用；**仅网易云可下载**（QQ 的 purl 为空、
 * 酷狗 play_url 缺失、酷我请求非法）。故：
 *   - 搜索：wyy / qq / kg 三源；
 *   - 下载/播放：网易云（`/song/media/outer/url?id=<id>.mp3`）；
 *   - 反向播放：下载后经 `av.reverse`（全平台 ffmpeg 统一走 av 模块）。
 *
 * 不做兜底正则；调用为显式指令。
 */

import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { join, resolve } from "node:path";
import { 启动模块 } from "@kugua/module-kit";
import type { NiganeClient } from "@kugua/nigane";
import type { 能力声明 } from "@kugua/capability";
import { 运行数据 } from "@kugua/paths";

type 来源 = "wyy" | "qq" | "kg";

interface 歌曲 {
  id: string;
  名称: string;
  歌手: string;
  专辑: string;
 来源: 来源;
  可下载: boolean;
}

const 请求头 = {
  "User-Agent": "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 Chrome/120 Safari/537.36",
};

/* ============ 搜索 ============ */
async function 搜网易云(关键词: string, 数量: number): Promise<歌曲[]> {
  const r = await fetch(
    `https://music.163.com/api/search/get/web?s=${encodeURIComponent(关键词)}&type=1&limit=${数量}`,
    { headers: { ...请求头, Referer: "https://music.163.com/" } },
  );
  const jo = (await r.json()) as {
    result?: { songs?: Array<{ id: number; name: string; ar?: Array<{ name: string }>; al?: { name: string }; privilege?: { fl?: number } }> };
  };
  return (jo.result?.songs ?? []).map((s) => ({
    id: String(s.id),
    名称: s.name,
    歌手: s.ar?.[0]?.name ?? "",
    专辑: s.al?.name ?? "",
    来源: "wyy" as const,
    可下载: s.privilege?.fl !== 0,
  }));
}

async function 搜QQ(关键词: string, 数量: number): Promise<歌曲[]> {
  const r = await fetch(
    `https://c.y.qq.com/soso/fcgi-bin/client_search_cp?new_json=1&w=${encodeURIComponent(关键词)}&format=json&n=${数量}`,
    { headers: { ...请求头, Referer: "https://y.qq.com/" } },
  );
  const jo = (await r.json()) as {
    data?: { song?: { list?: Array<{ mid: string; name: string; singer?: Array<{ name: string }>; album?: { name: string }; pay?: { pay_play?: number } }> } };
  };
  return (jo.data?.song?.list ?? []).map((s) => ({
    id: s.mid,
    名称: s.name,
    歌手: s.singer?.[0]?.name ?? "",
    专辑: s.album?.name ?? "",
    来源: "qq" as const,
    可下载: s.pay?.pay_play !== 1,
  }));
}

async function 搜酷狗(关键词: string, 数量: number): Promise<歌曲[]> {
  const r = await fetch(
    `https://songsearch.kugou.com/song_search_v2?&keyword=${encodeURIComponent(关键词)}&platform=WebFilter&pagesize=${数量}`,
    { headers: 请求头 },
  );
  const jo = (await r.json()) as {
    data?: { lists?: Array<{ FileHash: string; SongName: string; SingerName: string; AlbumName: string; trans_param?: { musicpack_advance?: number } }> };
  };
  return (jo.data?.lists ?? []).map((s) => ({
    id: s.FileHash,
    名称: s.SongName,
    歌手: s.SingerName,
    专辑: s.AlbumName,
    来源: "kg" as const,
    可下载: s.trans_param?.musicpack_advance !== 1,
  }));
}

async function 搜索(关键词: string, 来源: 来源, 数量: number): Promise<歌曲[]> {
  if (!关键词.trim()) throw new Error("缺少关键词");
  switch (来源) {
    case "qq":
      return 搜QQ(关键词, 数量);
    case "kg":
      return 搜酷狗(关键词, 数量);
    default:
      return 搜网易云(关键词, 数量);
  }
}

/** 下载（当前仅网易云可用） */
async function 下载(歌曲: 歌曲): Promise<{ buffer: Buffer; 格式: string }> {
  if (歌曲.来源 !== "wyy") {
    throw new Error(`${歌曲.来源} 来源暂不支持下载（接口受限），请用网易云（wyy）`);
  }
  const r = await fetch(`https://music.163.com/song/media/outer/url?id=${歌曲.id}.mp3`, {
    headers: { ...请求头, Referer: "https://music.163.com/" },
  });
  const buf = Buffer.from(await r.arrayBuffer());
  const 类型 = r.headers.get("content-type") ?? "";
  if (!类型.includes("audio") && !(buf[0] === 0x49 && buf[1] === 0x44 && buf[2] === 0x33)) {
    throw new Error("该歌曲不可下载（可能为 VIP/版权限制）");
  }
  return { buffer: buf, 格式: "mp3" };
}

/** 落盘到 data/music/ */
function 存文件(名称: string, buf: Buffer): string {
  const 目录 = 运行数据("music");
  mkdirSync(目录, { recursive: true });
  const 安全 = 名称.replace(/[\\/:*?"<>|]/g, "_").slice(0, 80) || `music_${Date.now()}`;
  const 路径 = join(目录, `${安全}.mp3`);
  writeFileSync(路径, buf);
  return 路径;
}

/** 调用 av 模块做 ffmpeg 处理（体现"ffmpeg 统一走 av"） */
async function 调Av(客户端: NiganeClient, 动作: string, 参数: Record<string, unknown>): Promise<string> {
  const r = (await 客户端.request("av", 动作, 参数, 300000)) as { base64?: string; format?: string };
  if (!r?.base64) throw new Error(`av.${动作} 未返回音频`);
  return r.base64;
}

const 能力清单: 能力声明[] = [
  { 名称: "music.search", 模块: "music", 标题: "搜索歌曲", 说明: "多源搜索（wyy/qq/kg）", 中文指令: ["搜歌"], 参数: { type: "object", properties: { 关键词: { type: "string" }, 来源: { type: "string", enum: ["wyy", "qq", "kg"] }, 数量: { type: "number" } }, required: ["关键词"] }, 暴露: { 指令: true, GUI: true, 定时: false, MCP: true } },
  { 名称: "music.play", 模块: "music", 标题: "点歌", 说明: "搜索并播放第一首（网易云），可选反向", 中文指令: ["点歌"], 参数: { type: "object", properties: { 关键词: { type: "string" }, 来源: { type: "string" }, 反向: { type: "boolean" } }, required: ["关键词"] }, 暴露: { 指令: true, GUI: true, 定时: false, MCP: true } },
  { 名称: "music.download", 模块: "music", 标题: "下载歌曲", 说明: "下载第一首到 data/music（网易云）", 中文指令: ["下载歌曲"], 参数: { type: "object", properties: { 关键词: { type: "string" }, 来源: { type: "string" } }, required: ["关键词"] }, 暴露: { 指令: true, GUI: true, 定时: false, MCP: true } },
  { 名称: "music.playUrl", 模块: "music", 标题: "歌曲外链", 说明: "返回网易云外链 URL", 中文指令: ["歌曲外链"], 参数: { type: "object", properties: { 关键词: { type: "string" }, id: { type: "string" } } }, 暴露: { 指令: true, GUI: true, 定时: false, MCP: true } },
];

void 启动模块({
  name: "music",
  version: "0.1.0",
  能力: 能力清单,
  注册: (客户端) => {
    const 取参数 = (params: unknown): { 关键词: string; 来源: 来源; 数量: number; 反向: boolean; id: string } => {
      const p = (params ?? {}) as Record<string, unknown>;
      const 关键词 = String(p.关键词 ?? p.参数文本 ?? p.原文 ?? "").trim();
      const 来源 = (["wyy", "qq", "kg"].includes(String(p.来源)) ? String(p.来源) : "wyy") as 来源;
      const 数量 = typeof p.数量 === "number" && p.数量 > 0 ? Math.min(p.数量, 30) : 10;
      return { 关键词, 来源, 数量, 反向: Boolean(p.反向), id: String(p.id ?? "") };
    };

    客户端.onRequest("music.search", async (params) => {
        const p = 取参数(params);
        return { 关键词: p.关键词, 来源: p.来源, 列表: await 搜索(p.关键词, p.来源, p.数量) };
    });

    客户端.onRequest("music.playUrl", async (params) => {
        const p = 取参数(params);
        let 歌曲id = p.id;
        let 歌名 = "";
        if (!歌曲id) {
          const 列表 = await 搜网易云(p.关键词, 1);
          if (列表.length === 0) throw new Error("未找到歌曲");
          歌曲id = 列表[0].id;
          歌名 = 列表[0].名称;
        }
      return { id: 歌曲id, 名称: 歌名, url: `https://music.163.com/song/media/outer/url?id=${歌曲id}.mp3` };
    });

    客户端.onRequest("music.play", async (params) => {
        const p = 取参数(params);
        let 歌: 歌曲;
        if (p.id) {
          歌 = { id: p.id, 来源: p.来源, 名称: "", 歌手: "", 专辑: "", 可下载: true };
        } else {
        const 列表 = await 搜索(p.关键词, p.来源, 1);
        if (列表.length === 0) throw new Error("未找到歌曲");
        歌 = 列表[0];
      }
    const { buffer } = await 下载(歌);
    let base64 = buffer.toString("base64");
    if (p.反向) {
      base64 = await 调Av(客户端, "av.reverse", { base64, 输出格式: "mp3" });
    }
    return { 名称: 歌.名称, 歌手: 歌.歌手, 来源: 歌.来源, format: "mp3", base64, 反向: p.反向 };
    });

    客户端.onRequest("music.download", async (params) => {
        const p = 取参数(params);
        let 歌: 歌曲;
        if (p.id) {
          歌 = { id: p.id, 来源: p.来源, 名称: "", 歌手: "", 专辑: "", 可下载: true };
        } else {
        const 列表 = await 搜索(p.关键词, p.来源, 1);
        if (列表.length === 0) throw new Error("未找到歌曲");
        歌 = 列表[0];
      }
    const { buffer } = await 下载(歌);
    const 路径 = 存文件(`${歌.名称}_${歌.歌手}`, buffer);
    return { 名称: 歌.名称, 歌手: 歌.歌手, 路径, size: buffer.length };
    });

    },
  就绪: () => console.log("[音乐模块] 已接入主控（下载源：网易云）"),
});
