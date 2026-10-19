/**
 * 测试端口分配不能返回重复端口。
 *
 * 这条看着像在测「测试工具」，实际守的是一个踩过的真坑：
 *
 * 原来三个集成测试文件都用「`listen(0)` 拿系统分配端口再 `close()`」的写法。
 * 这在全量跑时会偶发 `listen EACCES: permission denied`——绑 0 拿到的是动态段
 * （49152–65535）端口，而 Hyper-V / WinNAT 会保留其中若干段，落进保留段不是
 * 「被占用」而是「根本不让绑」。
 *
 * 改成固定段后，又立刻踩了第二个坑：同一文件要「主控 + WebUI」两个端口，
 * 如果每次都从基数开始扫，两次调用返回同一个值，两个子进程抢同一端口——
 * 表现为启动超时，看着像被测代码坏了（当时 `startup-robustness` 两红、
 * `--port 能覆盖` 那条直接报 `expected 26400 not to be 26400`）。
 *
 * 所以这里锁两件事：
 *   1. 同一基数连续取，必须拿到互不相同的端口
 *   2. 取到的端口真的能绑（不是超范围或落进保留段）
 */

import { describe, expect, it } from "vitest";
import { createServer } from "node:net";
import { 取测试端口, 取测试端口组, 端口段 } from "./port-pool.js";

/** 真去绑一下，确认可用 */
function 能绑(端口: number): Promise<boolean> {
  return new Promise((res) => {
    const s = createServer();
    let 结束 = false;
    const 收尾 = (v: boolean) => {
      if (结束) return;
      结束 = true;
      s.close(() => res(v));
    };
    s.once("error", () => 收尾(false));
    s.listen(端口, "127.0.0.1", () => 收尾(true));
  });
}

describe("测试端口分配", () => {
  it("同一基数连续取多次，端口互不相同", async () => {
    const 基数 = 27600; // 专门给这条测试留的段，不与其他文件共用
    const 甲 = await 取测试端口(基数);
    const 乙 = await 取测试端口(基数);
    const 丙 = await 取测试端口(基数);

    expect(甲).not.toBe(乙);
    expect(乙).not.toBe(丙);
    expect(甲).not.toBe(丙);
  });

  it("取到的端口落在指定段内", async () => {
    const 基数 = 27700;
    const 端口 = await 取测试端口(基数, 20);
    expect(端口).toBeGreaterThanOrEqual(基数);
    expect(端口).toBeLessThan(基数 + 20);
  });

  it("取到的端口真的绑得上", async () => {
    const 端口 = await 取测试端口(27800, 20);
    expect(await 能绑(端口)).toBe(true);
  });

  it("取测试端口组 一次拿齐 n 个互不相同的端口", async () => {
    const 组 = await 取测试端口组(27900, 3, 20);
    expect(组).toHaveLength(3);
    expect(new Set(组).size).toBe(3);
  });

  it("各文件登记的段互不重叠", () => {
    const 段们 = Object.values(端口段);
    // 每个文件至少要用 2 个端口（主控 + WebUI），多的能到 20+
    // 段基数间隔 200，配合跨度 40 足够，不会互相盖到
    const 排序 = [...段们].sort((a, b) => a - b);
    for (let i = 1; i < 排序.length; i++) {
      expect(排序[i] - 排序[i - 1]).toBeGreaterThanOrEqual(200);
    }
    // 不能与用户实例的端口撞车（主控默认 24601、桌面壳 24600）
    for (const 基 of 段们) {
      expect(基).toBeGreaterThan(25000);
      expect(基).toBeLessThan(49152); // 不进 Windows 动态段
    }
  });
});
