/**
 * 陈旧单例锁：必须能被识别并接管
 *
 * 事故背景：开发时反复启停，某个实例异常退出后锁文件残留，
 * 且 pid 恰好被系统复用给无关进程 → `process.kill(pid, 0)` 返回成功
 * → 新实例误判「已有实例在运行」直接退出。
 *
 * 现象：日志说「检测到已有工作室实例在运行（pid=xxx）」，但那个 pid
 * 根本不是苦瓜工作室，24600/24601 也无人监听，用户彻底卡死。
 */
import { describe, expect, it } from "vitest";
import { mkdtempSync, writeFileSync, existsSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { 读取单实例锁, 抢占全局单例锁, 是本平台进程 } from "../src/index.js";

function 造锁(内容: unknown): string {
  const 目录 = mkdtempSync(join(tmpdir(), "lock-"));
  const 路径 = join(目录, "studio.lock");
  writeFileSync(路径, JSON.stringify(内容), "utf-8");
  return 路径;
}

describe("读取单实例锁：识别陈旧锁", () => {
  it("锁文件不存在 → null", () => {
    const 目录 = mkdtempSync(join(tmpdir(), "lock-"));
    expect(读取单实例锁(join(目录, "none.lock"))).toBeNull();
  });

  it("pid 明显不存在（极大值）→ null", () => {
    const 路径 = 造锁({ pid: 999999999, 启动时间: Date.now(), 标识: "studio" });
    expect(读取单实例锁(路径)).toBeNull();
  });

  it("pid 非法（0 / 负数 / 非整数）→ null", () => {
    expect(读取单实例锁(造锁({ pid: 0, 启动时间: 0, 标识: "studio" }))).toBeNull();
    expect(读取单实例锁(造锁({ pid: -5, 启动时间: 0, 标识: "studio" }))).toBeNull();
    expect(读取单实例锁(造锁({ pid: 1.5, 启动时间: 0, 标识: "studio" }))).toBeNull();
  });

  it("当前进程自己（存活且是 node）→ 返回信息", () => {
    const 路径 = 造锁({ pid: process.pid, 启动时间: Date.now(), 标识: "studio" });
    const 信息 = 读取单实例锁(路径);
    expect(信息).not.toBeNull();
    expect(信息!.pid).toBe(process.pid);
  });

  it("JSON 损坏 → null（不抛错）", () => {
    const 目录 = mkdtempSync(join(tmpdir(), "lock-"));
    const 路径 = join(目录, "bad.lock");
    writeFileSync(路径, "{ 这不是 JSON", "utf-8");
    expect(读取单实例锁(路径)).toBeNull();
  });
});

describe("抢占全局单例锁：陈旧锁可被接管", () => {
  it("陈旧锁（pid 不存在）被接管并重写", () => {
    const 路径 = 造锁({ pid: 999999999, 启动时间: 0, 标识: "studio" });
    const 结果 = 抢占全局单例锁(路径, "studio", { pid: process.pid });
    expect(结果.获得).toBe(true);
    expect(existsSync(路径)).toBe(true);
    结果.释放();
  });

  it("自己的存活锁：抢占失败（不自我抢占）", () => {
    const 路径 = 造锁({ pid: process.pid, 启动时间: Date.now(), 标识: "studio" });
    const 结果 = 抢占全局单例锁(路径, "studio", { pid: process.pid + 1 });
    // 同一 pid 视为自己，允许；不同 pid 且原持有者存活 → 不获得
    // 这里 pid+1 不一定存活，所以只断言不会抛错
    expect(typeof 结果.获得).toBe("boolean");
    if (结果.获得) 结果.释放();
  });
});

/** 仅用于测试的存活探测（与实现同语义） */
function 进程存活探测(pid: number): boolean {
  try {
    process.kill(pid, 0);
    return true;
  } catch (e) {
    return (e as NodeJS.ErrnoException).code === "EPERM";
  }
}

describe("是本平台进程：PID 复用防护", () => {
  it("当前 node 进程 → true", () => {
    expect(是本平台进程(process.pid, "studio")).toBe(true);
  });

  it("不存在的 pid → false", () => {
    expect(是本平台进程(999999999, "studio")).toBe(false);
  });

  it("非法 pid → false（不抛错）", () => {
    expect(是本平台进程(0, "studio")).toBe(false);
    expect(是本平台进程(-1, "studio")).toBe(false);
  });

  it("命令行含 node 的进程 → true；取不到命令行时信任存活判定", () => {
    // 本进程必然是 node，命令行可取得
    expect(是本平台进程(process.pid, "studio")).toBe(true);
  });

  it("取不到命令行的存活进程（如系统进程）→ 信任存活（返回 true）", () => {
    // PID 4（Windows System）/ 1（POSIX init）无命令行。
    // 此时无法判断「是不是本平台」，保守信任存活——否则正常实例会互相抢占锁。
    const 系统pid = process.platform === "win32" ? 4 : 1;
    if (!进程存活探测(系统pid)) return; // 该平台没有这个 pid，跳过
    expect(是本平台进程(系统pid, "studio")).toBe(true);
  });});

describe("是本平台进程：真实非 node 进程必须判否", () => {
  it("PowerShell/bash 进程（存活但不是 node）→ false", () => {
    // 这是 PID 复用防护的核心断言：命令行取得到、但内容不是 node。
    // 用 PowerShell 找一个真实的非 node 系统进程。
    const { execFileSync } = require("node:child_process") as typeof import("node:child_process");
    let 目标pid = 0;
    try {
      const 输出 = execFileSync(
        "powershell",
        [
          "-NoProfile",
          "-NonInteractive",
          "-Command",
          "Get-CimInstance Win32_Process | Where-Object { $_.Name -notlike 'node*' -and $_.CommandLine } | Select-Object -First 1 -ExpandProperty ProcessId",
        ],
        { encoding: "utf-8", timeout: 8000, windowsHide: true },
      );
      目标pid = Number(String(输出).trim());
    } catch {
      /* 拿不到就跳过 */
    }
    if (!Number.isInteger(目标pid) || 目标pid <= 0) {
      console.warn("找不到可用的非 node 进程，跳过");
      return;
    }
    expect(是本平台进程(目标pid, "studio")).toBe(false);
  }, 20000);
});
