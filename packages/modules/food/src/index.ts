/**
 * 今天吃什么模块
 * 严格复刻C# EatText逻辑，使用DScript引擎
 * 数据通过苦音协议从 MKG 读取，不直接访问文件系统
 */

import { existsSync, readFileSync } from "node:fs";
import { resolve } from "node:path";
import { NiganeClient } from "@kugua/nigane";
import { DScriptFile, DValue } from "@kugua/dscript";

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

function 人称互换(文本: string): string {
  return 文本
    .replace(/我/g, "【W】")
    .replace(/你/g, "我")
    .replace(/【W】/g, "你");
}

async function 启动(): Promise<void> {
  const 配置 = 加载配置();
  const host = 配置.host ?? "127.0.0.1";
  const port = 配置.port ?? 24601;
  const envURL = process.env.NIGANE_URL ?? process.argv[2];
  const envToken = process.env.NIGANE_TOKEN ?? process.argv[3];

  const 客户端 = new NiganeClient({
    name: "food",
    url: envURL ?? `ws://${host}:${port}`,
    token: envToken ?? 配置.token ?? "",
    version: "0.1.0",
    capabilities: ["food.recommend"],
  });

  let 脚本缓存: DScriptFile | null = null;

  async function 加载数据(): Promise<DScriptFile> {
    if (脚本缓存) return 脚本缓存;
    const 数据路径 = resolve(process.cwd(), "data/generators", "data_eat.txt");
    const 内容 = readFileSync(数据路径, "utf-8");
    const 脚本 = new DScriptFile();
    脚本.Load(内容);
    脚本缓存 = 脚本;
    return 脚本;
  }

  function EatText(time: string, verb: string): string {
    const 脚本 = 脚本缓存!;
    let 结果 = 脚本.GetResult(null, [
      new DValue("【time】", [time]),
      new DValue("【verb】", [verb]),
    ]);
    结果 = 人称互换(结果);
    if (结果.includes("【")) {
      return "";
    }
    return 结果;
  }

  客户端.onRequest("food.recommend", async (params) => {
    await 加载数据();
    const { time = "今天", verb = "吃" } = (params ?? {}) as {
      time?: string;
      verb?: string;
    };
    const 推荐 = EatText(time, verb);
    return {
      time,
      verb,
      推荐,
    };
  });

  await 客户端.connect();
  console.log("[吃什么模块] 已接入主控，等待推荐请求");

  const 关闭 = (): void => {
    console.log("[吃什么模块] 正在关闭……");
    客户端.close();
    process.exit(0);
  };
  客户端.on("shutdown", 关闭);
  process.on("SIGINT", 关闭);
  process.on("SIGTERM", 关闭);
}

启动().catch((err: unknown) => {
  console.error("[吃什么模块] 启动失败：", err);
  process.exit(1);
});
