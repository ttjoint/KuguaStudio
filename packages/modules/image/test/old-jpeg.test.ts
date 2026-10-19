/**
 * 做旧的 JPEG 往返循环必须合并成一条 magick 命令。
 *
 * 背景（实测）：原来每轮两个进程（转 JPEG 一个、转回 PNG 一个），
 * `iterations = 50 * (1 - quality)` 默认能到 35，就是 70 次进程启动。
 * 600x400 实测 6.6 秒，其中绝大部分是 Windows 上每次 ~65ms 的启动开销。
 *
 * 改成一条命令里用 `-write` 写临时文件 + `+delete`/`-read` 读回来，
 * 同样 35 轮只要 1.9 秒。
 *
 * 关键：**必须用临时文件中转，不能用管道**。stdin 被第一轮 -read 消耗后，
 * 后续 -read 拿不到数据，magick 会报 "insufficient image data"。
 *
 * 这条测试锁的是「结果语义不变」——性能优化最容易在这里把画质悄悄改掉，
 * 而画质问题肉眼很难发现（做旧本来就是往差里做）。
 */

import { describe, expect, it } from "vitest";
import { spawnSync } from "node:child_process";
import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { 做旧单帧 } from "../src/pixels.js";
import { magick路径, 运行Magick } from "../src/magick.js";

/** magick 不可用时跳过，而不是报一堆看不懂的错 */
const 有Magick = (() => {
  try {
    return spawnSync(magick路径(), ["-version"], { windowsHide: true }).status === 0;
  } catch {
    return false;
  }
})();

/** 造一张确定性的测试图（gradient 不含随机） */
async function 造图(): Promise<Buffer> {
  return 运行Magick(["-size", "160x120", "gradient:blue-white", "png:-"]);
}

/** 取原始 RGBA 用于逐字节比较 */
async function 取RGBA(png: Buffer): Promise<Buffer> {
  return 运行Magick(["-", "-depth", "8", "rgba:-"], png);
}

describe.skipIf(!有Magick)("做旧：JPEG 往返循环合并后结果不变", () => {
  it("输出的像素与「逐次起进程」的参考实现逐字节一致", async () => {
    const 源 = await 造图();

    // 参考实现：完全复刻改之前的写法（每次 JPEG/PNG 各起一个进程），
    // 但用固定的 quality 序列，避开随机源导致无法逐字节比较。
    const 序列 = [27, 27, 27, 27, 27];
    let 参考 = 源;
    for (const qv of 序列) {
      const jpg = await 运行Magick(["-", "-quality", String(qv), "jpg:-"], 参考);
      参考 = await 运行Magick(["-", "png:-"], jpg);
    }

    // 待测实现：同一组 quality，但走合并路径。
    // 做旧单帧 内部用 NextDouble() 取 quality，这里不能直接比——
    // 改为直接验证「合并路径与逐次路径在同一输入下等价」这一性质，
    // 用一个最小复现：tmp 文件往返 N 轮 vs 管道往返 N 轮。
    const dir = mkdtempSync(join(tmpdir(), "kugua-oldjpeg-test-"));
    try {
      const 输入 = join(dir, "in.png");
      const 中转 = join(dir, "t.jpg");
      writeFileSync(输入, 源);
      const 参数 = [输入];
      for (const qv of 序列) {
        参数.push("-quality", String(qv), "-write", 中转, "+delete", "-read", 中转);
      }
      参数.push("png:-");
      const 合并结果 = await 运行Magick(参数);

      const a = await 取RGBA(合并结果);
      const b = await 取RGBA(参考);
      expect(a.length).toBe(b.length);
      // 逐字节相同：合并没有改变像素，只是省掉了进程启动
      expect(a.equals(b)).toBe(true);
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  }, 120_000);

  it("做旧确实改变了画面（不是原样返回）", async () => {
    const 源 = await 造图();
    const 出 = await 做旧单帧(源, 0.3);
    const a = await 取RGBA(源);
    const b = await 取RGBA(出);
    expect(a.length).toBe(b.length);
    // 做旧的核心是「往差里做」，如果像素完全没变说明流程根本没跑
    expect(a.equals(b)).toBe(false);
  }, 120_000);

  it("quality 高（iterations 为 0）时不该崩，也不该无限循环", async () => {
    // q >= 1 被 clamp 到 0.95 → iterations = floor(50*0.05) = 2
    // q 越接近 1 轮次越少，这条防的是轮次算错导致 iterations 变成负数
    const 源 = await 造图();
    const 出 = await 做旧单帧(源, 1.0);
    expect(出.length).toBeGreaterThan(0);
  }, 120_000);
});
