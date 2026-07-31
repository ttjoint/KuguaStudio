/**
 * Napcat 桥接模块入口
 * 配置：kugua.config.json 增加 "napcat" 节，如：
 * {
 *   "token": "苦音令牌",
 *   "napcat": { "url": "ws://127.0.0.1:3001", "token": "", "转发心跳": false }
 * }
 */

import { existsSync, readFileSync } from "node:fs";
import { resolve } from "node:path";
import { 启动Napcat桥, type Napcat桥配置 } from "./bridge.js";

interface 文件配置 {
  host?: string;
  port?: number;
  token?: string;
  napcat?: { url?: string; token?: string; 转发心跳?: boolean };
}

function 加载配置(): Napcat桥配置 {
  const 路径 = resolve(process.cwd(), "kugua.config.json");
  let 文件: 文件配置 = {};
  if (existsSync(路径)) {
    try {
      文件 = JSON.parse(readFileSync(路径, "utf-8")) as 文件配置;
    } catch (err) {
      console.warn(`[napcat桥] 配置文件解析失败，使用默认配置：${String(err)}`);
    }
  }
  const host = 文件.host ?? "127.0.0.1";
  const port = 文件.port ?? 24601;
  const envURL = process.env.NIGANE_URL ?? process.argv[2];
  const envToken = process.env.NIGANE_TOKEN ?? process.argv[3];
  return {
    苦音地址: envURL ?? `ws://${host}:${port}`,
    苦音令牌: envToken ?? 文件.token ?? "",
    napcat地址: 文件.napcat?.url ?? "ws://127.0.0.1:3001",
    napcat令牌: 文件.napcat?.token ?? "",
    转发心跳: 文件.napcat?.转发心跳 ?? false,
  };
}

const 配置 = 加载配置();

启动Napcat桥(配置)
  .then((桥) => {
    console.log(`[napcat桥] 已启动：苦音=${配置.苦音地址}，Napcat=${配置.napcat地址}`);
    const 关闭 = (): void => {
      console.log("[napcat桥] 正在关闭……");
      桥.关闭();
      process.exit(0);
    };
    桥.苦音.on("shutdown", 关闭);
    process.on("SIGINT", 关闭);
    process.on("SIGTERM", 关闭);
  })
  .catch((err: unknown) => {
    console.error("[napcat桥] 启动失败：", err);
    process.exit(1);
  });
