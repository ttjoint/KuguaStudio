/**
 * 文本功能综合模块
 * 严格复刻C# ModTextFunction 及对应生成器
 * 使用 DScript 引擎与内联火星文字符集
 */

import { existsSync, readFileSync } from "node:fs";
import { resolve } from "node:path";
import { 启动模块 } from "@kugua/module-kit";
import { DScriptFile, DValue } from "@kugua/dscript";
import { 简体字符集, 繁体字符集, 火星字符集 } from "./data/hx_chars.js";

/* ============ 语料缓存 ============ */
interface 语料 {
  攻受: DScriptFile;
  讽刺: DScriptFile;
  什么是: DScriptFile;
  狗屁: DScriptFile; // data_hyly.txt TextModules
  云杰: DScriptFile; // data_hyly2.txt SpamText2
  营销号: DScriptFile; // data_hyly3.txt SpamText3
  随机汉字串: string;
  历史行: string[];
}

let 语料缓存: 语料 | null = null;

/** 中文指令调用时，把 参数文本/原文 补齐到 文本/输入/主题/日期（不覆盖已有值）。 */
function 规范参数(参数: unknown): unknown {
  if (!参数 || typeof 参数 !== "object") return 参数;
  const p = { ...(参数 as Record<string, unknown>) };
  const 基准 = p.参数文本 ?? p.原文;
  if (typeof 基准 === "string") {
    for (const k of ["文本", "输入", "主题", "日期"]) {
      if (p[k] === undefined) p[k] = 基准;
    }
  }
  return p;
}

function 读数据(名: string): string {
  return readFileSync(resolve(process.cwd(), "data/generators", 名), "utf-8");
}

function 载入语料(): 语料 {
  if (语料缓存) return 语料缓存;
  const 攻受 = new DScriptFile();
  攻受.Load(读数据("gongshou.txt"));
  const 讽刺 = new DScriptFile();
  讽刺.Load(读数据("jokes.txt"));
  const 什么是 = new DScriptFile();
  什么是.Load(读数据("spam.txt"));
  const 狗屁 = new DScriptFile();
  狗屁.Load(读数据("data_hyly.txt"));
  const 云杰 = new DScriptFile();
  云杰.Load(读数据("data_hyly2.txt"));
  const 营销号 = new DScriptFile();
  营销号.Load(读数据("data_hyly3.txt"));
  const 随机汉字串 = readFileSync(
    resolve(process.cwd(), "data/generators", "随机-随机汉字.txt"),
    "utf-8"
  ).trim();
  const 历史行 = readFileSync(
    resolve(process.cwd(), "data/generators", "history_in_today.txt"),
    "utf-8"
  )
    .replace(/^\uFEFF/, "")
    .split(/\r?\n/)
    .filter((l) => l.trim().length > 0);
  语料缓存 = { 攻受, 讽刺, 什么是, 狗屁, 云杰, 营销号, 随机汉字串, 历史行 };
  return 语料缓存;
}

/* ============ 通用随机 ============ */
function 洗牌<T>(输入: T[]): T[] {
  const 数组 = [...输入];
  for (let i = 数组.length - 1; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1));
    [数组[i], 数组[j]] = [数组[j], 数组[i]];
  }
  return 数组;
}

/** 乱序字符串；time>0 时按不均匀切牌方式 */
function 乱序字符串(字符: string, time = 0): string {
  if (!字符) return 字符;
  if (time < 1) {
    return 洗牌([...字符]).join("");
  }
  time = Math.min(time, 字符.length - 1);
  const cutFlags = 洗牌(Array.from({ length: 字符.length - 1 }, (_, i) => i < time));
  const 片段: string[] = [];
  let 起点 = 0;
  for (let i = 1; i < 字符.length; i++) {
    if (cutFlags[i - 1]) {
      片段.push(字符.substring(起点, i));
      起点 = i;
    }
  }
  片段.push(字符.substring(起点));
  return 洗牌(片段).join("");
}

/* ============ 攻受 ============ */
function 攻受文(攻: string, 受: string): string {
  const 语料 = 载入语料();
  const 结果 = 语料.攻受.GetResult(null, [
    new DValue("【攻】", [攻]),
    new DValue("【受】", [受]),
  ]);
  return 结果.includes("【") ? "" : 结果;
}

/* ============ 讽刺（苏联笑话）============ */

/** 一张讽刺模板：原文 + 条件块位置 */
interface 讽刺模板块 {
  index: number;
  len: number;
  raw: string;
  conditions: Array<[string, string]>;
}
interface 讽刺模板 {
  raw: string;
  templates: 讽刺模板块[];
}

/** 从关键词列表中提取命中的关键词（按出现顺序，保持去重） */
function 从文本找关键词(文本: string, 关键词: string[]): string[] {
  const 命中索引: number[] = [];
  let i = 0;
  while (i < 文本.length) {
    let 最长索引 = -1;
    let 结束 = i;
    for (let j = i; j < 文本.length; j++) {
      const 子 = 文本.substring(i, j + 1);
      const 位置 = 关键词.findIndex((k) => k === 子);
      if (位置 !== -1) {
        最长索引 = 位置;
        结束 = j;
      }
      // 关键词最长几个字，避免无限增长
      if (j - i > 8) break;
    }
    if (最长索引 !== -1) {
      if (!命中索引.includes(最长索引)) 命中索引.push(最长索引);
      i = 结束 + 1;
    } else {
      i++;
    }
  }
  命中索引.sort((a, b) => a - b);
  return 命中索引.map((x) => 关键词[x]);
}

/** 解析单个讽刺模板 */
function 解析讽刺模板(原文: string): 讽刺模板 {
  const 块: 讽刺模板块[] = [];
  for (let i = 0; i < 原文.length; i++) {
    if (原文[i] !== "【") continue;
    const 结束 = 原文.indexOf("】", i);
    if (结束 === -1) continue;
    const 体内 = 原文.substring(i + 1, 结束).trim();
    块.push({
      index: i,
      len: 结束 - i + 1,
      raw: 原文.substring(i, 结束 + 1),
      conditions: 体内.split("=").map((v) => [v.trim(), v.trim()]),
    });
    i = 结束;
  }
  return { raw: 原文, templates: 块 };
}

/** 生成讽刺：输入 "事件=A，好人=B，坏人=C" 等键值对 */
function 讽刺(输入: string): string {
  const 语料 = 载入语料();
  const 键值对: Array<[string, string]> = [];
  const 项 = 输入.split(/[,，]/).map((s) => s.trim()).filter(Boolean);
  for (const 条目 of 项) {
    const 对 = 条目.split(/[:：= ]/).map((s) => s.trim()).filter(Boolean);
    if (对.length === 2) 键值对.push([对[0], 对[1]]);
  }
  if (键值对.length === 0) return "";
  return 填充讽刺(语料.讽刺, 键值对);
}

function 填充讽刺(脚本: DScriptFile, 条件: Array<[string, string]>): string {
  // 关键词表来自脚本匿名模板原文（首行已由 DScript 忽略？不，这里手动从原始文本解析）
  // 为忠实复刻，这里直接遍历匿名模板的每一条未替换文本
  const 候选: 讽刺模板[] = [];
  for (const 匿名 of 脚本.AnonymousTemplates) {
    for (const t of 匿名.Templates) {
      候选.push(解析讽刺模板(t.template));
    }
  }
  if (候选.length === 0) return "";
  const 模板 = 候选[Math.floor(Math.random() * 候选.length)];
  let 结果 = "";
  let 已用 = 0;
  for (const 块 of 模板.templates) {
    if (块.index > 已用) 结果 += 模板.raw.substring(已用, 块.index);
    let 找到 = false;
    for (const [键, 值] of 块.conditions) {
      if (!键) {
        结果 += 值;
        找到 = true;
        break;
      }
      const 命中 = 条件.find(([k]) => k === 键);
      if (命中) {
        结果 += 值.replaceAll(键, 命中[1]);
        找到 = true;
        break;
      }
    }
    已用 = 块.index + 块.len;
  }
  if (已用 < 模板.raw.length) 结果 += 模板.raw.substring(已用);
  return 结果.includes("【") ? "" : 结果;
}

/* ============ 什么是（营销号流水账）============ */
function 什么是(主题: string): string {
  const 语料 = 载入语料();
  const 参数 = [
    new DValue("【A】", [主题]),
    new DValue("【B】", [["朋友", "小伙伴", "网友"][Math.floor(Math.random() * 3)]]),
    new DValue("【C】", ["苦瓜"]),
    new DValue("【D】", ["24601"]),
    new DValue("【E】", [String(new Date().getFullYear())]),
  ];
  let 结果 = "";
  for (const 模板 of 语料.什么是.AnonymousTemplates) {
    结果 += 模板.Result(参数) + "\r\n";
  }
  return 结果;
}

/* ============ 狗屁不通（研究一下）============ */
function 狗屁不通(主题: string, essayNum = 500): string {
  const 语料 = 载入语料();
  const beginNum = Math.floor(essayNum * 0.15);
  const bodyNum = Math.floor(essayNum * 0.7);
  const endNum = Math.floor(essayNum * 0.15);
  const 参数 = [new DValue("x", [主题])];
  const 标题 = 语料.狗屁.GetResult("title", 参数);
  let 引 = "";
  let 正文 = "";
  let 结 = "";
  let 尝试 = 2000;
  while (引.length < beginNum && 尝试-- > 0) 引 += 语料.狗屁.GetResult("begin", 参数);
  尝试 = 2000;
  while (正文.length < bodyNum && 尝试-- > 0) 正文 += 语料.狗屁.GetResult("body", 参数);
  尝试 = 2000;
  while (结.length < endNum && 尝试-- > 0) 结 += 语料.狗屁.GetResult("end", 参数);
  return `${标题}\r\n${引}\r\n${正文}\r\n${结}`;
}

/* ============ 云杰说道（车轱辘话）============ */
function 云杰说道(主题: string, length = 500): string {
  const 语料 = 载入语料();
  const 参数 = [new DValue("x", [主题])];
  let 结果 = "";
  let 次数 = 100;
  while (次数-- > 0 && 结果.length < length) {
    结果 += 语料.云杰.GetResult(null, 参数);
    if (Math.random() <= 0.05) 结果 += "\r\n";
  }
  return 结果;
}

/* ============ 营销号 ============ */
function 营销号(主题: string): string {
  const 语料 = 载入语料();
  const 参数 = [
    new DValue("主题", [主题]),
    new DValue("小编", ["我苦"]),
  ];
  return 语料.营销号.GetResult(null, 参数);
}

/* ============ 火星文 ============ */
function 火星文(输入: string): string {
  let 结果 = "";
  for (const 字 of 输入) {
    let 索引 = 简体字符集.indexOf(字);
    if (索引 === -1) 索引 = 繁体字符集.indexOf(字);
    结果 += 索引 !== -1 ? 火星字符集[索引] : 字;
  }
  return 结果;
}

/* ============ 随机汉字 ============ */
function 随机汉字(行数: number, 列数: number): string {
  const 语料 = 载入语料();
  if (!语料.随机汉字串) return "";
  const 行: string[] = [];
  for (let i = 0; i < 行数; i++) {
    let 单行 = "";
    for (let j = 0; j < 列数; j++) {
      单行 += 语料.随机汉字串[Math.floor(Math.random() * 语料.随机汉字串.length)];
    }
    行.push(单行);
  }
  return 行.join("\r\n");
}

/* ============ 历史上的今天 ============ */
function 中文数字转整数(输入: string): number {
  if (/^\d+$/.test(输入)) return parseInt(输入, 10);
  const 映射: Record<string, number> = {
    〇: 0, 零: 0, 一: 1, 二: 2, 两: 2, 三: 3, 四: 4,
    五: 5, 六: 6, 七: 7, 八: 8, 九: 9, 十: 10, 廿: 20, 卅: 30, 卌: 40,
  };
  let 结果 = 0;
  let 临时 = 0;
  let 有十 = false;
  for (const 字 of 输入) {
    const 值 = 映射[字];
    if (值 === undefined) return 0;
    if (值 === 10) {
      临时 = 临时 === 0 ? 10 : 临时 * 10;
      有十 = true;
    } else {
      if (有十) {
        临时 += 值;
        结果 += 临时;
        临时 = 0;
        有十 = false;
      } else {
        临时 = 值;
      }
    }
  }
  return 结果 + 临时;
}

function 解析日期(输入: string): Date {
  const 现在 = new Date();
  switch (输入) {
    case "今天": return 现在;
    case "昨天": return new Date(现在.getTime() - 86400000);
    case "前天": return new Date(现在.getTime() - 2 * 86400000);
    case "明天": return new Date(现在.getTime() + 86400000);
    case "后天": return new Date(现在.getTime() + 2 * 86400000);
  }
  const 大前天 = 输入.match(/^(大+)(前天)$/);
  if (大前天) return new Date(现在.getTime() - (2 + 大前天[1].length) * 86400000);
  const 大后天 = 输入.match(/^(大+)(后天)$/);
  if (大后天) return new Date(现在.getTime() + (2 + 大后天[1].length) * 86400000);
  const 月日 = 输入.match(/^(\d{1,2}|[一二三四五六七八九十]{1,2})月([一二三四五六七八九十]{1,3}|\d{1,2})(日)?$/);
  if (月日) {
    const 月 = 中文数字转整数(月日[1]);
    const 日 = 中文数字转整数(月日[2]);
    return new Date(现在.getFullYear(), 月 - 1, 日);
  }
  return 现在;
}

function 历史上的今天(输入: string): string {
  const 语料 = 载入语料();
  const 日期 = 解析日期(输入);
  const 月 = 日期.getMonth() + 1;
  const 日 = 日期.getDate();
  let 结果 = `历史上的${String(月).padStart(2, "0")}月${String(日).padStart(2, "0")}日:\r\n`;
  let 条数 = 0;
  for (const 行 of 语料.历史行) {
    const 项 = 行.split(/\t/).map((s) => s.trim());
    if (项.length >= 5) {
      const 年 = 项[0];
      const m = parseInt(项[1], 10);
      const d = parseInt(项[2], 10);
      const 类型 = 项[3];
      const 内容 = 项[4];
      if (m === 月 && d === 日 && 类型 === "1") {
        结果 += `${年}年:${内容}\r\n`;
        if (++条数 > 10) break;
      }
    }
  }
  return 结果;
}

/* ============ 启动 ============ */
void 启动模块({
  name: "text",
  version: "0.1.0",
  capabilities: [
    "text.reverse", "text.reverseLines", "text.toUpper", "text.toLower",
    "text.shuffle", "text.cut", "text.gongshou", "text.joke", "text.salad",
    "text.paper", "text.paper2", "text.paper3", "text.hx", "text.randomHans",
    "text.historyToday",
  ],
  注册: (客户端) => {
    // 中文指令调用时，把 参数文本/原文 补齐到 文本/输入/主题/日期
    const 原始注册 = 客户端.onRequest.bind(客户端);
    客户端.onRequest = (动作: string, 处理器: Parameters<typeof 客户端.onRequest>[1]): void => {
      原始注册(动作, (参数, 消息) => 处理器(规范参数(参数), 消息));
    };

    客户端.onRequest("text.reverse", (params) => {
      const { 文本 = "" } = (params ?? {}) as { 文本?: string };
      return { 原因: 文本, 结果: [...文本].reverse().join("") };
    });

    客户端.onRequest("text.reverseLines", (params) => {
      const { 文本 = "" } = (params ?? {}) as { 文本?: string };
      return { 原因: 文本, 结果: 文本.split("\n").reverse().join("\r\n") };
    });

    客户端.onRequest("text.toUpper", (params) => {
      const { 文本 = "" } = (params ?? {}) as { 文本?: string };
      return { 原因: 文本, 结果: 文本.toUpperCase() };
    });

    客户端.onRequest("text.toLower", (params) => {
      const { 文本 = "" } = (params ?? {}) as { 文本?: string };
      return { 原因: 文本, 结果: 文本.toLowerCase() };
    });

    客户端.onRequest("text.shuffle", (params) => {
      const { 文本 = "" } = (params ?? {}) as { 文本?: string };
      return { 原因: 文本, 结果: 乱序字符串(文本) };
    });

    客户端.onRequest("text.cut", (params) => {
      const { 段数 = 3, 次数 = 1, 文本 = "" } = (params ?? {}) as {
        段数?: number;
        次数?: number;
        文本?: string;
      };
      let 目标 = 文本.trim();
      if (段数 < 1) return "";
      let runTime = 次数 < 1 ? 1 : Math.min(次数, 5);
      let 结果 = "";
      for (let i = 0; i < runTime; i++) {
        结果 += 乱序字符串(目标, 段数) + "\r\n";
      }
      return { 原因: 文本, 结果 };
    });

    客户端.onRequest("text.gongshou", (params) => {
      const { 攻 = "", 受 = "" } = (params ?? {}) as { 攻?: string; 受?: string };
      if (!攻 || !受 || 攻.length > 15 || 受.length > 15) return { 原因: "", 结果: "" };
      载入语料();
      return { 攻, 受, 结果: 攻受文(攻, 受) };
    });

    客户端.onRequest("text.joke", (params) => {
      const { 输入 = "" } = (params ?? {}) as { 输入?: string };
      载入语料();
      return { 原因: 输入, 结果: 讽刺(输入) };
    });

    客户端.onRequest("text.salad", (params) => {
      const { 主题 = "" } = (params ?? {}) as { 主题?: string };
      载入语料();
      return { 主题, 结果: 什么是(主题) };
    });

    客户端.onRequest("text.paper", (params) => {
      const { 主题 = "" } = (params ?? {}) as { 主题?: string };
      载入语料();
      return { 主题, 结果: 狗屁不通(主题) };
    });

    客户端.onRequest("text.paper2", (params) => {
      const { 主题 = "" } = (params ?? {}) as { 主题?: string };
      载入语料();
      return { 主题, 结果: `云杰说道:暂且不知诸位朋友哪位,${云杰说道(主题)}` };
    });

    客户端.onRequest("text.paper3", (params) => {
      const { 主题 = "" } = (params ?? {}) as { 主题?: string };
      载入语料();
      return { 主题, 结果: 营销号(主题) };
    });

    客户端.onRequest("text.hx", (params) => {
      const { 文本 = "" } = (params ?? {}) as { 文本?: string };
      return { 原因: 文本, 结果: 火星文(文本) };
    });

    客户端.onRequest("text.randomHans", (params) => {
      const { 行数 = 1, 列数 = 1 } = (params ?? {}) as { 行数?: number; 列数?: number };
      let rows = 行数 < 1 ? 1 : 行数;
      let cols = 列数 < 1 ? 1 : 列数;
      if (rows * cols > 2500) {
        const maxrow = Math.floor(2500 / cols);
        if (maxrow <= 0) { rows = 1; cols = 2500; }
        else rows = maxrow;
      }
      载入语料();
      return { 行数: rows, 列数: cols, 结果: 随机汉字(rows, cols) };
    });

    客户端.onRequest("text.historyToday", (params) => {
      const { 日期 = "今天" } = (params ?? {}) as { 日期?: string };
      载入语料();
      return { 日期, 结果: 历史上的今天(日期) };
    });
  },
  就绪: () => console.log("[文本模块] 已接入主控，等待文本功能请求"),
});
