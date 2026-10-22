/**
 * 长任务模块的超时契约（回归护栏）
 *
 * 背景：后台手动验收发现，NiganeClient 的 handler 超时默认 30000ms，
 * 而本地 9B 模型单轮可达 40s+ —— 表现为「处理超时（30000ms）：ai.chat」，
 * 但模型其实还在生成。这类问题单测抓不到（测试用假 LLM 秒回）。
 *
 * 这个测试用**静态检查**锁死契约：ai / agent 模块必须显式设置足够的超时，
 * 防止将来重构时被顺手删掉。
 */
import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";

// import.meta.dirname = packages/modules/ai/test → 上溯 4 层到仓库根
const 根 = resolve(import.meta.dirname, "../../../..");

function 读源(相对: string): string {
  return readFileSync(resolve(根, 相对), "utf-8");
}

describe("长任务超时契约", () => {
  it("ai 模块显式设置 handler 超时（≥ 300s，覆盖单轮 40s+）", () => {
    const 源 = 读源("packages/modules/ai/src/index.ts");
    const 匹配 = 源.match(/请求超时毫秒:\s*(\d+)/);
    expect(匹配, "ai 模块必须显式设置 请求超时毫秒，否则长对话会被 30s 默认值掐断").not.toBeNull();
    const 毫秒 = Number(匹配![1]);
    expect(毫秒).toBeGreaterThanOrEqual(300_000);
  });

  it("agent 模块显式设置 handler 超时（≥ 600s，覆盖多轮工具循环）", () => {
    const 源 = 读源("packages/modules/agent/src/index.ts");
    const 匹配 = 源.match(/请求超时毫秒:\s*(\d+)/);
    expect(匹配, "agent 模块必须显式设置 请求超时毫秒").not.toBeNull();
    const 毫秒 = Number(匹配![1]);
    expect(毫秒).toBeGreaterThanOrEqual(600_000);
  });

  it("agent 调 ai.chat 时显式传超时（默认 10s 必然失败）", () => {
    const 源 = 读源("packages/modules/agent/src/index.ts");
    // 匹配 request("ai", "ai.chat", {...}, 超时) 的第四参
    const 调用段 = 源.slice(源.indexOf('request("ai", "ai.chat"'));
    const 片段 = 调用段.slice(0, 600);
    // 找到 })) as  之前的最后一段，检查是否有数字超时参数
    const 有超时 = /},\s*\d{4,}\)\)/.test(片段) || /},\s*\d{5,}\s*\)/.test(片段);
    expect(有超时, "agent 调 ai.chat 必须传超时毫秒，否则用默认 10s 直接超时").toBe(true);
  });

  it("agent.run 能力声明标记 长任务（走 capability.call 时给 600s）", () => {
    const 源 = 读源("packages/modules/agent/src/index.ts");
    expect(源).toMatch(/长任务:\s*true/);
  });
});
