/**
 * 信息工具模块
 * 复刻参考项目 ModInfotool 核心功能：
 * 查IP（在线接口）、计算器、URL编/解码、字节换算、进制转换、体脂率
 */

import { existsSync, readFileSync } from "node:fs";
import { resolve } from "node:path";
import { NiganeClient } from "@kugua/nigane";

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

/* ============ 查IP（在线接口）============ */
async function 查IP(ip: string): Promise<string> {
  const url = `https://ip.dnomd343.top/info/${encodeURIComponent(ip.trim())}`;
  const res = await fetch(url, { headers: { "User-Agent": "Mozilla/5.0" } });
  if (!res.ok) return `查询失败：HTTP ${res.status}`;
  const jo = (await res.json()) as { detail?: unknown; loc?: unknown };
  return `IP：${ip.trim()}\n归属：${jo["detail"] ?? "未知"}（${jo["loc"] ?? "未知"}）`;
}

/* ============ 安全表达式求值（四则/幂/括号/负号）============ */
class 表达式求值 {
  private 文本: string;
  private 位置 = 0;
  constructor(文本: string) {
    this.文本 = 文本.replace(/\s+/g, "");
  }
  private 当前(): string {
    return this.文本[this.位置];
  }
  private 吃(): string {
    return this.文本[this.位置++];
  }
  private 解析表达式(): number {
    let 值 = this.解析项();
    while (this.当前() === "+" || this.当前() === "-") {
      const op = this.吃();
      const 右 = this.解析项();
      值 = op === "+" ? 值 + 右 : 值 - 右;
    }
    return 值;
  }
  private 解析项(): number {
    let 值 = this.解析因子();
    while (this.当前() === "*" || this.当前() === "/" || this.当前() === "%") {
      const op = this.吃();
      const 右 = this.解析因子();
      if (op === "*") 值 *= 右;
      else if (op === "/") 值 /= 右;
      else 值 %= 右;
    }
    return 值;
  }
  private 解析因子(): number {
    if (this.当前() === "-") {
      this.吃();
      return -this.解析因子();
    }
    if (this.当前() === "(") {
      this.吃();
      const 值 = this.解析表达式();
      if (this.吃() !== ")") throw new Error("括号不匹配");
      return 值;
    }
    return this.解析数字();
  }
  private 解析数字(): number {
    const 起 = this.位置;
    while (/[0-9.]/.test(this.文本[this.位置] ?? "")) this.位置++;
    if (起 === this.位置) throw new Error(`无法解析字符：${this.当前()}`);
    return Number(this.文本.slice(起, this.位置));
  }
  evaluate(): number {
    const 值 = this.解析表达式();
    if (this.位置 < this.文本.length) throw new Error("存在无法解析的字符");
    return 值;
  }
}

function 计算(expr: string): string {
  if (!expr.trim()) return "";
  try {
    const 值 = new 表达式求值(expr).evaluate();
    return `${expr} = ${Number.isInteger(值) ? 值 : Number(值.toFixed(6))}`;
  } catch (err) {
    return `表达式有误：${(err as Error).message}`;
  }
}

/* ============ URL 编/解码 ============ */
function url解码(data: string): string {
  try {
    return decodeURIComponent(data);
  } catch {
    return data;
  }
}
function url编码(data: string): string {
  return encodeURIComponent(data);
}

/* ============ 字节换算 ============ */
function 字节换算(输入: string): string {
  const m = 输入.match(/^(\d+)\s*([bB])$/);
  if (!m) return "";
  const 值 = BigInt(m[1]);
  const 单位 = m[2];
  const 结果 = [`${值}${单位}`];
  const 档位: Array<[bigint, string]> = [
    [1024n, "K"], [1048576n, "M"], [1073741824n, "G"],
    [1099511627776n, "T"], [1125899906842624n, "P"],
  ];
  for (const [进制, 名] of 档位) {
    if (值 >= 进制) {
      结果.push(`= ${(Number(值) / Number(进制)).toFixed(2)}${名}${单位}`);
    }
  }
  return 结果.join(" ");
}

/* ============ 进制转换 ============ */
function 转十六进制(十进制: string): string {
  const 值 = BigInt(十进制.trim());
  if (值 === 0n) return "";
  return `${十进制}`.padStart(0) + ` = 0x${值.toString(16)}`;
}
function 十六进制转十进制(hex: string): string {
  const 值 = BigInt("0x" + hex.trim());
  if (值 === 0n) return "";
  return `0x${hex} = ${值.toString(10)}`;
}

/* ============ 体脂率（BMI 估算）============ */
function 体脂率(参数: string): string {
  const 段 = 参数.split(/[\s,，]+/).filter((s) => s.length > 0);
  if (段.length < 2) return "体脂需提供身高cm 体重kg [年龄] [性别，0女1男]，如：体脂：170 90 25 1";
  const h = Number(段[0]);
  const w = Number(段[1]);
  const 年龄 = 段.length > 2 ? Number(段[2]) : 30;
  const 是男 = 段.length > 3 && 段[3] === "0" ? false : true;
  const bmi = w / (h / 100) ** 2;
  // 常见体脂估算：男 1.2*BMI+0.23*年龄-5.4-10.8*(0/1)，女对应不同系数
  const 体脂 = 是男
    ? 1.2 * bmi + 0.23 * 年龄 - 16.2
    : 1.2 * bmi + 0.23 * 年龄 - 5.4;
  return `身高${h}cm，体重${w}kg，${年龄}岁的${是男 ? "男" : "女"}性 BMI=${bmi.toFixed(2)}，体脂率约 ${体脂.toFixed(2)}%`;
}

async function 启动(): Promise<void> {
  const 配置 = 加载配置();
  const host = 配置.host ?? "127.0.0.1";
  const port = 配置.port ?? 24601;
  const envURL = process.env.NIGANE_URL ?? process.argv[2];
  const envToken = process.env.NIGANE_TOKEN ?? process.argv[3];

  const 客户端 = new NiganeClient({
    name: "infotool",
    url: envURL ?? `ws://${host}:${port}`,
    token: envToken ?? 配置.token ?? "",
    version: "0.1.0",
    capabilities: [
      "infotool.ip",
      "infotool.calc",
      "infotool.urlDecode",
      "infotool.urlEncode",
      "infotool.byteSize",
      "infotool.toHex",
      "infotool.fromHex",
      "infotool.bodyFat",
    ],
  });

  客户端.onRequest("infotool.ip", async (params) => {
    const { ip = "" } = (params ?? {}) as { ip?: string };
    if (!ip.trim()) return { 输入: ip, 结果: "请提供要查询的 IP" };
    try {
      return { 输入: ip, 结果: await 查IP(ip) };
    } catch (err) {
      return { 输入: ip, 结果: `查询失败：${(err as Error).message}` };
    }
  });

  客户端.onRequest("infotool.calc", (params) => {
    const { 表达式 = "" } = (params ?? {}) as { 表达式?: string };
    return { 输入: 表达式, 结果: 计算(表达式) };
  });

  客户端.onRequest("infotool.urlDecode", (params) => {
    const { 数据 = "" } = (params ?? {}) as { 数据?: string };
    return { 输入: 数据, 结果: url解码(数据) };
  });

  客户端.onRequest("infotool.urlEncode", (params) => {
    const { 数据 = "" } = (params ?? {}) as { 数据?: string };
    return { 输入: 数据, 结果: url编码(数据) };
  });

  客户端.onRequest("infotool.byteSize", (params) => {
    const { 数据 = "" } = (params ?? {}) as { 数据?: string };
    return { 输入: 数据, 结果: 字节换算(数据) };
  });

  客户端.onRequest("infotool.toHex", (params) => {
    const { 数字 = "" } = (params ?? {}) as { 数字?: string };
    return { 输入: 数字, 结果: 转十六进制(数字) };
  });

  客户端.onRequest("infotool.fromHex", (params) => {
    const { 十六进制 = "" } = (params ?? {}) as { 十六进制?: string };
    return { 输入: 十六进制, 结果: 十六进制转十进制(十六进制) };
  });

  客户端.onRequest("infotool.bodyFat", (params) => {
    const { 参数 = "" } = (params ?? {}) as { 参数?: string };
    return { 输入: 参数, 结果: 体脂率(参数) };
  });

  await 客户端.connect();
  console.log("[信息工具模块] 已接入主控，等待请求");

  const 关闭 = (): void => {
    console.log("[信息工具模块] 正在关闭……");
    客户端.close();
    process.exit(0);
  };
  客户端.on("shutdown", 关闭);
  process.on("SIGINT", 关闭);
  process.on("SIGTERM", 关闭);
}

启动().catch((err: unknown) => {
  console.error("[信息工具模块] 启动失败：", err);
  process.exit(1);
});