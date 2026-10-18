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
import { NextInt } from "@kugua/random";

interface 模式 {
  name: string;
  config: string[];
  sentences: string[];
}

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

/* ============ 生成算法（忠实复刻） ============ */

/** `ChatMode.getRandomSentence`：按语料与配置随机拼合 */
function 随机句(mode: 模式): string {
  const sentences = mode.sentences;
  if (sentences.length === 0) return "";
  let maxsnum = 5;
  let maxslen = 7;
  let maxwordnum = 4;
  if (mode.config.includes("单句")) {
    maxslen = 1;
    maxwordnum = 1;
    maxsnum = 1;
  }
  if (mode.config.includes("句内不拼接")) {
    maxwordnum = 1;
    maxslen = 1;
  }
  const sgn1 = [",", "，", "；", "、"];
  const sgn2 = ["\r\n", "。", "。", "。", "？", "！", "…", "——"];
  const sgn3 = ["\r\n", "。", "？", "！", "…", "——", "??", "...", "：", "?!", "???", "!!", "！！！"];
  let result = "";
  const sn = NextInt(1, maxsnum);
  for (let i = 0; i < sn; i++) {
    const thislen = NextInt(1, maxslen);
    let thissentence = "";
    let wordnum = 0;
    while (thissentence.length < thislen && wordnum < maxwordnum) {
      wordnum++;
      thissentence += sentences[NextInt(0, sentences.length - 1)];
    }
    const last = thissentence.length > 0 ? thissentence[thissentence.length - 1] : "";
    if (thissentence.length > 0 && !sgn1.includes(last) && !sgn2.includes(last)) {
      if (mode.config.includes("无标点")) thissentence += " ";
      else thissentence += sgn1[NextInt(sgn1.length)];
      result += thissentence;
      if (result.length > 0) {
        if (mode.config.includes("无标点")) {
          /* 保持 */
        } else if (mode.config.includes("乱打标点")) {
          result = result.slice(0, -1) + sgn3[NextInt(sgn3.length)];
        } else {
          result = result.slice(0, -1) + sgn2[NextInt(sgn2.length)];
        }
      }
    } else {
      result += thissentence;
    }
  }
  if (!result || !result.trim()) {
    if (mode.config.includes("无标点")) result = " ";
    else if (mode.config.includes("乱打标点")) result = result.slice(0, -1) + sgn3[NextInt(sgn3.length)];
    else result = result.slice(0, -1) + sgn2[NextInt(sgn2.length)];
  }
  return result;
}

/** `getChaosRandomSentence`：混沌模式组句（两库按概率抽取） */
function 混沌句(): string {
  const sgn = ["\r\n", "。", "？", "！", "…", "——", "??", "...", "：", "?!", "???", "!!", "！！！"];
  let result = "";
  const sentences = NextInt(1, 6);
  for (let i = 0; i < sentences; i++) {
    const thislen = NextInt(0, 11);
    let thissentence = "";
    let wordnum = 0;
    while (thissentence.length < thislen && wordnum < 5) {
      wordnum++;
      if (NextInt(0, 100) > 80) {
        if (chaosWord.length > 0) thissentence += chaosWord[NextInt(0, chaosWord.length - 1)][0];
      } else {
        if (chaosXwb.length > 0) thissentence += chaosXwb[NextInt(0, chaosXwb.length - 1)];
      }
    }
    thissentence += sgn[NextInt(sgn.length)];
    result += thissentence;
  }
  return result;
}

/** `getMotionString`：随机括弧情绪（如「(悲)」） */
function 情绪括弧(): string {
  if (chaosMotion.length <= 0) return "";
  if (NextInt(0, 100) > 66) return `(${chaosMotion[NextInt(0, chaosMotion.length - 1)]})`;
  return "";
}

/** `getGong`：小万邦式拼合 */
function 小万邦句(): string {
  if (chaosXwb.length === 0) return "";
  let sb = "";
  const snum = NextInt(1, 5);
  for (let i = 0; i < snum; i++) {
    const wnum = NextInt(1, 5);
    let nowlen = 0;
    for (let j = 0; j < wnum; j++) {
      const s = chaosXwb[NextInt(chaosXwb.length)];
      sb += s;
      nowlen += s.length;
      if (nowlen > 15) break;
    }
    if (i < snum - 1) sb += "，";
    else sb += "。？!"[NextInt(3)];
  }
  return sb;
}

/** `getXiyi`：西医模拟 */
function 西医句(): string {
  let disease = "";
  let drug = "";
  let treatment = "";
  let num = NextInt(1, 4);
  for (let i = 0; i < num; i++) disease += xyDisease[NextInt(xyDisease.length)] + "，";
  num = NextInt(1, 4);
  for (let i = 0; i < num; i++) drug += xyDrugs[NextInt(xyDrugs.length)] + "，";
  num = NextInt(1, 4);
  for (let i = 0; i < num; i++) treatment += xyTreatment[NextInt(xyTreatment.length)] + "，";
  return `查了下${treatment}怀疑你得了${disease}建议吃${drug}祝你早日康复！`;
}

/** `getPen`：喷人（多句） */
function 喷人句(): string {
  if (penlist.length === 0) return "";
  const num = NextInt(2, 10);
  const res: string[] = [];
  for (let i = 0; i < num; i++) res.push(penlist[NextInt(penlist.length)].trim());
  return res.join("\n");
}

/** 按模式生成一句 */
function 生成(模式名: string): string {
  确保加载();
  const mode = 模式表.get(模式名);
  if (!mode) throw new Error(`未知模式：${模式名}`);
  switch (模式名) {
    case "混沌":
      return 混沌句() + 情绪括弧();
    case "小万邦":
      return 小万邦句();
    case "本草":
      return bencao.length > 0 ? bencao[NextInt(bencao.length)] : "";
    case "西医":
      return 西医句();
    case "喷人":
      return 喷人句();
    default:
      return 随机句(mode);
  }
}

void 启动模块({
  name: "chatmode",
  version: "0.1.0",
  能力: 能力清单,
  注册: (客户端) => {
    客户端.onRequest("chatmode.say", (params) => {
      const p = (params ?? {}) as { 模式?: string; 内容?: string; 参数文本?: string; 原文?: string };
      const 模式名 = (p.模式 ?? "").trim();
      if (!模式名) throw new Error("缺少 模式");
      return { 模式: 模式名, 结果: 生成(模式名) };
    });

    客户端.onRequest("chatmode.list", () => {
      确保加载();
      return [...模式表.keys()];
    });
  },
  就绪: () => console.debug("[模式闲聊模块] 已接入主控，等待模式请求"),
});
