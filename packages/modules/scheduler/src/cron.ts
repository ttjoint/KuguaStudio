/**
 * 轻量级 cron 表达式解析与「下次运行时间」计算。
 * 支持 5 段（分 时 日 月 周）与 6 段（秒 分 时 日 月 周）两种格式：
 *   *        任意值
 *   ?        任意值（仅日/周，Quartz 兼容）
 *   5        精确值
 *   a-b      区间
 *   「*」/n  步长（如每 5 分钟：分字段写 * / 5）
 *   a-b/n    区间步长
 *   a,b,c    列表
 *   L        该月最后一天（仅日字段）
 * 周字段：0 与 7 均为周日，1-6 为周一至周六。
 */

export interface 时间字段 {
  最小: number;
  最大: number;
  /** 通配：匹配任意值 */
  通配: boolean;
  取值: Set<number>;
  /** 仅日字段：L 表示该月最后一天 */
  L?: boolean;
}

export interface Cron表达式 {
  /** 6 段格式时存在 */
  秒?: 时间字段;
  分: 时间字段;
  时: 时间字段;
  日: 时间字段;
  月: 时间字段;
  周: 时间字段;
}

export class Cron错误 extends Error {}

function 解析字段(原始: string, 最小: number, 最大: number, 允许L = false): 时间字段 {
  const 结果: 时间字段 = { 最小, 最大, 通配: false, 取值: new Set() };
  for (let 部分 of 原始.split(",")) {
    部分 = 部分.trim();
    if (!部分) throw new Cron错误(`空字段：${原始}`);
    if (部分 === "*" || 部分 === "?") {
      结果.通配 = true;
      for (let v = 最小; v <= 最大; v++) 结果.取值.add(v);
      continue;
    }
    if (允许L && 部分 === "L") {
      结果.L = true;
      continue;
    }
    let 区间文本 = 部分;
    let 步长 = 1;
    const 斜杠 = 部分.indexOf("/");
    if (斜杠 >= 0) {
      区间文本 = 部分.slice(0, 斜杠);
      步长 = Number(部分.slice(斜杠 + 1));
      if (!Number.isInteger(步长) || 步长 <= 0) throw new Cron错误(`非法步长：${部分}`);
    }
    let 起: number;
    let 止: number;
    if (区间文本 === "*" || 区间文本 === "?") {
      起 = 最小;
      止 = 最大;
    } else {
      const 横线 = 区间文本.indexOf("-");
      if (横线 >= 0) {
        起 = Number(区间文本.slice(0, 横线));
        止 = Number(区间文本.slice(横线 + 1));
      } else {
        起 = 止 = Number(区间文本);
      }
      if (!Number.isInteger(起) || !Number.isInteger(止)) throw new Cron错误(`非法数值：${部分}`);
      if (起 < 最小 || 止 > 最大) throw new Cron错误(`越界：${部分}（允许 ${最小}-${最大}）`);
      if (止 < 起) throw new Cron错误(`区间颠倒：${部分}`);
    }
    for (let v = 起; v <= 止; v += 步长) 结果.取值.add(v);
  }
  return 结果;
}

/** 解析 cron 表达式；非法时抛 Cron错误 */
export function 解析Cron(表达式: string): Cron表达式 {
  const 段 = 表达式.trim().split(/\s+/);
  if (段.length !== 5 && 段.length !== 6) {
    throw new Cron错误(`cron 应为 5 或 6 段，实际 ${段.length} 段：${表达式}`);
  }
  const 秒 = 段.length === 6 ? 解析字段(段[0], 0, 59) : undefined;
  const 分 = 解析字段(段[段.length - 5], 0, 59);
  const 时 = 解析字段(段[段.length - 4], 0, 23);
  const 日 = 解析字段(段[段.length - 3], 1, 31, true);
  const 月 = 解析字段(段[段.length - 2], 1, 12);
  const 周 = 解析字段(段[段.length - 1], 0, 7);
  return { 秒, 分, 时, 日, 月, 周 };
}

function 月末日(year: number, month: number): number {
  // month 为 1-12；new Date(year, month, 0) 即该月最后一天
  return new Date(year, month, 0).getDate();
}

function 日匹配(表达式: Cron表达式, d: Date): boolean {
  const dom = 表达式.日.取值.has(d.getDate()) || (表达式.日.L === true && d.getDate() === 月末日(d.getFullYear(), d.getMonth() + 1));
  // 周日有两种写法：0 与 7 都算周日（cron 通例）。
  // 取值集合里可能只有 0 或只有 7，所以两个都要查。
  // 曾经只查 7，导致 `* * * * 0`（最常见的周日写法）永远不匹配。
  const 周码 = d.getDay();
  const dow = 表达式.周.取值.has(周码) || (周码 === 0 && 表达式.周.取值.has(7));
  const dom通配 = 表达式.日.通配 && !表达式.日.L;
  const 周通配 = 表达式.周.通配;
  if (dom通配 && 周通配) return true;
  // 经典 cron 语义：日与周都受限时任一命中即可；仅一方受限时该方必须命中
  if (!dom通配 && !周通配) return dom || dow;
  return dom通配 ? dow : dom;
}

/**
 * 计算从 fromMs 之后的首次运行时间（毫秒时间戳）。
 * 找不到（5 年内无匹配）返回 null。
 */
export function 下次运行(表达式: Cron表达式, fromMs: number): number | null {
  const 期限 = fromMs + 5 * 366 * 24 * 60 * 60 * 1000;
  const 秒级 = Boolean(表达式.秒);
  let 当前: Date;
  if (秒级) {
    当前 = new Date(fromMs + 1000);
  } else {
    当前 = new Date(fromMs);
    当前.setSeconds(0, 0);
    当前.setTime(当前.getTime() + 60000);
  }
  const 起始分钟 = new Date(fromMs);
  起始分钟.setSeconds(0, 0);
  const 起始秒 = Math.floor((fromMs % 60000) / 1000);

  while (当前.getTime() <= 期限) {
    if (表达式.月.取值.has(当前.getMonth() + 1) && 日匹配(表达式, 当前)) {
      if (表达式.时.取值.has(当前.getHours()) && 表达式.分.取值.has(当前.getMinutes())) {
        if (!秒级) {
          return 当前.getTime();
        }
        const 秒列表 = [...表达式.秒!.取值].sort((a, b) => a - b);
        const 首分钟 =
          当前.getHours() === 起始分钟.getHours() && 当前.getMinutes() === 起始分钟.getMinutes();
        const 秒 = 首分钟 ? 秒列表.find((s) => s > 起始秒) : 秒列表[0];
        if (秒 !== undefined) {
          return new Date(当前.getFullYear(), 当前.getMonth(), 当前.getDate(), 当前.getHours(), 当前.getMinutes(), 秒, 0).getTime();
        }
      }
    }
    当前.setTime(当前.getTime() + 60000);
  }
  return null;
}

/** 便捷函数：解析并求下次运行时间；非法表达式时抛 Cron错误 */
export function 解析并求下次(cron: string, fromMs: number): number {
  const 表达式 = 解析Cron(cron);
  const 下次 = 下次运行(表达式, fromMs);
  if (下次 === null) throw new Cron错误(`cron 在 5 年内无匹配：${cron}`);
  return 下次;
}
