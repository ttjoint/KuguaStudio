/**
 * AI 提供方配置：从 kugua.config.json 的 `ai` 节读取，缺省回退环境变量或本地默认端点。
 *
 * 设计：把"模型/端点"集中成网关（仿 Open WebUI），模块只认提供方名与用途（chat/image/embed），
 * 不再各模块自行读环境变量。
 */

import { existsSync, readFileSync } from "node:fs";
import { resolve } from "node:path";
import { 加载OpenWebUI配置, type OpenWebUI配置 } from "./openwebui.js";

export interface AI提供方 {
  name: string;
  baseUrl: string;
  apiKey: string;
  models: { chat?: string; image?: string; embed?: string };
}

export interface AI配置 {
  providers: AI提供方[];
  default: string;
  /** OpenWebUI 网关（可选）：作为模型目录与统一入口 */
  openwebui?: OpenWebUI配置;
}

interface AI配置节 {
  providers?: AI提供方[];
  default?: string;
}

function 读文件(路径: string): AI配置节 {
  if (!existsSync(路径)) return {};
  try {
    const j = JSON.parse(readFileSync(路径, "utf-8")) as { ai?: AI配置节 };
    return j.ai ?? {};
  } catch {
    return {};
  }
}

/**
 * 合并提供方列表的两层配置。
 *
 * 密钥由平台写进 `kugua.config.local.json`（不进版本库），公开信息
 * （名称、地址、模型）留在 `kugua.config.json`。
 *
 * 分开存之后，本地文件里的 `providers` 只有 `apiKey` 一列，**必须按
 * 名称逐行补回**——否则模块读到的提供方全部没有密钥，配置页里填的
 * 密钥等于白填（这是个真出现过的 bug：`ai.providers` 一直回
 * `hasKey: false`）。
 *
 * 按名称而不是按位置合并：用户可能在配置页里删行或调整顺序。
 */
export function 合并提供方(主: AI提供方[] = [], 覆盖: AI提供方[] = []): AI提供方[] {
  if (覆盖.length === 0) return 主;
  const 结果 = 主.map((p) => ({ ...p, models: { ...(p.models ?? {}) } }));
  for (const 密 of 覆盖) {
    const 名 = String(密?.name ?? "").trim();
    const 命中 = 结果.find((p) => p.name === 名);
    if (命中) {
      // 只补凭据，不覆盖公开字段（公开字段以主配置为准）
      if (密.apiKey) 命中.apiKey = String(密.apiKey);
      continue;
    }
    // 本地文件里凭空多出来的整行（少见）：并进去，避免丢失用户手改的数据
    if (名) {
      结果.push({
        name: 名,
        baseUrl: String(密.baseUrl ?? "").replace(/\/+$/, ""),
        apiKey: String(密.apiKey ?? ""),
        models: 密.models ?? {},
      });
    }
  }
  return 结果;
}

function 读配置节(): AI配置节 {
  const 主路径 = resolve(process.cwd(), process.env.KUGUA_CONFIG ?? "kugua.config.json");
  const 覆盖路径 = resolve(process.cwd(), process.env.KUGUA_CONFIG_LOCAL ?? "kugua.config.local.json");
  const 主 = 读文件(主路径);
  const 覆盖 = 读文件(覆盖路径);
  if (!覆盖.providers && !覆盖.default) return 主;
  return {
    ...主,
    ...覆盖,
    // 数组是整体替换的，深合并帮不上忙，这里单独按名称补
    providers: 合并提供方(主.providers, 覆盖.providers),
    default: 覆盖.default || 主.default,
  };
}

/** 加载 AI 配置：config.ai → 环境变量 → 本地默认（LM Studio / Ollama） */
export function 加载AI配置(): AI配置 {
  const openwebui = 加载OpenWebUI配置() ?? undefined;
  const 节 = 读配置节();
  if (Array.isArray(节.providers) && 节.providers.length > 0) {
    const providers = 节.providers.map((p) => {
      // 字段契约：配置声明（declaration.ts 的 提供方列）用的是**扁平字段**
      // （chatModel / imageModel / embedModel），而运行时模型是嵌套的 models.chat。
      // 两种都要兼容：手写配置可能用嵌套，UI 写入的是扁平。
      // 声明用扁平字段（chatModel/imageModel/embedModel），运行时是 models.chat。
      const 原始 = p as unknown as {
        chatModel?: string;
        imageModel?: string;
        embedModel?: string;
      };
      const 嵌套 = (p.models ?? {}) as { chat?: string; image?: string; embed?: string };
      return {
        name: String(p.name),
        baseUrl: String(p.baseUrl ?? "").replace(/\/+$/, ""),
        apiKey: String(p.apiKey ?? ""),
        models: {
          chat: String(原始.chatModel ?? 嵌套.chat ?? "") || undefined,
          image: String(原始.imageModel ?? 嵌套.image ?? "") || undefined,
          embed: String(原始.embedModel ?? 嵌套.embed ?? "") || undefined,
        },
      };
    });
    return { providers, default: String(节.default ?? providers[0].name), openwebui };
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
      openwebui,
    };
  }
  // 只配了 OpenWebUI：用它当唯一提供方
  if (openwebui) {
    return { providers: [], default: "openwebui", openwebui };
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
