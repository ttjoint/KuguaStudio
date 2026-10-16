/**
 * @kugua/paths —— 苦瓜路径解析
 *
 * 分两类：
 *  1) **模块自带只读资源**：`packages/modules/<模块>/assets/...`
 *     —— 用 `模块资源(import.meta.url, "x.txt")` 解析，与 cwd 无关，模块自包含。
 *  2) **平台运行时可变数据**：数据根（默认 `<cwd>/data`，`KUGUA_DATA_DIR` 可覆盖）
 *     —— 用 `运行数据("jobs", ...)` 解析；不放代码目录。
 *
 * 详见 docs/开发细则.md。
 */

import { existsSync, readFileSync } from "node:fs";
import { resolve, dirname } from "node:path";
import { fileURLToPath } from "node:url";

/** 平台运行时数据根（可变）：KUGUA_DATA_DIR 或 <cwd>/data */
export function 数据根(): string {
  return process.env.KUGUA_DATA_DIR ?? resolve(process.cwd(), "data");
}

/** 拼出运行时数据路径，如 运行数据("jobs", "jobs.db") */
export function 运行数据(...路径: string[]): string {
  return resolve(数据根(), ...路径);
}

/**
 * 解析模块自带只读资源：`<模块目录>/assets/<路径...>`
 * 用法：`模块资源(import.meta.url, "data_zhouyi.txt")`
 */
export function 模块资源(metaUrl: string, ...路径: string[]): string {
  const 模块目录 = resolve(dirname(fileURLToPath(metaUrl)), "..");
  return resolve(模块目录, "assets", ...路径);
}

/** 读取模块自带文本资源（去掉 BOM） */
export function 读模块资源(metaUrl: string, ...路径: string[]): string {
  return readFileSync(模块资源(metaUrl, ...路径), "utf-8").replace(/^\uFEFF/, "");
}

/** 模块资源是否存在 */
export function 模块资源存在(metaUrl: string, ...路径: string[]): boolean {
  return existsSync(模块资源(metaUrl, ...路径));
}
