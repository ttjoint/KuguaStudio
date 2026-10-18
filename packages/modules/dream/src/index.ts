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

/**
 * 从「梦见蛇」这类原文里取出关键词。
 *
 * 复刻 C# 正则 `^(解梦|梦到|梦见)(.+)$`。抽出来是为了能测：
 * 「梦见」后面带不带空格、「解梦」和「梦见」混用、前缀都没有时
 * 整个原文都当关键词——这三条都是静默回落到别的东西。
 */
export function 解析关键词(文本: string): string {
  const 干净 = (文本 ?? "").trim();
  const m = 干净.match(/^(?:解梦|梦到|梦见)\s*(.+)$/);
  return m ? m[1].trim() : 干净;
}

void 启动模块({
  name: "dream",
  version: "0.2.0",
  仅在主模块启动: true,
  入口文件URL: import.meta.url,
  能力: 能力清单,
  处理器: {
    "dream.interpret": async (params) => {
      await 加载数据();
      const p = (params ?? {}) as { keyword?: string; 参数文本?: string; 原文?: string };
      // 复刻 C# 正则 ^(解梦|梦到|梦见)(.+)$
      let keyword = p.keyword ?? "";
      if (!keyword) {
        keyword = 解析关键词(p.参数文本 ?? p.原文 ?? "");
      }
      const 解读 = DreamText(keyword);
      return { keyword, 解读 };
    },
  },
  就绪: () => console.debug("[解梦模块] 已接入主控，等待解梦请求"),
});
