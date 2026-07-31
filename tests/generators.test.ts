/**
 * 生成类模块测试
 * 测试占卜模块的周易算法、运势，以及吃什么模块的模板填充
 * 同时验证 MKG readContent + mkg.data.read 数据读取链路
 */

import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { mkdtempSync, writeFileSync, mkdirSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { MKG } from "@kugua/mkg";
import { 解析周易数据, 查找卦象 } from "../packages/modules/divination/src/zhouyi.js";
import { 占六爻, 解读卦象 } from "../packages/modules/divination/src/yarrow.js";

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

describe("周易数据解析", () => {
  const 示例数据 = `# 注释行
1|乾|元亨利贞|潜龙勿用;见龙在田;终日乾乾;或跃在渊;飞龙在天;亢龙有悔
2|坤|元亨牝马之贞|履霜坚冰;直方大;含章可贞;括囊;黄裳元吉;龙战于野`;

  it("解析为卦象列表", () => {
    const 列表 = 解析周易数据(示例数据);
    expect(列表.length).toBe(2);
    expect(列表[0].序号).toBe(1);
    expect(列表[0].名称).toBe("乾");
    expect(列表[0].卦辞).toBe("元亨利贞");
    expect(列表[0].爻辞.length).toBe(6);
    expect(列表[0].爻辞[0]).toBe("潜龙勿用");
  });

  it("按序号查找卦象", () => {
    const 列表 = 解析周易数据(示例数据);
    const 坤 = 查找卦象(列表, 2);
    expect(坤).toBeDefined();
    expect(坤?.名称).toBe("坤");
    expect(查找卦象(列表, 99)).toBeUndefined();
  });
});

describe("蓍草筮法", () => {
  const 周易数据 = `1|乾|元亨利贞|初九潜龙勿用;九二见龙在田;九三终日乾乾;九四或跃在渊;九五飞龙在天;上九亢龙有悔
2|坤|元亨牝马之贞|初六履霜坚冰;六二直方大;六三含章可贞;六四括囊;六五黄裳元吉;上六龙战于野`;
  const 列表 = 解析周易数据(周易数据);

  it("占六爻返回有效卦序", () => {
    const { 本卦序, 变卦序, 爻位 } = 占六爻();
    expect(本卦序).toBeGreaterThanOrEqual(1);
    expect(本卦序).toBeLessThanOrEqual(64);
    expect(变卦序).toBeGreaterThanOrEqual(1);
    expect(变卦序).toBeLessThanOrEqual(64);
    expect(爻位.length).toBe(6);
    for (const n of 爻位) {
      expect([6, 7, 8, 9]).toContain(n);
    }
  });

  it("解读卦象包含卦名", () => {
    const 本卦 = 列表[0];
    const { 爻位 } = 占六爻();
    const 解读 = 解读卦象(本卦, 列表[1], 爻位);
    expect(解读).toContain("乾");
  });

  it("无变爻时返回卦辞", () => {
    const 本卦 = 列表[0];
    // 全是7和8（不变爻）
    const 解读 = 解读卦象(本卦, undefined, [7, 8, 7, 8, 7, 8]);
    expect(解读).toContain("卦辞");
    expect(解读).toContain("元亨利贞");
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
