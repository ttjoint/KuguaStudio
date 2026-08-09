/**
 * MKG 管理与增强：节点删除 / 导入去重 / 物理重命名 / 回收站 / 别名同步 / 新字段
 */

import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { mkdtempSync, writeFileSync, mkdirSync, rmSync, existsSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { MKG, type 统一内容条目 } from "@kugua/mkg";

describe("MKG 管理增强", () => {
  let 工作目录: string;
  let mkg: MKG;

  beforeEach(() => {
    工作目录 = mkdtempSync(join(tmpdir(), "kugua-mkg-ops-"));
    mkg = new MKG(join(工作目录, "mkg.db"));
  });

  afterEach(() => {
    mkg.close();
    rmSync(工作目录, { recursive: true, force: true });
  });

  it("deleteNode 同时移除资源与节点，并级联删除节点标签", async () => {
    const 目录 = join(工作目录, "docs");
    mkdirSync(目录);
    writeFileSync(join(目录, "a.txt"), "alpha");
    await mkg.index(目录);

    const 资源 = mkg.getResource(join(目录, "a.txt"))!;
    const 标签 = mkg.createTag("重要");
    const 条目 = mkg.listAllContent().find((x) => x.resourceId === 资源.id)!;
    mkg.setNodeTags(条目.id, [标签.id]);
    expect(mkg.listAllContent().find((x) => x.id === 条目.id)!.tagIds).toContain(标签.id);

    mkg.deleteNode(条目.id);
    expect(mkg.getResource(资源.id)).toBeUndefined();
    expect(mkg.listAllContent().some((x) => x.id === 条目.id)).toBe(false);
  });

  it("importPath 对完全一致的文件去重（不同路径不再导入）", async () => {
    const 甲 = join(工作目录, "a.txt");
    const 乙 = join(工作目录, "copy", "a-copy.txt");
    writeFileSync(甲, "完全一致的内容");
    mkdirSync(join(工作目录, "copy"));
    writeFileSync(乙, "完全一致的内容");

    const 首次 = await mkg.importPath(甲);
    expect(首次.added).toBe(1);
    expect(首次.duplicate).toBeFalsy();

    const 重复 = await mkg.importPath(乙);
    expect(重复.added).toBe(0);
    expect(重复.duplicate).toBeTruthy();
    expect(重复.duplicate!.path).toBe(甲);
  });

  it("importFile 对完全一致的文件去重且不再复制", async () => {
    const 源 = join(工作目录, "src.txt");
    writeFileSync(源, "重复内容");
    const 库目录 = join(工作目录, "library");
    const 首次 = await mkg.importFile({ sourcePath: 源, destDir: 库目录 });
    expect("duplicate" in 首次 && 首次.duplicate).toBe(false);

    const 二次 = await mkg.importFile({ sourcePath: 源, destDir: 库目录 });
    expect("duplicate" in 二次 && 二次.duplicate).toBe(true);
    if ("duplicate" in 二次 && 二次.duplicate) {
      expect(二次.existingPath).toBe((首次 as { path: string }).path);
    }
    // 知识库目录中应只有一份
    const 条目 = mkg.listAllContent();
    expect(条目.filter((x) => x.realName === "src.txt").length).toBe(1);
  });

  it("renameResourceFile 重命名物理文件并同步数据库与节点标题", async () => {
    const 目录 = join(工作目录, "docs");
    mkdirSync(目录);
    writeFileSync(join(目录, "old.txt"), "hello");
    await mkg.index(目录);
    const 资源 = mkg.getResource(join(目录, "old.txt"))!;

    const 详情 = mkg.renameResourceFile(资源.id, "new.txt");
    expect(详情.path).toBe(join(目录, "new.txt"));
    expect(详情.name).toBe("new.txt");
    expect(existsSync(join(目录, "old.txt"))).toBe(false);
    expect(existsSync(join(目录, "new.txt"))).toBe(true);
    // 节点标题同步为真实文件名
    const 条目 = mkg.listAllContent().find((x) => x.resourceId === 资源.id)!;
    expect(条目.name).toBe("new.txt");
    expect(条目.realName).toBe("new.txt");

    // 重命名为已存在名称时报错（类似资源管理器提示）
    writeFileSync(join(目录, "taken.txt"), "taken");
    expect(() => mkg.renameResourceFile(资源.id, "taken.txt")).toThrow(/已存在/);

    // 非法字符拒绝
    expect(() => mkg.renameResourceFile(资源.id, "bad:name.txt")).toThrow(/不能包含/);
  });

  it("trashResource：物理文件已不存在时仅从知识库移除", async () => {
    const 目录 = join(工作目录, "docs");
    mkdirSync(目录);
    writeFileSync(join(目录, "gone.txt"), "bye");
    await mkg.index(目录);
    const 资源 = mkg.getResource(join(目录, "gone.txt"))!;
    const 条目 = mkg.listAllContent().find((x) => x.resourceId === 资源.id)!;

    // 模拟物理文件已被外部删除：仅移除知识库记录
    rmSync(join(目录, "gone.txt"));
    const 结果 = await mkg.trashResource(资源.id);
    expect(结果.trashed).toBe(false);
    expect(mkg.getResource(资源.id)).toBeUndefined();
    expect(mkg.listAllContent().some((x) => x.id === 条目.id)).toBe(false);
  });

  it("listAllContent 提供入库时间与真实文件名，别名同步节点标题", async () => {
    const 目录 = join(工作目录, "docs");
    mkdirSync(目录);
    writeFileSync(join(目录, "报告.txt"), "内容");
    await mkg.index(目录);
    const 资源 = mkg.getResource(join(目录, "报告.txt"))!;

    let 条目 = mkg.listAllContent().find((x) => x.resourceId === 资源.id) as 统一内容条目;
    expect(条目.realName).toBe("报告.txt");
    expect(条目.indexedAt).toBeGreaterThan(0);

    mkg.setAlias(资源.id, "我的知识库名称");
    条目 = mkg.listAllContent().find((x) => x.resourceId === 资源.id)!;
    expect(条目.name).toBe("我的知识库名称");
    expect(条目.realName).toBe("报告.txt");
  });
});
