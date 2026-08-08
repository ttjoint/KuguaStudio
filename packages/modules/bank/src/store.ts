/**
 * 积分系统持久化：账户与流水分开存 JSON（原子写）。
 * 路径可通过 KUGUA_BANK_DATA 覆盖（目录，默认 data/bank）。
 */

import { existsSync, mkdirSync, readFileSync, renameSync, writeFileSync } from "node:fs";
import { dirname, join, resolve } from "node:path";
import type { 账户, 流水 } from "./types.js";

export class 银行存储 {
  private 账户文件: string;
  private 流水文件: string;

  constructor(目录?: string) {
    const 根 = 目录 ?? process.env.KUGUA_BANK_DATA ?? resolve(process.cwd(), "data/bank");
    this.账户文件 = join(根, "accounts.json");
    this.流水文件 = join(根, "ledger.json");
  }

  load(): { 账户: 账户[]; 流水: 流水[] } {
    return {
      账户: 读取JSON<账户[]>(this.账户文件, []),
      流水: 读取JSON<流水[]>(this.流水文件, []),
    };
  }

  save(账户: 账户[], 流水: 流水[]): void {
    写入JSON(this.账户文件, 账户);
    写入JSON(this.流水文件, 流水);
  }
}

function 读取JSON<T>(路径: string, 默认: T): T {
  if (!existsSync(路径)) return 默认;
  try {
    const 数据 = JSON.parse(readFileSync(路径, "utf-8")) as T;
    return 数据 ?? 默认;
  } catch (err) {
    console.warn(`[银行] 解析失败，忽略：${err instanceof Error ? err.message : String(err)}`);
    return 默认;
  }
}

function 写入JSON(路径: string, 数据: unknown): void {
  try {
    mkdirSync(dirname(路径), { recursive: true });
    const 临时 = `${路径}.tmp`;
    writeFileSync(临时, JSON.stringify(数据, null, 2), "utf-8");
    renameSync(临时, 路径);
  } catch (err) {
    console.warn(`[银行] 保存失败：${err instanceof Error ? err.message : String(err)}`);
  }
}
