/**
 * OneBot 11 事件类型定义（含 Napcat 扩展）
 * 参考旧项目 KuguaSdk/Onebot11/Structs.cs；不常见字段经索引签名透传。
 */

import type { 标识, 消息段 } from "./segments.js";

/** 事件公共字段 */
export interface 事件基 {
  time: number;
  self_id: 标识;
  post_type: string;
  [其他: string]: unknown;
}

/** 消息发送者信息 */
export interface 发送者 {
  user_id: 标识;
  nickname?: string;
  card?: string;
  sex?: string;
  age?: number | string;
  area?: string;
  level?: string;
  role?: string;
  title?: string;
}

/** 群消息事件 */
export interface 群消息事件 extends 事件基 {
  post_type: "message";
  message_type: "group";
  sub_type: string;
  message_id: 标识;
  group_id: 标识;
  user_id: 标识;
  anonymous: unknown;
  message: 消息段[];
  raw_message: string;
  font: number;
  sender: 发送者;
}

/** 私聊消息事件 */
export interface 私聊消息事件 extends 事件基 {
  post_type: "message";
  message_type: "private";
  sub_type: string;
  message_id: 标识;
  user_id: 标识;
  message: 消息段[];
  raw_message: string;
  font: number;
  sender: 发送者;
}

/** 通知事件（群上传/增员/减员/禁言/撤回/戳一戳等，字段透传） */
export interface 通知事件 extends 事件基 {
  post_type: "notice";
  notice_type: string;
  sub_type?: string;
  group_id?: 标识;
  user_id?: 标识;
  operator_id?: 标识;
  target_id?: 标识;
  message_id?: 标识;
  duration?: number;
  file?: { id: string; name: string; size: number; busid: number };
}

/** 请求事件（加好友/加群/邀请入群） */
export interface 请求事件 extends 事件基 {
  post_type: "request";
  request_type: string;
  sub_type?: string;
  group_id?: 标识;
  user_id: 标识;
  comment?: string;
  flag: string;
}

/** 元事件（lifecycle / heartbeat） */
export interface 元事件 extends 事件基 {
  post_type: "meta_event";
  meta_event_type: string;
  sub_type?: string;
  status?: { online: boolean; good: boolean };
  interval?: number;
}

/**
 * 事件分类串，如 "message.group"、"notice.group_upload"、"meta.heartbeat"。
 * Ob11Client 同时按分类名与统一 "event" 通道派发。
 */
export type 事件分类 =
  | `message.${string}`
  | `notice.${string}`
  | `request.${string}`
  | `meta.${string}`
  | `sent.${string}`;
