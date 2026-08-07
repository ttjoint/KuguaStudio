/**
 * 掷骰模块
 * 严格复刻C# ModDice 掷骰逻辑
 * 支持自定义骰子个数与面数，如 r3d6 代表 3 个六面骰
 */

import { existsSync, readFileSync } from "node:fs";
import { resolve } from "node:path";
import { NiganeClient } from "@kugua/nigane";

interface 模块配置 {
  host?: string;
  port?: number;
  token?: string;
}

function 加载配置(): 模块配置 {
  const 路径 = resolve(process.cwd(), "kugua.config.json");
  if (!existsSync(路径)) return {};
  try {
    return JSON.parse(readFileSync(路径, "utf-8")) as 模块配置;
  } catch {
    return {};
  }
}

/** 掷骰：返回总和，并给出明细描述 */
function 掷骰(面数: number, 个数: number): { 总和: number; 描述: string } {
  const 结果: number[] = [];
  for (let i = 0; i < 个数; i++) {
    结果.push(面数 > 1 ? Math.floor(Math.random() * 面数) + 1 : 1);
  }
  const 总和 = 结果.reduce((a, b) => a + b, 0);
  if (个数 <= 1) {
    return { 总和, 描述: `${总和}` };
  }
  return { 总和, 描述: `${结果.join("+")} = ${总和}` };
}

async function 启动(): Promise<void> {
  const 配置 = 加载配置();
  const host = 配置.host ?? "127.0.0.1";
  const port = 配置.port ?? 24601;
  const envURL = process.env.NIGANE_URL ?? process.argv[2];
  const envToken = process.env.NIGANE_TOKEN ?? process.argv[3];

  const 客户端 = new NiganeClient({
    name: "dice",
    url: envURL ?? `ws://${host}:${port}`,
    token: envToken ?? 配置.token ?? "",
    version: "0.1.0",
    capabilities: ["dice.roll"],
  });

  客户端.onRequest("dice.roll", async (params) => {
    const { 个数 = 1, 面数 = 100, 缘由 = "" } = (params ?? {}) as {
      个数?: number;
      面数?: number;
      缘由?: string;
    };
    let diceNum = 个数;
    let faceNum = 面数;
    diceNum = Math.min(diceNum, 100);
    if (diceNum <= 0) diceNum = 1;
    if (faceNum <= 0) faceNum = 100;
    const 缘由文本 = 缘由?.trim() ?? "";
    const { 总和, 描述 } = 掷骰(faceNum, diceNum);
    return {
      个数: diceNum,
      面数: faceNum,
      缘由,
      描述,
      总和,
      文本: `${缘由文本} ${diceNum}d${faceNum} = ${描述}`.trim(),
    };
  });

  await 客户端.connect();
  console.log("[掷骰模块] 已接入主控，等待掷骰请求");

  const 关闭 = (): void => {
    console.log("[掷骰模块] 正在关闭……");
    客户端.close();
    process.exit(0);
  };
  客户端.on("shutdown", 关闭);
  process.on("SIGINT", 关闭);
  process.on("SIGTERM", 关闭);
}

启动().catch((err: unknown) => {
  console.error("[掷骰模块] 启动失败：", err);
  process.exit(1);
});