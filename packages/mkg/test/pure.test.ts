/**
 * 载体层纯函数单测。
 *
 * 载体判定是全平台「内容归属」的唯一真相来源，改错会静默改变编辑语义：
 * - 把「库内」判成「外部文件」→ 编辑器会把数据库内容当磁盘镜像写回，可能覆盖/报错；
 * - 把「外部文件」判成「库内」→ UI 不再提示「外部进程可改」，用户保存时以为安全。
 */
import { describe, expect, it } from "vitest";
import { 判定载体, 判定磁盘已变更 } from "../src/pure";

describe("判定载体", () => {
  it("file + 有 resourceId → 外部文件", () => {
    expect(判定载体({ type: "file", resourceId: 3 })).toBe("外部文件");
  });

  it("file + 无 resourceId → 库内（内部临时态不该暴露成外部文件）", () => {
    expect(判定载体({ type: "file", resourceId: null })).toBe("库内");
  });

  it("note/material/card/snippet 恒为库内，即使意外挂了 resourceId", () => {
    expect(判定载体({ type: "note", resourceId: 5 })).toBe("库内");
    expect(判定载体({ type: "material", resourceId: 5 })).toBe("库内");
    expect(判定载体({ type: "card", resourceId: 5 })).toBe("库内");
    expect(判定载体({ type: "snippet", resourceId: 5 })).toBe("库内");
  });

  it("directory + 有 resourceId → 外部文件（目录也是磁盘镜像）", () => {
    expect(判定载体({ type: "directory", resourceId: 1 })).toBe("库内");
  });
});

describe("判定磁盘已变更", () => {
  it("磁盘 mtime 新于库内记录 → 已变更", () => {
    expect(判定磁盘已变更({ 磁盘Mtime: 200, 库内Mtime: 100 })).toBe(true);
  });

  it("磁盘 mtime 等于或早于库内记录 → 未变更", () => {
    expect(判定磁盘已变更({ 磁盘Mtime: 100, 库内Mtime: 100 })).toBe(false);
    expect(判定磁盘已变更({ 磁盘Mtime: 99, 库内Mtime: 100 })).toBe(false);
  });
});
