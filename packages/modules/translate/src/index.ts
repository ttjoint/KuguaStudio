/**
 * 翻译模块
 * 复刻参考项目 ModTranslate：Google 网页接口翻译
 * 能力：translate.translate（单语言/指定语言翻译）、translate.rounds（译N次多语言接力）
 */

import { existsSync, readFileSync } from "node:fs";
import { resolve } from "node:path";
import { NiganeClient } from "@kugua/nigane";
import { 语言代码, 是否语言, 语言名列表 } from "./lang.js";
import { 切块, 解析译文, 解码HTML实体, 语言显示名 } from "./parse.js";

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

const 用户代理列表 = [
  "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/100.0.4896.60 Safari/537.36",
  "Mozilla/5.0 (Windows NT 10.0; Win64; x64; rv:98.0) Gecko/20100101 Firefox/98.0",
  "Mozilla/5.0 (Macintosh; Intel Mac OS X 12_3_1) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/15.3 Safari/605.1.15",
];

function 随机用户代理(): string {
  return 用户代理列表[Math.floor(Math.random() * 用户代理列表.length)];
}

/** 单次 Google 翻译（在线） */
async function 翻译单次(input: string, to: string, from = "auto"): Promise<string> {
  const url = `https://translate.google.com/m?sl=${encodeURIComponent(from)}&tl=${encodeURIComponent(to)}&ie=UTF-8&prev=_m&q=${encodeURIComponent(input)}`;
  const res = await fetch(url, {
    headers: { "User-Agent": 随机用户代理(), "Accept-Language": "zh-CN,zh;q=0.9" },
  });
  if (!res.ok) return "";
  const html = await res.text();
  const 译 = 解析译文(html);
  return 译 ? 解码HTML实体(译) : "";
}

/** 按行翻译：每行分块（最长 100 字符）逐块翻译后拼接 */
async function 翻译文本(input: string, to: string): Promise<string> {
  const 结果: string[] = [];
  for (const { 块 } of 切块(input)) {
    let 拼接 = "";
    for (const 段 of 块) {
      const 译 = await 翻译单次(段, to);
      拼接 += 译 && 译 !== 段 ? 译 : 段;
    }
    结果.push(拼接);
  }
  return 结果.join("\r\n");
}

async function 启动(): Promise<void> {
  const 配置 = 加载配置();
  const host = 配置.host ?? "127.0.0.1";
  const port = 配置.port ?? 24601;
  const envURL = process.env.NIGANE_URL ?? process.argv[2];
  const envToken = process.env.NIGANE_TOKEN ?? process.argv[3];

  const 客户端 = new NiganeClient({
    name: "translate",
    url: envURL ?? `ws://${host}:${port}`,
    token: envToken ?? 配置.token ?? "",
    version: "0.1.0",
  });

  // 译英 你好啊 / 译英译日译中 共是风，还是法律的。
  客户端.onRequest("translate.translate", async (params) => {
    const { 目标 = "英语", 文字 = "" } = (params ?? {}) as { 目标?: string; 文字?: string };
    if (!文字.trim()) return { 输入: 文字, 结果: "请输入要翻译的文字" };
    const to = 语言代码(目标);
    try {
      const 结果 = await 翻译文本(文字, to);
      return { 输入: 文字, 目标, 结果 };
    } catch (err) {
      return { 输入: 文字, 目标, 结果: `翻译失败：${(err as Error).message}` };
    }
  });

  // 译N次 你们别骂我了（N 次随机语言接力，最后回中文）
  客户端.onRequest("translate.rounds", async (params) => {
    const { 次数 = 3, 文字 = "" } = (params ?? {}) as { 次数?: number; 文字?: string };
    if (!文字.trim()) return { 输入: 文字, 结果: "请输入要翻译的文字" };
    let n = Math.min(Math.max(Number(次数) || 3, 1), 10);
    const 语言名 = 语言名列表();
    const 使用语言: string[] = [];
    let 当前 = 文字;
    try {
      for (let i = 0; i < n; i++) {
        let 名 = "";
        do {
          名 = 语言名[Math.floor(Math.random() * 语言名.length)];
        } while (语言代码(名).includes("zh"));
        使用语言.push(语言显示名(名));
        当前 = await 翻译文本(当前, 语言代码(名));
      }
      // 最后译回中文
      使用语言.push("中");
      当前 = await 翻译文本(当前, "zh-CN");
      const 链路 = "(" + 使用语言.map((s) => `译${s}`).join("") + ")";
      return { 输入: 文字, 链路, 结果: `${链路}\n${当前}` };
    } catch (err) {
      return { 输入: 文字, 结果: `翻译失败：${(err as Error).message}` };
    }
  });

  await 客户端.connect();
  console.log("[翻译模块] 已接入主控，等待翻译请求");

  const 关闭 = (): void => {
    console.log("[翻译模块] 正在关闭……");
    客户端.close();
    process.exit(0);
  };
  客户端.on("shutdown", 关闭);
  process.on("SIGINT", 关闭);
  process.on("SIGTERM", 关闭);
}

启动().catch((err: unknown) => {
  console.error("[翻译模块] 启动失败：", err);
  process.exit(1);
});