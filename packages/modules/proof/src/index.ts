/**
 * 数字论证模块
 * 严格复刻 C# ModProof.cs：把字符串/数字论证为一串数字
 * 使用 MathProof 逆波兰表达式搜索 + 笔画数/字母序号对照
 */

import { existsSync, readFileSync } from "node:fs";
import { resolve } from "node:path";
import { NiganeClient } from "@kugua/nigane";
import { MathProof } from "./math_proof.js";

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

/** homo 特有的默认目标数字 */
const HOMO_NUMBERS = [1, 1, 4, 5, 1, 4];

/** 笔画数字典：字符 → 笔画数 */
let 笔画字典: Map<string, number> | null = null;

function 载入笔画字典(): Map<string, number> {
  if (笔画字典) return 笔画字典;
  const 字典 = new Map<string, number>();
  const 文本 = readFileSync(resolve(process.cwd(), "data/generators", "data_bihua.txt"), "utf-8");
  for (const 行 of 文本.split(/\r?\n/)) {
    const 项 = 行.split("\t");
    if (项.length >= 2) {
      const 值 = parseInt(项[1], 10);
      if (!Number.isNaN(值)) 字典.set(项[0], 值);
    }
  }
  笔画字典 = 字典;
  return 字典;
}

/**
 * 数字论证
 * 输入 message 形如「西方苦瓜」或「12dora=12450」
 * 返回论证等式链，失败返回「论不出来」
 */
function 数字论证(输入: string): string {
  let message = 输入.trim();
  const targetNumber: number[] = [];
  if (message.includes("=")) {
    const parts = message.split("=");
    if (parts.length >= 2) {
      const 尾数 = parseFloat(parts[parts.length - 1]);
      if (Number.isInteger(尾数) && parts[parts.length - 1].trim() !== "") {
        for (const c of String(尾数)) {
          targetNumber.push(parseInt(c, 10));
        }
        message = parts.slice(0, -1).join("=");
      }
    }
  }
  if (targetNumber.length <= 0) {
    targetNumber.push(...HOMO_NUMBERS);
  }

  const mathProof = new MathProof();
  const 目标串 = targetNumber.join("");

  if (/^\d+$/.test(message)) {
    const trynum = parseInt(message, 10);
    const proofChain = mathProof.Proof(trynum, targetNumber);
    if (proofChain.length > 0) {
      if (proofChain[proofChain.length - 1] !== 目标串) proofChain.push(目标串);
      return `${trynum}=${proofChain.join("=")}\r\nQ.E.D`;
    }
  } else {
    const numb = "0123456789零一二三四五六七八九十壹贰叁肆伍陆柒捌玖";
    const engc = "abcdefghijklmnopqrstuvwxyzABCDEFGHIJKLMNOPQRSTUVWXYZ";
    const symb = "\t\r\n []【】！@#￥%…&*（）+=-—_!@#$%^&*()|/\\。、，？?“”\"',";
    let eng = false;
    let chn = false;
    const tmp: Array<{ c: string; v: number }> = [];
    const 字典 = 载入笔画字典();
    for (const c of message) {
      if (symb.includes(c)) continue;
      if (numb.includes(c)) {
        tmp.push({ c, v: numb.indexOf(c) % 10 });
        continue;
      }
      if (engc.includes(c)) {
        tmp.push({ c, v: (engc.indexOf(c) % 26) + 1 });
        eng = true;
        continue;
      }
      const cv = 字典.get(c);
      if (cv !== undefined) {
        tmp.push({ c, v: cv });
        chn = true;
        continue;
      }
    }

    if (tmp.length > 0) {
      let trynum = tmp.reduce((a, t) => a + t.v, 0);
      let transDescription = "";
      if (eng || chn) {
        transDescription = "按";
        if (eng) transDescription += "字母序号，";
        if (chn) transDescription += "笔画数，";
        transDescription += `${message}=${tmp.map((t) => t.v).join("+")}`;
      } else {
        transDescription = `${message}=${tmp.map((t) => t.v).join("+")}`;
      }

      const proofChain = mathProof.Proof(trynum, targetNumber);
      if (proofChain.length > 0) {
        if (proofChain[proofChain.length - 1] !== 目标串) proofChain.push(目标串);
        return `${transDescription}=${trynum}=${proofChain.join("=")}\r\nQ.E.D`;
      }
    }
  }
  return "论不出来";
}

async function 启动(): Promise<void> {
  const 配置 = 加载配置();
  const host = 配置.host ?? "127.0.0.1";
  const port = 配置.port ?? 24601;
  const envURL = process.env.NIGANE_URL ?? process.argv[2];
  const envToken = process.env.NIGANE_TOKEN ?? process.argv[3];

  const 客户端 = new NiganeClient({
    name: "proof",
    url: envURL ?? `ws://${host}:${port}`,
    token: envToken ?? 配置.token ?? "",
    version: "0.1.0",
    capabilities: ["proof.demonstrate"],
  });

  客户端.onRequest("proof.demonstrate", (params) => {
    const { 输入 = "" } = (params ?? {}) as { 输入?: string };
    载入笔画字典();
    return { 输入, 结果: 数字论证(输入) };
  });

  await 客户端.connect();
  console.log("[数字论证模块] 已接入主控，等待论证请求");

  const 关闭 = (): void => {
    console.log("[数字论证模块] 正在关闭……");
    客户端.close();
    process.exit(0);
  };
  客户端.on("shutdown", 关闭);
  process.on("SIGINT", 关闭);
  process.on("SIGTERM", 关闭);
}

启动().catch((err: unknown) => {
  console.error("[数字论证模块] 启动失败：", err);
  process.exit(1);
});