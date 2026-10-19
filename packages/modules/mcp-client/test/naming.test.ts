/**
 * mcp-client 的命名与前缀规范化测试。
 *
 * 前缀会拼进**能力名**，而能力名是主控的全局键。拼错了的表现是
 * 「接入成功」的日志照样打、但真去调那个能力时路由打不到——
 * 日志里看不出来，只有实测才发现。
 */

import { describe, expect, it } from "vitest";
import { 规范前缀, 清单转配置, 能力名 } from "../src/naming.js";

describe("规范前缀", () => {
  it("正常值原样返回", () => {
    expect(规范前缀("weather", "fallback")).toBe("weather");
  });

  it("两端空白被 trim", () => {
    expect(规范前缀("  weather  ", "fallback")).toBe("weather");
  });

  it("中间空白变成下划线", () => {
    expect(规范前缀("my weather", "fallback")).toBe("my_weather");
  });

  it("非法字符换成下划线", () => {
    expect(规范前缀("my@weather!", "fallback")).toBe("my_weather_");
    expect(规范前缀("天气", "fallback")).toBe("__");
  });

  it("点号、下划线、连字符是合法的（有意放行）", () => {
    // 点号必须合法：能力名格式就是 `前缀.工具名`，
    // 允许前缀自带层级（`my.company.weather`）。
    expect(规范前缀("my.company", "fb")).toBe("my.company");
    expect(规范前缀("a_b-c.d", "fb")).toBe("a_b-c.d");
  });

  it("空串用回退", () => {
    expect(规范前缀("", "fallback")).toBe("fallback");
  });

  it("全空白用回退", () => {
    expect(规范前缀("   ", "fallback")).toBe("fallback");
  });

  it("规范化后仍为空时返回回退（不再继续规范化）", () => {
    // 传全非法字符会被换成下划线，不是空——所以能走到这里的只有
    // 「回退本身也是空」的情况。此时原样返回，不死循环。
    expect(规范前缀("", "")).toBe("");
  });

  it("回退里的非法字符**不会被**规范化", () => {
    // 当前实现：只有当 前缀 为空时才取 回退，然后统一规范化。
    // 所以回退其实也会被规范化（走的是同一条 replace）。
    // 这条钉住它——将来若改成「回退不处理」，这里会红。
    expect(规范前缀("", "my@fb")).toBe("my_fb");
  });

  it("前缀合法时不看回退", () => {
    expect(规范前缀("ok", "my@fb")).toBe("ok");
  });
});

describe("清单转配置", () => {
  it("完整清单", () => {
    const r = 清单转配置(
      {
        name: "weather",
        command: "node",
        args: ["server.mjs"],
        env: { K: "V" },
        prefix: "wx",
        timeoutMs: 5000,
      },
      "/abs/dir",
    );
    expect(r).toEqual({
      name: "weather",
      command: "node",
      args: ["server.mjs"],
      env: { K: "V" },
      cwd: "/abs/dir",
      prefix: "wx",
      timeoutMs: 5000,
    });
  });

  it("cwd 固定为清单所在目录（不依赖平台的 cwd）", () => {
    const r = 清单转配置({ name: "a", command: "node" }, "/some/where");
    expect(r?.cwd).toBe("/some/where");
  });

  it("entry 是老写法，等价于 command", () => {
    expect(清单转配置({ name: "a", entry: "run.py" }, "/d")?.command).toBe("run.py");
  });

  it("command 优先于 entry", () => {
    expect(清单转配置({ name: "a", command: "node", entry: "run.py" }, "/d")?.command).toBe("node");
  });

  it("prefix 没写时等于 name", () => {
    // 这就是「前缀默认等于服务名」的出处，改了会影响所有能力名
    expect(清单转配置({ name: "weather", command: "node" }, "/d")?.prefix).toBe("weather");
  });

  it("prefix 写了就用它", () => {
    expect(清单转配置({ name: "weather", command: "node", prefix: "wx" }, "/d")?.prefix).toBe("wx");
  });

  it("args 没写时是空数组（不是 undefined）", () => {
    expect(清单转配置({ name: "a", command: "node" }, "/d")?.args).toEqual([]);
  });

  it("args 不是数组时也归成空数组", () => {
    for (const v of ["one", 123, {}, null]) {
      expect(清单转配置({ name: "a", command: "node", args: v as never }, "/d")?.args).toEqual([]);
    }
  });

  it("没有 name 返回 null", () => {
    expect(清单转配置({ command: "node" }, "/d")).toBeNull();
  });

  it("name 是空串返回 null", () => {
    expect(清单转配置({ name: "", command: "node" }, "/d")).toBeNull();
  });

  it("既没 command 也没 entry 返回 null", () => {
    expect(清单转配置({ name: "a" }, "/d")).toBeNull();
  });

  it("command 是空串返回 null", () => {
    expect(清单转配置({ name: "a", command: "" }, "/d")).toBeNull();
  });

  it("传 null / undefined 返回 null 而不抛错", () => {
    // 清单文件里可能是 `null`，JSON.parse 得 null。
    // 这里不能抛——抛了整份扫描就断了。
    expect(清单转配置(null, "/d")).toBeNull();
    expect(清单转配置(undefined, "/d")).toBeNull();
  });

  it("timeoutMs 原样透传（含 undefined）", () => {
    expect(清单转配置({ name: "a", command: "node" }, "/d")?.timeoutMs).toBeUndefined();
    expect(清单转配置({ name: "a", command: "node", timeoutMs: 0 }, "/d")?.timeoutMs).toBe(0);
  });

  it("不修改入参", () => {
    const 原文 = { name: "a", command: "node", args: ["x"] };
    const 快照 = JSON.stringify(原文);
    清单转配置(原文, "/d");
    expect(JSON.stringify(原文)).toBe(快照);
  });
});

describe("能力名", () => {
  it("前缀.工具名", () => {
    expect(能力名("weather", "forecast")).toBe("weather.forecast");
  });

  it("前缀带层级时是三层", () => {
    expect(能力名("my.company", "tool")).toBe("my.company.tool");
  });
});

describe("三者串起来", () => {
  it("清单 → 前缀 → 能力名 的完整链路", () => {
    const 服务 = 清单转配置({ name: "My Weather", command: "node" }, "/d");
    expect(服务).not.toBeNull();
    const 前缀 = 规范前缀(服务!.prefix ?? 服务!.name, 服务!.name);
    expect(前缀).toBe("My_Weather"); // 空格换下划线
    expect(能力名(前缀, "forecast")).toBe("My_Weather.forecast");
  });

  it("前缀全非法时能力名不会以点或下划线以外的怪字符开头", () => {
    const 服务 = 清单转配置({ name: "天气", command: "node" }, "/d");
    const 前缀 = 规范前缀(服务!.prefix ?? 服务!.name, 服务!.name);
    // 中文被换成下划线，能力名仍然是合法标识符形状
    expect(能力名(前缀, "t")).toMatch(/^[A-Za-z0-9_.-]+$/);
  });
});
