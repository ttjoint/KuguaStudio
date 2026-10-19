/**
 * 二维码模块
 *
 * 复刻参考项目 `QRCodeHelper`（ZXing）的核心能力：文本/链接 → 二维码 PNG。
 * 这里使用 npm `qrcode`（纯 JS）生成，接口与输出为 base64 PNG。
 */

import { 启动模块 } from "@kugua/module-kit";
import type { 能力声明 } from "@kugua/capability";
import QRCode from "qrcode";
import { 归一参数 } from "./params.js";

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
      const { 文本, 尺寸, 纠错, 边距 } = 归一参数(params);
      const width = 尺寸;
      const buf = await QRCode.toBuffer(文本, {
        type: "png",
        width,
        margin: 边距,
        errorCorrectionLevel: 纠错,
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
  就绪: () => console.debug("[二维码模块] 已接入主控，等待生成请求"),
});
