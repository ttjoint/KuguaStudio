/**
 * 小组件声明协议（Widget）
 *
 * 插件/模块用「数据结构」告诉平台自己要显示什么，平台用自己的组件库渲染。
 * **插件不说放在哪、多大、什么形状**——那是 GUI 的事（见 docs/小组件设计.md 第四节）。
 *
 * 为什么不用 iframe：N 个 iframe = N 个独立 JS 上下文，尺寸协商要 postMessage
 * 往返，且插件能做任意 DOM 操作就意味着能盖住主界面。
 *
 * 三层 UI 表面：
 *   - 声明式表单（配置）：开关、地址、下拉 —— 表达能力最低
 *   - **小组件（本文件）**：实时数值、曲线、进度
 *   - iframe 自定义页：音色试听、模型下载等复杂交互
 */

/** 小组件类型。新增取值属于破坏性变更——旧平台会拒绝该声明。 */
export type 小组件类型 = "number" | "gauge" | "sparkline";

/**
 * 显著度：只表达相对重要性，**不表达位置**。
 *
 * `primary` = 用户最常看的那一两个数；`secondary` = 细节、偶尔才看。
 * 平台可因屏幕窄而把 primary 也压成窄条——这是建议不是指令。
 */
export type 显著度 = "primary" | "normal" | "secondary";

/** 单个小组件声明 */
export interface 小组件声明 {
  /**
   * 插件内唯一。只允许 `[a-z0-9._-]`，其余字符导致该声明被拒。
   * 全局唯一键 = `${插件名}.${id}`。
   */
  id: string;
  类型: 小组件类型;
  标题: string;
  /**
   * 显著度，默认 `normal`。单插件最多 2 个 `primary`，超出自动降级并记日志。
   *
   * 上限是必要的：所有插件都标 primary，这个词就失去意义了。
   */
  显著度?: 显著度;
  /**
   * 分组：同组的组件平台应摆在一起。不填则等于插件名。
   * 填别的字符串可以与其他插件的组件合并成组。
   */
  分组?: string;
  单位?: string;
  小数位?: number;
  /** gauge / sparkline 的最大值，默认 100 */
  最大?: number;
  /** sparkline 保留的点数，默认 60，上限 300 */
  点数?: number;
  /** gauge 外观建议，默认 ring。**平台可忽略** */
  外观?: "ring" | "bar";
  /** 超过此值变黄 */
  警示?: number;
  /** 超过此值变红 */
  危险?: number;
  /**
   * 多少秒没收到推送就置灰为「无数据」，默认 30，最小 5。
   *
   * 这条不是可选装饰：插件崩了但界面还在显示最后一帧，用户会以为是实时的。
   */
  过期?: number;
}

/** 单插件最多声明多少个小组件（防止一次灌入上百个） */
export const 最多小组件数 = 12;
/** 单插件最多几个 primary */
export const 最多主要小组件 = 2;
/** sparkline 点数上限 */
export const 最多曲线点数 = 300;
/** 推送限流：单插件每秒最多多少次 widget.data */
export const 每秒推送上限 = 20;

/** id 是否合法 */
export function 合法小组件id(id: unknown): id is string {
  return typeof id === "string" && id.length > 0 && id.length <= 64 && /^[a-z0-9._-]+$/.test(id);
}

const 合法类型 = new Set<string>(["number", "gauge", "sparkline"]);
const 合法显著度 = new Set<string>(["primary", "normal", "secondary"]);

/**
 * 校验并归一一条声明。
 *
 * **容错优先**：未知的字段直接丢弃，不报错——插件可能比平台新。
 * 但类型不认识时必须拒绝整条（不能默默当 number 渲染，那会让用户
 * 看到莫名其妙的东西）。
 *
 * @returns 归一后的声明；不可用时返回 `null` 并给出原因
 */
export function 归一小部件声明(
  原始: unknown,
  来源: string,
): { 声明: 小组件声明 } | { 原因: string } {
  if (!原始 || typeof 原始 !== "object") return { 原因: "声明不是对象" };
  const 原 = 原始 as Record<string, unknown>;

  if (!合法小组件id(原.id)) return { 原因: `id 不合法：${String(原.id)}` };
  const 类型 = String(原.类型 ?? 原.type ?? "");
  if (!合法类型.has(类型)) return { 原因: `未知类型：${类型}` };

  const 标题 = String(原.标题 ?? 原.title ?? "").trim();
  if (!标题) return { 原因: "缺少标题" };

  const 显著度原值 = String(原.显著度 ?? 原.prominence ?? "normal");
  const 显著度 = (合法显著度.has(显著度原值) ? 显著度原值 : "normal") as 显著度;

  const 分组原值 = 原.分组 ?? 原.group;
  const 分组 = typeof 分组原值 === "string" && 分组原值.trim() ? 分组原值.trim() : 来源;

  const 数值 = (键中: string, 键英: string): number | undefined => {
    const v = 原[键中] ?? 原[键英];
    return typeof v === "number" && Number.isFinite(v) ? v : undefined;
  };

  const 声明: 小组件声明 = {
    id: 原.id,
    类型: 类型 as 小组件类型,
    标题,
    显著度,
    分组,
  };

  if (typeof 原.单位 === "string" || typeof 原.unit === "string") {
    声明.单位 = String(原.单位 ?? 原.unit);
  }
  const 小数位 = 数值("小数位", "decimals");
  if (小数位 !== undefined) 声明.小数位 = Math.max(0, Math.min(6, Math.round(小数位)));
  const 最大 = 数值("最大", "max");
  if (最大 !== undefined) 声明.最大 = 最大;
  const 点数 = 数值("点数", "points");
  if (点数 !== undefined) 声明.点数 = Math.max(2, Math.min(最多曲线点数, Math.round(点数)));
  const 外观 = String(原.外观 ?? 原.appearance ?? "");
  if (外观 === "ring" || 外观 === "bar") 声明.外观 = 外观;
  const 警示 = 数值("警示", "warn");
  if (警示 !== undefined) 声明.警示 = 警示;
  const 危险 = 数值("危险", "danger");
  if (危险 !== undefined) 声明.危险 = 危险;
  const 过期 = 数值("过期", "stale");
  if (过期 !== undefined) 声明.过期 = Math.max(5, Math.round(过期));

  return { 声明 };
}

/**
 * 归一一个插件的全部声明：截断数量、限制 primary。
 *
 * 超限不静默——返回的 `警告` 会记到日志里，让插件作者自己看到。
 */
export function 归一小部件列表(
  原始: unknown,
  来源: string,
): { 声明: 小组件声明[]; 警告: string[] } {
  const 警告: string[] = [];
  const 列表 = Array.isArray(原始) ? 原始 : [];
  if (列表.length === 0) return { 声明: [], 警告 };

  const 结果: 小组件声明[] = [];
  const 已见 = new Set<string>();
  for (const 项 of 列表) {
    if (结果.length >= 最多小组件数) {
      警告.push(`超过 ${最多小组件数} 个，其余已忽略`);
      break;
    }
    const r = 归一小部件声明(项, 来源);
    if ("原因" in r) {
      警告.push(r.原因);
      continue;
    }
    if (已见.has(r.声明.id)) {
      警告.push(`重复的 id：${r.声明.id}`);
      continue;
    }
    已见.add(r.声明.id);
    结果.push(r.声明);
  }

  // 限制 primary 数量：按声明顺序保留前 N 个，其余降级
  let 主要计数 = 0;
  for (const 项 of 结果) {
    if (项.显著度 !== "primary") continue;
    主要计数 += 1;
    if (主要计数 > 最多主要小组件) {
      项.显著度 = "normal";
      警告.push(`${项.id} 的 primary 超限，已降为 normal`);
    }
  }

  return { 声明: 结果, 警告 };
}

/**
 * 合并「清单声明」与「运行时补声明」。
 *
 * 运行时补声明是给**能力不确定**的插件用的：sysmon 要采 GPU，但机器上不一定
 * 有 N 卡。清单里先声明、取不到就不推送的做法行不通——那会让没显卡的用户
 * 看到一个永远「无数据」的卡片，分不清是「还没采到」还是「这台机器根本没法采」。
 *
 * 合并不是覆盖：清单里固定的 cpu/mem 和运行时才有的 gpu 应该共存。
 * 同 id 时以补声明为准——插件自己更清楚当前能不能提供这一项。
 *
 * 放在协议层而不是 plugins 模块的闭包里，是为了能单测。判断「哪些该留、哪些该被
 * 替换」看着简单，但 id 缺失、类型不符、补声明非数组这些情况都要有确定的处理。
 */
export function 合并小组件声明(静态: unknown, 补: unknown): unknown {
  const 补列 = Array.isArray(补) ? 补 : [];
  if (补列.length === 0) return 静态;
  const 静态列 = Array.isArray(静态) ? 静态 : [];
  const 取id = (项: unknown): string => String((项 as { id?: unknown })?.id ?? "");
  const 补id集 = new Set(补列.map(取id).filter(Boolean));
  // 没 id 的静态项无法判断是否该被替换，原样保留——
  // 归一阶段会把它们整条拒掉，这里不该提前吞掉，否则警告也一起没了。
  return [...静态列.filter((项) => !补id集.has(取id(项))), ...补列];
}
