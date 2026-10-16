/**
 * 头像模块
 *
 * 复刻参考项目 `ModImage.getUserAvatar / getGroupAvatar`：直调 qlogo 接口（**无需 QQ 登录态**）。
 *   - 用户头像：https://q1.qlogo.cn/g?b=qq&nk=<qq>&s=0
 *   - 群历史头像：https://p.qlogo.cn/gh/0/<groupid>_<i>/0（遍历，连续占位图则停止）
 *
 * 说明：原实现的"我的头像 / @某人 / 昵称反查"依赖 IM 上下文，本平台只接受显式 QQ 号/群号。
 */

import { 启动模块 } from "@kugua/module-kit";
import type { 能力声明 } from "@kugua/capability";

/** 图片尺寸（PNG/GIF/JPEG 头部） */
function 图片尺寸(buf: Buffer): { width: number; height: number } {
  if (buf.length >= 24 && buf[0] === 0x89 && buf[1] === 0x50) {
    return { width: buf.readUInt32BE(16), height: buf.readUInt32BE(20) };
  }
  if (buf.length >= 10 && buf[0] === 0x47 && buf[1] === 0x49 && buf[2] === 0x46) {
    return { width: buf.readUInt16LE(6), height: buf.readUInt16LE(8) };
  }
  if (buf.length >= 4 && buf[0] === 0xff && buf[1] === 0xd8) {
    let i = 2;
    while (i + 9 < buf.length) {
      if (buf[i] !== 0xff) {
        i++;
        continue;
      }
      const 标记 = buf[i + 1];
      if (标记 >= 0xc0 && 标记 <= 0xcf && 标记 !== 0xc4 && 标记 !== 0xc8 && 标记 !== 0xcc) {
        return { height: buf.readUInt16BE(i + 5), width: buf.readUInt16BE(i + 7) };
      }
      const 长度 = buf.readUInt16BE(i + 2);
      i += 2 + 长度;
    }
  }
  return { width: 0, height: 0 };
}

/** 从参数中解析 QQ 号/群号（提取首个合法数字串） */
function 取号码(p: Record<string, unknown>): string {
  const 候选 = [p.qq, p.groupid, p.群号, p.号码, p.参数文本, p.原文];
  for (const c of 候选) {
    if (typeof c === "string") {
      const m = c.match(/[1-9][0-9]{4,}/);
      if (m) return m[0];
    }
    if (typeof c === "number" && c >= 10000) return String(c);
  }
  return "";
}

const 能力清单: 能力声明[] = [
  {
    名称: "avatar.userAvatar",
    模块: "avatar",
    标题: "QQ 用户头像",
    说明: "按 QQ 号获取用户头像（qlogo，无需登录态）",
    中文指令: ["头像"],
    参数: { type: "object", properties: { qq: { type: "string" } }, required: ["qq"] },
    暴露: { 指令: true, GUI: true, 定时: false, MCP: true },
  },
  {
    名称: "avatar.groupAvatar",
    模块: "avatar",
    标题: "QQ 群历史头像",
    说明: "按群号获取群历史头像列表（qlogo，无需登录态）",
    中文指令: ["群头像"],
    参数: {
      type: "object",
      properties: { groupid: { type: "string" }, 上限: { type: "number" } },
      required: ["groupid"],
    },
    暴露: { 指令: true, GUI: true, 定时: false, MCP: true },
  },
];

void 启动模块({
  name: "avatar",
  version: "0.1.0",
  能力: 能力清单,
  注册: (客户端) => {
    客户端.onRequest("avatar.userAvatar", async (params) => {
        const p = (params ?? {}) as Record<string, unknown>;
        const qq = 取号码(p);
        if (!qq) throw new Error("无法解析 QQ 号");
        const url = `https://q1.qlogo.cn/g?b=qq&nk=${qq}&s=0`;
        const res = await fetch(url, { signal: AbortSignal.timeout(15000) });
        if (!res.ok) throw new Error(`头像下载失败：HTTP ${res.status}`);
        const buf = Buffer.from(await res.arrayBuffer());
        const { width, height } = 图片尺寸(buf);
        return { qq, url, base64: buf.toString("base64"), format: "jpeg", width, height };
    });

    客户端.onRequest("avatar.groupAvatar", async (params) => {
        const p = (params ?? {}) as Record<string, unknown>;
        const groupid = 取号码(p);
        if (!groupid) throw new Error("无法解析群号");
        const 上限 = typeof p.上限 === "number" && p.上限 > 0 ? Math.min(p.上限, 100) : 100;
        const 列表: Array<{ url: string; base64: string; width: number; height: number }> = [];
        let skilleft = 1;
        for (let i = 1; i <= 上限; i++) {
          const url = `https://p.qlogo.cn/gh/0/${groupid}_${i}/0`;
          try {
            const res = await fetch(url, { signal: AbortSignal.timeout(10000) });
            if (!res.ok) continue;
            const buf = Buffer.from(await res.arrayBuffer());
            const { width, height } = 图片尺寸(buf);
            if (width < 41 && height < 41) {
              if (skilleft-- < 0) break;
            } else {
            列表.push({ url, base64: buf.toString("base64"), width, height });
          }
      } catch {
      continue;
    }
    }
    return { groupid, 数量: 列表.length, 头像: 列表 };
    });

    },
  就绪: () => console.log("[头像模块] 已接入主控，等待查询请求"),
});
