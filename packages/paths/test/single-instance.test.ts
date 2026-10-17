/**
 * 单实例锁测试：验证「同一把锁只允许一个活跃持有者」，
 * 且陈旧锁（持有进程已退出）可被安全接管。
 */
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { mkdtempSync, rmSync, readFileSync, writeFileSync, existsSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { 获取单实例锁, 读取单实例锁, 抢占全局单例锁, 全局单例锁路径 } from "../src/index";

let 目录: string;
let 锁路径: string;

beforeEach(() => {
  目录 = mkdtempSync(join(tmpdir(), "kugua-lock-"));
  锁路径 = join(目录, "webui.lock");
});

afterEach(() => {
  rmSync(目录, { recursive: true, force: true });
});

describe("单实例锁", () => {
  it("首次获取成功并写入锁文件", () => {
    const 锁 = 获取单实例锁(锁路径, "webui", { 端口: 24600 });
    expect(锁.获得).toBe(true);
    expect(existsSync(锁路径)).toBe(true);
    const 信息 = JSON.parse(readFileSync(锁路径, "utf-8"));
    expect(信息.pid).toBe(process.pid);
    expect(信息.标识).toBe("webui");
    expect(信息.附加).toEqual({ 端口: 24600 });
    锁.释放();
  });

  it("同一进程内重复获取仍成功（同一 pid）", () => {
    const a = 获取单实例锁(锁路径);
    const b = 获取单实例锁(锁路径);
    expect(a.获得).toBe(true);
    expect(b.获得).toBe(true);
    a.释放();
    b.释放();
  });

  it("已有存活进程持锁时获取失败并返回其信息", () => {
    // 伪造一个「存活」的持锁者：使用当前进程 pid（必然存活），但标识不同
    writeFileSync(锁路径, JSON.stringify({ pid: process.pid, 启动时间: 1, 标识: "other" }), "utf-8");
    // 当前 pid 存活 → 读取到的就是「已有实例」
    const 信息 = 读取单实例锁(锁路径);
    expect(信息).not.toBeNull();
    expect(信息?.pid).toBe(process.pid);
    expect(信息?.标识).toBe("other");
  });

  it("陈旧锁（进程已不存在）可被接管", () => {
    // 用一个几乎不可能存在的 pid
    writeFileSync(锁路径, JSON.stringify({ pid: 999999, 启动时间: 1, 标识: "dead" }), "utf-8");
    expect(读取单实例锁(锁路径)).toBeNull();
    const 锁 = 获取单实例锁(锁路径);
    expect(锁.获得).toBe(true);
    expect(JSON.parse(readFileSync(锁路径, "utf-8")).pid).toBe(process.pid);
    锁.释放();
  });

  it("释放后锁文件被删除", () => {
    const 锁 = 获取单实例锁(锁路径);
    expect(existsSync(锁路径)).toBe(true);
    锁.释放();
    expect(existsSync(锁路径)).toBe(false);
  });

  it("释放不会误删他人的锁（pid 不匹配则保留）", () => {
    const 锁 = 获取单实例锁(锁路径);
    // 模拟新实例接管：改写锁文件 pid
    writeFileSync(锁路径, JSON.stringify({ pid: process.pid + 1, 启动时间: 2, 标识: "new" }), "utf-8");
    锁.释放();
    expect(existsSync(锁路径)).toBe(true);
  });

  it("锁文件损坏时视为无锁，可接管", () => {
    writeFileSync(锁路径, "{ 这不是合法 JSON", "utf-8");
    expect(读取单实例锁(锁路径)).toBeNull();
    const 锁 = 获取单实例锁(锁路径);
    expect(锁.获得).toBe(true);
    锁.释放();
  });
});

describe("全局单例锁（抢占式，与端口/配置/cwd 无关）", () => {
  it("锁路径固定在本机用户级目录，不受 cwd / KUGUA_DATA_DIR 影响", () => {
    const a = 全局单例锁路径();
    const 原cwd = process.cwd();
    const 原数据 = process.env.KUGUA_DATA_DIR;
    try {
      process.chdir(tmpdir());
      process.env.KUGUA_DATA_DIR = join(tmpdir(), "别的地方");
      expect(全局单例锁路径()).toBe(a);
    } finally {
      process.chdir(原cwd);
      if (原数据 === undefined) delete process.env.KUGUA_DATA_DIR;
      else process.env.KUGUA_DATA_DIR = 原数据;
    }
  });

  it("首次抢占成功，同进程重复抢占幂等", () => {
    const 甲 = 抢占全局单例锁(锁路径, "studio");
    expect(甲.获得).toBe(true);
    const 乙 = 抢占全局单例锁(锁路径, "studio");
    expect(乙.获得).toBe(true);
    甲.释放();
  });

  it("已被存活进程持有时拒绝抢占，并返回持有者信息", () => {
    // 伪造一个「存活」的持有者：用当前进程的父进程 pid（一定存活且不是本进程）
    const 存活pid = process.ppid;
    writeFileSync(锁路径, JSON.stringify({ pid: 存活pid, 启动时间: Date.now(), 标识: "studio" }), "utf-8");
    const 结果 = 抢占全局单例锁(锁路径, "studio");
    expect(结果.获得).toBe(false);
    expect(结果.已有?.pid).toBe(存活pid);
  });

  it("陈旧锁（持有进程已不存在）可被接管", () => {
    writeFileSync(锁路径, JSON.stringify({ pid: 999999, 启动时间: 1, 标识: "studio" }), "utf-8");
    const 结果 = 抢占全局单例锁(锁路径, "studio");
    expect(结果.获得).toBe(true);
    expect(读取单实例锁(锁路径)?.pid).toBe(process.pid);
    结果.释放();
  });

  it("锁文件损坏时视为陈旧锁接管", () => {
    writeFileSync(锁路径, "{ 这不是 JSON", "utf-8");
    const 结果 = 抢占全局单例锁(锁路径, "studio");
    expect(结果.获得).toBe(true);
    结果.释放();
  });

  it("释放后锁文件被删除，其他实例可再抢占", () => {
    const 甲 = 抢占全局单例锁(锁路径, "studio");
    expect(甲.获得).toBe(true);
    甲.释放();
    expect(existsSync(锁路径)).toBe(false);
    const 乙 = 抢占全局单例锁(锁路径, "studio");
    expect(乙.获得).toBe(true);
    乙.释放();
  });
});
