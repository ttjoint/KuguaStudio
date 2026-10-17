/**
 * OpenWebUI 接入：把 OpenWebUI 当作「模型目录 + 统一网关」使用。
 *
 * 与普通 OpenAI 兼容端点的差别：
 * 1. 鉴权是**登录态 JWT**（Bearer），不是固定的 sk- key；会过期，需要自动续期。
 * 2. 模型列表在 `/api/v1/models`，每项 id 形如 `连接名.模型id`
 *    （如 `硅基流动.Qwen/Qwen3-8B`），前缀来自 OpenWebUI 的 `prefix_id`。
 * 3. 对话走 `/api/chat/completions`（OpenWebUI 原生）或 `/api/v1/chat/completions`。
 * 4. 上游失败时返回**非标准**错误体（如 `{code:30001,message:"balance is insufficient"}`，
 *    HTTP 402/400），必须原样透出 message，否则用户只看到 "HTTP 402"。
 *
 * 因此单独实现，不塞进通用 `client.ts` 的 OpenAI 路径。
 */

import { existsSync, mkdirSync, readFileSync, renameSync, writeFileSync } from "node:fs";
import { dirname, resolve } from "node:path";

export interface OpenWebUI配置 {
  /** 是否启用 */
  enabled: boolean;
  /** 服务根地址，如 http://127.0.0.1:8090（不要带 /api） */
  baseUrl: string;
  /** 登录邮箱；仅用于自动登录取 token */
  email?: string;
  /** 登录密码；仅用于自动登录取 token */
  password?: string;
  /** 直接给出的 token（优先于账密登录） */
  token?: string;
  /** 默认模型（形如 `硅基流动.Qwen/Qwen3-8B`） */
  defaultModel?: string;
  /** 向量模型（可选） */
  embedModel?: string;
  /** 图像模型（可选） */
  imageModel?: string;
}

/** 归一化后的一个模型条目 */
export interface OWU模型 {
  /** 完整 id（含连接前缀），调用时用它 */
  id: string;
  /** 连接前缀，如 `硅基流动`；无前缀时为空串 */
  prefix: string;
  /** 去掉前缀后的原始模型名 */
  name: string;
}

interface 缓存项 {
  models: OWU模型[];
  at: number;
}

const 模型缓存 = new Map<string, 缓存项>();
const 模型缓存时长 = 60_000;

/** token 落盘路径：避免每次启动都登录一次 */
function 令牌路径(): string {
  const 根 = process.env.KUGUA_DATA_DIR ?? resolve(process.cwd(), "data");
  return resolve(根, "ai", "openwebui-token.json");
}

interface 令牌记录 {
  baseUrl: string;
  token: string;
  /** 过期时间（毫秒时间戳），未知时 0 */
  exp: number;
}

function 读令牌(baseUrl: string): string | null {
  const 路径 = 令牌路径();
  if (!existsSync(路径)) return null;
  try {
    const j = JSON.parse(readFileSync(路径, "utf-8")) as 令牌记录;
    if (j.baseUrl !== baseUrl) return null;
    if (!j.token) return null;
    // 提前 1 小时视为过期，留出续期余量
    if (j.exp > 0 && Date.now() > j.exp - 3_600_000) return null;
    return j.token;
  } catch {
    return null;
  }
}

function 写令牌(baseUrl: string, token: string): void {
  try {
    const 路径 = 令牌路径();
    mkdirSync(dirname(路径), { recursive: true });
    const 载荷 = token.split(".")[1];
    let exp = 0;
    if (载荷) {
      try {
        const 体 = JSON.parse(Buffer.from(载荷, "base64url").toString("utf-8")) as { exp?: number };
        if (typeof 体.exp === "number") exp = 体.exp * 1000;
      } catch {
        /* 不是 JWT，忽略 */
      }
    }
    const 临时 = `${路径}.tmp`;
    writeFileSync(临时, JSON.stringify({ baseUrl, token, exp } satisfies 令牌记录, null, 2), "utf-8");
    renameSync(临时, 路径);
  } catch {
    /* 落盘失败不影响使用，只是下次要重新登录 */
  }
}

/**
 * 读取配置节。
 *
 * 支持两层：主配置 `kugua.config.json` + 本地私有覆盖 `kugua.config.local.json`。
 * 密码这类凭据只写进后者（已在 .gitignore 中），避免被提交到仓库。
 */
function 读配置节(路径: string): { ai?: { openwebui?: OpenWebUI配置 } } {
  if (!existsSync(路径)) return {};
  try {
    return JSON.parse(readFileSync(路径, "utf-8")) as { ai?: { openwebui?: OpenWebUI配置 } };
  } catch {
    return {};
  }
}

/** 合并主配置与本地覆盖（后者优先） */
function 合并配置(主: OpenWebUI配置 | undefined, 覆盖: OpenWebUI配置 | undefined): OpenWebUI配置 | undefined {
  if (!主 && !覆盖) return undefined;
  const 合 = { ...(主 ?? {}), ...(覆盖 ?? {}) } as OpenWebUI配置;
  // 空串视为未设置，回落到主配置的值
  for (const 键 of ["baseUrl", "email", "password", "token", "defaultModel", "embedModel", "imageModel"] as const) {
    if (!合[键] && 主?.[键]) 合[键] = 主[键];
  }
  return 合;
}

/** 从配置文件 / 环境变量读取 OpenWebUI 配置 */
export function 加载OpenWebUI配置(): OpenWebUI配置 | null {
  const 主路径 = resolve(process.cwd(), process.env.KUGUA_CONFIG ?? "kugua.config.json");
  const 覆盖路径 = resolve(process.cwd(), "kugua.config.local.json");
  const 主 = 读配置节(主路径).ai?.openwebui;
  const 覆盖 = 读配置节(覆盖路径).ai?.openwebui;
  let 节 = 合并配置(主, 覆盖);
  const 环境基址 = process.env.KUGUA_OPENWEBUI_URL;
  if (!节 && !环境基址) return null;
  const 配置: OpenWebUI配置 = {
    enabled: true,
    baseUrl: String(节?.baseUrl ?? 环境基址 ?? "").replace(/\/+$/, ""),
    email: 节?.email ?? process.env.KUGUA_OPENWEBUI_EMAIL,
    password: 节?.password ?? process.env.KUGUA_OPENWEBUI_PASSWORD,
    token: 节?.token ?? process.env.KUGUA_OPENWEBUI_TOKEN,
    defaultModel: 节?.defaultModel ?? process.env.KUGUA_OPENWEBUI_MODEL,
    embedModel: 节?.embedModel,
    imageModel: 节?.imageModel,
  };
  if (节?.enabled === false) return null;
  if (!配置.baseUrl) return null;
  return 配置;
}

/** 提取 OpenWebUI / 上游的「人话」错误信息 */
export function 提取错误(状态: number, 文本: string): string {
  const 片段 = 文本.slice(0, 500);
  try {
    const j = JSON.parse(片段) as {
      detail?: unknown;
      message?: unknown;
      error?: unknown;
    };
    const 候选 = [j.message, j.detail, j.error];
    for (const c of 候选) {
      if (typeof c === "string" && c.trim()) return `${c.trim()}（HTTP ${状态}）`;
      if (c && typeof c === "object") {
        const 内 = (c as { message?: unknown }).message;
        if (typeof 内 === "string" && 内.trim()) return `${内.trim()}（HTTP ${状态}）`;
      }
    }
  } catch {
    /* 非 JSON，回退到原文 */
  }
  return `HTTP ${状态}：${片段}`;
}

/** 取可用 token：显式 → 缓存 → 账密登录 */
async function 取令牌(配置: OpenWebUI配置, 强制刷新 = false): Promise<string> {
  if (配置.token) return 配置.token;
  if (!强制刷新) {
    const 缓存 = 读令牌(配置.baseUrl);
    if (缓存) return 缓存;
  }
  if (!配置.email || !配置.password) {
    throw new Error("OpenWebUI 未配置 token，且缺少 email/password，无法登录");
  }
  const r = await fetch(`${配置.baseUrl}/api/v1/auths/signin`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ email: 配置.email, password: 配置.password }),
    signal: AbortSignal.timeout(15_000),
  });
  const 文本 = await r.text();
  if (!r.ok) throw new Error(`OpenWebUI 登录失败：${提取错误(r.status, 文本)}`);
  const j = JSON.parse(文本) as { token?: string };
  if (typeof j.token !== "string" || !j.token) throw new Error("OpenWebUI 登录响应缺少 token");
  写令牌(配置.baseUrl, j.token);
  return j.token;
}

/** 解析模型 id 为「前缀 + 名字」 */
export function 解析模型id(id: string): OWU模型 {
  const 点 = id.indexOf(".");
  if (点 > 0 && 点 < id.length - 1) {
    return { id, prefix: id.slice(0, 点), name: id.slice(点 + 1) };
  }
  return { id, prefix: "", name: id };
}

/** 列出 OpenWebUI 中的全部模型（带 60 秒缓存） */
export async function 列出OWU模型(配置: OpenWebUI配置, 跳过缓存 = false): Promise<OWU模型[]> {
  const 键 = 配置.baseUrl;
  const 缓存 = 模型缓存.get(键);
  if (!跳过缓存 && 缓存 && Date.now() - 缓存.at < 模型缓存时长) return 缓存.models;

  const 请求 = async (令牌: string) =>
    fetch(`${配置.baseUrl}/api/v1/models`, {
      headers: { Authorization: `Bearer ${令牌}` },
      signal: AbortSignal.timeout(20_000),
    });

  let 令牌 = await 取令牌(配置);
  let r = await 请求(令牌);
  if (r.status === 401 && !配置.token) {
    // token 失效：重新登录一次
    令牌 = await 取令牌(配置, true);
    r = await 请求(令牌);
  }
  const 文本 = await r.text();
  if (!r.ok) throw new Error(`OpenWebUI 模型列表失败：${提取错误(r.status, 文本)}`);
  const j = JSON.parse(文本) as { data?: Array<{ id?: string }> };
  const models = (j.data ?? [])
    .map((m) => String(m.id ?? ""))
    .filter(Boolean)
    .map(解析模型id);
  模型缓存.set(键, { models, at: Date.now() });
  return models;
}

/** 清空模型缓存（配置变更后调用） */
export function 清空OWU缓存(): void {
  模型缓存.clear();
}

export interface OWU聊天参数 {
  messages: Array<{ role: string; content: string }>;
  model?: string;
  temperature?: number;
  maxTokens?: number;
}

export interface OWU聊天结果 {
  reply: string;
  model: string;
  提供方: "openwebui";
}

/** 通过 OpenWebUI 对话 */
export async function OWU聊天(配置: OpenWebUI配置, 参数: OWU聊天参数): Promise<OWU聊天结果> {
  const 模型 = (参数.model && 参数.model.trim()) || 配置.defaultModel;
  if (!模型) throw new Error("未指定模型，且 OpenWebUI 未配置默认模型（ai.openwebui.defaultModel）");

  const 发送 = async (令牌: string) =>
    fetch(`${配置.baseUrl}/api/chat/completions`, {
      method: "POST",
      headers: { "Content-Type": "application/json", Authorization: `Bearer ${令牌}` },
      body: JSON.stringify({
        model: 模型,
        messages: 参数.messages,
        temperature: 参数.temperature,
        max_tokens: 参数.maxTokens,
        stream: false,
      }),
      signal: AbortSignal.timeout(180_000),
    });

  let 令牌 = await 取令牌(配置);
  let r = await 发送(令牌);
  if (r.status === 401 && !配置.token) {
    令牌 = await 取令牌(配置, true);
    r = await 发送(令牌);
  }
  const 文本 = await r.text();
  if (!r.ok) throw new Error(`OpenWebUI 对话失败：${提取错误(r.status, 文本)}`);
  const 数据 = JSON.parse(文本) as {
    choices?: Array<{ message?: { content?: unknown } }>;
    model?: string;
  };
  const 内容 = 数据.choices?.[0]?.message?.content;
  if (typeof 内容 !== "string" || !内容.trim()) {
    throw new Error(`OpenWebUI 响应缺少文本内容：${文本.slice(0, 300)}`);
  }
  return { reply: 内容, model: 数据.model ?? 模型, 提供方: "openwebui" };
}

export interface OWU连通性 {
  ok: boolean;
  模型数?: number;
  错误?: string;
  baseUrl: string;
}

/** 连通性探测：登录 + 列模型 */
export async function OWU探活(配置: OpenWebUI配置): Promise<OWU连通性> {
  try {
    const models = await 列出OWU模型(配置, true);
    return { ok: true, 模型数: models.length, baseUrl: 配置.baseUrl };
  } catch (err) {
    return {
      ok: false,
     错误: err instanceof Error ? err.message : String(err),
      baseUrl: 配置.baseUrl,
    };
  }
}
