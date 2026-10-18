/**
 * 掷骰模块
 *
 * 严格复刻参考项目 `ModTextFunctions/ModDice.cs`：随机掷骰，支持 `r3d6` 形式与缘由。
 * 随机数使用全平台统一随机源 `@kugua/random`（CSPRNG，见 MyRandom）。
 *
 * 能力声明：dice.roll（中文指令「掷骰」；rNdM 形式由入口层解析后传入）。
 * 启动样板（读配置 / 连主控 / 处理退出）已收敛到 @kugua/module-kit。
 */

import { NextInt } from "@kugua/random";
import { 启动模块 } from "@kugua/module-kit";
import type { 能力声明 } from "@kugua/capability";

const 能力清单: 能力声明[] = [
  {
    名称: "dice.roll",
    模块: "dice",
    标题: "掷骰",
    说明: "掷骰子：r3d6（3 个 6 面骰）、rd50、r3d6 缘由 等",
    中文指令: ["掷骰"],
    参数: {
      type: "object",
      properties: {
        个数: { type: "number", description: "骰子个数，默认 1，上限 100" },
        面数: { type: "number", description: "每颗骰子面数，默认 100" },
        缘由: { type: "string", description: "掷骰缘由" },
        原文: { type: "string", description: "原始指令文本（如 r3d6）" },
      },
    },
    暴露: { 指令: true, GUI: true, 定时: true, MCP: true },
  },
];

/** 复刻 ModDice.getRoll：面数 > 1 时取 [1, 面数]，否则恒为 1 */
export function 掷骰(面数: number, 个数: number): { 总和: number; 描述: string; 明细: number[] } {
  const 明细: number[] = [];
  for (let i = 0; i < 个数; i++) {
    明细.push(面数 > 1 ? NextInt(面数) + 1 : 1);
  }
  const 总和 = 明细.reduce((a, b) => a + b, 0);
  const 描述 = 个数 === 1 ? `${总和}` : `${明细.join("+")} = ${总和}`;
  return { 总和, 描述, 明细 };
}

/** 骰子个数上限（复刻 ModDice：超过 100 就按 100 算） */
export const 个数上限 = 100;
/** 面数缺省值（复刻 ModDice：不填就是 d100） */
export const 默认面数 = 100;

export interface 掷骰参数 {
  个数?: number;
  面数?: number;
  缘由?: string;
  原文?: string;
  参数文本?: string;
  文本?: string;
}

/**
 * 从调用参数里解出掷骰的个数/面数/缘由。
 *
 * 抽出来是为了能测：这段全是边界（`r` 后面不写个数、`d` 后面不写面数、
 * 个数为 0 或负数、面数为 0、超过上限……），而它埋在 `启动模块()` 的
 * 处理器闭包里时一条都测不到——闭包一建就要连主控。
 *
 * 解析优先级：能匹配 `^r(\d*)?d(\d*)?(.*)?$` 就用原文（复刻 C# 正则），
 * 否则用显式字段。
 */
export function 解析参数(参数: unknown): { 个数: number; 面数: number; 缘由: string } {
  const p = (参数 ?? {}) as 掷骰参数;
  let 个数 = typeof p.个数 === "number" ? p.个数 : 1;
  let 面数 = typeof p.面数 === "number" ? p.面数 : 默认面数;
  let 缘由 = p.缘由 ?? "";

  // 复刻 C# 正则 ^r(\d*)?d(\d*)?(.*)?$：优先从原始文本解析
  const 源 = [p.原文, p.参数文本, p.文本].find((s) => typeof s === "string" && s.trim());
  if (源) {
    const m = 源.trim().match(/^r(\d*)?d(\d*)?(.*)?$/i);
    if (m) {
      个数 = m[1] ? Number(m[1]) : 1;
      面数 = m[2] ? Number(m[2]) : 默认面数;
      缘由 = (m[3] ?? "").trim();
    }
  }

  个数 = Math.min(个数, 个数上限);
  if (个数 <= 0) 个数 = 1;
  if (面数 <= 0) 面数 = 默认面数;
  return { 个数, 面数, 缘由 };
}

/**
 * 掷骰并拼出对外的结果载荷。
 *
 * 与 `解析参数` 分开：这里会真的消耗随机数，测试要能用固定序列断言。
 */
export function 掷骰结果(参数: unknown): {
  个数: number;
  面数: number;
  缘由: string;
  明细: number[];
  描述: string;
  总和: number;
  文本: string;
} {
  const { 个数, 面数, 缘由 } = 解析参数(参数);
  const { 总和, 描述, 明细 } = 掷骰(面数, 个数);
  const 缘由文本 = (缘由 ?? "").trim();
  return {
    个数,
    面数,
    缘由,
    明细,
    描述,
    总和,
    文本: `${缘由文本} ${个数}d${面数} = ${描述}`.trim(),
  };
}

void 启动模块({
  name: "dice",
  version: "0.2.0",
  // 被 import 时（测试导入纯函数）不要连主控，直接运行时才启动。
  // 否则一切导入就 spawn 连接、失败就 exit(1)，纯函数根本没法测。
  仅在主模块启动: true,
  入口文件URL: import.meta.url,
  能力: 能力清单,
  处理器: {
    "dice.roll": (params) => 掷骰结果(params),
  },
});
