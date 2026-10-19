/**
 * mkg 模块的纯逻辑（从 index.ts 抽出，便于单测）。
 *
 * ## 为什么值得抽
 *
 * mkg 主体是数据库操作（SQLite + FTS5），单测要建库灌数据，成本高。
 * 但有三处纯判定，错了都是「看起来正常的错」：
 *
 * 1. **`读取索引默认值`**：配置项 0 / 空表示「不限」。
 *    写错的话扫描会静默只扫第一层，或者把所有文件都排除掉——
 *    用户看到的是「索引完就几条」，而日志一片正常。
 *
 * 2. **`是否在目录下`**：这是 `mkg.file.pathInfo` 的核心判定。
 *    少了路径分隔符就会把 `/a/bc` 误判成在 `/a/b` 下，
 *    于是「导入的副本」被当成「原址扫描的原始文件」，
 *    **编辑器保存时静默覆盖源文件**。
 *
 * 3. **`识别扩展名`**：`path.split(".").pop()` 对没有扩展名的文件
 *    会返回整个路径（比如 `/a/Makefile` 的 pop 是 `Makefile`），
 *    然后被当成「无扩展名文本」或「未知类型」。
 */

import { resolve, sep } from "node:path";

/** 索引默认选项：来自配置，每次索引时套用（可被单次调用的参数覆盖） */
export interface 索引默认值 {
  maxDepth?: number;
  exclude?: string[];
  indexTextContent?: boolean;
  maxTextSize?: number;
}

/**
 * 把配置节里的索引选项转成内部形状。
 *
 * 「0 表示不限」是这一层唯一的语义约定：配置文件里没法填 `undefined`，
 * 所以用 0 当哨兵值。写反了（比如 `> 0 ? 深度 : 0`）会让默认配置变成
 * 「深度 0」，而深度 0 通常被理解成「只扫当前目录」或「不扫」。
 */
export function 读取索引默认值(节: Record<string, unknown>): 索引默认值 {
  const 深度 = Number(节.indexMaxDepth ?? 0);
  const 上限MB = Number(节.maxTextSizeMb ?? 10);
  const 排除 = Array.isArray(节.excludePatterns)
    ? 节.excludePatterns.map((x) => String(x)).filter((x) => x.trim() !== "")
    : [];
  return {
    maxDepth: Number.isFinite(深度) && 深度 > 0 ? 深度 : undefined,
    exclude: 排除.length > 0 ? 排除 : undefined,
    indexTextContent: 节.indexTextContent === false ? false : true,
    maxTextSize: Number.isFinite(上限MB) && 上限MB > 0 ? 上限MB * 1024 * 1024 : undefined,
  };
}

/** 路径归一：绝对化、小写、去掉尾部路径分隔符 */
export function 规范路径(路径: string): string {
  return resolve(路径).toLowerCase().replace(/[\\/]+$/, "");
}

/**
 * `子` 是否在 `根` 目录之下（含根自身）。
 *
 * `根 + sep` 那一步不能省：只写 `startsWith(根)` 时，
 * `/data/mkg` 会被判定为包含 `/data/mkg-backup`。
 */
export function 是否在目录下(子: string, 根: string): boolean {
  const 子规范 = 规范路径(子);
  const 根规范 = 规范路径(根);
  return 子规范 === 根规范 || 子规范.startsWith(根规范 + sep);
}

/** 文本类扩展名 */
export const 文本扩展名 = new Set([
  "txt", "md", "markdown", "json", "js", "mjs", "cjs", "ts", "tsx", "jsx",
  "py", "cs", "java", "c", "cpp", "h", "hpp", "go", "rs", "rb", "php",
  "swift", "kt", "scala", "r", "lua", "dart", "sql", "sh", "bash", "zsh",
  "bat", "cmd", "ps1", "vbs", "html", "htm", "css", "scss", "sass", "less",
  "xml", "svg", "yaml", "yml", "toml", "ini", "cfg", "conf", "log",
  "env", "gitignore", "editorconfig", "dockerfile", "makefile",
]);

export const 压缩包扩展名 = new Set(["zip", "rar", "7z", "tar", "gz", "bz2", "xz", "tgz", "tbz2"]);
export const 图片扩展名 = new Set(["jpg", "jpeg", "png", "gif", "webp", "bmp", "ico", "svg", "tiff", "tif", "avif", "heic", "heif"]);
export const 视频扩展名 = new Set(["mp4", "webm", "ogg", "ogv", "mov", "avi", "mkv", "flv", "wmv", "m4v", "mpg", "mpeg", "3gp"]);
export const 音乐扩展名 = new Set(["mp3", "wav", "flac", "ogg", "oga", "aac", "m4a", "wma", "opus", "aiff", "ape"]);

/**
 * 从路径取小写扩展名。
 *
 * **没有扩展名时返回空串**，不返回文件名。
 * `path.split(".").pop()` 对 `/a/Makefile` 返回 `"Makefile"`——
 * 看起来像个扩展名，但其实是文件名，会一路传进各类型集合里做无用匹配。
 *
 * 点开头的隐藏文件（`.gitignore`）特殊处理：整体去掉前导点当作扩展名，
 * 这样 `.gitignore` / `.editorconfig` 能进文本集合。
 */
export function 识别扩展名(路径: string): string {
  const 文件名 = 路径.replace(/[\\/]+$/, "").split(/[\\/]/).pop() ?? "";
  const 点 = 文件名.lastIndexOf(".");
  if (点 < 0) return "";
  if (点 === 0) return 文件名.slice(1).toLowerCase(); // .gitignore → gitignore
  return 文件名.slice(点 + 1).toLowerCase();
}

export interface 类型判定 {
  isText: boolean;
  isArchive: boolean;
  isImage: boolean;
  isVideo: boolean;
  isAudio: boolean;
  extension: string;
}

/** 按扩展名判定文件类型 */
export function 判定文件类型(路径: string): 类型判定 {
  const ext = 识别扩展名(路径);
  return {
    isText: 文本扩展名.has(ext),
    isArchive: 压缩包扩展名.has(ext),
    isImage: 图片扩展名.has(ext),
    isVideo: 视频扩展名.has(ext),
    isAudio: 音乐扩展名.has(ext),
    extension: ext,
  };
}
