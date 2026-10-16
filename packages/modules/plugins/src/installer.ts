/**
 * 插件安装 / 更新 / 卸载 / 市场索引工具
 * 对应文章架构的「应用市场与路由」与「自动下载、安装与更新」：
 *   - 市场索引：读取 GitHub raw 上的 plugins.json（JSON 数组）
 *   - 安装：git clone --depth 1 <repo> plugins/<name>，随后按需 npm install
 *   - 更新：git fetch 比较远端提交，git pull --ff-only，再装依赖并热重载
 *   - 卸载：校验路径在插件根目录内后递归删除
 */

import { existsSync, readFileSync, rmSync } from "node:fs";
import { join, resolve, sep } from "node:path";
import { spawn } from "node:child_process";

/** 市场条目（对应文章 plugins.json 结构） */
export interface 市场条目 {
  name: string;
  repo: string;
  author?: string;
  version?: string;
  description?: string;
  homepage?: string;
}

export interface 执行结果 {
  code: number;
  stdout: string;
  stderr: string;
}

/** 执行外部命令（git/npm），带超时与 windowsHide */
export function 执行命令(
  命令: string,
  参数: string[],
  选项: { cwd?: string; 超时毫秒?: number; 环境?: Record<string, string> } = {},
): Promise<执行结果> {
  return new Promise((resolvePromise, reject) => {
    const 子进程 = spawn(命令, 参数, {
      cwd: 选项.cwd,
      windowsHide: true,
      stdio: ["ignore", "pipe", "pipe"] as const,
      env: { ...process.env, ...选项.环境 },
    });
    let stdout = "";
    let stderr = "";
    子进程.stdout.on("data", (b: Buffer) => (stdout += b.toString()));
    子进程.stderr.on("data", (b: Buffer) => (stderr += b.toString()));
    const 定时 = setTimeout(() => {
      子进程.kill("SIGTERM");
    }, 选项.超时毫秒 ?? 120000);
    子进程.on("error", (err) => {
      clearTimeout(定时);
      reject(new Error(`无法启动 ${命令}：${err.message}`));
    });
    子进程.on("close", (code) => {
      clearTimeout(定时);
      resolvePromise({ code: code ?? -1, stdout, stderr });
    });
  });
}

/** 从仓库地址取插件名（最后一个路径段，去 .git） */
export function 从仓库URL取名(repo: string): string {
  const 清理 = repo.trim().replace(/\/+$/, "").replace(/\.git$/, "");
  const 段 = 清理.split(/[/\\]/).filter(Boolean);
  const 名 = 段[段.length - 1] ?? "";
  return 名.replace(/^[^a-zA-Z0-9_\-]+/, "").toLowerCase() || "plugin";
}

/** git clone（浅克隆）到目标目录 */
export async function 克隆仓库(repo: string, 目标目录: string, 超时毫秒 = 180000): Promise<void> {
  const 结果 = await 执行命令("git", ["clone", "--depth", "1", repo, 目标目录], { 超时毫秒 });
  if (结果.code !== 0) {
    throw new Error(
      `git clone 失败（${结果.code}）：${结果.stderr.trim() || 结果.stdout.trim() || "未知错误"}`,
    );
  }
}

/** 插件目录存在 package.json 时执行 npm install */
export async function 安装依赖(目录: string, 超时毫秒 = 300000): Promise<boolean> {
  if (!existsSync(join(目录, "package.json"))) return false;
  const 结果 = await 执行命令("npm", ["install", "--no-audit", "--no-fund"], {
    cwd: 目录,
    超时毫秒,
  });
  if (结果.code !== 0) {
    throw new Error(
      `依赖安装失败（${结果.code}）：${结果.stderr.trim() || 结果.stdout.trim() || "未知错误"}`,
    );
  }
  return true;
}

/** 检查 git 仓库是否落后远端（返回提交差异） */
export async function 检查更新(
  目录: string,
  超时毫秒 = 60000,
): Promise<{ 有更新: boolean; 原提交: string; 新提交: string }> {
  const 原结果 = await 执行命令("git", ["rev-parse", "HEAD"], { cwd: 目录, 超时毫秒 });
  if (原结果.code !== 0) throw new Error(`无法读取插件提交：${原结果.stderr.trim()}`);
  const 原提交 = 原结果.stdout.trim();
  const 分支结果 = await 执行命令("git", ["rev-parse", "--abbrev-ref", "HEAD"], { cwd: 目录, 超时毫秒 });
  const 分支 = 分支结果.stdout.trim();
  if (!分支 || 分支 === "HEAD") throw new Error("插件目录不是可更新的 git 仓库");
  const 抓取 = await 抓取远端(目录, 分支, 超时毫秒);
  if (抓取.code !== 0) throw new Error(`git fetch 失败：${抓取.stderr.trim()}`);
  const 新结果 = await 执行命令("git", ["rev-parse", `origin/${分支}`], { cwd: 目录, 超时毫秒 });
  if (新结果.code !== 0) throw new Error(`git rev-parse origin/${分支} 失败：${新结果.stderr.trim()}`);
  const 新提交 = 新结果.stdout.trim();
  return { 有更新: 原提交 !== 新提交, 原提交, 新提交 };
}

/** 拉取更新（浅克隆兼容：fetch --depth 1 + ff-only merge） */
export async function 拉取更新(目录: string, 超时毫秒 = 120000): Promise<void> {
  const 分支结果 = await 执行命令("git", ["rev-parse", "--abbrev-ref", "HEAD"], { cwd: 目录, 超时毫秒 });
  const 分支 = 分支结果.stdout.trim();
  if (!分支 || 分支 === "HEAD") throw new Error("无法确定当前分支");
  const 抓取 = await 抓取远端(目录, 分支, 超时毫秒);
  if (抓取.code !== 0) throw new Error(`git fetch 失败：${抓取.stderr.trim()}`);
  const 结果 = await 执行命令("git", ["merge", "--ff-only", `origin/${分支}`], { cwd: 目录, 超时毫秒 });
  if (结果.code !== 0) {
    throw new Error(
      `git merge --ff-only 失败（${结果.code}）：${结果.stderr.trim() || 结果.stdout.trim() || "未知错误"}`,
    );
  }
}

/**
 * 抓取远端：浅克隆（GitHub 场景）保持 --depth 1；
 * 完整克隆（如本地路径仓库）不做浅抓取，避免浅边界导致 merge 拒绝无关历史。
 */
async function 抓取远端(目录: string, 分支: string, 超时毫秒: number): Promise<执行结果> {
  const 浅结果 = await 执行命令("git", ["rev-parse", "--is-shallow-repository"], { cwd: 目录, 超时毫秒 });
  const 是浅 = 浅结果.code === 0 && 浅结果.stdout.trim() === "true";
  const 参数 = 是浅
    ? ["fetch", "--depth", "1", "origin", 分支]
    : ["fetch", "origin", 分支];
  return 执行命令("git", 参数, { cwd: 目录, 超时毫秒 });
}

/** 校验路径位于根目录内（防目录穿越，卸载前必检） */
export function 校验路径在目录内(目标: string, 根目录: string): boolean {
  const 目标真实 = resolve(目标);
  const 根真实 = resolve(根目录);
  return 目标真实 === 根真实 || 目标真实.startsWith(根真实 + sep);
}

/** 递归删除插件目录（调用前须通过校验） */
export function 删除插件目录(目标: string): void {
  rmSync(目标, { recursive: true, force: true });
}

/** 判断市场索引是否本地文件 */
function 是本地路径(url: string): boolean {
  return (
    url.startsWith("file://") ||
    url.startsWith("./") ||
    url.startsWith("../") ||
    url.startsWith("/") ||
    /^[A-Za-z]:[\\/]/.test(url)
  );
}

/** 抓取市场索引：GitHub raw / 本地文件 / 任意 HTTP URL */
export async function 抓取市场(url: string, 超时毫秒 = 15000): Promise<市场条目[]> {
  let 数据: unknown;
  if (是本地路径(url)) {
    const 路径 = url.startsWith("file://") ? new URL(url).pathname : resolve(url);
    if (!existsSync(路径)) throw new Error(`市场索引文件不存在：${路径}`);
    数据 = JSON.parse(readFileSync(路径, "utf-8"));
  } else {
    const res = await fetch(url, {
      headers: { "User-Agent": "KuguaStudio/0.1" },
      signal: AbortSignal.timeout(超时毫秒),
    });
    if (!res.ok) throw new Error(`市场索引获取失败：HTTP ${res.status}`);
    数据 = await res.json();
  }
  if (!Array.isArray(数据)) throw new Error("市场索引格式非法：应为数组");
  return (数据 as unknown[]).map((条目, i) => {
    const 项 = (条目 ?? {}) as Record<string, unknown>;
    if (typeof 项.name !== "string" || typeof 项.repo !== "string") {
      throw new Error(`市场索引第 ${i} 条缺少 name/repo`);
    }
    return {
      name: 项.name,
      repo: 项.repo,
      author: typeof 项.author === "string" ? 项.author : undefined,
      version: typeof 项.version === "string" ? 项.version : undefined,
      description: typeof 项.description === "string" ? 项.description : undefined,
      homepage: typeof 项.homepage === "string" ? 项.homepage : undefined,
    };
  });
}
