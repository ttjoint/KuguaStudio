/**
 * 二维码模块
 *
 * 复刻参考项目 `QRCodeHelper`（ZXing）的核心能力：文本/链接 → 二维码 PNG。
 * 这里使用 npm `qrcode`（纯 JS）生成，接口与输出为 base64 PNG。
 */

import { 启动模块 } from "@kugua/module-kit";
import type { 能力声明 } from "@kugua/capability";
import QRCode from "qrcode";

const 能力清单: 能力声明[] = [
  {
    名称: "qrcode.generate",
    模块: "qrcode",
    标题: "生成二维码",
    说明: "把文本/链接生成二维码 PNG（默认 300×300，边距 4）",
    中文指令: ["二维码"],
    参数: {
      type: "object",
      properties: {
        文本: { type: "string", description: "要编码的文本/链接" },
        尺寸: { type: "number", description: "图片边长，默认 300" },
        纠错: { type: "string", enum: ["L", "M", "Q", "H"], description: "纠错级别，默认 M" },
        边距: { type: "number", description: "白边模块数，默认 4" },
      },
      required: ["文本"],
    },
    暴露: { 指令: true, GUI: true, 定时: false, MCP: true },
  },
];

void 启动模块({
  name: "qrcode",
  version: "0.1.0",
  能力: 能力清单,
  处理器: {
    "qrcode.generate": async (params) => {
      const p = (params ?? {}) as {
        文本?: string;
        尺寸?: number;
        纠错?: "L" | "M" | "Q" | "H";
        边距?: number;
        参数文本?: string;
        原文?: string;
      };
      const 文本 = (p.文本 ?? p.参数文本 ?? p.原文 ?? "").trim();
      if (!文本) throw new Error("缺少 文本");
      const width = typeof p.尺寸 === "number" && p.尺寸 > 0 ? p.尺寸 : 300;
      const buf = await QRCode.toBuffer(文本, {
        type: "png",
        width,
        margin: typeof p.边距 === "number" ? p.边距 : 4,
        errorCorrectionLevel: p.纠错 ?? "M",
      });
      return {
        文本,
        base64: buf.toString("base64"),
        format: "png",
        width,
        height: width,
      };
    },
  },
  就绪: () => console.log("[二维码模块] 已接入主控，等待生成请求"),
});
