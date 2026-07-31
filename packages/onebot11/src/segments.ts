/**
 * OneBot 11 消息段定义与构造助手
 * 字段参考旧项目 KuguaSdk/MessageStructs 与 Napcat 实际报文。
 */

/** QQ 号/群号等标识：Napcat 报文中可能为数字或字符串 */
export type 标识 = number | string;

/** 消息段：{ type, data } 结构，data 字段随 type 而定 */
export interface 消息段 {
  type: string;
  data: Record<string, unknown>;
}

/** 常用消息段构造器 */
export const 段 = {
  文本: (text: string): 消息段 => ({ type: "text", data: { text } }),
  表情: (id: 标识): 消息段 => ({ type: "face", data: { id } }),
  at: (qq: 标识): 消息段 => ({ type: "at", data: { qq } }),
  at全体: (): 消息段 => ({ type: "at", data: { qq: "all" } }),
  回复: (id: 标识): 消息段 => ({ type: "reply", data: { id } }),
  /** file 可为本地路径、http(s) 链接或 base64:// 串 */
  图片: (file: string, extra: Record<string, unknown> = {}): 消息段 => ({
    type: "image",
    data: { file, ...extra },
  }),
  语音: (file: string, extra: Record<string, unknown> = {}): 消息段 => ({
    type: "record",
    data: { file, ...extra },
  }),
  视频: (file: string, extra: Record<string, unknown> = {}): 消息段 => ({
    type: "video",
    data: { file, ...extra },
  }),
  戳一戳: (type: 标识, id: 标识, name = ""): 消息段 => ({
    type: "poke",
    data: { type, id, name },
  }),
  骰子: (): 消息段 => ({ type: "dice", data: {} }),
  猜拳: (): 消息段 => ({ type: "rps", data: {} }),
  /** 商城表情（Napcat 扩展，mface） */
  商城表情: (emoji_id: 标识, emoji_package_id: 标识, key: string): 消息段 => ({
    type: "mface",
    data: { emoji_id, emoji_package_id, key },
  }),
  json: (data: string): 消息段 => ({ type: "json", data: { data } }),
  xml: (data: string): 消息段 => ({ type: "xml", data: { data } }),
  分享: (url: string, title: string, content = "", image = ""): 消息段 => ({
    type: "share",
    data: { url, title, content, image },
  }),
  音乐: (type: string, id: 标识): 消息段 => ({ type: "music", data: { type, id } }),
  自定义音乐: (url: string, audio: string, title: string, content = "", image = ""): 消息段 => ({
    type: "music",
    data: { type: "custom", url, audio, title, content, image },
  }),
  /** 转发节点（发送合并转发用） */
  节点: (id: 标识): 消息段 => ({ type: "node", data: { id } }),
  自定义节点: (
    user_id: 标识,
    nickname: string,
    content: 消息段[],
  ): 消息段 => ({ type: "node", data: { user_id, nickname, content } }),
};

/**
 * 提取消息段数组中的纯文本（text 段拼接 + dice 结果），
 * 对应旧项目 MessageUtil.ToTextString。
 */
export function 提取纯文本(segments: 消息段[]): string {
  let 结果 = "";
  for (const s of segments) {
    if (s.type === "text" && typeof s.data.text === "string") {
      结果 += s.data.text;
    } else if (s.type === "dice") {
      const 结果值 = s.data.result;
      if (typeof 结果值 === "number" && 结果值 !== 0) 结果 += String(结果值);
    }
  }
  return 结果;
}
