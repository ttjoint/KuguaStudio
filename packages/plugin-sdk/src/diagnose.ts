/**
 * 插件契约失败的诊断助手。
 *
 * 写插件的三类错误**全都只表现成「插件没被扫描到」或「状态: error 一句话」**：
 *
 * 1. 用 CJS 写（`module.exports = ...`）→ 默认导出不是 BasePlugin 子类
 * 2. `定义插件(类, {...})` 少 `description` → `Cannot read properties of undefined (reading 'trim')`
 * 3. 插件目录不在仓库内 → `ERR_MODULE_NOT_FOUND`（import 不到 `@kugua/plugin-sdk`）
 *
 * 这三条对没写过插件的人来说完全不指向原因。本文件负责把「底层错误 + 模块导出形状」
 * 翻译成能照着改的提示。
 */

import type { 插件构造器 } from "./index.js";

/** 插件目录「不在仓库内」时 import 不到 SDK，报错长这样 */
const 模块找不到特征 = ["ERR_MODULE_NOT_FOUND", "Cannot find module", "Cannot find package"];

/**
 * 模块导出物形状描述（用于错误信息）。
 *
 * 只说「不是 BasePlugin 子类」没用——用户需要知道**实际导出了什么**，
 * 才能判断是 `module.exports`（CJS 写错）还是漏了 `export default`。
 */
export function 描述导出(模块: unknown): string {
  if (模块 === null || 模块 === undefined) return "空导出（模块没有导出任何东西）";
  if (typeof 模块 === "function") return "整个模块是一个函数（不是 BasePlugin 子类）";
  const 对象 = 模块 as Record<string, unknown>;
  const 键 = Object.keys(对象);
  if (键.length === 0) return "模块没有具名导出（可能写成了 CJS 的 module.exports）";
  const 默认 = 对象.default;
  const 默认描述 =
    默认 === undefined
      ? "没有 default 导出"
      : typeof 默认 === "function"
        ? "default 是函数但不像插件类（缺 on_load 与 插件元数据）"
        : `default 是 ${typeof 默认}`;
  return `导出键 [${键.join(", ")}]；${默认描述}`;
}

/**
 * 生成「默认导出不是 BasePlugin 子类」的完整诊断。
 *
 * 三条最常见的成因按出现频率排序，全部列出——因为用户通常第一次写插件，
 * 猜错一次就要再跑一轮。
 */
export function 诊断非插件类(插件名: string, 模块: unknown): string {
  return [
    `插件 ${插件名} 的默认导出不是 BasePlugin 子类。`,
    `  实际${描述导出(模块)}。`,
    "  常见成因：",
    "  1. 用了 CommonJS 写法（module.exports = class ...）——插件必须是 ESM，" +
      "要 `export default class XxxPlugin extends BasePlugin {}`",
    "  2. 忘记 `export default`，只写了 `class XxxPlugin extends BasePlugin {}`",
    "  3. 类没有继承 BasePlugin，或者继承的是别的包里的同名类（版本不一致）",
  ].join("\n");
}

/**
 * 生成「`定义插件()` 少字段」的诊断。
 *
 * `定义插件(类, { name, version })` 少 `description` 时会抛
 * `Cannot read properties of undefined (reading 'trim')`——
 * 这个错误一是**指不到 `description`**，二是**指不到 `定义插件` 这一层**。
 *
 * 参数里单独传 `调用点` 是为了在信息里带上文件路径（调用方知道自己是哪个插件）。
 */
export function 诊断元数据缺失(
  原始错误: unknown,
  元数据: Record<string, unknown> | undefined,
  调用点?: string,
): string | null {
  const 文本 = String(原始错误);
  // 只处理「trim of undefined」这一类，其他错误原样返回 null 由调用方处理
  if (!/reading 'trim'|reading "trim"/.test(文本)) return null;

  const 必填 = ["name", "version", "description", "author"] as const;
  const 缺失 = 必填.filter((k) => {
    const 值 = 元数据?.[k];
    return typeof 值 !== "string" || 值.trim() === "";
  });

  const 行 = [
    `插件元数据不完整：缺少或为空的必填字段 ${缺失.map((k) => `\`${k}\``).join("、")}。`,
    "  `定义插件(类, 元数据)` 的四个字段 name / version / description / author 都必须是非空字符串。",
  ];
  if (调用点) 行.push(`  调用位置：${调用点}`);
  if (缺失.includes("description")) {
    行.push("  提示：缺少 `description` 是这一条错误最常见的原因（代码里读它的 `.trim()`）。");
  }
  return 行.join("\n");
}

/** 生成「插件目录不在仓库内」的诊断 */
export function 诊断模块找不到(原始错误: unknown, 目录: string): string | null {
  const 文本 = String(原始错误);
  if (!模块找不到特征.some((f) => 文本.includes(f))) return null;
  return [
    `插件目录 ${目录} 里的入口文件 import 不到依赖。`,
    "  最常见原因：插件目录**不在仓库内**，于是 `@kugua/plugin-sdk` 无法解析。",
    "  插件必须放在仓库内（例如仓库根的 plugins/ 下），或者自己安装该依赖。",
    `  原始错误：${文本}`,
  ].join("\n");
}

/**
 * 汇总：把加载期抛出的原始错误翻成可操作提示。
 *
 * 顺序刻意是「元数据 → 模块找不到 → 非插件类」：
 * 元数据缺失的错误信息最没用（只有一句 trim），优先级最高。
 */
export function 诊断加载错误(
  插件名: string,
  原始错误: unknown,
  上下文: { 模块?: unknown; 目录?: string; 元数据?: Record<string, unknown>; 调用点?: string },
): string {
  // 前两条看**错误内容**决定是否接管；第三条看**错误是不是那句特定的**才接管。
  //
  // 这里踩过一次：原来只判「上下文里有 模块」，于是任何无关错误
  // （语法错误、运行期 throw）都会被改写成「默认导出不是 BasePlugin 子类」，
  // **真正的错误被吞掉了**——比没有诊断更糟。
  const 原文 = String(原始错误);
  const 是插件类错误 = /默认导出不是 BasePlugin 子类/.test(原文);
  return (
    诊断元数据缺失(原始错误, 上下文.元数据, 上下文.调用点) ??
    (上下文.目录 ? 诊断模块找不到(原始错误, 上下文.目录) : null) ??
    (是插件类错误 && 上下文.模块 !== undefined ? 诊断非插件类(插件名, 上下文.模块) : null) ??
    原文
  );
}

/** 供测试与调用方判断：这个导出值看起来像插件类吗 */
export function 像插件类(值: unknown): boolean {
  if (typeof 值 !== "function") return false;
  const 类 = 值 as 插件构造器;
  return 类.prototype?.on_load !== undefined || 类.插件元数据 !== undefined;
}
