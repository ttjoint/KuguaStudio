/**
 * 语音引擎注册表与调度
 *
 * 职责：
 *  1. 登记所有已知引擎（内置 + 外部注入）
 *  2. 按请求选择引擎（显式指定 → 可用性 → 分层优先级）
 *  3. 统一下层错误处理与结果组装
 *
 * 调度原则：**宁可慢一点，也不要因为首选引擎没配就失败**。
 * 一次请求会按优先级依次尝试可用引擎，第一个成功即返回。
 */

import type { TTS配置, 合成请求, 合成结果, 音频格式, 引擎分层, 语音引擎 } from "./types.js";
import { 取引擎配置, 加载TTS配置 } from "./config.js";

/** 引擎实例缓存（同一个引擎不重复构造） */
const 已注册 = new Map<string, 语音引擎>();

/** 分层优先级：数字越小越先尝试 */
const 分层序: Record<引擎分层, number> = { fast: 0, quality: 1, fallback: 2 };

/** 注册一个引擎实例 */
export function 注册引擎(引擎: 语音引擎): void {
  已注册.set(引擎.name, 引擎);
}

/** 取消注册（测试用） */
export function 注销引擎(名: string): void {
  已注册.delete(名);
}

/** 清空注册表（测试用） */
export function 清空引擎注册表(): void {
  已注册.clear();
}

/** 当前已注册的引擎名 */
export function 引擎名单(): string[] {
  return [...已注册.keys()];
}

/** 取已注册的引擎实例 */
export function 取引擎(名: string): 语音引擎 | undefined {
  return 已注册.get(名);
}

/**
 * 按格式回落规则：引擎不支持请求格式时，退回它支持的第一个。
 *
 * 顺序优先 mp3/ogg（体积小，便于传输），其次 wav。
 */
export function 选定格式(引擎: 语音引擎, 期望?: 音频格式): 音频格式 {
  const 支持 = 引擎.能力.formats;
  if (期望 && 支持.includes(期望)) return 期望;
  for (const f of ["mp3", "ogg", "wav", "aac"] as 音频格式[]) {
    if (支持.includes(f)) return f;
  }
  return 期望 ?? "wav";
}

/** 未显式指定引擎时的候选顺序 */
function 候选引擎(配置: TTS配置): 语音引擎[] {
  const 列表: 语音引擎[] = [];
  for (const 引擎 of 已注册.values()) {
    const 引擎配置 = 取引擎配置(配置, 引擎.name);
    // 显式 disabled 一律跳过
    if (引擎配置?.enabled === false) continue;
    // 未配置的引擎默认跳过，避免误连默认端口导致长时间超时；
    // 但 `fallback` 分层（纯 CPU / 系统 TTS）例外——它们的意义就是
    // 「别的都不可用时还能出声」，且不依赖任何外部服务地址，未配置也能安全尝试。
    if (!引擎配置 && 引擎.能力.tier !== "fallback") continue;
    列表.push(引擎);
  }
  return 列表.sort((a, b) => 分层序[a.能力.tier] - 分层序[b.能力.tier] || a.name.localeCompare(b.name));
}

/** 一次选择的结果：选中的引擎与其配置 */
export interface 调度结果 {
  引擎: 语音引擎;
  说明: string;
}

/**
 * 选择一组要尝试的引擎，按优先级排好。
 *
 * @param 指定 调用方显式要求的引擎名
 * @returns 尝试顺序列表；空列表表示没有可用引擎
 */
export async function 选择引擎(指定?: string, 配置?: TTS配置): Promise<调度结果[]> {
  const 用配置 = 配置 ?? 加载TTS配置();

  // 1) 显式指定：只试这一个，失败就报错（不静默换引擎，避免结果不可预期）
  if (指定) {
    const 引擎 = 已注册.get(指定);
    if (!引擎) throw new Error(`未知语音引擎：${指定}（可用：${引擎名单().join(", ") || "无"}）`);
    if (!(await 引擎.可用())) throw new Error(`语音引擎 ${指定} 当前不可用（请检查配置或服务是否启动）`);
    return [{ 引擎, 说明: "调用方指定" }];
  }

  // 2) 配置里的默认引擎
  const 候选 = 候选引擎(用配置);
  const 结果: 调度结果[] = [];
  const 默认名 = 用配置.defaultEngine;
  if (默认名) {
    const 默认 = 候选.find((e) => e.name === 默认名);
    if (默认 && (await 默认.可用())) 结果.push({ 引擎: 默认, 说明: "配置默认引擎" });
  }

  // 3) 其余引擎按分层优先级兜底
  for (const 引擎 of 候选) {
    if (引擎.name === 默认名) continue;
    try {
      if (await 引擎.可用()) 结果.push({ 引擎, 说明: `分层 ${引擎.能力.tier} 兜底` });
    } catch {
      /* 探测失败视为不可用 */
    }
  }
  return 结果;
}

/** 合成：按优先级依次尝试，第一个成功即返回 */
export async function 合成语音(请求: 合成请求 & { engine?: string }, 配置?: TTS配置): Promise<合成结果> {
  if (!请求.text?.trim()) throw new Error("缺少文本");
  const 用配置 = 配置 ?? 加载TTS配置();
  const 候选 = await 选择引擎(请求.engine, 用配置);
  if (候选.length === 0) {
    throw new Error("没有可用的语音引擎（请在 kugua.config.json 的 tts.engines 中配置 voxcpm 或 indextts）");
  }

  const 失败原因: string[] = [];
  for (const { 引擎 } of 候选) {
    const 开始 = Date.now();
    try {
      const 格式 = 选定格式(引擎, 请求.format);
      const 结果 = await 引擎.合成({ ...请求, format: 格式 });
      return { ...结果, elapsedMs: 结果.elapsedMs ?? Date.now() - 开始 };
    } catch (err) {
      失败原因.push(`${引擎.name}: ${err instanceof Error ? err.message : String(err)}`);
    }
  }
  throw new Error(`所有语音引擎均失败：\n${失败原因.join("\n")}`);
}

/** 汇总所有引擎的状态，供 tts.status 使用 */
export async function 引擎状态(配置?: TTS配置): Promise<
  Array<{
    name: string;
    tier: 引擎分层;
    已配置: boolean;
    可用: boolean;
    音色数: number;
    能力: 语音引擎["能力"];
    错误?: string;
  }>
> {
  const 用配置 = 配置 ?? 加载TTS配置();
  const 结果: Awaited<ReturnType<typeof 引擎状态>> = [];
  for (const 引擎 of 已注册.values()) {
    const 引擎配置 = 取引擎配置(用配置, 引擎.name);
    let 可用 = false;
    let 错误: string | undefined;
    if (引擎配置?.enabled !== false) {
      try {
        可用 = await 引擎.可用();
      } catch (err) {
        错误 = err instanceof Error ? err.message : String(err);
      }
    }
    结果.push({
      name: 引擎.name,
      tier: 引擎.能力.tier,
      已配置: Boolean(引擎配置),
      可用,
      音色数: 引擎配置?.voices?.length ?? 0,
      能力: 引擎.能力,
      错误,
    });
  }
  return 结果.sort((a, b) => 分层序[a.tier] - 分层序[b.tier] || a.name.localeCompare(b.name));
}
