/**
 * 信息工具模块
 *
 * 复刻参考项目 `ModInfotool`，按功能拆分为多个能力（各自独立 MCP 工具）：
 *   数学换算：calc / byteSize / toHex / fromHex
 *   编码：    urlEncode / urlDecode
 *   网络：    ip（离线 QQWry）/ biliShort（B 站 b23 短链）
 *   健康：    bodyFat（Deurenberg BMI 公式）
 *
 * 按《功能复刻准则》：不做 IM 相关（加群二维码）与已废弃的 IDGenerator。
 */
import { 启动模块 } from "@kugua/module-kit";
import { 模块资源 } from "@kugua/paths";
import { NextString } from "@kugua/random";
import type { 能力声明 } from "@kugua/capability";
import { Calculator } from "./calculator.js";
import { 大整数除法转字符串 } from "./bigutil.js";
import { QQWry } from "./qqwry.js";

/** 能力声明：按功能分组，各自独立 MCP 工具 */
const 能力清单: 能力声明[] = [
  // —— 数学换算 ——
  {
    名称: "infotool.calc",
    模块: "infotool",
    标题: "计算器",
    说明: "数学表达式求值（+ - * / % ^ √ 括号，常量 e/pi），如「1+1=」",
    中文指令: ["计算"],
    参数: { type: "object", properties: { 表达式: { type: "string" } }, required: ["表达式"] },
    暴露: { 指令: true, GUI: true, 定时: false, MCP: true },
  },
  {
    名称: "infotool.byteSize",
    模块: "infotool",
    标题: "字节换算",
    说明: "字节数换算为 K/M/G/T/P，如「1099511627776b」",
    中文指令: ["字节"],
    参数: { type: "object", properties: { 数据: { type: "string" } }, required: ["数据"] },
    暴露: { 指令: true, GUI: true, 定时: false, MCP: true },
  },
  {
    名称: "infotool.toHex",
    模块: "infotool",
    标题: "转十六进制",
    说明: "十进制转十六进制",
    中文指令: ["转十六进制"],
    参数: { type: "object", properties: { 数字: { type: "string" } }, required: ["数字"] },
    暴露: { 指令: true, GUI: true, 定时: false, MCP: true },
  },
  {
    名称: "infotool.fromHex",
    模块: "infotool",
    标题: "十六进制转十进制",
    说明: "十六进制转十进制（如 0x1a）",
    中文指令: ["十六进制转"],
    参数: { type: "object", properties: { 十六进制: { type: "string" } }, required: ["十六进制"] },
    暴露: { 指令: true, GUI: true, 定时: false, MCP: true },
  },
  // —— 编码 ——
  {
    名称: "infotool.urlEncode",
    模块: "infotool",
    标题: "URL 编码",
    说明: "把文本转为 URL 编码（空格→+）",
    中文指令: ["url编码"],
    参数: { type: "object", properties: { 数据: { type: "string" } }, required: ["数据"] },
    暴露: { 指令: true, GUI: true, 定时: false, MCP: true },
  },
  {
    名称: "infotool.urlDecode",
    模块: "infotool",
    标题: "URL 解码",
    说明: "把 URL 编码还原为文本",
    中文指令: ["url解码"],
    参数: { type: "object", properties: { 数据: { type: "string" } }, required: ["数据"] },
    暴露: { 指令: true, GUI: true, 定时: false, MCP: true },
  },
  // —— 网络 ——
  {
    名称: "infotool.ip",
    模块: "infotool",
    标题: "IP 归属查询",
    说明: "离线纯真库（QQWry）查询 IP 归属地",
    中文指令: ["查IP"],
    参数: { type: "object", properties: { ip: { type: "string" } }, required: ["ip"] },
    暴露: { 指令: true, GUI: true, 定时: false, MCP: true },
  },
  {
    名称: "infotool.biliShort",
    模块: "infotool",
    标题: "B 站短链",
    说明: "把 B 站链接转为 b23.tv 短链",
    中文指令: ["缩短"],
    参数: { type: "object", properties: { url: { type: "string" } }, required: ["url"] },
    暴露: { 指令: true, GUI: true, 定时: false, MCP: true },
  },
  // —— 健康 ——
  {
    名称: "infotool.bodyFat",
    模块: "infotool",
    标题: "体脂率",
    说明: "按身高/体重/年龄/性别估算（Deurenberg BMI 公式）",
    中文指令: ["体脂"],
    参数: { type: "object", properties: { 参数: { type: "string" } }, required: ["参数"] },
    暴露: { 指令: true, GUI: true, 定时: false, MCP: true },
  },
];

/** 从参数取文本：兼容结构化与中文指令 */
function 取文本(p: Record<string, unknown>, ...优先: string[]): string {
  for (const k of [...优先, "参数文本", "原文"]) {
    const v = p[k];
    if (typeof v === "string" && v.trim()) return v.trim();
  }
  return "";
}

/* ============ 计算器（复刻 Calculator）============ */
function 计算(表达式: string): string {
  const expr = 表达式.replace(/=\s*$/, "").trim();
  if (!expr) return "";
  try {
    const 值 = new Calculator(expr).Evaluate();
    return `${表达式.includes("=") ? 表达式 : `${表达式}=`}${值}`;
  } catch (err) {
    return `表达式有误：${(err as Error).message}`;
  }
}

/* ============ URL 编码/解码 ============ */
function url编码(数据: string): string {
  return encodeURIComponent(数据).replace(/%20/g, "+");
}

function url解码(数据: string): string {
  try {
    return decodeURIComponent(数据.replace(/\+/g, "%20"));
  } catch {
    return 数据;
  }
}

/* ============ 字节换算（复刻 convertToByteNum + BigUtil）============ */
function 字节换算(输入: string): string {
  const m = 输入.trim().match(/^(\d+)\s*([bB])$/);
  if (!m) return "";
  const 值 = BigInt(m[1]);
  const 单位 = m[2];
  let res = `${值}${单位}`;
  const K = 1024n;
  const M = 1024n * 1024n;
  const G = 1024n * 1024n * 1024n;
  const T = 1099511627776n;
  const P = 1125899906842624n;
  if (值 < M) res += `= ${(Number(值) / 1024).toFixed(2)}K${单位}`;
  if (值 >= M) res += `= ${(Number(值) / Number(M)).toFixed(2)}M${单位}`;
  if (值 >= G) res += `= ${(Number(值) / Number(G)).toFixed(2)}G${单位}`;
  if (值 >= T) res += `= ${大整数除法转字符串(值, T, 2)}T${单位}`;
  if (值 >= P) res += `= ${大整数除法转字符串(值, P, 2)}P${单位}`;
  return res;
}

/* ============ 进制转换 ============ */
function 转十六进制(十进制: string): string {
  const 原 = 十进制.trim();
  const 值 = BigInt(原);
  if (值 === 0n) return "";
  return `${原} = 0x${值.toString(16)}`;
}

function 十六进制转十进制(十六进制: string): string {
  const 原 = 十六进制.trim();
  const 值 = BigInt(原.startsWith("0x") || 原.startsWith("0X") ? 原 : `0x${原}`);
  if (值 === 0n) return "";
  return `${原} = ${值.toString(10)}`;
}

/* ============ 体脂率（复刻 BodyFatCalculator.CalculateByBMI）============ */
function 体脂率(参数: string): string {
  const 段 = 参数.split(/[\s,，]+/).filter((s) => s.length > 0);
  if (段.length < 2) {
    return "体脂需提供身高cm 体重kg [年龄] [性别，0女1男]，如：体脂：170 90 25 1";
  }
  const h = Number(段[0]);
  const w = Number(段[1]);
  if (!(h > 0) || !(w > 0)) return "身高或体重无效";
  const 年龄 = 段.length > 2 ? Number(段[2]) : 30;
  const 是男 = 段.length > 3 && 段[3] === "0" ? false : true;
  const bmi = w / (h / 100) ** 2;
  const 体脂 = 是男 ? 1.2 * bmi + 0.23 * 年龄 - 16.2 : 1.2 * bmi + 0.23 * 年龄 - 5.4;
  // 复刻 C# 输出格式
  return `身高${h}cm，体重${w}kg,${年龄}岁的${是男 ? "男" : "女"}性BMI=${体脂.toFixed(2)}`;
}

/* ============ B 站短链（复刻 BiliShortLinkGenerator）============ */
async function b23短链(longUrl: string): Promise<string> {
  const form = new URLSearchParams({
    build: "6500300",
    buvid: NextString(32) + "infoc",
    oid: longUrl,
    platform: "android",
    share_channel: "COPY",
    share_id: "public.webview.0.0.pv",
    share_mode: "3",
  });
  const res = await fetch("http://api.bilibili.com/x/share/click", {
    method: "POST",
    headers: { "Content-Type": "application/x-www-form-urlencoded" },
    body: form,
    signal: AbortSignal.timeout(9000),
  });
  if (!res.ok) throw new Error(`HTTP ${res.status}`);
  const jo = (await res.json()) as { data?: { content?: string } };
  return jo?.data?.content ?? "";
}

/* ============ 启动 ============ */
void 启动模块({
  name: "infotool",
  version: "0.2.0",
  能力: 能力清单,
  注册: (客户端) => {
    // 离线 IP 库（懒加载）
    let qqwry: QQWry | null = null;
    function 确保IP库(): QQWry {
      if (!qqwry) qqwry = new QQWry(模块资源(import.meta.url, "qqwry.dat"));
      return qqwry;
    }

    客户端.onRequest("infotool.calc", (params) => {
      const p = (params ?? {}) as Record<string, unknown>;
      const 表达式 = 取文本(p, "表达式");
      return { 输入: 表达式, 结果: 计算(表达式) };
    });

    客户端.onRequest("infotool.byteSize", (params) => {
      const p = (params ?? {}) as Record<string, unknown>;
      const 数据 = 取文本(p, "数据");
      return { 输入: 数据, 结果: 字节换算(数据) };
    });

    客户端.onRequest("infotool.toHex", (params) => {
      const p = (params ?? {}) as Record<string, unknown>;
      const 数字 = 取文本(p, "数字");
      try {
        return { 输入: 数字, 结果: 转十六进制(数字) };
      } catch {
        return { 输入: 数字, 结果: "" };
      }
    });

    客户端.onRequest("infotool.fromHex", (params) => {
      const p = (params ?? {}) as Record<string, unknown>;
      const 十六进制 = 取文本(p, "十六进制");
      try {
        return { 输入: 十六进制, 结果: 十六进制转十进制(十六进制) };
      } catch {
        return { 输入: 十六进制, 结果: "" };
      }
    });

    客户端.onRequest("infotool.urlEncode", (params) => {
      const p = (params ?? {}) as Record<string, unknown>;
      const 数据 = 取文本(p, "数据");
      return { 输入: 数据, 结果: 数据 ? url编码(数据) : "" };
    });

    客户端.onRequest("infotool.urlDecode", (params) => {
      const p = (params ?? {}) as Record<string, unknown>;
      const 数据 = 取文本(p, "数据");
      return { 输入: 数据, 结果: 数据 ? url解码(数据) : "" };
    });

    客户端.onRequest("infotool.ip", (params) => {
      const p = (params ?? {}) as Record<string, unknown>;
      const ip = 取文本(p, "ip");
      if (!ip) return { 输入: ip, 结果: "请提供要查询的 IP" };
      try {
        const [info0, info1, desp] = 确保IP库().find_info(ip);
        const 结果 =
          [info0, info1, desp].filter((s) => s && s.trim()).join(" / ") || "未找到该 IP 的记录";
        return { 输入: ip, 结果 };
      } catch (err) {
        return { 输入: ip, 结果: `查询失败：${(err as Error).message}` };
      }
    });

    客户端.onRequest("infotool.biliShort", async (params) => {
      const p = (params ?? {}) as Record<string, unknown>;
      const url = 取文本(p, "url");
      if (!url) return { 输入: url, 结果: "" };
      try {
        return { 输入: url, 结果: await b23短链(url) };
      } catch (err) {
        return { 输入: url, 结果: `生成失败：${(err as Error).message}` };
      }
    });

    客户端.onRequest("infotool.bodyFat", (params) => {
      const p = (params ?? {}) as Record<string, unknown>;
      const 参数 = 取文本(p, "参数");
      return { 输入: 参数, 结果: 体脂率(参数) };
    });
  },
  就绪: () => console.debug("[信息工具模块] 已接入主控，等待请求"),
});
