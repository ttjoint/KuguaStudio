/**
 * 解梦模块
 * 严格复刻C# DreamText逻辑，使用DScript引擎
 * 数据通过苦音协议从 MKG 读取，不直接访问文件系统
 */

import { 启动模块 } from "@kugua/module-kit";
import type { 能力声明 } from "@kugua/capability";
import { 读模块资源 } from "@kugua/paths";
import { DScriptFile, DValue } from "@kugua/dscript";

/** 能力声明：解梦 */
const 能力清单: 能力声明[] = [
  {
    名称: "dream.interpret",
    模块: "dream",
    标题: "解梦",
    说明: "根据关键词解梦（解梦/梦到/梦见 X）",
    中文指令: ["解梦", "梦到", "梦见"],
    参数: { type: "object", properties: { keyword: { type: "string" } } },
    暴露: { 指令: true, GUI: true, 定时: false, MCP: true },
  },
];

let 脚本缓存: DScriptFile | null = null;

async function 加载数据(): Promise<DScriptFile> {
  if (脚本缓存) return 脚本缓存;
  const 内容 = 读模块资源(import.meta.url, "data_dream.txt");
  const 脚本 = new DScriptFile();
  脚本.Load(内容);
  脚本缓存 = 脚本;
  return 脚本;
}

function DreamText(keyword: string): string {
  const 脚本 = 脚本缓存!;
  const 结果 = 脚本.GetResult(null, [new DValue("【key】", [keyword])]);
  if (结果.includes("【")) {
    return "我不知道";
  }
  return 结果;
}

void 启动模块({
  name: "dream",
  version: "0.2.0",
  能力: 能力清单,
  处理器: {
    "dream.interpret": async (params) => {
      await 加载数据();
      const p = (params ?? {}) as { keyword?: string; 参数文本?: string; 原文?: string };
      // 复刻 C# 正则 ^(解梦|梦到|梦见)(.+)$
      let keyword = p.keyword ?? "";
      if (!keyword) {
        const 文本 = (p.参数文本 ?? p.原文 ?? "").trim();
        const m = 文本.match(/^(?:解梦|梦到|梦见)\s*(.+)$/);
        keyword = m ? m[1].trim() : 文本;
      }
      const 解读 = DreamText(keyword);
      return { keyword, 解读 };
    },
  },
  就绪: () => console.log("[解梦模块] 已接入主控，等待解梦请求"),
});
