/**
 * B 站短链（b23.tv）的纯逻辑。
 *
 * ## 背景
 *
 * 复刻参考项目 `BiliShortLinkGenerator.cs`。接口是
 * `POST http://api.bilibili.com/x/share/click`，返回 `data.content` 是短链。
 *
 * ## 为什么值得抽出来测
 *
 * 实测这个接口有**三种「HTTP 200 但没有短链」**的情况，原来全被
 * `jo?.data?.content ?? ""` 吞成空串：
 *
 * | 输入 | 实际响应 | 原来的结果 |
 * |---|---|---|
 * | 标准视频链接 | `{code:0, data:{content:"https://b23.tv/X"}}` | 短链 ✓ |
 * | 非 B 站链接 | `{code:0, data:{content:null}}` | `""`（静默空） |
 * | 已经是短链 | `{code:0, data:{content:null}}` | `""`（静默空） |
 * | 空串 | `{code:-400, message:"请求错误"}` | `""`（静默空） |
 *
 * 用户看到的是「结果一栏空白」，不知道是链接不支持、还是网络坏了、
 * 还是自己没填。三种情况用同一句话表达，排查成本很高。
 *
 * 另外原实现只看 `res.ok` 不检查业务 `code`——HTTP 200 里带着
 * `code: -400` 的业务错误被当成成功处理。
 */

/** 短链接口返回体（只取用到的字段） */
export interface B23响应 {
  code?: number;
  message?: string;
  data?: { content?: string | null } | null;
}

/**
 * 解析短链接口响应。
 *
 * 返回 `{ 短链 }` 或 `{ 错误 }`，**不返回空串**——空串无法区分
 * 「接口说没有」和「我漏了字段」。错误信息说清是哪一种：
 *
 * - 业务 `code` 非 0 → 带上 `code` 与 `message`
 * - `code` 是 0 但没有 content → 明确说「该链接无法生成短链」，
 *   这是非 B 站链接与已是短链的正常表现，不是故障
 */
export function 解析短链响应(jo: unknown): { 短链: string } | { 错误: string } {
  const r = (jo ?? {}) as B23响应;
  const code = r.code;
  if (typeof code === "number" && code !== 0) {
    const 说明 = r.message ? `：${r.message}` : "";
    return { 错误: `B 站接口返回 code=${code}${说明}` };
  }
  const content = r.data?.content;
  if (typeof content !== "string" || content.trim() === "") {
    // 注意这里是**正常响应**，不是故障：
    // 非 B 站链接、已经是 b23 短链的链接，接口都返回 code:0 + content:null。
    return { 错误: "该链接无法生成短链（不是 B 站视频链接，或已经是短链）" };
  }
  return { 短链: content.trim() };
}

/** 必须是带协议的 http(s) URL，否则接口会回 code:-400 */
export function 是合法URL(文本: string): boolean {
  const t = 文本.trim();
  if (!/^https?:\/\//i.test(t)) return false;
  try {
    new URL(t);
    return true;
  } catch {
    return false;
  }
}

/** 看起来像 B 站的主机名（含 b23.tv 短链） */
export function 是B站主机(文本: string): boolean {
  try {
    const 主机 = new URL(文本.trim()).hostname.toLowerCase();
    return (
      主机 === "bilibili.com" ||
      主机.endsWith(".bilibili.com") ||
      主机 === "b23.tv" ||
      主机.endsWith(".b23.tv")
    );
  } catch {
    return false;
  }
}

/**
 * 生成短链请求的表单字段。
 *
 * `buvid` 是 B 站的设备标识，接口目前不校验内容，随机 32 位 + `infoc`
 * 后缀即可（与原 C# 实现一致）。抽出来是为了让测试能固定随机源。
 */
export function 短链表单(长链: string, buvid: string): URLSearchParams {
  return new URLSearchParams({
    build: "6500300",
    buvid,
    oid: 长链,
    platform: "android",
    share_channel: "COPY",
    share_id: "public.webview.0.0.pv",
    share_mode: "3",
  });
}
