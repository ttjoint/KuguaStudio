/**
 * 自然语言模块（谐音）
 *
 * 严格复刻参考项目 `ModNLP`：拼音首字母 + 维特比模型（ViterbiModel）。
 * 用法：`谐音awsl` / `谐音哈哈`
 *
 * 资源（随模块）：assets/pinyin_unicode.txt（汉字→拼音）、assets/model1.txt（模型）。
 */

import { 启动模块 } from "@kugua/module-kit";
import type { 能力声明 } from "@kugua/capability";
import { 模块资源, 读模块资源 } from "@kugua/paths";
import { ViterbiModel } from "./viterbi.js";

/** 能力声明：谐音（独立模块） */
const 能力清单: 能力声明[] = [
  {
    名称: "nlp.xieyin",
    模块: "nlp",
    标题: "谐音",
    说明: "按拼音首字母还原成句，如「谐音awsl」「谐音哈哈」",
    中文指令: ["谐音"],
    参数: { type: "object", properties: { 目标: { type: "string" } } },
    暴露: { 指令: true, GUI: true, 定时: false, MCP: true },
  },
];

// ===== 拼音与模型（懒加载）=====
let 拼音映射: string[] = [];
let 模型: ViterbiModel | null = null;
let 已加载 = false;

/** 复刻 ModNLP.GetPinyinSingle：汉字→完整拼音；字母→i/u/v 变形 */
function 单字拼音(字符: string): string {
  const code = 字符.codePointAt(0) ?? 0;
  if (code >= 0x4e00 && code <= 0x9fff) {
    const index = code - 0x4e00;
    if (index >= 0 && index < 拼音映射.length && 拼音映射[index] && 拼音映射[index].trim()) {
      return 拼音映射[index];
    }
  }
  if (字符 >= "a" && 字符 <= "z")
    return 字符.replace(/i/g, "y").replace(/u/g, "w").replace(/v/g, "w");
  if (字符 >= "A" && 字符 <= "Z") {
    return 字符.toLowerCase().replace(/i/g, "y").replace(/u/g, "w").replace(/v/g, "w");
  }
  return "";
}

function 确保加载(): void {
  if (已加载) return;
  拼音映射 = 读模块资源(import.meta.url, "pinyin_unicode.txt")
    .split(/\r?\n/)
    .map((l) => l.trim());
  模型 = new ViterbiModel({ 单字拼音 });
  const 模型路径 = 模块资源(import.meta.url, "model1.txt");
  if (!模型.LoadModel(模型路径)) {
    throw new Error(`加载 NLP 模型失败：${模型路径}`);
  }
  已加载 = true;
}

/** 复刻 ModNLP.getPinyinFirstList：取首字母序列（非拼音字符原样保留） */
function 拼音首字母串(input: string): string {
  let output = "";
  for (const c of input) {
    const p = 单字拼音(c);
    if (p && p.trim()) output += p[0];
    else output += c;
  }
  return output;
}

void 启动模块({
  name: "nlp",
  version: "0.2.0",
  能力: 能力清单,
  处理器: {
    "nlp.xieyin": (params) => {
      确保加载();
      const p = (params ?? {}) as { 目标?: string; 文本?: string; 参数文本?: string; 原文?: string };
      let 目标 = (p.目标 ?? p.文本 ?? p.参数文本 ?? p.原文 ?? "").trim();
      目标 = 目标.replace(/^谐音\s*/, "").trim();
      if (!目标) return { 目标, 结果: "" };
      const 拼音 = 拼音首字母串(目标);
      if (!拼音.trim()) return { 目标, 拼音, 结果: "" };
      const 结果 = 模型!.GetSamePinyinSentnse(拼音);
      return { 目标, 拼音, 结果 };
    },
  },
  就绪: () => console.debug("[NLP模块] 已接入主控，等待谐音请求"),
});
