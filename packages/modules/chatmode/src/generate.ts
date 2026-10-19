/**
 * chatmode 的生成算法（从 index.ts 抽出，语料改为参数传入）。
 *
 * ## 为什么值得抽出来测
 *
 * 这些算法是从原项目逐行复刻的，原样搬过来的「怪的地方」很多：
 * 空串切片、`NextInt(0, n)` 的闭区间、标点被 `slice(0,-1)` 替换……
 * 看着像 bug，但其实是原作者的本意。
 *
 * 复刻类代码最怕的正是「顺手修一修」——一修就跟原版行为不一样了。
 * 所以必须有测试把这些行为**钉死**，包括那些看着不合理的部分。
 * 测试的注释里会写明「这是原版行为，不要改」。
 *
 * 另一个坑：语料文件缺失时不能崩。原项目里 `sentences` 读不到就是空数组，
 * 生成结果是空串。这条也得钉住。
 */

import { NextInt } from "@kugua/random";

export interface 模式 {
  name: string;
  config: string[];
  sentences: string[];
}

/** 语料集合。全部由调用方传入，函数本身不碰文件系统。 */
export interface 语料 {
  chaosWord: string[][];
  chaosMotion: string[];
  chaosXwb: string[];
  bencao: string[];
  xyDisease: string[];
  xyDrugs: string[];
  xyTreatment: string[];
  penlist: string[];
}

/** `ChatMode.getRandomSentence`：按语料与配置随机拼合 */
export function 随机句(mode: 模式): string {
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
export function 混沌句(语: 语料): string {
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
        if (语.chaosWord.length > 0) thissentence += 语.chaosWord[NextInt(0, 语.chaosWord.length - 1)][0];
      } else {
        if (语.chaosXwb.length > 0) thissentence += 语.chaosXwb[NextInt(0, 语.chaosXwb.length - 1)];
      }
    }
    thissentence += sgn[NextInt(sgn.length)];
    result += thissentence;
  }
  return result;
}

/** `getMotionString`：随机括弧情绪（如「(悲)」） */
export function 情绪括弧(语: 语料): string {
  if (语.chaosMotion.length <= 0) return "";
  if (NextInt(0, 100) > 66) return `(${语.chaosMotion[NextInt(0, 语.chaosMotion.length - 1)]})`;
  return "";
}

/** `getGong`：小万邦式拼合 */
export function 小万邦句(语: 语料): string {
  if (语.chaosXwb.length === 0) return "";
  let sb = "";
  const snum = NextInt(1, 5);
  for (let i = 0; i < snum; i++) {
    const wnum = NextInt(1, 5);
    let nowlen = 0;
    for (let j = 0; j < wnum; j++) {
      const s = 语.chaosXwb[NextInt(语.chaosXwb.length)];
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
export function 西医句(语: 语料): string {
  let disease = "";
  let drug = "";
  let treatment = "";
  let num = NextInt(1, 4);
  for (let i = 0; i < num; i++) disease += 语.xyDisease[NextInt(语.xyDisease.length)] + "，";
  num = NextInt(1, 4);
  for (let i = 0; i < num; i++) drug += 语.xyDrugs[NextInt(语.xyDrugs.length)] + "，";
  num = NextInt(1, 4);
  for (let i = 0; i < num; i++) treatment += 语.xyTreatment[NextInt(语.xyTreatment.length)] + "，";
  return `查了下${treatment}怀疑你得了${disease}建议吃${drug}祝你早日康复！`;
}

/** `getPen`：喷人（多句） */
export function 喷人句(语: 语料): string {
  if (语.penlist.length === 0) return "";
  const num = NextInt(2, 10);
  const res: string[] = [];
  for (let i = 0; i < num; i++) res.push(语.penlist[NextInt(语.penlist.length)].trim());
  return res.join("\n");
}

/** 按模式生成一句；未知模式抛错 */
export function 生成(模式名: string, 模式表: Map<string, 模式>, 语: 语料): string {
  const mode = 模式表.get(模式名);
  if (!mode) throw new Error(`未知模式：${模式名}`);
  switch (模式名) {
    case "混沌":
      return 混沌句(语) + 情绪括弧(语);
    case "小万邦":
      return 小万邦句(语);
    case "本草":
      return 语.bencao.length > 0 ? 语.bencao[NextInt(语.bencao.length)] : "";
    case "西医":
      return 西医句(语);
    case "喷人":
      return 喷人句(语);
    default:
      return 随机句(mode);
  }
}
