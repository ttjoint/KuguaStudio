/**
 * 小组件注册表与布局存储
 *
 * 两件不同的事，分开放：
 *  - **注册表**：插件声明了哪些小组件（运行时，不落盘）
 *  - **布局**：用户希望怎么摆（落盘到 kugua.config.json 的 `widgets` 节）
 *
 * 职责分界（docs/小组件设计.md 第四节）：插件只说内容和显著度，
 * 布局完全由平台决定并持久化，插件读不到也不应该关心。
 */
import { existsSync, readFileSync, writeFileSync } from "node:fs";
import { resolve } from "node:path";
import {
  归一小部件列表,
  type 小组件声明,
} from "@kugua/nigane";

/** 带来源的已注册小组件 */
export interface 已注册小组件 extends 小组件声明 {
  /** 提供它的插件/模块名 */
  来源: string;
  /** 插件当前是否在线 */
  在线: boolean;
  /** 全局唯一键 `${来源}.${id}` */
  键: string;
}

/** 单个小组件的用户覆盖（只存用户改过的项） */
export interface 布局覆盖 {
  /** 隐藏 */
  隐藏?: boolean;
  /** 手动顺序，小的在前 */
  顺序?: number;
  /** 外形：大卡 / 横条 / 窄条 */
  外形?: "大卡" | "横条" | "窄条";
  /** 区域：顶部 / 侧栏 / 状态栏 */
  区域?: "顶部" | "侧栏" | "状态栏";
}

/** 一套布局方案 */
export interface 布局方案 {
  /** 形态预设 */
  展示?: "自动" | "紧凑" | "详细" | "仅状态栏";
  /** 按 `${来源}.${id}` 键的覆盖 */
  覆盖?: Record<string, 布局覆盖>;
}

/** 落盘的 widgets 配置节 */
export interface 小组件配置节 {
  /** 当前方案名 */
  当前方案: string;
  /** 所有方案；至少有一个「默认」 */
  方案: Record<string, 布局方案>;
}

/** 默认方案名 */
export const 默认方案名 = "默认";

const 合法外形 = new Set(["大卡", "横条", "窄条"]);
const 合法区域 = new Set(["顶部", "侧栏", "状态栏"]);
const 合法展示 = new Set(["自动", "紧凑", "详细", "仅状态栏"]);

function 配置路径(): string {
  return resolve(process.cwd(), "kugua.config.json");
}

/** 读取配置文件的原始对象（读不到就返回空对象） */
function 读配置(): Record<string, unknown> {
  const 路径 = 配置路径();
  if (!existsSync(路径)) return {};
  try {
    const 对象 = JSON.parse(readFileSync(路径, "utf-8")) as unknown;
    return 对象 && typeof 对象 === "object" ? (对象 as Record<string, unknown>) : {};
  } catch {
    return {};
  }
}

/** 归一一个覆盖项：未知字段丢弃，非法值忽略 */
function 归一覆盖(原始: unknown): 布局覆盖 {
  if (!原始 || typeof 原始 !== "object") return {};
  const 原 = 原始 as Record<string, unknown>;
  const 结果: 布局覆盖 = {};
  if (typeof 原.隐藏 === "boolean") 结果.隐藏 = 原.隐藏;
  if (typeof 原.顺序 === "number" && Number.isFinite(原.顺序)) 结果.顺序 = Math.round(原.顺序);
  const 外形 = String(原.外形 ?? "");
  if (合法外形.has(外形)) 结果.外形 = 外形 as 布局覆盖["外形"];
  const 区域 = String(原.区域 ?? "");
  if (合法区域.has(区域)) 结果.区域 = 区域 as 布局覆盖["区域"];
  return 结果;
}

/**
 * 归一整个 widgets 节。
 *
 * **容错优先**：配置可能被手改坏，坏的地方按默认值处理，绝不抛错——
 * 否则一个手滑的 JSON 就让界面白屏。
 */
export function 归一配置节(原始: unknown): 小组件配置节 {
  const 空: 小组件配置节 = { 当前方案: 默认方案名, 方案: { [默认方案名]: { 展示: "自动", 覆盖: {} } } };
  if (!原始 || typeof 原始 !== "object") return 空;
  const 原 = 原始 as Record<string, unknown>;

  const 方案原 = 原.方案;
  const 方案: Record<string, 布局方案> = {};
  if (方案原 && typeof 方案原 === "object" && !Array.isArray(方案原)) {
    for (const [名, 值] of Object.entries(方案原 as Record<string, unknown>)) {
      const 关键 = 名.trim();
      if (!关键) continue;
      const 条 = 值 && typeof 值 === "object" ? (值 as Record<string, unknown>) : {};
      const 展示 = String(条.展示 ?? "");
      const 覆盖原 = 条.覆盖;
      const 覆盖: Record<string, 布局覆盖> = {};
      if (覆盖原 && typeof 覆盖原 === "object" && !Array.isArray(覆盖原)) {
        for (const [键, 项] of Object.entries(覆盖原 as Record<string, unknown>)) {
          const 净 = 归一覆盖(项);
          // 空覆盖没有意义，不保留——否则「只存改过的项」会被空对象污染
          if (Object.keys(净).length > 0) 覆盖[键] = 净;
        }
      }
      方案[关键] = {
        展示: (合法展示.has(展示) ? 展示 : "自动") as 布局方案["展示"],
        覆盖,
      };
    }
  }

  // 至少保留一套：方案全没了就补回默认
  if (Object.keys(方案).length === 0) return 空;
  const 当前 = String(原.当前方案 ?? "");
  return {
    当前方案: 当前 && 方案[当前] ? 当前 : Object.keys(方案)[0],
    方案,
  };
}

/** 读取当前小组件配置节 */
export function 读取小组件配置(): 小组件配置节 {
  return 归一配置节(读配置().widgets);
}

/**
 * 写回 widgets 节。
 *
 * **必须透传其它顶层节**（ai / plugins / modules）——这是主控的既定约定：
 * 只读写自己认识的字段，不认识的必须原样写回，否则每次落盘都会
 * 静默抹掉别的模块的配置。
 */
export function 保存小组件配置(节: 小组件配置节): void {
  const 全 = 读配置();
  全.widgets = 节;
  writeFileSync(配置路径(), JSON.stringify(全, null, 2) + "\n", "utf-8");
}

/** 取当前方案的只读快照 */
export function 当前方案(节: 小组件配置节 = 读取小组件配置()): 布局方案 {
  return 节.方案[节.当前方案] ?? { 展示: "自动", 覆盖: {} };
}

// ===== 注册表（运行时） =====

/** 来源 → 该来源声明的小组件 */
const 注册表 = new Map<string, 小组件声明[]>();
/** 来源 → 在线状态 */
const 在线表 = new Map<string, boolean>();
/** 来源 → 声明时的警告 */
const 警告表 = new Map<string, string[]>();

/**
 * 记录一个来源（插件/模块）声明的小组件。
 *
 * 每次加载都会覆盖旧声明——插件升级后小组件集合可能变，不该残留。
 */
export function 注册小组件(来源: string, 原始: unknown): { 数量: number; 警告: string[] } {
  const { 声明, 警告 } = 归一小部件列表(原始, 来源);
  // 警告必须留下来——即使一条声明都没通过，插件作者也得知道为什么。
  // 早期版本在这里把警告一起删了，结果是「什么都不显示，也没任何提示」，
  // 最难查的那种故障。
  if (警告.length > 0) 警告表.set(来源, 警告);
  else 警告表.delete(来源);
  if (声明.length === 0) {
    注册表.delete(来源);
    return { 数量: 0, 警告 };
  }
  注册表.set(来源, 声明);
  return { 数量: 声明.length, 警告 };
}

/** 某个来源下线/卸载时清掉它的小组件 */
export function 注销小组件(来源: string): void {
  注册表.delete(来源);
  警告表.delete(来源);
  在线表.delete(来源);
}

/** 设置来源在线状态（离线时保留声明，界面据此标灰，而不是直接消失） */
export function 设置来源在线(来源: string, 在线: boolean): void {
  在线表.set(来源, 在线);
}

/** 列出全部已注册小组件（带全局键与在线状态） */
export function 列出小组件(): 已注册小组件[] {
  const 结果: 已注册小组件[] = [];
  for (const [来源, 列表] of 注册表) {
    const 在线 = 在线表.get(来源) ?? false;
    for (const 项 of 列表) {
      结果.push({ ...项, 来源, 在线, 键: `${来源}.${项.id}` });
    }
  }
  return 结果;
}

/** 汇总警告（给插件管理页展示） */
export function 列出小组件警告(): Array<{ 来源: string; 警告: string[] }> {
  return Array.from(警告表, ([来源, 警告]) => ({ 来源, 警告 }));
}

/** 清空注册表（测试与平台重启用） */
export function 清空注册表(): void {
  注册表.clear();
  在线表.clear();
  警告表.clear();
}
