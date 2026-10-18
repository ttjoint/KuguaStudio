/**
 * 今天吃什么模块
 * 严格复刻C# EatText逻辑，使用DScript引擎
 * 数据通过苦音协议从 MKG 读取，不直接访问文件系统
 */

import { 启动模块 } from "@kugua/module-kit";
import type { 能力声明 } from "@kugua/capability";
import { 读模块资源 } from "@kugua/paths";
import { DScriptFile, DValue } from "@kugua/dscript";

function 人称互换(文本: string): string {
  return 文本
    .replace(/我/g, "【W】")
    .replace(/你/g, "我")
    .replace(/【W】/g, "你");
}

/** 能力声明：今天吃什么 */
const 能力清单: 能力声明[] = [
  {
    名称: "food.recommend",
    模块: "food",
    标题: "今天吃什么",
    说明: "随机推荐吃什么（可带时间/动词，如「晚上喝什么」）",
    中文指令: ["吃什么"],
    参数: {
      type: "object",
      properties: {
        time: { type: "string", description: "时间，如 今天/晚上" },
        verb: { type: "string", description: "动词，如 吃/喝" },
      },
    },
    暴露: { 指令: true, GUI: true, 定时: false, MCP: true },
  },
];

let 脚本缓存: DScriptFile | null = null;

async function 加载数据(): Promise<DScriptFile> {
  if (脚本缓存) return 脚本缓存;
  const 内容 = 读模块资源(import.meta.url, "data_eat.txt");
  const 脚本 = new DScriptFile();
  脚本.Load(内容);
  脚本缓存 = 脚本;
  return 脚本;
}

function EatText(time: string, verb: string): string {
  const 脚本 = 脚本缓存!;
  let 结果 = 脚本.GetResult(null, [
    new DValue("【time】", [time]),
    new DValue("【verb】", [verb]),
  ]);
  结果 = 人称互换(结果);
  if (结果.includes("【")) {
    return "";
  }
  return 结果;
}

void 启动模块({
  name: "food",
  version: "0.2.0",
  能力: 能力清单,
  处理器: {
    "food.recommend": async (params) => {
      await 加载数据();
      const p = (params ?? {}) as { time?: string; verb?: string; 参数文本?: string; 原文?: string };
      let time = p.time ?? "今天";
      let verb = p.verb ?? "吃";
      // 复刻 C# 正则 ^(.*)(.{1})什么$：如「晚上喝什么」
      const 文本 = (p.参数文本 ?? p.原文 ?? "").trim();
      const m = 文本.match(/^(.*)(.{1})什么$/);
      if (m) {
        time = m[1].trim() || "今天";
        verb = m[2];
      }
      const 推荐 = EatText(time, verb);
      return { time, verb, 推荐 };
    },
  },
  就绪: () => console.debug("[吃什么模块] 已接入主控，等待推荐请求"),
});
