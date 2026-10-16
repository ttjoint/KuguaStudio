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

import { existsSync, readFileSync, writeFileSync, mkdirSync, unlinkSync } from "node:fs";
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

/** 单实例锁信息 */
export interface 锁信息 {
  pid: number;
  /** 锁持有者启动时间（毫秒） */
  启动时间: number;
  /** 自定义标识（如 "webui"） */
  标识: string;
  /** 附加信息（如监听端口） */
  附加?: Record<string, unknown>;
}

/** 判定某 pid 是否仍在运行 */
function 进程存活(pid: number): boolean {
  if (!Number.isInteger(pid) || pid <= 0) return false;
  try {
    // 信号 0 仅做存在性/权限探测，不真正发信号
    process.kill(pid, 0);
    return true;
  } catch (err) {
    // EPERM 说明进程存在但无权限；ESRCH 说明不存在
    return (err as NodeJS.ErrnoException).code === "EPERM";
  }
}

/**
 * 单实例锁：同一把锁目录下只允许一个活跃持有者。
 *
 * 用法：
 *   const 锁 = 获取单实例锁(锁路径, "webui", { 端口: 24600 });
 *   if (!锁.获得) { console.log("已有实例：", 锁.已有?.pid); process.exit(0); }
 *   // 退出时 锁.释放()
 *
 * 实现：读取锁文件中的 pid，若该进程仍存活则视为「已有实例」；
 * 否则视为陈旧锁，直接覆盖。整个过程不发送任何信号，绝不误杀其它进程。
 */
export function 获取单实例锁(
  锁路径: string,
  标识 = "kugua",
  附加?: Record<string, unknown>,
): { 获得: boolean; 已有?: 锁信息; 释放: () => void } {
  const 读取 = (): 锁信息 | null => {
    try {
      if (!existsSync(锁路径)) return null;
      return JSON.parse(readFileSync(锁路径, "utf-8")) as 锁信息;
    } catch {
      return null;
    }
  };

  const 已有 = 读取();
  // 同一进程重复获取视为成功（幂等），其它存活进程持锁则拒绝
  if (已有 && 已有.pid !== process.pid && 进程存活(已有.pid)) {
    return { 获得: false, 已有, 释放: () => undefined };
  }

  const 信息: 锁信息 = { pid: process.pid, 启动时间: Date.now(), 标识, 附加 };
  try {
    mkdirSync(dirname(锁路径), { recursive: true });
    writeFileSync(锁路径, JSON.stringify(信息, null, 2), "utf-8");
  } catch {
    // 锁文件写入失败时降级为「无锁」运行（不阻塞启动）
    return { 获得: true, 释放: () => undefined };
  }

  return {
    获得: true,
    释放: () => {
      try {
        const 当前 = 读取();
        // 只删除属于自己的锁，避免误删新实例的锁
        if (当前 && 当前.pid === process.pid) unlinkSync(锁路径);
      } catch {
        /* 忽略 */
      }
    },
  };
}

/** 读取当前单实例锁（不修改），便于「已启动则探测」 */
export function 读取单实例锁(锁路径: string): 锁信息 | null {
  try {
    if (!existsSync(锁路径)) return null;
    const 信息 = JSON.parse(readFileSync(锁路径, "utf-8")) as 锁信息;
    return 进程存活(信息.pid) ? 信息 : null;
  } catch {
    return null;
  }
}
