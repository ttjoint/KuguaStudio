/**
 * MKG 侧车（Sidecar）读写。
 *
 * 依据 docs/知识库设计.md 第四节：标签与关系写入文件旁的 `<文件>.mkg.json`，
 * 使标签可随文件迁移；数据库仅作索引与查询加速。
 */

import { existsSync, readFileSync, writeFileSync, renameSync, rmSync } from "node:fs";
import type { 侧车数据 } from "./types.js";

/** 侧车文件后缀 */
export const 侧车后缀 = ".mkg.json";

/** 计算某文件/目录对应的侧车路径 */
export function 侧车路径(文件路径: string): string {
  return `${文件路径}${侧车后缀}`;
}

/** 判断侧车是否存在 */
export function 侧车存在(文件路径: string): boolean {
  return existsSync(侧车路径(文件路径));
}

/** 读取侧车；不存在或损坏时返回 null */
export function 读取侧车(文件路径: string): 侧车数据 | null {
  const 路径 = 侧车路径(文件路径);
  if (!existsSync(路径)) return null;
  try {
    const 数据 = JSON.parse(readFileSync(路径, "utf-8")) as 侧车数据;
    return {
      version: typeof 数据.version === "number" ? 数据.version : 1,
      sha256: 数据.sha256,
      tags: Array.isArray(数据.tags) ? 数据.tags : [],
      relations: Array.isArray(数据.relations) ? 数据.relations : [],
      note: 数据.note,
      updatedAt: 数据.updatedAt,
    };
  } catch {
    return null;
  }
}

/** 写入侧车（临时文件 + 原子改名） */
export function 写入侧车(文件路径: string, 数据: 侧车数据): void {
  const 目标 = 侧车路径(文件路径);
  const 临时 = `${目标}.tmp`;
  const 规范: 侧车数据 = {
    version: 数据.version ?? 1,
    sha256: 数据.sha256,
    tags: 数据.tags ?? [],
    relations: 数据.relations ?? [],
    note: 数据.note,
    updatedAt: 数据.updatedAt ?? Math.floor(Date.now() / 1000),
  };
  writeFileSync(临时, JSON.stringify(规范, null, 2), "utf-8");
  renameSync(临时, 目标);
}

/** 合并式更新（保留未提供的字段） */
export function 合并侧车(文件路径: string, 补丁: Partial<侧车数据>): 侧车数据 {
  const 旧 = 读取侧车(文件路径) ?? { version: 1 };
  const 新: 侧车数据 = {
    version: 旧.version ?? 1,
    sha256: 补丁.sha256 ?? 旧.sha256,
    tags: 补丁.tags ?? 旧.tags ?? [],
    relations: 补丁.relations ?? 旧.relations ?? [],
    note: 补丁.note ?? 旧.note,
    updatedAt: Math.floor(Date.now() / 1000),
  };
  写入侧车(文件路径, 新);
  return 新;
}

/** 删除侧车 */
export function 删除侧车(文件路径: string): void {
  const 路径 = 侧车路径(文件路径);
  if (existsSync(路径)) rmSync(路径, { force: true });
}
