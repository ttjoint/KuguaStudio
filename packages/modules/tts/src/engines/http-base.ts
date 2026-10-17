/**
 * HTTP 类引擎共用的工具
 *
 * 三类引擎里有两类是「本地 HTTP 服务」（VoxCPM / IndexTTS / CosyVoice / GPT-SoVITS / ChatTTS），
 * 它们的共同点：探活靠 TCP、超时各不相同、错误体结构五花八门。
 * 把这些收敛到这里，引擎实现只写自己特有的请求组装逻辑。
 */

import { connect } from "node:net";

/**
 * 轻量探活：只做 TCP 连接，不发 HTTP 请求。
 *
 * 为什么不发 HTTP：部分服务（GPT-SoVITS 加载模型期间、vLLM 冷启动）
 * 会把请求挂住很久，探活反而拖慢状态查询。TCP 通就认为「服务在」，
 * 真正是否健康交给合成调用去发现。
 */
export function 端口可用(主机: string, 端口: number, 超时毫秒 = 1200): Promise<boolean> {
  return new Promise((resolve) => {
    const socket = connect({ host: 主机, port: 端口 });
    let 结束 = false;
    const 收尾 = (值: boolean): void => {
      if (结束) return;
      结束 = true;
      socket.destroy();
      resolve(值);
    };
    socket.setTimeout(超时毫秒);
    socket.once("connect", () => 收尾(true));
    socket.once("timeout", () => 收尾(false));
    socket.once("error", () => 收尾(false));
  });
}

/** 把配置里的 url 拆成主机与端口，供探活使用 */
export function 拆地址(url: string, 默认端口: number): { 主机: string; 端口: number } {
  try {
    const u = new URL(url);
    return { 主机: u.hostname || "127.0.0.1", 端口: u.port ? Number(u.port) : 默认端口 };
  } catch {
    return { 主机: "127.0.0.1", 端口: 默认端口 };
  }
}

/** 探测一个 url 指向的服务是否在监听 */
export async function 服务可达(url: string | undefined, 默认端口: number): Promise<boolean> {
  if (!url) return false;
  const { 主机, 端口 } = 拆地址(url, 默认端口);
  return 端口可用(主机, 端口);
}

/**
 * 从上游响应里提取「人话」错误。
 *
 * 各家错误体形态差异极大：FastAPI 用 `detail`，Flask 用 `msg` 或 `message`，
 * 还有嵌套 `error.message` 的。统一按顺序找第一个能看懂的就用。
 */
export function 提取错误(状态: number, 文本: string): string {
  const 片段 = 文本.slice(0, 600).trim();
  if (!片段) return `HTTP ${状态}`;
  try {
    const j = JSON.parse(片段) as Record<string, unknown>;
    for (const 键 of ["detail", "msg", "message", "error", "Exception"]) {
      const 值 = j[键];
      if (typeof 值 === "string" && 值) return `${状态}：${值}`;
      if (值 && typeof 值 === "object") {
        const 内层 = (值 as Record<string, unknown>).message;
        if (typeof 内层 === "string" && 内层) return `${状态}：${内层}`;
      }
    }
  } catch {
    /* 非 JSON，直接给原文 */
  }
  return `${状态}：${片段}`;
}

/** 各引擎的默认超时；有声书类可以放宽到分钟级 */
export const 默认超时 = {
  fast: 60_000,
  quality: 180_000,
  fallback: 60_000,
} as const;
