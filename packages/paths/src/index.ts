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

/**
 * 全系统单例锁路径（与 cwd / 配置 / KUGUA_DATA_DIR 全部无关）。
 *
 * 目的：无论用什么端口、什么配置、什么数据目录、从哪个目录启动，
 * 整个操作系统只允许一个 Studio 实例。
 *
 * 位置：
 *  - Windows：`%LOCALAPPDATA%\KuguaStudio\studio.lock`
 *  - 其它：`$XDG_RUNTIME_DIR/kugua-studio/studio.lock` 或 `~/.kugua-studio/studio.lock`
 */
export function 全局单例锁路径(): string {
  const 显式 = process.env.KUGUA_GLOBAL_LOCK;
  if (显式) return resolve(显式);
  if (process.platform === "win32") {
    const 基 = process.env.LOCALAPPDATA ?? process.env.APPDATA ?? resolve(process.env.USERPROFILE ?? ".", "AppData", "Local");
    return resolve(基, "KuguaStudio", "studio.lock");
  }
  const 运行目录 = process.env.XDG_RUNTIME_DIR;
  if (运行目录) return resolve(运行目录, "kugua-studio", "studio.lock");
  return resolve(process.env.HOME ?? ".", ".kugua-studio", "studio.lock");
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
    if ((err as NodeJS.ErrnoException).code === "EPERM") return true;
  }
  return false;
}

/**
 * 判断锁里的 pid 是否**真的是**本平台的进程。
 *
 * 为什么光靠 `process.kill(pid, 0)` 不够：
 * Windows 上 PID 会被系统快速复用。旧实例异常退出后，同一个 pid 可能已被
 * 无关进程（浏览器、编辑器…）占用，`kill(pid,0)` 返回成功 → 误判「已有实例
 * 在运行」→ 新实例直接退出，用户看到「检测到已有实例（pid=xxx）」但那个
 * 进程根本不是苦瓜工作室，且无端口在监听。实测踩过这个坑。
 *
 * 这里在 POSIX 上用 `ps` 校验命令行含本平台标识；Windows 上用
 * `wmic`/`tasklist` 同样校验。都拿不到信息时**保守返回 true**（宁可让用户
 * 手动删锁，也不要误杀别的进程）。
 */
export function 是本平台进程(pid: number, 标识: string): boolean {
  // 非法 pid 直接判否（避免把 0/-1 当成有效目标）
  if (!Number.isInteger(pid) || pid <= 0) return false;
  // 先确认进程存在；不存在就没必要再查命令行
  if (!进程存活(pid)) return false;

  const 命令 = 取命令行(pid);
  // 拿不到命令行（无 ps/PowerShell、权限不足）：**信任存活判定**。
  // 不能因为探测工具缺失就把存活进程判为死——那会让正常实例互相抢占锁。
  if (命令 === null) return true;
  // 拿到了命令行：必须像 node 进程（防 Windows PID 复用给无关程序）
  return /node(\.exe)?/i.test(命令) || 命令.includes(标识);
}

/**
 * 取进程命令行；拿不到返回 null。
 *
 * 注意：Windows 11 已移除 wmic（实测 `wmic: command not found`），
 * 必须用 PowerShell 的 Get-CimInstance。这一步约 1s，只在启动时执行一次。
 */
function 取命令行(pid: number): string | null {
  try {
    const { execFileSync } = require("node:child_process") as typeof import("node:child_process");
    if (process.platform === "win32") {
      const 输出 = execFileSync(
        "powershell",
        [
          "-NoProfile",
          "-NonInteractive",
          "-Command",
          `(Get-CimInstance Win32_Process -Filter 'ProcessId=${pid}').CommandLine`,
        ],
        { encoding: "utf-8", timeout: 6000, windowsHide: true },
      );
      const 文本 = String(输出 ?? "").trim();
      return 文本 || null;
    }
    const 输出 = execFileSync("ps", ["-p", String(pid), "-o", "command="], {
      encoding: "utf-8",
      timeout: 3000,
    });
    const 文本 = String(输出 ?? "").trim();
    return 文本 || null;
  } catch {
    return null;
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
    // 存活 + 确实是本平台进程（防 Windows PID 复用导致的误判）
    return 进程存活(信息.pid) && 是本平台进程(信息.pid, 信息.标识 ?? "studio") ? 信息 : null;
  } catch {
    return null;
  }
}

/**
 * 全局单例抢占（原子）。
 *
 * 与 `获取单实例锁` 的区别：本函数用 `wx` 独占创建做**原子抢占**，
 * 因此两个进程同时启动时也只会有一个抢到（先读再写会有竞态）。
 *
 * 行为：
 *  - 锁文件不存在 → 创建并持有，`获得: true`
 *  - 锁文件存在且 pid 存活 → `获得: false`，返回已有实例信息
 *  - 锁文件存在但 pid 已死（陈旧锁）→ 删除后重新抢占
 *
 * 全程不发送任何信号，绝不误杀其它进程。
 */
export function 抢占全局单例锁(
  锁路径: string = 全局单例锁路径(),
  标识 = "studio",
  附加?: Record<string, unknown>,
): { 获得: boolean; 已有?: 锁信息; 锁路径: string; 释放: () => void } {
  const 无操作 = () => undefined;
  const 读取现有 = (): 锁信息 | null => {
    try {
      if (!existsSync(锁路径)) return null;
      return JSON.parse(readFileSync(锁路径, "utf-8")) as 锁信息;
    } catch {
      return null;
    }
  };

  const 尝试独占创建 = (): boolean => {
    try {
      mkdirSync(dirname(锁路径), { recursive: true });
      const 信息: 锁信息 = { pid: process.pid, 启动时间: Date.now(), 标识, 附加 };
      writeFileSync(锁路径, JSON.stringify(信息, null, 2), { encoding: "utf-8", flag: "wx" });
      return true;
    } catch (err) {
      if ((err as NodeJS.ErrnoException).code === "EEXIST") return false;
      // 写入失败（如权限不足）降级为「不阻塞启动」，避免无法使用
      return true;
    }
  };

  for (let 轮 = 0; 轮 < 3; 轮++) {
    if (尝试独占创建()) {
      return {
        获得: true,
        锁路径,
        释放: () => {
          try {
            const 当前 = 读取现有();
            // 只删自己的锁，绝不碰新实例的锁
            if (当前 && 当前.pid === process.pid) unlinkSync(锁路径);
          } catch {
            /* 忽略 */
          }
        },
      };
    }

    const 已有 = 读取现有();
    // 锁文件损坏或进程已死 → 视为陈旧锁，清掉后重试抢占
    if (!已有 || !进程存活(已有.pid) || 已有.pid === process.pid) {
      try {
        unlinkSync(锁路径);
      } catch {
        /* 已被其它进程清掉，下轮重试 */
      }
      continue;
    }
    return { 获得: false, 已有, 锁路径, 释放: 无操作 };
  }

  return { 获得: false, 已有: 读取现有() ?? undefined, 锁路径, 释放: 无操作 };
}
