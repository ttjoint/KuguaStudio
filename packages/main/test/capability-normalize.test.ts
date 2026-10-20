import { describe, expect, it } from "vitest";
import { 归一全部能力, 归一能力声明 } from "../src/capability-normalize.js";

/**
 * 这组测试守住一个真实的崩溃现场：
 *
 * Python SDK 用户按语言习惯写 `{"name": "tts.speak"}`，主控直接取 `声明.名称`
 * 拿到 undefined，能力注册表抛错，而这个异常发生在握手回调里，
 * 直接把整个主控进程带崩。
 *
 * 结论：外部输入必须归一 + 容错，且永远不能在握手路径上抛。
 */
describe("能力声明归一", () => {
  it("协议中文字段名原样保留", () => {
    const r = 归一能力声明({ 名称: "a.b", 说明: "x", 中文指令: ["念"] });
    expect(r.名称).toBe("a.b");
    expect(r.说明).toBe("x");
    expect(r.中文指令).toEqual(["念"]);
  });

  it("英文 name 映射为名称", () => {
    const r = 归一能力声明({ name: "tts.speak", description: "合成语音" });
    expect(r.名称).toBe("tts.speak");
    expect(r.说明).toBe("合成语音");
    expect(r.name).toBeUndefined();
  });

  it("中英文混写时以显式中文键为准（后者覆盖前者）", () => {
    const r = 归一能力声明({ name: "英文名", 名称: "中文名" });
    expect(r.名称).toBe("中文名");
  });

  it("未识别的键原样透传", () => {
    const r = 归一能力声明({ 名称: "a", 自定义: 123 });
    expect(r.自定义).toBe(123);
  });

  it("非对象输入返回空对象而不是抛错", () => {
    expect(归一能力声明(null)).toEqual({});
    expect(归一能力声明("x")).toEqual({});
    expect(归一能力声明(42)).toEqual({});
  });
});

describe("能力列表归一与容错", () => {
  it("混合中英文字段都能收进", () => {
    const { 合法, 问题 } = 归一全部能力([
      { 名称: "a.one" },
      { name: "a.two" },
    ]);
    expect([...合法.keys()]).toEqual(["a.one", "a.two"]);
    expect(问题).toHaveLength(0);
  });

  it("缺少名称的声明被跳过并记录原因，不抛异常", () => {
    const { 合法, 问题 } = 归一全部能力([
      { name: "ok.one" },
      { description: "忘了写名字" },
      {},
    ]);
    expect([...合法.keys()]).toEqual(["ok.one"]);
    expect(问题).toHaveLength(2);
    expect(问题[0]?.原因).toBe("缺少名称");
  });

  it("名称为空白字符串也视为缺失", () => {
    const { 合法, 问题 } = 归一全部能力([{ 名称: "   " }]);
    expect(合法.size).toBe(0);
    expect(问题).toHaveLength(1);
  });

  it("名称两端空白会被裁掉", () => {
    const { 合法 } = 归一全部能力([{ 名称: "  a.b  " }]);
    expect([...合法.keys()]).toEqual(["a.b"]);
  });

  it("重复名称后者覆盖前者", () => {
    const { 合法 } = 归一全部能力([
      { 名称: "a.b", 说明: "旧" },
      { 名称: "a.b", 说明: "新" },
    ]);
    expect(合法.size).toBe(1);
    expect((合法.get("a.b") as { 说明?: string }).说明).toBe("新");
  });

  it("undefined / 空数组都返回空结果", () => {
    expect(归一全部能力(undefined).合法.size).toBe(0);
    expect(归一全部能力([]).合法.size).toBe(0);
  });

  it("无论输入多脏都不抛异常", () => {
    const 脏 = [null, undefined, 0, "", [], { name: null }, { 名称: {} }];
    expect(() => 归一全部能力(脏 as unknown[])).not.toThrow();
  });
});

describe("执行 字段（能力作业）", () => {
  it("英文 exec / execute 归一成 执行", () => {
    // 外部模块（Python/Go）按自己的习惯写 `exec`，不归一的话 job 侧
    // 永远找不到 执行，报「未声明 执行」——明明声明了，只是键名不同
    const 甲 = 归一全部能力([{ name: "image.batch", exec: { 命令: "magick" } }]);
    expect((甲.合法.get("image.batch") as { 执行?: { 命令: string } }).执行).toEqual({ 命令: "magick" });
    const 乙 = 归一全部能力([{ name: "image.batch", execute: { 命令: "magick" } }]);
    expect((乙.合法.get("image.batch") as { 执行?: { 命令: string } }).执行).toEqual({ 命令: "magick" });
  });

  it("本来就是中文键时原样保留", () => {
    const r = 归一全部能力([{ 名称: "x.y", 执行: { 命令: "node" } }]);
    expect((r.合法.get("x.y") as { 执行?: { 命令: string } }).执行).toEqual({ 命令: "node" });
  });
});
