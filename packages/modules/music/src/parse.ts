/**
 * music 的纯解析层（从 index.ts 抽出，便于单测）。
 *
 * ## 为什么值得抽
 *
 * 这里每个函数都满足「错了也看不出来」：
 *
 * - `归一参数` 错了 → 用户点了「搜歌」得到 10 条结果而不是他要的 3 条，
 *   或者传了 `来源: "qq"` 却搜了网易云。不报错，只是结果不对。
 * - 三源响应归一化错了 → 歌手名变成空串、id 变成 `"undefined"`，
 *   搜出来一堆看起来正常但点进去坏掉的条目。
 * - `安全文件名` 错了 → Windows 上写文件直接抛 EINVAL，
 *   或者更糟：`../` 逃出数据目录。
 * - `是否MP3` 错了 → 把网易云返回的 JSON 错误页当音频存成 .mp3，
 *   播放器打开一片静音。
 *
 * ## 这个文件不碰网络
 *
 * 所有 `fetch` 都留在 `index.ts`。这里只做「响应 JSON → 歌曲列表」的映射，
 * 所以测试可以喂任意畸形 JSON。
 */

/** 支持的音源 */
export type 来源 = "wyy" | "qq" | "kg";

export interface 歌曲 {
  id: string;
  名称: string;
  歌手: string;
  专辑: string;
  来源: 来源;
  可下载: boolean;
}

export interface 归一参数结果 {
  关键词: string;
  来源: 来源;
  数量: number;
  反向: boolean;
  id: string;
}

/** 搜索数量上限。超过这个数三源都会变慢且大概率返回无关结果。 */
export const 最大数量 = 30;
/** 不指定时的默认条数 */
export const 默认数量 = 10;

/**
 * 把外部传入的 params 归一成确定形状。
 *
 * 关键词的回退链是 `关键词 → 参数文本 → 原文`：指令面板、定时任务、
 * 外部 API 三种调用方的字段名不一样，这条链保证「总有一个能用」。
 *
 * 来源只接受三个白名单值，其他一律退回 `wyy`——因为**只有 wyy 能下载**，
 * 退到别的源会让「点歌」直接失败。
 */
export function 归一参数(params: unknown): 归一参数结果 {
  const p = (params ?? {}) as Record<string, unknown>;
  const 关键词 = String(p.关键词 ?? p.参数文本 ?? p.原文 ?? "").trim();
  const 来源 = (["wyy", "qq", "kg"].includes(String(p.来源)) ? String(p.来源) : "wyy") as 来源;
  const 数量 = typeof p.数量 === "number" && p.数量 > 0 ? Math.min(p.数量, 最大数量) : 默认数量;
  return { 关键词, 来源, 数量, 反向: Boolean(p.反向), id: String(p.id ?? "") };
}

/**
 * 把用户给的歌名+歌手变成安全的文件名片段。
 *
 * 两件事必须同时做到：
 * 1. 去掉 Windows 非法字符 `\ / : * ? " < > |`（同时覆盖 POSIX 的 `/`）
 * 2. 截断到 80 字符——Windows 整条路径上限 260，数据目录可能已经挺深了
 *
 * 清洗后为空时**不能返回空串**，否则会写出 `.mp3`（隐藏文件，用户找不到）。
 * 兜底用时间戳，保证每次都是新文件而不是互相覆盖。
 */
export function 安全文件名(原始: string, 时间戳: number): string {
  return 原始.replace(/[\\/:*?"<>|]/g, "_").slice(0, 80) || `music_${时间戳}`;
}

/**
 * 判定响应体是不是 MP3。
 *
 * 网易云的外链接口在歌曲不可下载时会返回 **JSON 错误体或 HTML 页面**，
 * HTTP 状态码却是 200。所以只能看内容：
 * - `content-type` 含 `audio` → 是
 * - 否则看 ID3 魔数（`ID3`，即 0x49 0x44 0x33）——有些 CDN 不给 audio 类型
 *
 * 两者都不满足就认为不可下载。宁可误报「VIP 限制」，
 * 也不要把一段 JSON 存成 .mp3 让播放器静音。
 */
export function 是否MP3(contentType: string, 头三字节: Uint8Array | number[]): boolean {
  if (contentType.includes("audio")) return true;
  return 头三字节[0] === 0x49 && 头三字节[1] === 0x44 && 头三字节[2] === 0x33;
}

/** 网易云搜索响应 → 歌曲列表 */
export function 解析网易云(jo: unknown): 歌曲[] {
  const r = jo as {
    result?: {
      songs?: Array<{
        id: number;
        name: string;
        ar?: Array<{ name: string }>;
        al?: { name: string };
        privilege?: { fl?: number };
      }>;
    };
  };
  return (r?.result?.songs ?? []).map((s) => ({
    id: String(s.id),
    名称: s.name,
    歌手: s.ar?.[0]?.name ?? "",
    专辑: s.al?.name ?? "",
    来源: "wyy" as const,
    // fl === 0 表示无试听/无版权；undefined 视为可下载（绝大多数免费歌都不带这个字段）
    可下载: s.privilege?.fl !== 0,
  }));
}

/** QQ 音乐搜索响应 → 歌曲列表 */
export function 解析QQ(jo: unknown): 歌曲[] {
  const r = jo as {
    data?: {
      song?: {
        list?: Array<{
          mid: string;
          name: string;
          singer?: Array<{ name: string }>;
          album?: { name: string };
          pay?: { pay_play?: number };
        }>;
      };
    };
  };
  return (r?.data?.song?.list ?? []).map((s) => ({
    id: s.mid,
    名称: s.name,
    歌手: s.singer?.[0]?.name ?? "",
    专辑: s.album?.name ?? "",
    来源: "qq" as const,
    // pay_play === 1 表示付费曲
    可下载: s.pay?.pay_play !== 1,
  }));
}

/** 酷狗搜索响应 → 歌曲列表 */
export function 解析酷狗(jo: unknown): 歌曲[] {
  const r = jo as {
    data?: {
      lists?: Array<{
        FileHash: string;
        SongName: string;
        SingerName: string;
        AlbumName: string;
        trans_param?: { musicpack_advance?: number };
      }>;
    };
  };
  return (r?.data?.lists ?? []).map((s) => ({
    id: s.FileHash,
    名称: s.SongName,
    歌手: s.SingerName,
    专辑: s.AlbumName,
    来源: "kg" as const,
    可下载: s.trans_param?.musicpack_advance !== 1,
  }));
}
