import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { mkdtempSync, writeFileSync, mkdirSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { MKG } from "@kugua/mkg";

describe("MKG 知识图谱", () => {
  let 工作目录: string;
  let mkg: MKG;

  beforeEach(() => {
    工作目录 = mkdtempSync(join(tmpdir(), "kugua-mkg-"));
    mkg = new MKG(join(工作目录, "mkg.db"));
  });

  afterEach(() => {
    mkg.close();
    rmSync(工作目录, { recursive: true, force: true });
  });

  it("索引目录并统计新增/更新/移除", async () => {
    mkdirSync(join(工作目录, "docs"));
    writeFileSync(join(工作目录, "docs", "readme.txt"), "hello world");
    writeFileSync(join(工作目录, "docs", "note.md"), "# MKG");

    const result1 = await mkg.index(join(工作目录, "docs"));
    expect(result1.added).toBe(3); // docs + readme.txt + note.md
    expect(result1.updated).toBe(0);

    writeFileSync(join(工作目录, "docs", "readme.txt"), "hello world!");
    const result2 = await mkg.index(join(工作目录, "docs"));
    expect(result2.added).toBe(0);
    expect(result2.updated).toBeGreaterThanOrEqual(1);
    expect(result2.removed).toBe(0);

    const resource = mkg.getResource(join(工作目录, "docs", "readme.txt"));
    expect(resource).toBeTruthy();
    expect(resource?.name).toBe("readme.txt");
    expect(resource?.kind).toBe("file");
  });

  it("标签 CRUD 与资源打标", () => {
    const tagA = mkg.createTag("文档", null, "文本资料");
    const tagB = mkg.createTag("重要", tagA.id, "高优先级");
    expect(tagA.parentId).toBeNull();
    expect(tagB.parentId).toBe(tagA.id);

    const tags = mkg.listTags();
    expect(tags.length).toBe(2);

    const children = mkg.listTags(tagA.id);
    expect(children.map((t) => t.name)).toContain("重要");
  });

  it("按标签搜索资源", async () => {
    mkdirSync(join(工作目录, "repo"));
    writeFileSync(join(工作目录, "repo", "a.txt"), "alpha");
    writeFileSync(join(工作目录, "repo", "b.txt"), "beta");

    await mkg.index(join(工作目录, "repo"));

    const tagDoc = mkg.createTag("文档");
    const tagImp = mkg.createTag("重要");

    const resA = mkg.getResource(join(工作目录, "repo", "a.txt"))!;
    const resB = mkg.getResource(join(工作目录, "repo", "b.txt"))!;

    mkg.tagResource(resA.id, tagDoc.id);
    mkg.tagResource(resA.id, tagImp.id);
    mkg.tagResource(resB.id, tagDoc.id);

    const docResults = mkg.searchByTags([tagDoc.id]);
    expect(docResults.total).toBe(2);

    const impResults = mkg.searchByTags([tagImp.id]);
    expect(impResults.total).toBe(1);
    expect(impResults.items[0].name).toBe("a.txt");

    const andResults = mkg.searchByTags([tagDoc.id, tagImp.id]);
    expect(andResults.total).toBe(1);

    mkg.untagResource(resA.id, tagImp.id);
    expect(mkg.searchByTags([tagImp.id]).total).toBe(0);
  });

  it("按路径与内容搜索", async () => {
    mkdirSync(join(工作目录, "notes"));
    writeFileSync(join(工作目录, "notes", "苦瓜.txt"), "苦瓜是一种植物，也是本项目的名字。");

    await mkg.index(join(工作目录, "notes"));

    const pathResults = mkg.searchByPath("苦瓜");
    expect(pathResults.total).toBeGreaterThanOrEqual(1);

    const contentResults = mkg.searchByContent("植物");
    expect(contentResults.total).toBe(1);
    expect(contentResults.items[0].snippet).toContain("植物");
  });

  it("清理已删除资源", async () => {
    mkdirSync(join(工作目录, "temp"));
    writeFileSync(join(工作目录, "temp", "old.txt"), "old");

    await mkg.index(join(工作目录, "temp"));
    expect(mkg.getResource(join(工作目录, "temp", "old.txt"))).toBeTruthy();

    rmSync(join(工作目录, "temp", "old.txt"));
    const result = await mkg.index(join(工作目录, "temp"));
    expect(result.removed).toBe(1);
    expect(mkg.getResource(join(工作目录, "temp", "old.txt"))).toBeUndefined();
  });

  it("资源创建、列出与删除", () => {
    const created = mkg.createResource(join(工作目录, "manual.txt"), "manual.txt", "file", {
      size: 12,
      sha256: "abc123",
    });
    expect(created.name).toBe("manual.txt");
    expect(created.kind).toBe("file");

    const all = mkg.listResources();
    expect(all.total).toBe(1);
    expect(all.items[0].path).toBe(join(工作目录, "manual.txt"));

    mkg.deleteResource(created.id);
    expect(mkg.listResources().total).toBe(0);
  });

  it("按标签列出资源", async () => {
    mkdirSync(join(工作目录, "tagged"));
    writeFileSync(join(工作目录, "tagged", "x.txt"), "x");
    writeFileSync(join(工作目录, "tagged", "y.txt"), "y");
    await mkg.index(join(工作目录, "tagged"));

    const tag = mkg.createTag("分类一");
    const resX = mkg.getResource(join(工作目录, "tagged", "x.txt"))!;
    const resY = mkg.getResource(join(工作目录, "tagged", "y.txt"))!;
    mkg.tagResource(resX.id, tag.id);
    mkg.tagResource(resY.id, tag.id);

    const result = mkg.listResourcesByTag(tag.id);
    expect(result.total).toBe(2);
    expect(result.items.map((r) => r.name).sort()).toEqual(["x.txt", "y.txt"]);
  });

  it("导入单个文件", async () => {
    const filePath = join(工作目录, "single.txt");
    writeFileSync(filePath, "imported content");
    const result = await mkg.importPath(filePath);
    expect(result.added).toBe(1);
    expect(result.updated).toBe(0);

    const res = mkg.getResource(filePath);
    expect(res).toBeTruthy();
    expect(res?.name).toBe("single.txt");
    expect(res?.size).toBe(Buffer.byteLength("imported content"));
  });
});
