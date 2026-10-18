/**
 * 业务失败与传输失败的区分。
 *
 * 来由：`/api/request` 原来用 HTTP 5xx 表达「模块未启动 / 没配置」这类**正常状态**。
 * 后果有两层：
 *   1. 浏览器把每个非 2xx 都记成控制台错误 —— 用户一开 AI 页就满屏红字，
 *      真正的问题被埋掉。UI 门禁也因此一直判失败。
 *   2. 传输层故障和业务拒绝混在一起，无法区分「平台坏了」和「这个功能没开」。
 *
 * 现在的约定：
 *   - 传输层出错（路由不存在、读体失败、服务内部异常）→ 5xx
 *   - 请求已到达平台、平台给出否定答复 → 200 + `__kuguaError`
 *
 * 对调用方而言两者一致：都抛错。所以这里同时守住「该抛的还得抛」，
 * 避免把错误吞掉——那比现在报 500 更糟。
 */

import { afterEach, describe, expect, it, vi } from "vitest";
import { 设置后台连通, 请求 } from "../src/renderer/bridge";

function 假响应(体: unknown, 状态 = 200): Response {
  return new Response(typeof 体 === "string" ? 体 : JSON.stringify(体), {
    status: 状态,
    headers: { "Content-Type": "application/json" },
  });
}

afterEach(() => {
  设置后台连通(true);
  vi.unstubAllGlobals();
});

describe("业务失败以 200 表达", () => {
  it("200 + __kuguaError 仍然抛给调用方", async () => {
    vi.stubGlobal("fetch", vi.fn(async () => 假响应({ __kuguaError: "目标模块不存在：logs" })));
    await expect(请求("/api/request", {})).rejects.toThrow(/目标模块不存在/);
  });

  it("抛出的错误文本就是平台给的原话，不加包装", async () => {
    // 调用方常把 err 直接显示给用户，多余前缀会变成噪音
    vi.stubGlobal("fetch", vi.fn(async () => 假响应({ __kuguaError: "OpenWebUI 未配置服务地址" })));
    await expect(请求("/api/request", {})).rejects.toThrow(/^OpenWebUI 未配置服务地址$/);
  });

  it("正常结果原样返回", async () => {
    vi.stubGlobal("fetch", vi.fn(async () => 假响应({ total: 3, ok: true })));
    await expect(请求("/api/request", {})).resolves.toEqual({ total: 3, ok: true });
  });

  it("结果里恰好有个叫 ok 的字段不会被当成错误", async () => {
    // 这就是为什么用 __kuguaError 而不是 ok:false —— 业务结果里 ok 太常见了
    vi.stubGlobal("fetch", vi.fn(async () => 假响应({ ok: false })));
    await expect(请求("/api/request", {})).resolves.toEqual({ ok: false });
  });

  it("空字符串的 __kuguaError 不抛错（视为无错误）", async () => {
    vi.stubGlobal("fetch", vi.fn(async () => 假响应({ __kuguaError: "", 值: 1 })));
    await expect(请求("/api/request", {})).resolves.toEqual({ __kuguaError: "", 值: 1 });
  });

  it("200 但响应体不是 JSON 时原样返回，不抛错", async () => {
    // 文件/文本类接口走同一条「请求」，不能因为不是 JSON 就崩
    vi.stubGlobal("fetch", vi.fn(async () => 假响应("纯文本")));
    await expect(请求("/api/request", {})).resolves.toBe("纯文本");
  });
});

describe("传输失败仍然是 5xx", () => {
  it("5xx 优先用响应体的 error 字段", async () => {
    vi.stubGlobal("fetch", vi.fn(async () => 假响应({ error: "服务内部错误" }, 500)));
    await expect(请求("/api/request", {})).rejects.toThrow(/服务内部错误/);
  });

  it("5xx 且无 error 字段时退化成状态码提示", async () => {
    vi.stubGlobal("fetch", vi.fn(async () => 假响应("", 503)));
    await expect(请求("/api/request", {})).rejects.toThrow(/503/);
  });

  it("断线闸门优先：不发请求、不依赖响应", async () => {
    const 假fetch = vi.fn();
    vi.stubGlobal("fetch", 假fetch);
    设置后台连通(false);
    await expect(请求("/api/request", {})).rejects.toThrow(/已与后台断开/);
    expect(假fetch).not.toHaveBeenCalled();
  });
});
