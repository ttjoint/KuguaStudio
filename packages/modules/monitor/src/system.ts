/**
 * 系统状态采集：CPU（短间隔双采样）、内存、磁盘（Windows 走 CIM，POSIX 走 df）。
 * 磁盘结果做 10 秒缓存，避免高频调用反复拉起子进程。
 */

import { execFile } from "node:child_process";
import { arch, availableParallelism, cpus, freemem, hostname, platform, totalmem, uptime } from "node:os";

export interface 磁盘信息 {
  name: string;
  total: number;
  free: number;
  used: number;
  usagePct: number;
}

export interface 系统快照 {
  time: number;
  hostname: string;
  platform: string;
  arch: string;
  uptimeSec: number;
  cpu: { usagePct: number; cores: number; model: string };
  memory: { total: number; free: number; used: number; usagePct: number };
  disk: 磁盘信息[];
}

interface CPU样本 {
  总: number;
  空闲: number;
}

function 采样CPU时刻(): CPU样本 {
  let 总 = 0;
  let 空闲 = 0;
  for (const c of cpus()) {
    总 += c.times.user + c.times.nice + c.times.sys + c.times.idle + c.times.irq;
    空闲 += c.times.idle;
  }
  return { 总, 空闲 };
}

/** CPU 使用率：间隔采样两次求增量占比 */
export async function 采样CPU使用率(间隔毫秒 = 300): Promise<{ usagePct: number; cores: number; model: string }> {
  const 前 = 采样CPU时刻();
  await new Promise<void>((resolve) => setTimeout(resolve, 间隔毫秒));
  const 后 = 采样CPU时刻();
  const 总差 = 后.总 - 前.总;
  const 空闲差 = 后.空闲 - 前.空闲;
  const usagePct = 总差 > 0 ? Math.max(0, Math.min(100, ((总差 - 空闲差) / 总差) * 100)) : 0;
  return {
    usagePct,
    cores: availableParallelism() || cpus().length,
    model: cpus()[0]?.model ?? "",
  };
}

let 磁盘缓存: { time: number; data: 磁盘信息[] } | null = null;

/** 磁盘使用情况（带 10 秒缓存） */
export async function 采样磁盘(): Promise<磁盘信息[]> {
  const 现在 = Date.now();
  if (磁盘缓存 && 现在 - 磁盘缓存.time < 10000) return 磁盘缓存.data;
  const 数据 = platform() === "win32" ? await 读磁盘Windows() : await 读磁盘POSIX();
  磁盘缓存 = { time: 现在, data: 数据 };
  return 数据;
}

function 组装磁盘(name: unknown, total: unknown, free: unknown): 磁盘信息 {
  const t = typeof total === "number" && total > 0 ? total : 0;
  const f = typeof free === "number" && free >= 0 ? free : 0;
  return {
    name: String(name ?? "?"),
    total: t,
    free: f,
    used: Math.max(0, t - f),
    usagePct: t > 0 ? ((t - f) / t) * 100 : 0,
  };
}

function 读磁盘Windows(): Promise<磁盘信息[]> {
  return new Promise((resolve) => {
    execFile(
      "powershell",
      [
        "-NoProfile",
        "-NonInteractive",
        "-Command",
        "Get-CimInstance Win32_LogicalDisk -Filter \"DriveType=3\" | Select-Object DeviceID,Size,FreeSpace | ConvertTo-Json -Compress",
      ],
      { timeout: 4000, windowsHide: true },
      (err, stdout) => {
        if (err || !stdout.trim()) {
          resolve([]);
          return;
        }
        try {
          const 数据: unknown = JSON.parse(stdout.trim());
          const 列表 = Array.isArray(数据) ? 数据 : [数据];
          resolve(
            列表
              .filter((x): x is Record<string, unknown> => typeof x === "object" && x !== null && typeof x.Size === "number" && x.Size > 0)
              .map((x) => 组装磁盘(x.DeviceID, x.Size, x.FreeSpace)),
          );
        } catch {
          resolve([]);
        }
      },
    );
  });
}

function 读磁盘POSIX(): Promise<磁盘信息[]> {
  return new Promise((resolve) => {
    execFile("df", ["-kP"], { timeout: 4000, windowsHide: true }, (err, stdout) => {
      if (err || !stdout.trim()) {
        resolve([]);
        return;
      }
      const 结果: 磁盘信息[] = [];
      for (const 行 of stdout.split("\n").slice(1)) {
        const 段 = 行.trim().split(/\s+/);
        if (段.length < 6) continue;
        const 总 = Number(段[1]) * 1024;
        const 已用 = Number(段[2]) * 1024;
        if (!Number.isFinite(总) || 总 <= 0) continue;
        结果.push({
          name: 段[0],
          total: 总,
          free: 总 - 已用,
          used: 已用,
          usagePct: (已用 / 总) * 100,
        });
      }
      resolve(结果);
    });
  });
}

/** 采集完整系统快照 */
export async function 采集快照(): Promise<系统快照> {
  const [cpu, disk] = await Promise.all([采样CPU使用率(), 采样磁盘()]);
  const 内存总 = totalmem();
  const 内存空闲 = freemem();
  return {
    time: Date.now(),
    hostname: hostname(),
    platform: platform(),
    arch: arch(),
    uptimeSec: uptime(),
    cpu,
    memory: {
      total: 内存总,
      free: 内存空闲,
      used: 内存总 - 内存空闲,
      usagePct: 内存总 > 0 ? ((内存总 - 内存空闲) / 内存总) * 100 : 0,
    },
    disk,
  };
}
