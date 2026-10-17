/**
 * 断线闸门测试。
 *
 * 来由：WebSocket 断开后，**HTTP 请求照样会发出去**——日志/总线走 WS，
 * 但所有 `window.kugua.request` 走 `/api/request`（HTTP），两者完全独立。
 * 后端已经没了，请求会在各自的超时里逐个失败，界面上表现为
 * 「点了半天没反应，然后突然弹一堆错误」。
 *
 * 这里守住闸门的语义：断线期间**不发请求**，立刻返回明确错误。
 */

import { afterEach, describe, expect, it, vi } from "vitest";
import { 设置后台连通, 是后台连通, 请求 } from "../src/renderer/bridge";

afterEach(() => {
  设置后台连通(true);
  vi.unstubAllGlobals();
});

describe("断线闸门", () => {
  it("默认连通", () => {
    expect(是后台连通()).toBe(true);
  });

  it("断线期间请求不出网，立刻抛明确错误", async () => {
    const 假fetch = vi.fn();
    vi.stubGlobal("fetch", 假fetch);

    设置后台连通(false);
    await expect(请求("/api/request", {})).rejects.toThrow(/已与后台断开/);
    // 关键：一个请求都没发出去
    expect(假fetch).not.toHaveBeenCalled();
  });

  it("错误信息要告诉用户怎么办，而不只是报错", async () => {
    设置后台连通(false);
    await expect(请求("/api/request", {})).rejects.toThrow(/手动刷新页面/);
  });

  it("恢复连通后请求能正常发出", async () => {
    const 假fetch = vi.fn(async () =>
      new Response(JSON.stringify({ ok: true }), {
        status: 200,
        headers: { "Content-Type": "application/json" },
      }),
    );
    vi.stubGlobal("fetch", 假fetch);

    设置后台连通(false);
    await expect(请求("/api/request", {})).rejects.toThrow();

    设置后台连通(true);
    const 结果 = await 请求<{ ok: boolean }>("/api/request", {});
    expect(结果).toEqual({ ok: true });
    expect(假fetch).toHaveBeenCalledTimes(1);
  });

  it("闸门是全局的：所有调用方共享同一状态", async () => {
    vi.stubGlobal("fetch", vi.fn());
    设置后台连通(false);
    // 两次独立调用都应被拦住（不是按调用方分别记状态）
    await expect(请求("/api/request", {})).rejects.toThrow(/已与后台断开/);
    await expect(请求("/api/dialog/openFiles", {})).rejects.toThrow(/已与后台断开/);
  });
});
