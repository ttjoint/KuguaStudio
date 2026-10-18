/**
 * 周易占卜模块
 * 严格复刻C#参考项目逻辑实现大衍筮法
 * 数据通过苦音协议从 MKG 读取
 */

import { 启动模块 } from "@kugua/module-kit";
import type { 能力声明 } from "@kugua/capability";
import { NextInt } from "@kugua/random";
import { 读模块资源 } from "@kugua/paths";

/** 能力声明：周易大衍筮法占卜 */
const 能力清单: 能力声明[] = [
  {
    名称: "divination.zhouyi",
    模块: "divination",
    标题: "周易占卜",
    说明: "大衍筮法摇卦（蓍草卜筮），可附缘由",
    中文指令: ["占卜"],
    参数: {
      type: "object",
      properties: { question: { type: "string", description: "占卜缘由（可选）" } },
    },
    暴露: { 指令: true, GUI: true, 定时: false, MCP: true },
  },
];

export const 文王卦序: readonly string[] = [
  "乾", "坤", "屯", "蒙", "需", "讼", "师", "比",
  "小畜", "履", "泰", "否", "同人", "大有", "谦", "豫",
  "随", "蛊", "临", "观", "噬嗑", "贲", "剥", "复",
  "无妄", "大畜", "颐", "大过", "坎", "离", "咸", "恒",
  "遁", "大壮", "晋", "明夷", "家人", "睽", "蹇", "解",
  "损", "益", "夬", "姤", "萃", "升", "困", "井",
  "革", "鼎", "震", "艮", "渐", "归妹", "丰", "旅",
  "巽", "兑", "涣", "节", "中孚", "小过", "既济", "未济"
];

export class 蓍草卜筮 {
  private 全部蓍草: number;
  private 挂出蓍草: number;
  private 揲出蓍草: number;
  private readonly 大衍之数 = 50;

  constructor() {
    this.全部蓍草 = this.大衍之数;
    this.挂出蓍草 = 0;
    this.揲出蓍草 = 0;
  }

  public 卜卦(): number[] {
    return [this.卜爻(), this.卜爻(), this.卜爻(), this.卜爻(), this.卜爻(), this.卜爻()];
  }

  private 卜爻(): number {
    this.全部蓍草 -= 1;
    this.挂出蓍草 += 1;

    this.四营();
    this.四营();
    this.四营();

    const 数 = this.全部蓍草 / 4;
    this.挂出蓍草 += this.全部蓍草;
    this.全部蓍草 = this.挂出蓍草;
    this.挂出蓍草 = 0;
    this.揲出蓍草 = 0;

    return 数;
  }

  private 四营(): void {
    const 划分处 = NextInt(this.全部蓍草);
    let 左 = 划分处;
    let 右 = this.全部蓍草 - 划分处;

    右 -= 1;
    this.挂出蓍草 += 1;

    while (左 > 4) {
      左 -= 4;
      this.揲出蓍草 += 4;
    }
    while (右 > 4) {
      右 -= 4;
      this.揲出蓍草 += 4;
    }

    this.挂出蓍草 += 左;
    this.挂出蓍草 += 右;

    this.全部蓍草 = this.揲出蓍草;
    this.揲出蓍草 = 0;
  }
}

export class 周易占卜 {
  private 卦辞原文: Map<string, string[]> = new Map();
  private 爻辞原文: Map<string, string[][]> = new Map();
  private 卜者: 蓍草卜筮 = new 蓍草卜筮();

  public 初始化(内容: string): void {
    const lines = 内容.split(/\r?\n/);
    let nowGuaNum = "";
    let nowline = 0;

    for (const line of lines) {
      const trimmed = line.trim();
      if (!trimmed) continue;

      nowline += 1;
      if (trimmed.startsWith("0") || trimmed.startsWith("1")) {
        nowGuaNum = trimmed;
        this.卦辞原文.set(nowGuaNum, new Array(7).fill(""));
        this.爻辞原文.set(nowGuaNum, Array.from({ length: 6 }, () => new Array(4).fill("")));
        nowline = 0;
      } else {
        const 卦辞 = this.卦辞原文.get(nowGuaNum);
        const 爻辞 = this.爻辞原文.get(nowGuaNum);
        if (!卦辞 || !爻辞) continue;

        if (nowline === 1) {
          const items = trimmed.split(/\s+/).filter(s => s);
          卦辞[0] = items[0] ?? "";
          卦辞[1] = items[1] ?? "";
          卦辞[2] = items[2] ?? "";
        } else if (nowline === 2) {
          卦辞[3] = trimmed.substring(卦辞[0].length + 1);
        } else if (nowline === 3) {
          卦辞[4] = trimmed.substring(3);
        } else if (nowline === 4) {
          卦辞[5] = trimmed.substring(3);
        } else if (nowline === 5) {
          卦辞[6] = trimmed.substring(3);
        } else if (nowline >= 6) {
          const yaoIdx = Math.floor((nowline - 6) / 4);
          const lineIdx = (nowline - 6) % 4;
          if (yaoIdx < 6 && lineIdx < 4) {
            爻辞[yaoIdx][lineIdx] = trimmed.substring(3);
          }
        }
      }
    }

    this.卜者 = new 蓍草卜筮();
  }

  private static 取Unicode卦象字符(卦名: string): string {
    const idx = 文王卦序.indexOf(卦名);
    return String.fromCodePoint(0x4DC0 + idx);
  }

  private 取卦名(卦象: string): string {
    const 卦辞 = this.卦辞原文.get(卦象);
    if (!卦辞) return "";
    const 卦名 = 卦辞[0];
    return `${周易占卜.取Unicode卦象字符(卦名)}${卦名}`;
  }

  private 取卦辞(卦象: string): string {
    const 卦辞 = this.卦辞原文.get(卦象);
    if (!卦辞) return "";
    return `★${卦辞[3]}\r\n${卦辞[4]}`;
  }

  private 取爻名(num: number, yinyang: string): string {
    if (yinyang === "1") {
      switch (num) {
        case 0: return "初九";
        case 1: return "九二";
        case 2: return "九三";
        case 3: return "九四";
        case 4: return "九五";
        case 5: return "上九";
      }
    } else if (yinyang === "0") {
      switch (num) {
        case 0: return "初六";
        case 1: return "六二";
        case 2: return "六三";
        case 3: return "六四";
        case 4: return "六五";
        case 5: return "上六";
      }
    }
    return "";
  }

  private 取爻辞(卦名: string, 爻数: number): string {
    const 爻辞 = this.爻辞原文.get(卦名);
    if (!爻辞) return "";
    const yinyang = 卦名[爻数];
    return `★${this.取爻名(爻数, yinyang)}，${爻辞[爻数][0]}\r\n${爻辞[爻数][1]}`;
  }

  public 解读卦象(question: string | null): {
    question: string | null;
    本卦: string;
    变卦: string | null;
    爻位: number[];
    解读: string;
  } {
    const 本卦爻 = this.卜者.卜卦();
    let 本卦 = "";
    let 之卦 = "";
    const 不变爻: number[] = [];
    const 变爻: number[] = [];
    const 之卦爻Arr: string[] = [];

    for (let i = 0; i < 6; i++) {
      本卦 += (本卦爻[i] === 6 || 本卦爻[i] === 8) ? "0" : "1";
      if (本卦爻[i] === 6) {
        变爻.push(i);
        之卦爻Arr.push("7");
      } else if (本卦爻[i] === 9) {
        变爻.push(i);
        之卦爻Arr.push("8");
      } else {
        不变爻.push(i);
        之卦爻Arr.push(本卦爻[i].toString());
      }
      之卦 += (之卦爻Arr[i] === "6" || 之卦爻Arr[i] === "8") ? "0" : "1";
    }

    let 解卦描述 = "";
    switch (变爻.length) {
      case 0:
        解卦描述 = `${this.取卦名(本卦)}卦不变\r\n` +
          `${this.取卦辞(本卦)}`;
        break;
      case 1:
        解卦描述 = `${this.取卦名(本卦)}之${this.取卦名(之卦)}\r\n` +
          `变爻：` +
          `${this.取爻名(变爻[0], 本卦[变爻[0]])}\r\n` +
          `${this.取爻辞(本卦, 变爻[0])}`;
        break;
      case 2:
        解卦描述 = `${this.取卦名(本卦)}之${this.取卦名(之卦)}\r\n` +
          `变爻有二：` +
          `${this.取爻名(变爻[0], 本卦[变爻[0]])}、` +
          `${this.取爻名(变爻[1], 本卦[变爻[1]])}\r\n` +
          `${this.取爻辞(本卦, 变爻[0])}\r\n${this.取爻辞(本卦, 变爻[1])}`;
        break;
      case 3:
        解卦描述 = `${this.取卦名(本卦)}之${this.取卦名(之卦)}\r\n` +
          `变爻有三：` +
          `${this.取爻名(变爻[0], 本卦[变爻[0]])}、` +
          `${this.取爻名(变爻[1], 本卦[变爻[1]])}、` +
          `${this.取爻名(变爻[2], 本卦[变爻[2]])}\r\n` +
          `${this.取卦辞(本卦)}\r\n${this.取卦辞(之卦)}`;
        break;
      case 4:
        解卦描述 = `${this.取卦名(本卦)}之${this.取卦名(之卦)}\r\n` +
          `变爻有四：` +
          `${this.取爻名(变爻[0], 本卦[变爻[0]])}、` +
          `${this.取爻名(变爻[1], 本卦[变爻[1]])}、` +
          `${this.取爻名(变爻[2], 本卦[变爻[2]])}、` +
          `${this.取爻名(变爻[3], 本卦[变爻[3]])}\r\n` +
          `${this.取爻辞(之卦, 变爻[0])}\r\n${this.取爻辞(之卦, 变爻[1])}`;
        break;
      case 5:
        解卦描述 = `${this.取卦名(本卦)}之${this.取卦名(之卦)}\r\n` +
          `变爻有五：` +
          `${this.取爻名(变爻[0], 本卦[变爻[0]])}、` +
          `${this.取爻名(变爻[1], 本卦[变爻[1]])}、` +
          `${this.取爻名(变爻[2], 本卦[变爻[2]])}、` +
          `${this.取爻名(变爻[3], 本卦[变爻[3]])}、` +
          `${this.取爻名(变爻[4], 本卦[变爻[4]])}\r\n` +
          `${this.取爻辞(之卦, 变爻[0])}`;
        break;
      case 6:
        解卦描述 = `${this.取卦名(本卦)}\r\n之${this.取卦名(之卦)}，六爻皆变\r\n` +
          `${this.取卦辞(之卦)}`;
        break;
    }

    const 缘由 = question ? `问：${question}\n` : "";

    return {
      question: question ?? null,
      本卦: this.取卦名(本卦),
      变卦: 变爻.length > 0 ? this.取卦名(之卦) : null,
      爻位: 本卦爻,
      解读: `${缘由}${解卦描述}`
    };
  }
}

const 占卜实例 = new 周易占卜();
let 数据已加载 = false;

async function 加载数据(): Promise<void> {
  if (数据已加载) return;
  const 内容 = 读模块资源(import.meta.url, "data_zhouyi.txt");
  占卜实例.初始化(内容);
  数据已加载 = true;
}

void 启动模块({
  name: "divination",
  version: "0.2.0",
  // 被 import 时（测试）不要连主控，直接运行时才启动。
  仅在主模块启动: true,
  入口文件URL: import.meta.url,
  能力: 能力清单,
  处理器: {
    "divination.zhouyi": async (params) => {
      await 加载数据();
      const p = (params ?? {}) as { question?: string; 参数文本?: string; 原文?: string };
      const 缘由 = (p.question ?? p.参数文本 ?? p.原文 ?? "").trim();
      return 占卜实例.解读卦象(缘由 || null);
    },
  },
  就绪: () => console.debug("[占卜模块] 已接入主控，等待占卜请求"),
});
