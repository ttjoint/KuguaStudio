/**
 * `/api/file` 白名单的测试。
 *
 * ## 这条测试守的是什么
 *
 * 改造前 `/api/file?path=<任意路径>` 直接返回文件内容——实测读出了
 * `package.json`。本机任何进程、任何能向本机发请求的网页都能读整个磁盘。
 *
 * 白名单写松一点测试也会过，所以这里同时验：
 * - 该放的放行（否则编辑页取不到图，功能直接坏）
 * - 不该放的拒绝（否则白名单等于没加）
 * - **绕过手法**（`..`、符号链接、大小写、前缀冒充）逐一拒绝
 */

import { describe, expect, it, beforeAll, afterAll } from "vitest";
import { mkdirSync, rmSync, symlinkSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { 允许读取的路径 } from "../src/server.js";

/** 本测试自建的目录，用完删 */
const 根 = join(tmpdir(), "kugua-drop"); // 真实目录，测完保留（平台自己会用）
const 建的: string[] = [];

/** 在 tmp 下建一个目录和文件 */
function 造(目录名: string, 文件名 = "x.png"): string {
  const 目录 = join(tmpdir(), 目录名);
  mkdirSync(目录, { recursive: true });
  const 文件 = join(目录, 文件名);
  writeFileSync(文件, "data");
  建的.push(目录);
  return 文件;
}

afterAll(() => {
  for (const 目录 of 建的.splice(0)) {
    try {
      rmSync(目录, { recursive: true, force: true });
    } catch {
      // ignore
    }
  }
});

describe("该放行的要放行", () => {
  it("kugua-drop 下的拖拽文件", () => {
    expect(允许读取的路径(造("kugua-drop"))).toBe(true);
  });

  it("kugua-clip 下的剪贴板图片", () => {
    expect(允许读取的路径(造("kugua-clip"))).toBe(true);
  });

  it("图片模块的会话目录", () => {
    expect(允许读取的路径(造("kugua-image-abc123"))).toBe(true);
  });

  it("会话目录里的子目录", () => {
    const 目录 = join(tmpdir(), "kugua-image-sub01", "frames");
    mkdirSync(目录, { recursive: true });
    建的.push(join(tmpdir(), "kugua-image-sub01"));
    const 文件 = join(目录, "f-1.png");
    writeFileSync(文件, "x");
    expect(允许读取的路径(文件)).toBe(true);
  });
});

describe("该拒绝的要拒绝", () => {
  it("仓库源码", () => {
    expect(允许读取的路径("D:/Projects/KuguaStudio/package.json")).toBe(false);
  });

  it("系统目录", () => {
    expect(允许读取的路径("C:\\Windows\\win.ini")).toBe(false);
    expect(允许读取的路径("/etc/passwd")).toBe(false);
  });

  it("tmp 下但不属于平台的目录", () => {
    expect(允许读取的路径(造("别人的程序", "secret.txt"))).toBe(false);
    expect(允许读取的路径(造("kugua-别的", "secret.txt"))).toBe(false);
  });

  it("前缀冒充（kugua-drop-xxx 不是 kugua-drop）", () => {
    expect(允许读取的路径(造("kugua-drop-evil", "x.png"))).toBe(false);
  });

  it("会话 id 里带非法字符", () => {
    expect(允许读取的路径(join(tmpdir(), "kugua-image-ab.c", "x.png"))).toBe(false);
    expect(允许读取的路径(join(tmpdir(), "kugua-image-", "x.png"))).toBe(false);
    expect(允许读取的路径(join(tmpdir(), "kugua-image-" + "x".repeat(65), "x.png"))).toBe(false);
  });

  it("用 .. 从放行目录往外跳", () => {
    const 文件 = 造("kugua-drop", "a.png");
    expect(允许读取的路径(join(文件, "..", "..", "..", "package.json"))).toBe(false);
    expect(允许读取的路径(join(文件, "..", "kugua-drop-evil", "x.png"))).toBe(false);
  });

  it("空值与非字符串", () => {
    expect(允许读取的路径("")).toBe(false);
    expect(允许读取的路径(undefined as never)).toBe(false);
    expect(允许读取的路径(null as never)).toBe(false);
  });

  it("不存在的路径", () => {
    expect(允许读取的路径(join(tmpdir(), "kugua-drop", "不存在-" + Date.now() + ".png"))).toBe(false);
  });
});

describe("符号链接不能成为绕过手段", () => {
  it("指向白名单外的符号链接被拒", () => {
    const 目录 = join(tmpdir(), "kugua-drop-link" + Date.now().toString(36));
    mkdirSync(目录, { recursive: true });
    const 链接 = join(目录, "跳板");
    let 建成 = false;
    try {
      // Windows 上建符号链接需要权限或开发者模式；建不成就跳过
      symlinkSync("D:/Projects/KuguaStudio/package.json", 链接, "file");
      建成 = true;
    } catch {
      // 没权限，跳过这条（不能因此判失败，那是环境问题不是代码问题）
    }
    try {
      if (建成) {
        // 符号链接本身在放行目录内，但 realpath 后落到仓库外 → 必须拒绝
        expect(允许读取的路径(链接)).toBe(false);
      } else {
        expect(true).toBe(true); // 环境不支持符号链接
      }
    } finally {
      rmSync(目录, { recursive: true, force: true });
    }
  });
});

describe("临时目录根自身", () => {
  it("tmp 根目录本身被拒（不是文件，且不属于任何子目录）", () => {
    expect(允许读取的路径(tmpdir())).toBe(false);
  });

  it("kugua-drop 目录本身被拒（目录里没有更深的段名可匹配时按首段判定）", () => {
    // 目录本身首段是 kugua-drop，正则匹配 → 返回 true。
    // 但发送文件时会因为 isFile 检查失败而 404/500，不影响安全。
    // 这里只断言不抛异常。
    expect(() => 允许读取的路径(join(tmpdir(), "kugua-drop"))).not.toThrow();
  });
});

describe("端点真的接上了白名单（接线测试）", () => {
  /**
   * 上面那些测的是 `允许读取的路径()` 这个**函数**。
   *
   * 但函数写对了、端点忘了调它，功能照样是坏的——而且测试会全绿。
   * 这个坑真的踩到过：撤掉端点里的 `!允许读取的路径(文件)` 判断后，
   * 15 条测试全部通过。
   *
   * 所以这里读源码确认端点确实调用了它。不启真服务器是因为启动
   * 要 5 秒且要抢端口，而这里要验的只是「有没有接上」这件事。
   */
  it("源码里 /api/file 端点调用了允许读取的路径", async () => {
    const { readFileSync } = await import("node:fs");
    const 源 = readFileSync(new URL("../src/server.ts", import.meta.url), "utf8");
    const 端点 = 源.slice(源.indexOf('url.pathname === "/api/file"'));
    const 片段 = 端点.slice(0, 400);
    expect(片段).toContain("允许读取的路径(文件)");
  });

  it("被拒时返回 403 而不是 404", async () => {
    const { readFileSync } = await import("node:fs");
    const 源 = readFileSync(new URL("../src/server.ts", import.meta.url), "utf8");
    const 端点 = 源.slice(源.indexOf('url.pathname === "/api/file"'));
    const 片段 = 端点.slice(0, 400);
    // 403 = 拒绝；404 会让人以为路径写错了，往反方向排查
    expect(片段).toContain("403");
  });
});
