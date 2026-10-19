/**
 * 拆帧类动作不该把帧再合成回 GIF。
 *
 * 背景（实测）：`多帧结果` 原来无条件调 `合帧为GIF`，于是 `gifUnzip`
 * 拆完 30 帧还要再合一次——多花 850ms、多传 3.7MB，而用户要的只是那些帧。
 *
 * 「拆」和「改」是两种语义：
 *   - 拆（gifUnzip / gifUnzipGrid）：帧本身就是结果，合回去纯属浪费
 *   - 改（倍速 / 乱序 / 删帧）：必须合回 GIF，否则用户拿不到动画
 *
 * 所以这条测试分两半：一半锁「拆不合帧」，一半锁「改必须合帧」。
 * 只测前者的话，把 合帧 开关默认关掉也能全绿——那就把改帧类全弄坏了。
 */

import { describe, expect, it, beforeAll } from "vitest";
import { spawn, spawnSync } from "node:child_process";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import {
  gifSpeed,
  gifUnzip,
  gifUnzipGrid,
  gifShuffle,
  gifRemoveFrame,
} from "../src/gif.js";
import { magick路径 } from "../src/magick.js";

/** 造一个 N 帧小 GIF：纯色块 + 居中帧号，便于肉眼确认帧序 */
function 造GIF(帧数: number): Promise<Buffer> {
  const dir = mkdtempSync(join(tmpdir(), "kugua-gif-test-"));
  const 帧文件: string[] = [];
  for (let i = 0; i < 帧数; i++) {
    const f = join(dir, `f${String(i).padStart(2, "0")}.png`);
    帧文件.push(f);
    // 每帧颜色不同，拆回来能看出是不是同一帧
    const r = 40 + i * 20;
    写PNG(f, `rgb(${r},100,200)`, String(i));
  }
  return new Promise((res, rej) => {
    const p = spawn(magick路径(), ["-delay", "10", "-loop", "0", ...帧文件, "gif:-"], {
      windowsHide: true,
    });
    const 出: Buffer[] = [];
    const 错: Buffer[] = [];
    p.stdout.on("data", (d: Buffer) => 出.push(d));
    p.stderr.on("data", (d: Buffer) => 错.push(d));
    p.on("error", rej);
    p.on("close", (码) => {
      rmSync(dir, { recursive: true, force: true });
      if (码 === 0) res(Buffer.concat(出));
      else rej(new Error(`造 GIF 失败：${Buffer.concat(错).toString().slice(0, 200)}`));
    });
  });
}

/** 同步生成单帧 PNG（spawnSync 更简单，测试里不必异步） */
function 写PNG(路径: string, 颜色: string, 文字: string): void {
  const r = spawnSync(
    magick路径(),
    [
      "-size", "120x90", `xc:${颜色}`,
      "-pointsize", "36", "-fill", "white", "-gravity", "center",
      "-annotate", "0", 文字,
      路径,
    ],
    { windowsHide: true },
  );
  if (r.status !== 0) throw new Error(`写 PNG 失败：${String(r.stderr).slice(0, 200)}`);
}

/** 判断 base64 内容是不是 GIF（前三字节 GIF） */
function 是GIF(base64: string): boolean {
  return Buffer.from(base64, "base64").subarray(0, 3).toString() === "GIF";
}

/** magick 不可用时跳过整个文件，而不是报一堆看不懂的错 */
const 有Magick = (() => {
  try {
    return spawnSync(magick路径(), ["-version"], { windowsHide: true }).status === 0;
  } catch {
    return false;
  }
})();

describe.skipIf(!有Magick)("GIF 拆帧：拆不合帧，改必须合帧", () => {
  let gif: Buffer;
  beforeAll(async () => {
    gif = await 造GIF(6);
  }, 60_000);

  describe("拆类动作不应该合回 GIF", () => {
    it("gifUnzip 返回帧，主图不是 GIF", async () => {
      const r = await gifUnzip(gif);
      expect(r.format).toBe("png");
      expect(r.images).toHaveLength(6);
      // 关键断言：改前这里是 true（合了一次 GIF，白花 850ms）
      expect(是GIF(r.base64)).toBe(false);
    }, 60_000);

    it("gifUnzipGrid 返回碎片，主图不是 GIF", async () => {
      const r = await gifUnzipGrid(gif, 2, 2);
      expect(r.format).toBe("png");
      expect(r.images).toHaveLength(4);
      expect(是GIF(r.base64)).toBe(false);
    }, 60_000);

    it("拆出来的帧仍是完整可用的图（不是空占位）", async () => {
      const r = await gifUnzip(gif);
      // 每帧都该是合法 PNG：PNG 魔数 89 50 4E 47
      for (const b64 of r.images) {
        const 头 = Buffer.from(b64, "base64").subarray(0, 4);
        expect([...头]).toEqual([0x89, 0x50, 0x4e, 0x47]);
      }
    }, 60_000);
  });

  /**
   * 这一组是「反向保护」：如果为了省掉合帧而把 合帧 默认关掉，
   * 下面这些改帧动作会拿不到 GIF——用户看到的是静不住的静态图。
   */
  describe("改帧类动作必须合回 GIF", () => {
    it("gifSpeed 改帧后仍是 GIF", async () => {
      const r = await gifSpeed(gif, 2);
      expect(r.format).toBe("gif");
      expect(是GIF(r.base64)).toBe(true);
      expect(r.images).toHaveLength(6);
    }, 60_000);

    it("gifShuffle 打乱后仍是 GIF", async () => {
      const r = await gifShuffle(gif);
      expect(r.format).toBe("gif");
      expect(是GIF(r.base64)).toBe(true);
    }, 60_000);

    it("gifRemoveFrame 删帧后仍是 GIF，且帧数真的少了", async () => {
      // 参数语义是复刻参考项目的：begin=0 / count=2 实际会删 3 帧
      // （内部用 `删.length > c` 才 break，等效 c+1）。这里只断言「少了」，
      // 不锁死具体帧数——那是另一个模块的既有语义，与本文件要守的
      // 「改帧必须合回 GIF」无关，写死只会让将来调整删帧语义时误伤。
      const r = await gifRemoveFrame(gif, 0, 2);
      expect(r.format).toBe("gif");
      expect(是GIF(r.base64)).toBe(true);
      expect(r.images.length).toBeLessThan(6);
      expect(r.images.length).toBeGreaterThan(0);
    }, 60_000);
  });
});
