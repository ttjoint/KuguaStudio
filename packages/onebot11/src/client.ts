/**
 * OneBot 11 正向 WebSocket 客户端
 * 行为对齐旧项目 NTBot.cs：连接 Napcat、echo 匹配 API 应答、断线自动重连。
 *
 * 事件：
 *  - "connect" / "close" / "error" —— 连接状态
 *  - "event" (分类, 数据) —— 统一事件通道，分类如 "message.group"
 *  - "<分类>" (数据) —— 按分类单独监听
 */

import { EventEmitter } from "node:events";
import { randomUUID } from "node:crypto";
import WebSocket from "ws";
import { 段, type 消息段 } from "./segments.js";

export interface Ob11选项 {
  /** Napcat 正向 WS 地址，如 ws://127.0.0.1:3001 */
  url: string;
  /** access_token（经 Authorization 头发送） */
  token?: string;
  /** 断线重连间隔，默认 5000 毫秒 */
  重连间隔毫秒?: number;
  /** API 应答超时，默认 10000 毫秒 */
  api超时毫秒?: number;
}

interface 挂起项 {
  resolve: (data: unknown) => void;
  reject: (err: Error) => void;
  定时器: NodeJS.Timeout;
}

export class Ob11Client extends EventEmitter {
  private ws?: WebSocket;
  private 挂起 = new Map<string, 挂起项>();
  private 已关闭 = false;
  private 重连计时?: NodeJS.Timeout;

  constructor(private 选项: Ob11选项) {
    super();
  }

  /** 是否处于已连接状态 */
  get 在线(): boolean {
    return this.ws?.readyState === WebSocket.OPEN;
  }

  /**
   * 建立连接；首次连接成功 resolve，首次失败 reject。
   * 之后断线按固定间隔自动重连，直到调用 close()。
   */
  connect(): Promise<void> {
    const 间隔 = this.选项.重连间隔毫秒 ?? 5000;
    return new Promise((resolve, reject) => {
      let 首次 = true;
      const 建立 = (): void => {
        if (this.已关闭) return;
        const headers = this.选项.token
          ? { Authorization: `Bearer ${this.选项.token}` }
          : undefined;
        const ws = new WebSocket(this.选项.url, { headers });
        this.ws = ws;

        ws.on("open", () => {
          this.emit("connect");
          if (首次) {
            首次 = false;
            resolve();
          }
        });
        ws.on("message", (数据) => this.处理帧(数据.toString()));
        ws.on("error", (err) => {
          this.emit("error", err);
          if (首次) {
            首次 = false;
            reject(err);
          }
        });
        ws.on("close", () => {
          this.拒绝全部(new Error("Napcat 连接已关闭"));
          this.emit("close");
          if (!this.已关闭) {
            this.重连计时 = setTimeout(建立, 间隔);
          }
        });
      };
      建立();
    });
  }

  /** 主动关闭并停止自动重连 */
  close(): void {
    this.已关闭 = true;
    if (this.重连计时) clearTimeout(this.重连计时);
    this.ws?.close();
    this.拒绝全部(new Error("客户端已关闭"));
  }

  /**
   * 调用 OneBot API，经 echo 匹配应答。
   * retcode 非 0 时 reject。
   */
  callApi<T = unknown>(action: string, params?: unknown, 超时毫秒?: number): Promise<T> {
    const ws = this.ws;
    if (!ws || ws.readyState !== WebSocket.OPEN) {
      return Promise.reject(new Error("Napcat 未连接"));
    }
    const echo = `${action}:${randomUUID()}`;
    return new Promise<T>((resolve, reject) => {
      const 定时器 = setTimeout(() => {
        this.挂起.delete(echo);
        reject(new Error(`OneBot API 超时：${action}`));
      }, 超时毫秒 ?? this.选项.api超时毫秒 ?? 10000);
      this.挂起.set(echo, {
        resolve: resolve as (data: unknown) => void,
        reject,
        定时器,
      });
      ws.send(JSON.stringify({ action, params: params ?? {}, echo }));
    });
  }

  /** 发送群消息；字符串自动包装为文本段 */
  sendGroupMsg(group_id: number | string, message: string | 消息段[]): Promise<unknown> {
    const 段列 = typeof message === "string" ? [段.文本(message)] : message;
    return this.callApi("send_group_msg", { group_id, message: 段列 });
  }

  /** 发送私聊消息；字符串自动包装为文本段 */
  sendPrivateMsg(user_id: number | string, message: string | 消息段[]): Promise<unknown> {
    const 段列 = typeof message === "string" ? [段.文本(message)] : message;
    return this.callApi("send_private_msg", { user_id, message: 段列 });
  }

  /** 处理入站帧：API 应答或事件 */
  private 处理帧(文本: string): void {
    let 对象: Record<string, unknown>;
    try {
      对象 = JSON.parse(文本) as Record<string, unknown>;
    } catch {
      return;
    }
    if (typeof 对象 !== "object" || 对象 === null) return;

    // API 应答帧：带 echo 且带 status/retcode
    if (typeof 对象.echo === "string" && ("status" in 对象 || "retcode" in 对象)) {
      const 项 = this.挂起.get(对象.echo);
      if (!项) return;
      this.挂起.delete(对象.echo);
      clearTimeout(项.定时器);
      if (对象.status === "ok" || 对象.retcode === 0) {
        项.resolve(对象.data);
      } else {
        const 描述 = (对象.message ?? 对象.wording ?? "API 调用失败") as string;
        项.reject(new Error(`[${String(对象.retcode)}] ${描述}`));
      }
      return;
    }

    const post = 对象.post_type;
    if (typeof post !== "string") return;
    let 分类: string;
    switch (post) {
      case "message":
        分类 = `message.${String(对象.message_type)}`;
        break;
      case "notice":
        分类 = `notice.${String(对象.notice_type)}`;
        break;
      case "request":
        分类 = `request.${String(对象.request_type)}`;
        break;
      case "meta_event":
        分类 = `meta.${String(对象.meta_event_type)}`;
        break;
      case "message_sent":
        分类 = `sent.${String(对象.message_type)}`;
        break;
      default:
        分类 = `unknown.${post}`;
        break;
    }
    this.emit(分类, 对象);
    this.emit("event", 分类, 对象);
  }

  private 拒绝全部(err: Error): void {
    for (const [, 项] of this.挂起) {
      clearTimeout(项.定时器);
      项.reject(err);
    }
    this.挂起.clear();
  }
}
