/**
 * 生成类模块测试
 * - MKG readContent + mkg.data.read 数据读取链路
 * - 今天吃什么模板填充逻辑（DScript 模板）
 * 注：周易占卜算法已随 divination 模块重构为内联实现（经 nigane 协议暴露
 * divination.zhouyi），不再有独立可导出的 zhouyi.ts / yarrow.ts，故移除相关单元测试。
 */

import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { mkdtempSync, writeFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { MKG } from "@kugua/mkg";

describe("MKG readContent 数据读取", () => {
  let 工作目录: string;
  let mkg: MKG;

  beforeEach(() => {
    工作目录 = mkdtempSync(join(tmpdir(), "kugua-gen-"));
    mkg = new MKG(join(工作目录, "test.db"));
  });

  afterEach(() => {
    mkg.close();
    rmSync(工作目录, { recursive: true, force: true });
  });

  it("索引后可按路径读取文本内容", async () => {
    const 文件路径 = join(工作目录, "data.txt");
    writeFileSync(文件路径, "测试内容一行");
    await mkg.importPath(文件路径);
    expect(mkg.readContent(文件路径)).toBe("测试内容一行");
  });

  it("未索引的路径返回 null", () => {
    expect(mkg.readContent(join(工作目录, "不存在.txt"))).toBeNull();
  });
});

describe("今天吃什么模板", () => {
  function 解析模板(内容: string): string[] {
    const 结果: string[] = [];
    for (const 行 of 内容.split("\n")) {
      const 文本 = 行.trim();
      if (!文本 || 文本.startsWith("#")) continue;
      结果.push(文本);
    }
    return 结果;
  }

  const 示例 = `# 注释
{time}{verb}一碗面条
{time}去吃火锅
{time}不如{verb}饺子`;

  it("解析模板跳过注释", () => {
    const 模板 = 解析模板(示例);
    expect(模板.length).toBe(3);
    expect(模板[0]).toContain("{time}");
    expect(模板[0]).toContain("{verb}");
  });

  it("填充占位符", () => {
    const 模板 = 解析模板(示例);
    const 选中 = 模板[0];
    const 结果 = 选中
      .replace(/\{time\}/g, "今天")
      .replace(/\{verb\}/g, "吃");
    expect(结果).toBe("今天吃一碗面条");
  });

  it("人称互换", () => {
    function 人称互换(文本: string): string {
      return 文本
        .replace(/我/g, "\x00")
        .replace(/你/g, "我")
        .replace(/\x00/g, "你");
    }
    expect(人称互换("我请你吃饭")).toBe("你请我吃饭");
  });
});