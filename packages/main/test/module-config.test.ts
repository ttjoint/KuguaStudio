/**
 * 模块配置服务单测：点号路径、类型校验、凭据隔离、两层合并、表单模型。
 */

import { describe, expect, it, beforeEach, afterEach } from "vitest";
import { mkdtempSync, rmSync, writeFileSync, readFileSync, existsSync } from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";
import type { 配置声明 } from "@kugua/nigane";
import {
  保存模块配置,
  全部声明,
  取声明,
  构造表单模型,
  构造载荷,
  清空声明缓存,
  记录声明,
  深合并,
  校验值,
  展开表单,
  读取模块配置,
  合并凭据,
  拆分凭据,
  路径删值,
  路径取值,
  路径写值,
} from "../src/module-config.js";

let 临时目录: string;
let 原主路径: string | undefined;
let 原本地路径: string | undefined;

beforeEach(() => {
  临时目录 = mkdtempSync(join(tmpdir(), "kugua-cfg-"));
  原主路径 = process.env.KUGUA_CONFIG;
  原本地路径 = process.env.KUGUA_CONFIG_LOCAL;
  // 两个文件路径都要固定到临时目录：主配置用 KUGUA_CONFIG，
  // 本地覆盖用 cwd，故这里直接切换 cwd 不现实——改为删掉旧文件后断言
  清空声明缓存();
});

afterEach(() => {
  if (原主路径 === undefined) delete process.env.KUGUA_CONFIG;
  else process.env.KUGUA_CONFIG = 原主路径;
  rmSync(临时目录, { recursive: true, force: true });
});

function 写主配置(对象: unknown): void {
  const p = join(临时目录, "kugua.config.json");
  writeFileSync(p, JSON.stringify(对象, null, 2), "utf-8");
  process.env.KUGUA_CONFIG = p;
}

function 读主配置(): Record<string, unknown> {
  const p = process.env.KUGUA_CONFIG!;
  return existsSync(p) ? (JSON.parse(readFileSync(p, "utf-8")) as Record<string, unknown>) : {};
}

describe("点号路径读写", () => {
  it("按嵌套键取值", () => {
    const o = { engines: { voxcpm: { url: "http://x", enabled: true } } };
    expect(路径取值(o, "engines.voxcpm.url")).toBe("http://x");
    expect(路径取值(o, "engines.voxcpm.enabled")).toBe(true);
    expect(路径取值(o, "engines.不存在.x")).toBeUndefined();
    expect(路径取值(o, "engines.voxcpm.url.更深")).toBeUndefined();
  });

  it("写值时自动创建中间对象", () => {
    const o: Record<string, unknown> = {};
    路径写值(o, "a.b.c", 1);
    expect(o).toEqual({ a: { b: { c: 1 } } });
  });

  it("中间层是数组或标量时重建为对象", () => {
    const o: Record<string, unknown> = { a: [1, 2, 3] };
    路径写值(o, "a.b", "x");
    expect(o).toEqual({ a: { b: "x" } });
  });

  it("删值后自底向上清理空壳对象", () => {
    const o: Record<string, unknown> = { a: { b: { c: 1, d: 2 } }, keep: 1 };
    路径删值(o, "a.b.c");
    expect(o).toEqual({ a: { b: { d: 2 } }, keep: 1 });
    路径删值(o, "a.b.d");
    // a.b 与 a 都变空，应被一并清理
    expect(o).toEqual({ keep: 1 });
  });

  it("删除不存在的路径不抛错", () => {
    const o: Record<string, unknown> = { a: 1 };
    expect(() => 路径删值(o, "x.y.z")).not.toThrow();
    expect(o).toEqual({ a: 1 });
  });
});

describe("深合并", () => {
  it("对象递归合并，数组整体替换", () => {
    const a = { x: { y: 1, z: 2 }, list: [1, 2] };
    const b = { x: { z: 3 }, list: [9] };
    expect(深合并(a, b)).toEqual({ x: { y: 1, z: 3 }, list: [9] });
  });

  it("覆盖值为 undefined 时保留基值", () => {
    expect(深合并({ a: 1 }, { a: undefined })).toEqual({ a: 1 });
  });

  it("基值非对象时直接采用覆盖值", () => {
    expect(深合并(1, { a: 2 })).toEqual({ a: 2 });
    expect(深合并({ a: 1 }, 5)).toBe(5);
  });
});

describe("类型校验", () => {
  it("number 支持字符串转数字并检查范围", () => {
    expect(校验值({ 键: "n", 标题: "数量", 类型: "number" }, "42")).toBe(42);
    expect(() => 校验值({ 键: "n", 标题: "数量", 类型: "number" }, "abc")).toThrow("必须是数字");
    expect(() =>
      校验值({ 键: "n", 标题: "数量", 类型: "number", 最小: 1, 最大: 10 }, 0),
    ).toThrow("不能小于 1");
    expect(() =>
      校验值({ 键: "n", 标题: "数量", 类型: "number", 最小: 1, 最大: 10 }, 11),
    ).toThrow("不能大于 10");
  });

  it("boolean 接受常见真值写法", () => {
    const d = { 键: "b", 标题: "开关", 类型: "boolean" as const };
    expect(校验值(d, true)).toBe(true);
    expect(校验值(d, "true")).toBe(true);
    expect(校验值(d, "0")).toBe(false);
    expect(校验值(d, 1)).toBe(true);
    expect(() => 校验值(d, "yes")).toThrow("必须是布尔值");
  });

  it("select 拒绝不在选项内的值", () => {
    const d = {
      键: "s",
      标题: "引擎",
      类型: "select" as const,
      选项: ["a", "b", { 值: "c", 标题: "C" }],
    };
    expect(校验值(d, "c")).toBe("c");
    expect(() => 校验值(d, "z")).toThrow("取值必须是");
  });

  it("字符串数组逐项转字符串", () => {
    const d = { 键: "l", 标题: "列表", 类型: "array" as const, 数组: { 元素: "string" as const } };
    expect(校验值(d, ["a", 1, true])).toEqual(["a", "1", "true"]);
    expect(() => 校验值(d, "不是数组")).toThrow("必须是数组");
  });

  it("对象数组按列声明校验并丢弃未知列", () => {
    const d = {
      键: "rows",
      标题: "音色",
      类型: "array" as const,
      数组: {
        元素: "object" as const,
        列: [
          { 键: "id", 标题: "标识", 类型: "string" as const, 必填: true },
          { 键: "weight", 标题: "权重", 类型: "number" as const },
        ],
      },
    };
    const 结果 = 校验值(d, [
      { id: "a", weight: "2", 未知列: "丢弃" },
      { id: "b" },
    ]);
    expect(结果).toEqual([{ id: "a", weight: 2 }, { id: "b" }]);
  });

  it("必填字段为空时抛错", () => {
    expect(() => 校验值({ 键: "k", 标题: "必填项", 必填: true }, "")).not.toThrow();
    expect(() => 校验值({ 键: "k", 标题: "必填项", 必填: true }, undefined)).toThrow("不能为空");
  });
});

describe("表单展开", () => {
  it("扁平点号键还原成嵌套对象", () => {
    expect(展开表单({ "engines.voxcpm.url": "http://x", "engines.indextts.url": "http://y" })).toEqual({
      engines: { voxcpm: { url: "http://x" }, indextts: { url: "http://y" } },
    });
  });
});

describe("保存模块配置", () => {
  const 声明: 配置声明 = {
    字段: [
      { 键: "defaultEngine", 标题: "默认引擎", 类型: "string" },
      { 键: "engines.voxcpm.url", 标题: "VoxCPM 地址", 类型: "string" },
      { 键: "engines.voxcpm.enabled", 标题: "启用", 类型: "boolean" },
    ],
  };

  it("写入主配置并报告真实变更项", () => {
    写主配置({ tts: { defaultEngine: "voxcpm" } });
    const 变更 = 保存模块配置(
      "tts",
      { defaultEngine: "indextts", "engines.voxcpm.url": "http://127.0.0.1:9881" },
      声明,
    );
    expect(变更.sort()).toEqual(["defaultEngine", "engines.voxcpm.url"]);
    const 主 = 读主配置() as { tts: Record<string, unknown> };
    expect(主.tts.defaultEngine).toBe("indextts");
    expect((主.tts.engines as Record<string, Record<string, unknown>>).voxcpm.url).toBe(
      "http://127.0.0.1:9881",
    );
  });

  it("值未变化时不报告变更也不写盘", () => {
    写主配置({ tts: { defaultEngine: "voxcpm" } });
    const 变更 = 保存模块配置("tts", { defaultEngine: "voxcpm" }, 声明);
    expect(变更).toEqual([]);
  });

  it("空字符串表示清除该字段", () => {
    写主配置({ tts: { defaultEngine: "voxcpm", extra: 1 } });
    const 变更 = 保存模块配置("tts", { defaultEngine: "" }, 声明);
    expect(变更).toEqual(["defaultEngine"]);
    const 主 = 读主配置() as { tts: Record<string, unknown> };
    expect(主.tts.defaultEngine).toBeUndefined();
    expect(主.tts.extra).toBe(1);
  });

  it("其它顶层节不被抹掉", () => {
    写主配置({ ai: { provider: "openwebui" }, modules: [{ name: "tts" }] });
    保存模块配置("tts", { defaultEngine: "x" }, 声明);
    const 主 = 读主配置();
    expect(主.ai).toEqual({ provider: "openwebui" });
    expect(Array.isArray(主.modules)).toBe(true);
  });

  it("类型不符时抛错且不落盘", () => {
    写主配置({ tts: {} });
    expect(() =>
      保存模块配置("tts", { "engines.voxcpm.enabled": "不是布尔" }, 声明),
    ).toThrow("必须是布尔值");
    const 主 = 读主配置() as { tts: Record<string, unknown> };
    expect(主.tts.engines).toBeUndefined();
  });

  it("未声明字段按原样保存", () => {
    写主配置({ tts: {} });
    const 变更 = 保存模块配置("tts", { 自定义键: { a: 1 } }, 声明);
    expect(变更).toEqual(["自定义键"]);
    const 主 = 读主配置() as { tts: Record<string, unknown> };
    expect(主.tts.自定义键).toEqual({ a: 1 });
  });
});

describe("声明缓存与表单模型", () => {
  it("记录并读取声明", () => {
    const 声明: 配置声明 = { 说明: "测试", 字段: [{ 键: "a", 标题: "A" }] };
    记录声明("tts", 声明);
    expect(取声明("tts")).toEqual(声明);
    expect(Object.keys(全部声明())).toEqual(["tts"]);
  });

  it("非法声明不会被缓存", () => {
    记录声明("bad", { 字段: "不是数组" } as unknown as 配置声明);
    expect(取声明("bad")).toBeUndefined();
  });

  it("表单模型带上当前值与默认值", () => {
    写主配置({ tts: { defaultEngine: "indextts" } });
    记录声明("tts", {
      字段: [
        { 键: "defaultEngine", 标题: "默认引擎" },
        { 键: "未设置", 标题: "未设置项", 默认值: "兜底" },
      ],
    });
    const 模型 = 构造表单模型("tts");
    expect(模型.模块).toBe("tts");
    expect(模型.字段[0].值).toBe("indextts");
    expect(模型.字段[1].值).toBe("兜底");
  });

  it("凭据字段不回传明文，只标记已设置", () => {
    写主配置({ tts: { apiKey: "super-secret" } });
    记录声明("tts", {
      字段: [{ 键: "apiKey", 标题: "密钥", 类型: "secret", 凭据: true }],
    });
    const 模型 = 构造表单模型("tts");
    expect(模型.字段[0].值).toBe("");
    expect(模型.字段[0].已设置).toBe(true);
  });

  it("未设置的凭据标记为未设置", () => {
    写主配置({ tts: {} });
    记录声明("tts", { 字段: [{ 键: "apiKey", 标题: "密钥", 凭据: true }] });
    expect(构造表单模型("tts").字段[0].已设置).toBe(false);
  });
});

describe("推送载荷", () => {
  it("载荷包含模块名、配置对象与来源", () => {
    写主配置({ tts: { defaultEngine: "voxcpm" } });
    const 载荷 = 构造载荷("tts", "用户", ["defaultEngine"]);
    expect(载荷.模块).toBe("tts");
    expect(载荷.来源).toBe("用户");
    expect(载荷.变更).toEqual(["defaultEngine"]);
    expect(载荷.配置).toEqual({ defaultEngine: "voxcpm" });
  });

  it("读取不存在模块得到空对象", () => {
    写主配置({});
    expect(读取模块配置("不存在")).toEqual({});
  });
});

/**
 * 对象数组里的凭据隔离。
 *
 * 这是一个真实漏洞：最初只有顶层字段支持 `凭据: true`，
 * 于是 `providers[0].apiKey` 这种「藏在表格列里的密钥」会直接写进
 * kugua.config.json —— 也就是被提交进版本库。凭据隔离形同虚设。
 */
describe("数组内凭据隔离", () => {
  const 声明: 配置声明 = {
    字段: [
      {
        键: "providers",
        标题: "模型提供方",
        类型: "array",
        数组: {
          元素: "object",
          列: [
            { 键: "name", 标题: "名称", 类型: "string", 必填: true },
            { 键: "baseUrl", 标题: "地址", 类型: "string" },
            { 键: "apiKey", 标题: "密钥", 类型: "secret", 凭据: true },
          ],
        },
      },
    ],
  };

  function 读本地配置(): Record<string, unknown> {
    const p = join(process.cwd(), "kugua.config.local.json");
    if (!existsSync(p)) return {};
    return JSON.parse(readFileSync(p, "utf-8")) as Record<string, unknown>;
  }

  function 清本地配置(): void {
    rmSync(join(process.cwd(), "kugua.config.local.json"), { force: true });
  }

  beforeEach(() => {
    清本地配置();
    写主配置({ ai: {} });
  });
  afterEach(清本地配置);

  it("拆分：凭据列进凭据层，其余进公开层", () => {
    const r = 拆分凭据(声明, [{ name: "a", baseUrl: "http://x", apiKey: "sk-1" }], ["providers"]);
    expect(r.公开).toEqual([{ name: "a", baseUrl: "http://x" }]);
    // 凭据层必须带上主键（第一列），否则读取时对不回行、密钥等于丢失
    expect(r.凭据).toEqual([{ apiKey: "sk-1", name: "a" }]);
  });

  it("合并：按主键对齐，用户删行或调序后密钥不串行", () => {
    const r = 合并凭据(
      [{ name: "b" }, { name: "a" }],
      [{ apiKey: "sk-a", name: "a" }, { apiKey: "sk-b", name: "b" }],
      "name",
    );
    expect(r).toEqual([
      { name: "b", apiKey: "sk-b" },
      { name: "a", apiKey: "sk-a" },
    ]);
  });

  it("拆分：没有凭据列时不产生凭据层", () => {
    const r = 拆分凭据(声明, [{ name: "a" }], ["providers"]);
    expect(r.公开).toEqual([{ name: "a" }]);
    expect(r.凭据).toBeUndefined();
  });

  it("合并：按行把凭据补回公开层", () => {
    const r = 合并凭据(
      [{ name: "a" }, { name: "b" }],
      [{ apiKey: "sk-1" }, { apiKey: "sk-2" }],
    );
    expect(r).toEqual([
      { name: "a", apiKey: "sk-1" },
      { name: "b", apiKey: "sk-2" },
    ]);
  });

  it("合并：凭据层缺失时原样返回", () => {
    expect(合并凭据([{ name: "a" }], undefined)).toEqual([{ name: "a" }]);
  });

  it("保存时密钥不落主配置，只落 local 文件", () => {
    记录声明("ai", 声明);
    保存模块配置(
      "ai",
      {
        providers: [{ name: "lmstudio", baseUrl: "http://127.0.0.1:1234/v1", apiKey: "sk-secret" }],
      },
      声明,
    );
    const 主文本 = readFileSync(process.env.KUGUA_CONFIG!, "utf-8");
    expect(主文本).not.toContain("sk-secret");
    const 主 = 读主配置() as { ai: { providers: Array<Record<string, unknown>> } };
    expect(主.ai.providers[0]?.apiKey).toBeUndefined();
    expect(主.ai.providers[0]?.name).toBe("lmstudio");

    const 本地 = 读本地配置() as { ai: { providers: Array<Record<string, unknown>> } };
    expect(本地.ai.providers[0]?.apiKey).toBe("sk-secret");
  });

  it("读取时凭据被合并回来", () => {
    记录声明("ai", 声明);
    保存模块配置(
      "ai",
      { providers: [{ name: "p1", baseUrl: "http://x", apiKey: "sk-1" }] },
      声明,
    );
    const 配置 = 读取模块配置("ai") as { providers: Array<Record<string, unknown>> };
    expect(配置.providers[0]?.apiKey).toBe("sk-1");
    expect(配置.providers[0]?.name).toBe("p1");
  });

  it("表单模型里表格密钥列被脱敏，只回已设置标记", () => {
    记录声明("ai", 声明);
    保存模块配置("ai", { providers: [{ name: "p1", apiKey: "sk-1" }] }, 声明);
    const 模型 = 构造表单模型("ai");
    const 字段 = 模型.字段.find((f) => f.键 === "providers")!;
    const 行 = (字段.值 as Array<Record<string, unknown>>)[0]!;
    expect(行.apiKey).toBe("");
    expect(行["apiKey__已设置"]).toBe(true);
    expect(JSON.stringify(模型)).not.toContain("sk-1");
  });

  it("凭据列声称是凭据时才隔离——未标记的列照常入主配置", () => {
    const 无凭据声明: 配置声明 = {
      字段: [
        {
          键: "list",
          标题: "列表",
          类型: "array",
          数组: { 元素: "object", 列: [{ 键: "note", 标题: "备注", 类型: "string" }] },
        },
      ],
    };
    记录声明("x", 无凭据声明);
    保存模块配置("x", { list: [{ note: "plain" }] }, 无凭据声明);
    const 主 = 读主配置() as { x: { list: Array<Record<string, unknown>> } };
    expect(主.x.list[0]?.note).toBe("plain");
  });
});

