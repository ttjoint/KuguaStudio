/**
 * 万年历模块
 *
 * 复刻参考项目 ModCalendar：公历/农历/回历/四柱/节气/生肖/星座/月相。
 * 按《功能复刻准则》：忠实复刻；**芸历（蒸汽/创世）换算不做**。
 *
 * 能力声明见下方 能力清单（中文指令 / GUI / MCP 由注册表派生）。
 */

import { 启动模块 } from "@kugua/module-kit";
import type { 能力声明 } from "@kugua/capability";
import {
  公历转农历,
  干支,
  生肖,
  四柱查询,
  当日节气,
  星座,
  公历转回历,
  月相,
  公历日序,
  农历月名串,
  农历日名串,
  农历月大小,
  星期,
  当日节日,
  未来节日,
  朝代,
  儒略日,
} from "./lunar.js";

/** 能力声明：一处声明，自动派生 中文指令 / GUI / MCP 入口 */
const 能力清单: 能力声明[] = [
  {
    名称: "calendar.today",
    模块: "calendar",
    标题: "今日黄历",
    说明: "今夕是何年：公历/农历/回历/四柱/节气/星座/月相",
    中文指令: ["今夕是何年", "今天", "黄历", "今日"],
    参数: { type: "object", properties: {} },
    暴露: { 指令: true, GUI: true, 定时: false, MCP: true },
  },
  {
    名称: "calendar.query",
    模块: "calendar",
    标题: "日期查询",
    说明: "查询指定公历日期的黄历信息，如「公历 2012年5月20日」",
    中文指令: ["公历", "公元"],
    参数: {
      type: "object",
      properties: {
        日期: { type: "string", description: "如 2012年5月20日" },
        时: { type: "number", description: "小时（0-23），默认当前小时" },
      },
    },
    暴露: { 指令: true, GUI: true, 定时: false, MCP: true },
  },
];

function 补两位(n: number): string {
  return n < 10 ? "0" + n : String(n);
}

/** 组装一份完整黄历文本（今夕是何年 / 指定日期查询共用） */
function 黄历文本(y: number, mo: number, d: number, h: number, mi: number, s: number): string {
  const 农历 = 公历转农历(y, mo, d);
  const 岁干支 = 干支((农历.year - 4) % 60);
  const 生肖名 = 生肖(农历.year);
  const 月相名 = 月相(公历日序(y, mo, d) + h * 3600000 + mi * 60000);
  const 节气 = 当日节气(y, mo, d);
  const 时 = 补两位(h);
  const 分 = 补两位(mi);
  const 秒 = 补两位(s);
  const 回历 = 公历转回历(y, mo, d);
  const 四柱 = 四柱查询(y, mo, d, 农历.year, 农历.month, h);
  const 节日 = 当日节日(y, mo, d);
  const 星座名 = 星座(mo, d);

  const 行: string[] = [];
  const 公历串 = `${y}年${补两位(mo)}月${补两位(d)}日 星期${星期(y, mo, d)} ${时}:${分}:${秒}`;
  const 农历串 = `${岁干支}${生肖名}年 ${农历月名串(农历.year, 农历.month, 农历.isLeap)}${农历月大小(农历.year, 农历.month, 农历.isLeap)} ${农历日名串(农历.day)}日`;

  行.push(`儒略日：${儒略日(y, mo, d)}   ${儒略日(y, mo, d) - 2451545}`);
  行.push(`公历：${公历串} ${月相名}`);
  行.push(`回历：${回历年串(回历.年, 回历.月, 回历.日)}`);
  行.push(`农历：${农历串}`);
  行.push(
    `${节气.今日 ? `今天${节气.名}` : `${节气.名}已过${补整数(节气.已过)}天`}${节气.今日 ? "★" : ""} ${节日 || "无节日"} 星座：${星座名}`,
  );
  行.push(朝代(y));
  行.push(`四柱：${四柱.年} ${四柱.月} ${四柱.日} ${四柱.时}`);

  for (const { 距, 名 } of 未来节日(y, mo, d)) {
    行.push(`再过${距 + 1}天：${名}`);
  }
  return 行.join("\r\n");
}

function 回历年串(年: number, 月: number, 日: number): string {
  return `${年}年${补两位(月)}月${补两位(日)}日`;
}

function 补整数(n: number): string {
  return Number.isInteger(n) ? String(n) : Math.floor(n).toString();
}

/** 解析「2012年5月20日 / 2012-5-20 / 2012/5/20」类日期，返回 { y, mo, d } 或 null */
function 解析日期(输入: string): { y: number; mo: number; d: number } | null {
  const 文本 = 输入.replace(/^(公历|公元)\s*/g, "").trim();
  let m = 文本.match(/(-?\d+)\s*年\s*(\d{1,2})\s*月\s*(\d{1,2})\s*日?/);
  if (!m) m = 文本.match(/(-?\d+)[-/.](\d{1,2})[-/.](\d{1,2})/);
  if (!m) return null;
  const y = Number(m[1]);
  const mo = Number(m[2]);
  const d = Number(m[3]);
  if (mo < 1 || mo > 12 || d < 1 || d > 31) return null;
  return { y, mo, d };
}

/** 从参数中取出日期文本：兼容结构化参数与中文指令（参数文本/原文） */
function 取日期文本(p: { 日期?: string; 参数文本?: string; 原文?: string }): string {
  return (p.日期 ?? p.参数文本 ?? p.原文 ?? "").trim();
}

void 启动模块({
  name: "calendar",
  version: "0.2.0",
  能力: 能力清单,
  处理器: {
    "calendar.today": () => {
      const now = new Date();
      return {
        结果: 黄历文本(
          now.getFullYear(),
          now.getMonth() + 1,
          now.getDate(),
          now.getHours(),
          now.getMinutes(),
          now.getSeconds(),
        ),
      };
    },
    "calendar.query": (params) => {
      const p = (params ?? {}) as { 日期?: string; 时?: number; 参数文本?: string; 原文?: string };
      const 文本 = 取日期文本(p);
      const 解析 = 解析日期(文本);
      if (!解析) {
        return { 输入: 文本, 结果: "日期格式有误，请使用「2012年5月20日」格式" };
      }
      const 时 = typeof p.时 === "number" ? p.时 : new Date().getHours();
      return { 输入: 文本, 结果: 黄历文本(解析.y, 解析.mo, 解析.d, 时, 0, 0) };
    },
  },
  就绪: () => console.log("[万年历模块] 已接入主控，等待查询请求"),
});
