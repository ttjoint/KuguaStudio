import { describe, expect, it } from "vitest";
import { 解析模型id, 提取错误 } from "../src/openwebui.js";

describe("OpenWebUI 模型 id 解析", () => {
  it("拆出连接前缀与模型名", () => {
    expect(解析模型id("硅基流动.Qwen/Qwen3-8B")).toEqual({
      id: "硅基流动.Qwen/Qwen3-8B",
      prefix: "硅基流动",
      name: "Qwen/Qwen3-8B",
    });
  });

  it("模型名自身含点号时只按第一个点拆", () => {
    const 结果 = 解析模型id("LMSTUDIO.qwen3.6-27b-fable-fusion-711");
    expect(结果.prefix).toBe("LMSTUDIO");
    expect(结果.name).toBe("qwen3.6-27b-fable-fusion-711");
  });

  it("没有前缀时 prefix 为空串", () => {
    expect(解析模型id("gpt-4o")).toEqual({ id: "gpt-4o", prefix: "", name: "gpt-4o" });
  });

  it("以点开头或结尾时不当成前缀", () => {
    expect(解析模型id(".hidden").prefix).toBe("");
    expect(解析模型id("trailing.").prefix).toBe("");
  });
});

describe("OpenWebUI 错误信息提取", () => {
  it("取平铺的 message 字段", () => {
    const 文本 = JSON.stringify({ code: 30001, message: "账户余额不足" });
    expect(提取错误(402, 文本)).toBe("账户余额不足（HTTP 402）");
  });

  it("取 detail 字符串", () => {
    const 文本 = JSON.stringify({ detail: "Model not found" });
    expect(提取错误(400, 文本)).toBe("Model not found（HTTP 400）");
  });

  it("取嵌套的 error.message（OpenAI 风格）", () => {
    const 文本 = JSON.stringify({ error: { code: 400, message: "仅支持 Claude Code 客户端" } });
    expect(提取错误(400, 文本)).toBe("仅支持 Claude Code 客户端（HTTP 400）");
  });

  it("非 JSON 时回退到原文", () => {
    expect(提取错误(500, "Internal Server Error")).toContain("Internal Server Error");
  });

  it("空 JSON 时仍给出状态码", () => {
    expect(提取错误(418, "{}")).toContain("HTTP 418");
  });
});
