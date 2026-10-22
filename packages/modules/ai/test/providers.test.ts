/**
 * AI 提供方配置加载：字段契约兼容性
 *
 * 背景（验收发现的真 bug）：
 * - 配置声明（declaration.ts 的 提供方列）用**扁平字段**：chatModel / imageModel / embedModel
 * - 运行时结构是**嵌套**：models.chat / models.image / models.embed
 * - 原实现只读嵌套，导致 UI 填了 chatModel 后运行时拿到 models: {}
 *   → 表现为「配了模型但不用，回退到提供方第一个模型」
 *
 * 这里锁死「两种写法都能读」的行为。
 */
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { mkdtempSync, writeFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { 加载AI配置 } from "../src/providers.js";

let 目录: string;
let 主配置: string;
let 本地配置: string;

beforeEach(() => {
  目录 = mkdtempSync(join(tmpdir(), "ai-providers-"));
  主配置 = join(目录, "kugua.config.json");
  本地配置 = join(目录, "kugua.config.local.json");
  process.env.KUGUA_CONFIG = 主配置;
  process.env.KUGUA_CONFIG_LOCAL = 本地配置;
});

afterEach(() => {
  delete process.env.KUGUA_CONFIG;
  delete process.env.KUGUA_CONFIG_LOCAL;
  try {
    rmSync(目录, { recursive: true, force: true });
  } catch {
    /* ignore */
  }
});

function 写配置(主: unknown, 本地: unknown = {}): void {
  writeFileSync(主配置, JSON.stringify({ ai: 主 }), "utf-8");
  writeFileSync(本地配置, JSON.stringify({ ai: 本地 }), "utf-8");
}

describe("加载AI配置：提供方字段契约", () => {
  it("扁平字段（声明写法）：chatModel/imageModel/embedModel 映射到 models", () => {
    写配置({
      default: "lmstudio",
      providers: [
        {
          name: "lmstudio",
          baseUrl: "http://127.0.0.1:1234/v1",
          chatModel: "qwen/qwen3.5-9b",
          imageModel: "flux",
          embedModel: "nomic",
        },
      ],
    });
    const 配置 = 加载AI配置();
    expect(配置.default).toBe("lmstudio");
    expect(配置.providers).toHaveLength(1);
    expect(配置.providers[0].models).toEqual({
      chat: "qwen/qwen3.5-9b",
      image: "flux",
      embed: "nomic",
    });
  });

  it("嵌套字段（手写写法）：models.chat 也能读", () => {
    写配置({
      providers: [
        { name: "ollama", baseUrl: "http://127.0.0.1:11434/v1", models: { chat: "llama3" } },
      ],
    });
    const 配置 = 加载AI配置();
    expect(配置.providers[0].models.chat).toBe("llama3");
  });

  it("扁平优先于嵌套（同时存在时以声明字段为准）", () => {
    写配置({
      providers: [
        {
          name: "x",
          baseUrl: "http://x/v1",
          chatModel: "扁平模型",
          models: { chat: "嵌套模型" },
        },
      ],
    });
    expect(加载AI配置().providers[0].models.chat).toBe("扁平模型");
  });

  it("未填模型时 models 各字段为 undefined（而非空串）", () => {
    写配置({ providers: [{ name: "x", baseUrl: "http://x/v1" }] });
    const m = 加载AI配置().providers[0].models;
    expect(m.chat).toBeUndefined();
    expect(m.image).toBeUndefined();
    expect(m.embed).toBeUndefined();
  });

  it("baseUrl 末尾斜杠被去掉", () => {
    写配置({ providers: [{ name: "x", baseUrl: "http://x/v1///" }] });
    expect(加载AI配置().providers[0].baseUrl).toBe("http://x/v1");
  });

  it("本地文件的 apiKey 按名称补回（凭据分离存储）", () => {
    写配置(
      { providers: [{ name: "cloud", baseUrl: "https://api.example.com/v1", chatModel: "m1" }] },
      { providers: [{ name: "cloud", apiKey: "sk-secret" }] },
    );
    const p = 加载AI配置().providers[0];
    expect(p.apiKey).toBe("sk-secret");
    // 关键：补 key 时不能把主文件的 baseUrl / 模型丢掉
    expect(p.baseUrl).toBe("https://api.example.com/v1");
    expect(p.models.chat).toBe("m1");
  });

  it("default 缺省时取第一个提供方名", () => {
    写配置({ providers: [{ name: "first", baseUrl: "http://x/v1" }] });
    expect(加载AI配置().default).toBe("first");
  });
});
