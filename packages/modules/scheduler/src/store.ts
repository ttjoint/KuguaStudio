/**
 * 定时任务 JSON 持久化：原子写（临时文件 + 改名），损坏时安全回退为空列表。
 */

import { existsSync, mkdirSync, readFileSync, renameSync, writeFileSync } from "node:fs";
import { dirname } from "node:path";
import type { 定时任务 } from "./types.js";

export class 任务存储 {
  constructor(private 路径: string) {}

  load(): 定时任务[] {
    if (!existsSync(this.路径)) return [];
    try {
      const 数据: unknown = JSON.parse(readFileSync(this.路径, "utf-8"));
      if (!Array.isArray(数据)) return [];
      return 数据.filter(
        (x): x is 定时任务 =>
          typeof x === "object" &&
          x !== null &&
          typeof (x as 定时任务).id === "string" &&
          typeof (x as 定时任务).name === "string" &&
          typeof (x as 定时任务).cron === "string",
      );
    } catch (err) {
      console.warn(`[调度] 任务文件解析失败，忽略：${err instanceof Error ? err.message : String(err)}`);
      return [];
    }
  }

  save(任务: 定时任务[]): void {
    try {
      mkdirSync(dirname(this.路径), { recursive: true });
      const 临时 = this.路径 + ".tmp";
      writeFileSync(临时, JSON.stringify(任务, null, 2), "utf-8");
      renameSync(临时, this.路径);
    } catch (err) {
      console.warn(`[调度] 保存任务失败：${err instanceof Error ? err.message : String(err)}`);
    }
  }
}
