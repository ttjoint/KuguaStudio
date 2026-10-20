/**
 * mkg 包纯逻辑（从 domains/nodes.ts 抽出，便于单测与复用）。
 *
 * 载体判定是唯一一处「内容归属」的真相来源：
 * 全平台（UI 图标、编辑器语义、将来的 AI 只读边界）都必须走这个函数，
 * 而不是各自写散落的 `type === "file"` 判断。
 */

import type { 载体 } from "./types.js";

/**
 * 判定某节点的正文载体。
 *
 * 规则：`file` 且挂有 resource（即磁盘上确实存在对应文件）→ 外部文件；
 * 其余全部为库内。
 *
 * 为什么用「type === "file" 且 resourceId != null」双条件：
 * - 仅 `type === "file"` 不够：迁移/索引边界下可能存在尚未回填 node_id 的 file，
 *   但那些是内部临时态，对外一律不应暴露成「外部文件」。
 * - 仅 `resourceId != null` 不够：note/material/card/snippet 在正常路径下
 *   永远没有 resourceId，但仍应显式守住「只有 file 才是磁盘镜像」这条语义，
 *   防止将来有人给非 file 节点挂 resource 时静默改变载体语义。
 */
export function 判定载体(node: { type: string; resourceId: number | null }): 载体 {
  return node.type === "file" && node.resourceId != null ? "外部文件" : "库内";
}

/**
 * 判定磁盘文件在「库内最近记录的修改时间」之后是否又被改动。
 *
 * 参数需区分两个时间：
 * - `磁盘Mtime`：当前磁盘文件的实际 mtime（必须由调用方刚 stat 获得）；
 * - `库内Mtime`：数据库 `resources.modified_time` 里记录的、上次索引时的磁盘 mtime。
 *
 * 磁盘 mtime 新于库内记录 → 说明外部进程在索引后又改了文件，标记待重新索引/重载。
 *
 * 这是「疑似变更」的廉价探测器，只做时间戳比较，不做 sha256：
 * 精确校验（sha256）留给「打开编辑 / 保存写回」那条路径。
 */
export function 判定磁盘已变更(参数: {
  磁盘Mtime: number;
  库内Mtime: number;
}): boolean {
  return 参数.磁盘Mtime > 参数.库内Mtime;
}
