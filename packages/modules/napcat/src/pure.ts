/**
 * napcat 桥的纯逻辑（从 bridge.ts 抽出，便于单测）。
 *
 * ## 为什么值得抽
 *
 * bridge.ts 主体是「连 WS → 注册回调」，几乎全是 IO。但里面有两处
 * **判定**是「错了也看不出来」的：
 *
 * 1. **心跳过滤**：`meta.heartbeat` 每 5 秒一条。不过滤的话总线上
 *    每分钟多出 12 条噪声事件，前端聊天框会被刷屏——但功能「看起来」正常，
 *    只是日志很吵、WS 流量白涨。
 *
 * 2. **`api` 的 action 校验**：不校验时 `callApi(undefined)` 会把
 *    `action=undefined` 发给 Napcat，Napcat 回一个看不懂的错误，
 *    排查时根本不知道是自己少传了字段。
 *
 * 这两处都只依赖入参，所以可以离线测。
 */

/** OneBot 事件分类里，默认不转发的那一个 */
export const 心跳分类 = "meta.heartbeat";

/**
 * 这个事件要不要转发到苦音总线。
 *
 * 心跳默认丢弃：它是 Napcat 的存活探测，对业务毫无意义。
 * 但调试连接问题时可能需要看，所以留了 `转发心跳` 开关。
 */
export function 应转发(分类: string, 转发心跳: boolean): boolean {
  if (分类 === 心跳分类 && !转发心跳) return false;
  return true;
}

/**
 * 苦音事件名。格式 `napcat.<分类>`。
 *
 * 分类本身带点（`message.group` / `meta.heartbeat`），
 * 拼出来是 `napcat.message.group` 这样的三段——
 * 前端按前缀订阅 `napcat.*` 就能收全，不需要预先枚举分类。
 */
export function 事件名(分类: string): string {
  return `napcat.${分类}`;
}

/**
 * 从 `api` 请求的 params 里取出 action 与 params。
 *
 * action 缺失/为空白串时**必须抛错**：静默放行会让 Napcat 收到
 * `action=undefined`，错误在对面抛，这边完全看不出是自己漏了字段。
 */
export function 解析Api请求(params: unknown): { action: string; 参数: unknown } {
  const p = (params ?? {}) as { action?: unknown; params?: unknown };
  const action = typeof p.action === "string" ? p.action.trim() : "";
  if (!action) throw new Error("缺少 action 字段");
  return { action, 参数: p.params };
}
