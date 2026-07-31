/**
 * OneBot 11（Napcat）协议库统一导出
 */

export { 段, 提取纯文本, type 消息段, type 标识 } from "./segments.js";
export type {
  事件基,
  事件分类,
  发送者,
  群消息事件,
  私聊消息事件,
  通知事件,
  请求事件,
  元事件,
} from "./events.js";
export { Ob11Client, type Ob11选项 } from "./client.js";
