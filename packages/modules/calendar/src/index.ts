/**
 * 万年历模块
 * 复刻参考项目 ModCalendar：公历/农历/回历/四柱/节气/生肖/星座/月相/芸历换算
 * 能力：calendar.today（今夕是何年）、calendar.query（指定日期查询）、calendar.yunhua（芸历换算）
 */

import { existsSync, readFileSync } from "node:fs";
import { resolve } from "node:path";
import { NiganeClient } from "@kugua/nigane";
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
  芸历换算,
  儒略日,
} from "./lunar.js";

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
  行.push(`${节气.今日 ? `今天${节气.名}` : `${节气.名}已过${补整数(节气.已过)}天`}${节气.今日 ? "★" : ""} ${节日 || "无节日"} 星座：${星座名}`);
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

/** 解析「2012年5月20日」类日期，返回 { y, mo, d } 或 null */
function 解析日期(输入: string): { y: number; mo: number; d: number } | null {
  const m = 输入.match(/(-?\d+)\s*年\s*(\d{1,2})\s*月\s*(\d{1,2})\s*日?/);
  if (!m) return null;
  const y = Number(m[1]);
  const mo = Number(m[2]);
  const d = Number(m[3]);
  if (mo < 1 || mo > 12 || d < 1 || d > 31) return null;
  return { y, mo, d };
}

async function 启动(): Promise<void> {
  const 配置 = 加载配置();
  const host = 配置.host ?? "127.0.0.1";
  const port = 配置.port ?? 24601;
  const envURL = process.env.NIGANE_URL ?? process.argv[2];
  const envToken = process.env.NIGANE_TOKEN ?? process.argv[3];

  const 客户端 = new NiganeClient({
    name: "calendar",
    url: envURL ?? `ws://${host}:${port}`,
    token: envToken ?? 配置.token ?? "",
    version: "0.1.0",
    capabilities: ["calendar.today", "calendar.query", "calendar.yunhua"],
  });

  客户端.onRequest("calendar.today", (params) => {
    const now = new Date();
    return {
      输入: (params ?? {}) as unknown as Record<string, unknown>,
      结果: 黄历文本(
        now.getFullYear(),
        now.getMonth() + 1,
        now.getDate(),
        now.getHours(),
        now.getMinutes(),
        now.getSeconds()
      ),
    };
  });

  客户端.onRequest("calendar.query", (params) => {
    const { 日期 = "", 时 = new Date().getHours() } = (params ?? {}) as { 日期?: string; 时?: number };
    const 解析 = 解析日期(日期.trim());
    if (!解析) {
      return { 输入: 日期, 结果: "日期格式有误，请使用「2012年5月20日」格式" };
    }
    return { 输入: 日期, 结果: 黄历文本(解析.y, 解析.mo, 解析.d, 时, 0, 0) };
  });

  客户端.onRequest("calendar.yunhua", (params) => {
    const { 模式 = "SE", 年 = 1 } = (params ?? {}) as { 模式?: "SE" | "YY"; 年?: number };
    const 有效模式 = 模式 === "YY" ? "YY" : "SE";
    return { 输入: `${有效模式 === "SE" ? "蒸汽" : "创世"}${年}年`, 结果: 芸历换算(年, 有效模式) };
  });

  await 客户端.connect();
  console.log("[万年历模块] 已接入主控，等待查询请求");

  const 关闭 = (): void => {
    console.log("[万年历模块] 正在关闭……");
    客户端.close();
    process.exit(0);
  };
  客户端.on("shutdown", 关闭);
  process.on("SIGINT", 关闭);
  process.on("SIGTERM", 关闭);
}

启动().catch((err: unknown) => {
  console.error("[万年历模块] 启动失败：", err);
  process.exit(1);
});