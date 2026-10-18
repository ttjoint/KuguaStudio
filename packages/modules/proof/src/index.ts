/**
 * 数字论证模块
 * 严格复刻 C# ModProof.cs：把字符串/数字论证为一串数字
 * 使用 MathProof 逆波兰表达式搜索 + 笔画数/字母序号对照
 */

import { 启动模块 } from "@kugua/module-kit";
import type { 能力声明 } from "@kugua/capability";
import { 读模块资源 } from "@kugua/paths";
import { MathProof } from "./math_proof.js";

/** 能力声明：数字论证（中文指令「论证」） */
const 能力清单: 能力声明[] = [
  {
    名称: "proof.demonstrate",
    模块: "proof",
    标题: "数字论证",
    说明: "把字词/数字论证为一串数字（字母序号/笔画数 + 逆波兰搜索）",
    中文指令: ["论证"],
    参数: {
      type: "object",
      properties: { 输入: { type: "string", description: "待论证的词语或数字" } },
    },
    暴露: { 指令: true, GUI: true, 定时: false, MCP: true },
  },
];

interface 模块配置 {
  host?: string;
  port?: number;
  token?: string;
}

/** homo 特有的默认目标数字 */
const HOMO_NUMBERS = [1, 1, 4, 5, 1, 4];

/** 笔画数字典：字符 → 笔画数 */
let 笔画字典: Map<string, number> | null = null;

function 载入笔画字典(): Map<string, number> {
  if (笔画字典) return 笔画字典;
  const 字典 = new Map<string, number>();
  const 文本 = 读模块资源(import.meta.url, "data_bihua.txt");
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

void 启动模块({
  name: "proof",
  version: "0.2.0",
  能力: 能力清单,
  处理器: {
    "proof.demonstrate": (params) => {
      const p = (params ?? {}) as { 输入?: string; 参数文本?: string; 原文?: string };
      const 输入 = (p.输入 ?? p.参数文本 ?? p.原文 ?? "").trim();
      载入笔画字典();
      return { 输入, 结果: 数字论证(输入) };
    },
  },
  就绪: () => console.debug("[数字论证模块] 已接入主控，等待论证请求"),
});