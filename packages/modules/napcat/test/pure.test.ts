/**
 * napcat 桥的纯逻辑测试：心跳过滤 / 事件名 / api 请求校验。
 *
 * ## 为什么测这三处
 *
 * napcat 桥主体是连两条 WebSocket（苦音 + Napcat），没法在单测里跑真连接。
 * 但三处判定是「错了也看不出来」的：
 *
 * 1. **心跳过滤**：漏了过滤不会报错，只是总线上每分钟多 12 条噪声。
 *    用户看到的是「聊天记录里全是心跳」，但功能本身还在工作。
 *
 * 2. **事件名拼接**：`napcat.` 前缀漏了、或者拼成 `napcat/xxx`，
 *    前端订阅 `napcat.*` 就收不到消息——表现是「机器人不回话」，
 *    而服务端日志一片正常。
 *
 * 3. **`api` 的 action 校验**：不校验时 `action=undefined` 发给 Napcat，
 *    错误在对面抛，这边什么都看不出来。
 */

import { describe, expect, it } from "vitest";
import { 事件名, 心跳分类, 应转发, 解析Api请求 } from "../src/pure.js";

describe("心跳过滤", () => {
  it("默认丢弃 meta.heartbeat", () => {
    expect(应转发("meta.heartbeat", false)).toBe(false);
  });

  it("开了 转发心跳 才转发", () => {
    expect(应转发("meta.heartbeat", true)).toBe(true);
  });

  it("其他 meta 事件照样转发（只丢心跳，不丢整个 meta）", () => {
    // meta.lifecycle 表示机器人上下线，是必须转发的
    expect(应转发("meta.lifecycle", false)).toBe(true);
  });

  it("普通消息事件照样转发", () => {
    expect(应转发("message.group", false)).toBe(true);
    expect(应转发("message.private", false)).toBe(true);
    expect(应转发("notice.group_upload", false)).toBe(true);
  });

  it("心跳分类常量就是 meta.heartbeat（别改成 heartbeat）", () => {
    expect(心跳分类).toBe("meta.heartbeat");
    // 钉住：OneBot11 的完整分类名带 meta. 前缀
    expect(心跳分类.startsWith("meta.")).toBe(true);
  });
});

describe("事件名", () => {
  it("加 napcat. 前缀", () => {
    expect(事件名("message.group")).toBe("napcat.message.group");
  });

  it("分类本身带点时不重复加点", () => {
    expect(事件名("meta.heartbeat")).toBe("napcat.meta.heartbeat");
  });

  it("空分类时只剩前缀（不抛错，也不拼出 \"napcat.\" 之外的东西）", () => {
    expect(事件名("")).toBe("napcat.");
  });

  it("前缀是 napcat 而不是 napcat 的别名（前端按这个订阅）", () => {
    expect(事件名("x").startsWith("napcat.")).toBe(true);
    expect(事件名("x").split(".")[0]).toBe("napcat");
  });

  it("三段式事件名可以按前两段过滤（前端订阅 napcat.message.*）", () => {
    const 名 = 事件名("message.group");
    expect(名.split(".").slice(0, 2).join(".")).toBe("napcat.message");
  });
});

describe("解析Api请求：action 校验", () => {
  it("正常提取 action 与 params", () => {
    const r = 解析Api请求({ action: "get_group_list", params: { a: 1 } });
    expect(r.action).toBe("get_group_list");
    expect(r.参数).toEqual({ a: 1 });
  });

  it("没有 params 时 参数 是 undefined（不是 {}）", () => {
    // 必须保持 undefined：Ob11Client 对 undefined 和 {} 的处理不同
    expect(解析Api请求({ action: "x" }).参数).toBeUndefined();
  });

  it("缺 action 时抛错", () => {
    expect(() => 解析Api请求({})).toThrow(/缺少 action/);
    expect(() => 解析Api请求(null)).toThrow(/缺少 action/);
    expect(() => 解析Api请求(undefined)).toThrow(/缺少 action/);
  });

  it("action 是空白串时也抛错（trim 后为空）", () => {
    // 只判 !action 时 "   " 会被放行，然后 Napcat 收到全空格 action
    expect(() => 解析Api请求({ action: "   " })).toThrow(/缺少 action/);
    expect(() => 解析Api请求({ action: "\t\n" })).toThrow(/缺少 action/);
  });

  it("action 非字符串时抛错（数字 0 不能当成合法 action）", () => {
    expect(() => 解析Api请求({ action: 0 })).toThrow(/缺少 action/);
    expect(() => 解析Api请求({ action: 123 })).toThrow(/缺少 action/);
    expect(() => 解析Api请求({ action: null })).toThrow(/缺少 action/);
  });

  it("action 两侧空白被 trim", () => {
    expect(解析Api请求({ action: "  send_msg  " }).action).toBe("send_msg");
  });

  it("params 原样透传，不做形状校验", () => {
    // 各 OneBot API 的 params 形状不同，桥不该替它们校验
    expect(解析Api请求({ action: "x", params: "字符串也行" }).参数).toBe("字符串也行");
    expect(解析Api请求({ action: "x", params: null }).参数).toBeNull();
    expect(解析Api请求({ action: "x", params: [1, 2] }).参数).toEqual([1, 2]);
  });
});
