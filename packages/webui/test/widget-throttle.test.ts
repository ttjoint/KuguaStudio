import { describe, it, expect } from "vitest";
import { 推送限流 } from "../src/widget-throttle.js";

describe("小组件推送限流", () => {
  it("上限内全部通过", () => {
    const 流 = new 推送限流(20);
    for (let i = 0; i < 20; i += 1) expect(流.通过("sysmon", 0)).toBe(true);
  });

  it("超过上限的丢弃", () => {
    const 流 = new 推送限流(3);
    expect(流.通过("a", 0)).toBe(true);
    expect(流.通过("a", 0)).toBe(true);
    expect(流.通过("a", 0)).toBe(true);
    expect(流.通过("a", 0)).toBe(false);
  });

  it("进入新窗口后配额恢复", () => {
    const 流 = new 推送限流(2);
    expect(流.通过("a", 1000)).toBe(true);
    expect(流.通过("a", 1000)).toBe(true);
    expect(流.通过("a", 1000)).toBe(false);
    expect(流.通过("a", 2000)).toBe(true);
  });

  it("各来源互不影响——一个插件刷爆不该拖累别的插件", () => {
    const 流 = new 推送限流(1);
    expect(流.通过("a", 0)).toBe(true);
    expect(流.通过("a", 0)).toBe(false);
    expect(流.通过("b", 0)).toBe(true);
  });

  it("重置后恢复配额", () => {
    const 流 = new 推送限流(1);
    expect(流.通过("a", 0)).toBe(true);
    expect(流.通过("a", 0)).toBe(false);
    流.重置("a");
    expect(流.通过("a", 0)).toBe(true);
  });

  it("重置全部来源", () => {
    const 流 = new 推送限流(1);
    流.通过("a", 0);
    流.通过("b", 0);
    流.重置();
    expect(流.通过("a", 0)).toBe(true);
    expect(流.通过("b", 0)).toBe(true);
  });

  it("丢弃不排队——超限后立刻回来也不会补偿", () => {
    const 流 = new 推送限流(2);
    流.通过("a", 0);
    流.通过("a", 0);
    expect(流.通过("a", 0)).toBe(false);
    expect(流.通过("a", 0)).toBe(false);
    // 新窗口第一发应该通过，而不是先把之前丢弃的补上
    expect(流.通过("a", 1000)).toBe(true);
  });
});
