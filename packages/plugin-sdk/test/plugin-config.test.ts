/**
 * 插件配置能力测试。
 *
 * 覆盖三件事：
 *  1. 清单里的 `配置声明` 能被读出来（平台据此判断「可配置」）
 *  2. 宿主注入的 `配置()` 按插件名分别读取，互不串台
 *  3. 读配置失败时不抛异常（插件不该因为总线抖动而崩）
 */

import { describe, expect, it } from "vitest";
import { Context, 创建宿主, type 插件宿主 } from "../src/index.js";
import { 创建日志器 } from "../src/index.js";

/** 造一个只会回应 moduleConfig.getModule 的假客户端 */
function 造客户端(
  配置表: Record<string, Record<string, unknown>>,
  行为: "正常" | "抛错" = "正常",
): { request: (...参数: unknown[]) => Promise<unknown>; 调用记录: string[] } {
  const 调用记录: string[] = [];
  return {
    调用记录,
    request: async (...参数: unknown[]) => {
      const [目标, 动作, 载荷] = 参数 as [string, string, { name?: string }];
      调用记录.push(`${目标}.${动作}:${载荷?.name ?? ""}`);
      if (行为 === "抛错") throw new Error("总线断开");
      if (动作 === "nigane.moduleConfig.getModule") {
        return 配置表[载荷?.name ?? ""] ?? {};
      }
      return {};
    },
  };
}

describe("插件配置", () => {
  it("按插件名读取各自的配置节", async () => {
    const 客户端 = 造客户端({
      hello: { greeting: "早上好", limit: 9 },
      other: { greeting: "不同插件的值" },
    });
    const 甲 = 创建宿主(客户端 as never, 创建日志器(), "hello");
    const 乙 = 创建宿主(客户端 as never, 创建日志器(), "other");

    expect(await 甲.配置()).toEqual({ greeting: "早上好", limit: 9 });
    expect(await 乙.配置()).toEqual({ greeting: "不同插件的值" });
    // 确认是各查各的，而不是读到同一份
    expect(客户端.调用记录).toEqual([
      "nigane.nigane.moduleConfig.getModule:hello",
      "nigane.nigane.moduleConfig.getModule:other",
    ]);
  });

  it("未声明配置的插件得到空对象而不是报错", async () => {
    const 客户端 = 造客户端({});
    const 宿主 = 创建宿主(客户端 as never, 创建日志器(), "未声明");
    expect(await 宿主.配置()).toEqual({});
  });

  it("没有插件名时直接返回空对象，不发请求", async () => {
    const 客户端 = 造客户端({ hello: { a: 1 } });
    const 宿主 = 创建宿主(客户端 as never, 创建日志器());
    expect(await 宿主.配置()).toEqual({});
    expect(客户端.调用记录).toEqual([]);
  });

  it("读取失败不抛异常，返回上次成功的值", async () => {
    let 应抛错 = false;
    const 客户端 = {
      request: async () => {
        if (应抛错) throw new Error("总线断开");
        return { greeting: "缓存值" };
      },
    };
    const 宿主 = 创建宿主(客户端 as never, 创建日志器(), "hello");
    expect(await 宿主.配置()).toEqual({ greeting: "缓存值" });

    // 总线抖动：插件不该崩，应回退到上次成功的结果
    应抛错 = true;
    await expect(宿主.配置()).resolves.toEqual({ greeting: "缓存值" });
  });

  it("首次读取就失败时返回空对象（插件用默认值兜底）", async () => {
    const 客户端 = 造客户端({}, "抛错");
    const 宿主 = 创建宿主(客户端 as never, 创建日志器(), "hello");
    await expect(宿主.配置()).resolves.toEqual({});
  });

  it("Context 把配置能力透传给插件", async () => {
    const 客户端 = 造客户端({ hello: { greeting: "经过 Context" } });
    const 宿主: 插件宿主 = 创建宿主(客户端 as never, 创建日志器(), "hello");
    const ctx = new Context(宿主);
    expect(await ctx.配置()).toEqual({ greeting: "经过 Context" });
  });

  it("配置每次都回源，平台改完立刻可见", async () => {
    let 当前值: Record<string, unknown> = { greeting: "旧值" };
    const 客户端 = {
      request: async () => 当前值,
    };
    const 宿主 = 创建宿主(客户端 as never, 创建日志器(), "hello");
    expect(await 宿主.配置()).toEqual({ greeting: "旧值" });
    当前值 = { greeting: "新值" };
    expect(await 宿主.配置()).toEqual({ greeting: "新值" });
  });
});
