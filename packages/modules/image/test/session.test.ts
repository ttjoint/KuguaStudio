/**
 * 会话目录管理的测试。
 *
 * ## 这里真正要防的是什么
 *
 * 1. **目录穿越**：`在会话内()` 是编辑页路径白名单的唯一判据。它错一个字符，
 *    前端就能让 WebUI 读 `C:\Windows\System32\...`。
 * 2. **残留**：会话目录不删，`%TEMP%` 会一直攒 `kugua-image-*`，
 *    用户永远不去清，而且没人会想到是图片模块干的。
 */

import { afterEach, describe, expect, it } from "vitest";
import { existsSync, mkdirSync, rmSync, writeFileSync, utimesSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

import {
  打开会话,
  会话合法,
  在会话内,
  释放会话,
  释放全部会话,
  清掉过旧会话,
  活会话列表,
} from "../src/session.js";

/** 本文件建的目录，测试后清干净（避免污染真实 tmp） */
const 已建: string[] = [];
afterEach(() => {
  // 先按 id 释放，再兜底删
  for (const 目录 of 已建.splice(0)) {
    try {
      释放会话(目录.slice(目录.lastIndexOf("kugua-image-") + "kugua-image-".length));
    } catch {
      // ignore
    }
    try {
      rmSync(目录, { recursive: true, force: true });
    } catch {
      // ignore
    }
  }
});

describe("会话 id 校验", () => {
  it("接受正常 id", () => {
    expect(会话合法("abc123")).toBe(true);
    expect(会话合法("A-b_c")).toBe(true);
    expect(会话合法("x".repeat(64))).toBe(true);
  });

  it("拒绝空串和超长", () => {
    expect(会话合法("")).toBe(false);
    expect(会话合法("x".repeat(65))).toBe(false);
  });

  it("拒绝目录穿越与路径分隔符", () => {
    expect(会话合法("../etc")).toBe(false);
    expect(会话合法("a/b")).toBe(false);
    expect(会话合法("a\\b")).toBe(false);
    expect(会话合法("..")).toBe(false);
    expect(会话合法(".")).toBe(false);
  });

  it("拒绝非字符串", () => {
    expect(会话合法(undefined)).toBe(false);
    expect(会话合法(null)).toBe(false);
    expect(会话合法(123)).toBe(false);
    expect(会话合法({})).toBe(false);
  });

  it("拒绝 Windows 盘符与空格", () => {
    expect(会话合法("C:")).toBe(false);
    expect(会话合法("a b")).toBe(false);
  });
});

describe("打开会话", () => {
  it("不传 id 时新建一个", () => {
    const { 会话, 目录 } = 打开会话();
    已建.push(目录);
    expect(会话合法(会话)).toBe(true);
    expect(existsSync(目录)).toBe(true);
    expect(目录.startsWith(tmpdir())).toBe(true);
  });

  it("两次新建得到不同 id", () => {
    const a = 打开会话();
    const b = 打开会话();
    已建.push(a.目录, b.目录);
    expect(a.会话).not.toBe(b.会话);
  });

  it("传合法 id 时复用同一个目录", () => {
    const id = "reuse" + Date.now().toString(36);
    const a = 打开会话(id);
    已建.push(a.目录);
    expect(a.会话).toBe(id);
    expect(a.复用).toBeUndefined(); // 复用标记由调用方给
    const b = 打开会话(id);
    expect(b.目录).toBe(a.目录);
    expect(b.会话).toBe(id);
  });

  it("传非法 id 时不复用，改为新建（不能因为前端乱传就拼出坏路径）", () => {
    const { 会话, 目录 } = 打开会话("../../evil");
    已建.push(目录);
    expect(会话).not.toBe("../../evil");
    expect(会话合法(会话)).toBe(true);
    expect(在会话内(目录)).toBe(true);
  });

  it("新建的目录记进活会话表", () => {
    const { 目录 } = 打开会话();
    已建.push(目录);
    expect(活会话列表().some((p) => p === 目录)).toBe(true);
  });
});

describe("在会话内 —— 编辑页路径白名单", () => {
  it("会话目录里的文件通过", () => {
    const { 目录 } = 打开会话();
    已建.push(目录);
    const 文件 = join(目录, "结果-1.png");
    writeFileSync(文件, "x");
    expect(在会话内(文件)).toBe(true);
  });

  it("会话目录里的多级路径也通过", () => {
    const { 目录 } = 打开会话();
    已建.push(目录);
    const 子 = join(目录, "frames");
    mkdirSync(子, { recursive: true });
    expect(在会话内(join(子, "f-1.png"))).toBe(true);
  });

  it("tmp 下但不是会话目录的路径被拒", () => {
    const 别的 = join(tmpdir(), "kugua-drop", "x.png");
    expect(在会话内(别的)).toBe(false);
  });

  it("目录名整体必须严格是 kugua-image-<合法id>", () => {
    // 容易写错的地方：`绝对.startsWith(根)` 会让
    // `kugua-image-abcXXXX` 通过 `kugua-image-abc` 的检查。
    // 这里 abc-evil 本身是个合法 id（连字符允许），所以它**确实**是
    // 一个会话目录——不算穿越。真正要拒的是 id 段里带非法字符的。
    expect(在会话内(join(tmpdir(), "kugua-image-abc-evil", "x.png"))).toBe(true);
    expect(在会话内(join(tmpdir(), "kugua-image-ab..c", "x.png"))).toBe(false);
    expect(在会话内(join(tmpdir(), "kugua-image-", "x.png"))).toBe(false);
  });

  it("会话目录的上级目录本身被拒（必须是文件而非目录）", () => {
    const { 目录 } = 打开会话();
    已建.push(目录);
    // 目录本身没扩展名，也不在「文件」语义里——但更要紧的是别让
    // `..` 生效。传目录 + ".." 必须落到会话目录外
    expect(在会话内(join(目录, "..", "别的.txt"))).toBe(false);
  });

  it("系统盘任意路径被拒", () => {
    expect(在会话内("C:\\Windows\\System32\\drivers\\etc\\hosts")).toBe(false);
    expect(在会话内("/etc/passwd")).toBe(false);
  });

  it("空值和非字符串被拒", () => {
    expect(在会话内("")).toBe(false);
    expect(在会话内(undefined as never)).toBe(false);
    expect(在会话内(null as never)).toBe(false);
  });
});

describe("释放会话", () => {
  it("删掉目录", () => {
    const { 会话, 目录 } = 打开会话();
    expect(existsSync(目录)).toBe(true);
    expect(释放会话(会话)).toBe(true);
    expect(existsSync(目录)).toBe(false);
  });

  it("幂等：再删一次返回 false 但不抛", () => {
    const { 会话 } = 打开会话();
    释放会话(会话);
    expect(() => 释放会话(会话)).not.toThrow();
    expect(释放会话(会话)).toBe(false);
  });

  it("非法 id 直接返回 false，不会误删到别处", () => {
    expect(释放会话("../../evil")).toBe(false);
    expect(释放会话(undefined)).toBe(false);
    expect(释放会话("")).toBe(false);
  });

  it("释放后从活会话表移除", () => {
    const { 会话, 目录 } = 打开会话();
    expect(活会话列表()).toContain(目录);
    释放会话(会话);
    expect(活会话列表()).not.toContain(目录);
  });
});

describe("释放全部会话 —— 模块退出钩子", () => {
  it("删掉本进程打开的所有会话并返回数量", () => {
    const a = 打开会话();
    const b = 打开会话();
    const n = 释放全部会话();
    expect(n).toBeGreaterThanOrEqual(2);
    expect(existsSync(a.目录)).toBe(false);
    expect(existsSync(b.目录)).toBe(false);
    expect(活会话列表()).toHaveLength(0);
  });

  it("清空后可再次打开（退出钩子不该把状态弄坏）", () => {
    释放全部会话();
    const { 会话, 目录 } = 打开会话();
    已建.push(目录);
    expect(existsSync(目录)).toBe(true);
    释放会话(会话);
  });
});

describe("清掉过旧会话 —— 强杀后的兜底", () => {
  it("超过时限的目录被删", () => {
    const id = "old" + Date.now().toString(36);
    const { 目录 } = 打开会话(id);
    // 把 mtime 改到 7 小时前
    const 旧 = Date.now() / 1000 - 7 * 60 * 60;
    utimesSync(目录, 旧, 旧);
    const 删了 = 清掉过旧会话();
    expect(删了).toBeGreaterThanOrEqual(1);
    expect(existsSync(目录)).toBe(false);
  });

  it("刚打开的目录不会被删", () => {
    const { 目录 } = 打开会话();
    已建.push(目录);
    清掉过旧会话();
    expect(existsSync(目录)).toBe(true);
  });

  it("不看创建时间只看 mtime：持续写入的目录不会被误删", () => {
    const id = "longedit" + Date.now().toString(36);
    const { 目录 } = 打开会话(id);
    已建.push(目录);
    // 模拟「创建很久但一直在写」：目录本身很新
    const 删前 = 清掉过旧会话();
    expect(existsSync(目录)).toBe(true);
    expect(typeof 删前).toBe("number");
  });

  it("不碰 tmp 下非本次前缀的目录", () => {
    const 无关 = join(tmpdir(), "kugua-别的-" + Date.now().toString(36));
    mkdirSync(无关, { recursive: true });
    try {
      清掉过旧会话();
      expect(existsSync(无关)).toBe(true);
    } finally {
      rmSync(无关, { recursive: true, force: true });
    }
  });
});

describe("目录名不会与真实用户文件撞车", () => {
  it("所有会话目录都带统一前缀", () => {
    const { 目录 } = 打开会话();
    已建.push(目录);
    const 末段 = 目录.slice(目录.lastIndexOf("kugua-image-"));
    expect(末段.startsWith("kugua-image-")).toBe(true);
  });
});
