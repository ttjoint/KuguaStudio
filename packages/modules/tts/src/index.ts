/**
 * 语音合成模块（M6）
 * tts.speak：按提供方合成文本为 base64 WAV（默认 sherpa-onnx，可用 KUGUA_TTS_PROVIDER 覆盖）。
 * 用法：node dist/index.js [主控地址] [token]
 */

import { NiganeClient } from "@kugua/nigane";
import { 注册TTS处理器 } from "./handlers.js";
import { 解析提供方 } from "./tts.js";

const 地址 = process.env.NIGANE_URL ?? process.argv[2] ?? "ws://127.0.0.1:24601";
const 令牌 = process.env.NIGANE_TOKEN ?? process.argv[3] ?? "";

const 客户端 = new NiganeClient({
  name: "tts",
  url: 地址,
  token: 令牌,
  version: "0.6.0",
  capabilities: ["tts.speak", "tts.status"],
});

注册TTS处理器(客户端);

客户端.on("shutdown", () => {
  console.log("[TTS] 主控退出，结束本进程");
  客户端.close();
  process.exit(0);
});

客户端.on("close", () => {
  console.log("[TTS] 与主控的连接已断开");
  process.exit(0);
});

客户端
  .connect()
  .then(() => console.log(`[TTS] 已接入主控：${地址}（提供方：${解析提供方()}）`))
  .catch((err: unknown) => {
    console.error("[TTS] 接入失败：", err);
    process.exit(1);
  });
