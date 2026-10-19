/**
 * 模式闲聊模块（chatmode）
 *
 * 只复刻原项目里**基于语料的随机抽取拼合**部分（不做用户输入兜底、不接 AI）：
 *   - 各「xx模式」：`ChatMode.getRandomSentence`（`_index.txt` 定义模式与配置，`<模式名>.txt` 为语料）
 *   - `混沌`：`getChaosRandomSentence` + `getMotionString`（混沌-名词 / 混沌-小万邦部分 / 混沌-情绪词）
 *   - `小万邦`：`getGong`（混沌-小万邦部分）
 *   - `本草`：本草.csv 随机一行；`西医`：西医病名/西药/检查；`喷人`：pen.txt
 *
 * 调用为显式指令（如「基督模式 你好啊」），不做泛泛正则兜底。
 */

import { readFileSync } from "node:fs";
import { 启动模块 } from "@kugua/module-kit";
import type { 能力声明 } from "@kugua/capability";
import { 模块资源 } from "@kugua/paths";
import { 生成 as 生成内部, type 模式, type 语料 } from "./generate.js";

const 能力清单: 能力声明[] = [
  {
    名称: "chatmode.say",
    模块: "chatmode",
    标题: "模式闲聊",
    说明: "按「xx模式」的语料随机拼合生成一句（如「基督模式 你好啊」）",
    参数: {
      type: "object",
      properties: {
        模式: { type: "string", description: "模式名，如 基督/佛/宋词/混沌" },
        内容: { type: "string", description: "触发文本（当前算法忽略，仅占位）" },
      },
      required: ["模式"],
    },
    暴露: { 指令: false, GUI: true, 定时: false, MCP: true },
  },
  {
    名称: "chatmode.list",
    模块: "chatmode",
    标题: "模式列表",
    说明: "列出全部可用模式",
    中文指令: ["模式列表"],
    参数: { type: "object", properties: {} },
    暴露: { 指令: true, GUI: true, 定时: false, MCP: true },
  },
];

/** 模块自带资源读取（去 BOM，按行） */
function 读行(...路径: string[]): string[] {
  return readFileSync(模块资源(import.meta.url, "Mode", ...路径), "utf-8")
    .replace(/^\uFEFF/, "")
    .split(/\r?\n/);
}

/* ============ 语料与模式（懒加载） ============ */
let 模式表: Map<string, 模式> = new Map();
let chaosWord: string[][] = [];
let chaosMotion: string[] = [];
let chaosXwb: string[] = [];
let bencao: string[] = [];
let xyDisease: string[] = [];
let xyDrugs: string[] = [];
let xyTreatment: string[] = [];
let penlist: string[] = [];
let 已加载 = false;

function 确保加载(): void {
  if (已加载) return;
  const modes: 模式[] = [];
  for (const line of 读行("_index.txt")) {
    const 行 = line.replace(/^\uFEFF/, "").trim();
    if (!行) continue;
    const items = 行.split("\t");
    const name = (items[0] ?? "").trim();
    if (!name) continue;
    const config = (items[1] ?? "")
      .split(",")
      .map((s) => s.trim())
      .filter(Boolean);
    let sentences: string[] = [];
    try {
      sentences = 读行(`${name}.txt`);
    } catch {
      sentences = [];
    }
    modes.push({ name, config, sentences });
  }
  // 内置模式（非 _index）
  modes.push({ name: "测试", config: ["隐藏"], sentences: [] });
  modes.push({ name: "喷人", config: [], sentences: [] });
  modes.push({ name: "语音", config: [], sentences: [] });
  modes.push({ name: "本草", config: [], sentences: [] });
  modes.push({ name: "西医", config: [], sentences: [] });
  模式表 = new Map(modes.map((m) => [m.name, m]));

  chaosWord = 读行("混沌-名词.txt").map((l) => l.split(/\s+/).filter(Boolean));
  chaosMotion = 读行("混沌-情绪词.txt").filter((l) => l.trim());
  chaosXwb = 读行("混沌-小万邦部分.txt").filter((l) => l.length > 0);
  bencao = 读行("本草.csv").filter((l) => l.trim());
  xyDisease = 读行("西医病名.txt").filter((l) => l.trim());
  xyDrugs = 读行("西医西药.txt").filter((l) => l.trim());
  xyTreatment = 读行("西医检查.txt").filter((l) => l.trim());
  penlist = 读行("pen.txt");
  已加载 = true;
}

/** 把当前加载到的语料打包给生成算法 */
function 语料(): 语料 {
  return { chaosWord, chaosMotion, chaosXwb, bencao, xyDisease, xyDrugs, xyTreatment, penlist };
}

/** 生成算法见 generate.ts（语料作为参数传入，便于单测） */
void 启动模块({
  name: "chatmode",
  version: "0.1.0",
  能力: 能力清单,
  注册: (客户端) => {
    客户端.onRequest("chatmode.say", (params) => {
      const p = (params ?? {}) as { 模式?: string; 内容?: string; 参数文本?: string; 原文?: string };
      const 模式名 = (p.模式 ?? "").trim();
      if (!模式名) throw new Error("缺少 模式");
      确保加载();
      return { 模式: 模式名, 结果: 生成内部(模式名, 模式表, 语料()) };
    });

    客户端.onRequest("chatmode.list", () => {
      确保加载();
      return [...模式表.keys()];
    });
  },
  就绪: () => console.debug("[模式闲聊模块] 已接入主控，等待模式请求"),
});
