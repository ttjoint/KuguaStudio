/**
 * AI 提供方配置：从 kugua.config.json 的 `ai` 节读取，缺省回退环境变量或本地默认端点。
 *
 * 设计：把"模型/端点"集中成网关（仿 Open WebUI），模块只认提供方名与用途（chat/image/embed），
 * 不再各模块自行读环境变量。
 */

import { existsSync, readFileSync } from "node:fs";
import { resolve } from "node:path";

export interface AI提供方 {
  name: string;
  baseUrl: string;
  apiKey: string;
  models: { chat?: string; image?: string; embed?: string };
}

export interface AI配置 {
  providers: AI提供方[];
  default: string;
}

function 读配置节(): { providers?: AI提供方[]; default?: string } {
  const 路径 = resolve(process.cwd(), "kugua.config.json");
  if (!existsSync(路径)) return {};
  try {
    const j = JSON.parse(readFileSync(路径, "utf-8")) as { ai?: { providers?: AI提供方[]; default?: string } };
    return j.ai ?? {};
  } catch {
    return {};
  }
}

/** 加载 AI 配置：config.ai → 环境变量 → 本地默认（LM Studio / Ollama） */
export function 加载AI配置(): AI配置 {
  const 节 = 读配置节();
  if (Array.isArray(节.providers) && 节.providers.length > 0) {
    const providers = 节.providers.map((p) => ({
      name: String(p.name),
      baseUrl: String(p.baseUrl ?? "").replace(/\/+$/, ""),
      apiKey: String(p.apiKey ?? ""),
      models: p.models ?? {},
    }));
    return { providers, default: String(节.default ?? providers[0].name) };
  }
  // 环境变量回退（单提供方 default）
  if (process.env.KUGUA_AI_BASE_URL) {
    return {
      providers: [
        {
          name: "default",
          baseUrl: process.env.KUGUA_AI_BASE_URL.replace(/\/+$/, ""),
          apiKey: process.env.KUGUA_AI_API_KEY ?? "",
          models: {
            chat: process.env.KUGUA_AI_CHAT_MODEL,
            image: process.env.KUGUA_AI_IMAGE_MODEL,
            embed: process.env.KUGUA_AI_EMBED_MODEL,
          },
        },
      ],
      default: "default",
    };
  }
  // 本地默认
  return {
    providers: [
      { name: "lmstudio", baseUrl: "http://127.0.0.1:1234/v1", apiKey: "", models: {} },
      { name: "ollama", baseUrl: "http://127.0.0.1:11434/v1", apiKey: "ollama", models: {} },
    ],
    default: "lmstudio",
  };
}

/** 取提供方（按名，缺省取默认） */
export function 取提供方(配置: AI配置, 名称?: string): AI提供方 {
  const 名 = 名称 && 名称.trim() ? 名称.trim() : 配置.default;
  const p = 配置.providers.find((x) => x.name === 名);
  if (!p) throw new Error(`未知 AI 提供方：${名}（可用：${配置.providers.map((x) => x.name).join(", ")}）`);
  return p;
}
