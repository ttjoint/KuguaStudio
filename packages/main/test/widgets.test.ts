/**
 * 小组件布局存储单测
 *
 * 重点在「配置被手改坏时不能崩」与「写回必须透传其它顶层节」——
 * 后者是主控的既定约定：只读写自己认识的字段，不认识的必须原样写回，
 * 否则每次落盘都会静默抹掉别的模块的配置。
 */
import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { existsSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";
import {
  归一配置节,
  读取小组件配置,
  保存小组件配置,
  默认方案名,
  注册小组件,
  注销小组件,
  列出小组件,
  设置来源在线,
  列出小组件警告,
  清空注册表,
} from "../src/widgets.js";

describe("归一配置节", () => {
  it("空值给出一套默认方案", () => {
    const 节 = 归一配置节(undefined);
    expect(节.当前方案).toBe(默认方案名);
    expect(Object.keys(节.方案)).toEqual([默认方案名]);
  });

  it("丢掉空覆盖项——否则「只存改过的项」会被空对象污染", () => {
    const 节 = 归一配置节({
      方案: { 默认: { 覆盖: { "a.b": {}, "c.d": { 隐藏: true } } } },
    });
    expect(Object.keys(节.方案.默认.覆盖 ?? {})).toEqual(["c.d"]);
  });

  it("非法枚举值被丢弃而不报错", () => {
    const 节 = 归一配置节({
      方案: { 默认: { 覆盖: { "a.b": { 外形: "巨型", 区域: "月球", 顺序: "十" } } } },
    });
    expect(节.方案.默认.覆盖?.["a.b"]).toBeUndefined();
  });

  it("当前方案指向不存在的方案时落到第一个", () => {
    const 节 = 归一配置节({ 当前方案: "不存在", 方案: { 甲: {}, 乙: {} } });
    expect(节.当前方案).toBe("甲");
  });

  it("方案全被删空时补回默认——界面不能没有方案可用", () => {
    const 节 = 归一配置节({ 当前方案: "x", 方案: {} });
    expect(Object.keys(节.方案)).toEqual([默认方案名]);
  });

  it("未知的展示预设回落自动", () => {
    const 节 = 归一配置节({ 方案: { 默: { 展示: "极简" } } });
    expect(节.方案.默.展示).toBe("自动");
  });

  it("完全不是对象时返回默认，不抛错", () => {
    expect(归一配置节(null).当前方案).toBe(默认方案名);
    expect(归一配置节("坏").当前方案).toBe(默认方案名);
    expect(归一配置节([1, 2]).当前方案).toBe(默认方案名);
  });
});

describe("落盘读写", () => {
  let 临时: string;
  let 原cwd: string;

  beforeEach(() => {
    原cwd = process.cwd();
    临时 = mkdtempSync(join(tmpdir(), "kugua-widget-"));
    process.chdir(临时);
  });

  afterEach(() => {
    process.chdir(原cwd);
    rmSync(临时, { recursive: true, force: true });
  });

  it("配置文件不存在时读到默认值", () => {
    expect(读取小组件配置().当前方案).toBe(默认方案名);
  });

  it("保存后能读回", () => {
    保存小组件配置({
      当前方案: "专注",
      方案: { 专注: { 展示: "仅状态栏", 覆盖: { "a.b": { 隐藏: true } } } },
    });
    const 读回 = 读取小组件配置();
    expect(读回.当前方案).toBe("专注");
    expect(读回.方案.专注.覆盖?.["a.b"]).toEqual({ 隐藏: true });
  });

  it("写回时透传其它顶层节（ai / plugins / modules）", () => {
    writeFileSync(
      join(临时, "kugua.config.json"),
      JSON.stringify(
        {
          host: "127.0.0.1",
          port: 24601,
          ai: { provider: "openwebui", models: ["a"] },
          plugins: { marketIndex: "http://x" },
          modules: [{ name: "sysmon" }],
        },
        null,
        2,
      ),
    );
    保存小组件配置({ 当前方案: 默认方案名, 方案: { [默认方案名]: { 覆盖: {} } } });
    const 全 = JSON.parse(readFileSync(join(临时, "kugua.config.json"), "utf-8")) as Record<string, unknown>;
    expect(全.ai).toEqual({ provider: "openwebui", models: ["a"] });
    expect(全.plugins).toEqual({ marketIndex: "http://x" });
    expect(全.modules).toEqual([{ name: "sysmon" }]);
    expect(全.host).toBe("127.0.0.1");
    expect(全.widgets).toBeTruthy();
  });

  it("配置文件是坏 JSON 时读默认，不抛错", () => {
    writeFileSync(join(临时, "kugua.config.json"), "{ 坏掉的");
    expect(读取小组件配置().当前方案).toBe(默认方案名);
  });

  it("保存会创建文件", () => {
    保存小组件配置({ 当前方案: 默认方案名, 方案: { [默认方案名]: {} } });
    expect(existsSync(join(临时, "kugua.config.json"))).toBe(true);
  });
});

describe("注册表", () => {
  beforeEach(() => 清空注册表());
  afterEach(() => 清空注册表());

  it("注册后列出，带全局键与在线状态", () => {
    注册小组件("sysmon", [{ id: "cpu", 类型: "number", 标题: "CPU" }]);
    设置来源在线("sysmon", true);
    const 列 = 列出小组件();
    expect(列.length).toBe(1);
    expect(列[0].键).toBe("sysmon.cpu");
    expect(列[0].在线).toBe(true);
  });

  it("重新声明会覆盖旧声明，不残留", () => {
    注册小组件("p", [
      { id: "a", 类型: "number", 标题: "A" },
      { id: "b", 类型: "number", 标题: "B" },
    ]);
    注册小组件("p", [{ id: "a", 类型: "number", 标题: "A" }]);
    expect(列出小组件().map((x) => x.键)).toEqual(["p.a"]);
  });

  it("声明为空时清掉该来源", () => {
    注册小组件("p", [{ id: "a", 类型: "number", 标题: "A" }]);
    注册小组件("p", []);
    expect(列出小组件()).toEqual([]);
  });

  it("注销后消失", () => {
    注册小组件("p", [{ id: "a", 类型: "number", 标题: "A" }]);
    注销小组件("p");
    expect(列出小组件()).toEqual([]);
  });

  it("离线但保留声明——界面据在线状态标灰，而不是整块消失", () => {
    注册小组件("p", [{ id: "a", 类型: "number", 标题: "A" }]);
    设置来源在线("p", false);
    const 列 = 列出小组件();
    expect(列.length).toBe(1);
    expect(列[0].在线).toBe(false);
  });

  it("警告按来源汇总", () => {
    注册小组件("p", [{ id: "BAD ID", 类型: "number", 标题: "X" }]);
    const 警告 = 列出小组件警告();
    expect(警告.length).toBe(1);
    expect(警告[0].来源).toBe("p");
  });
});
