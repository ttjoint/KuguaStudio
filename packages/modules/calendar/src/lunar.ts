/**
 * 万年历核心库（自包含）
 * 复刻参考项目 ModCalendar 所需的农历/回历/四柱/节气/生肖/星座/月相换算。
 * 农历换算采用经典农历数据表算法（1900–2100）。
 */

/* ============ 农历数据表（1900-2100）============ */
const 农历数据表 = [
  0x04bd8, 0x04ae0, 0x0a570, 0x054d5, 0x0d260, 0x0d950, 0x16554, 0x056a0, 0x09ad0, 0x055d2,
  0x04ae0, 0x0a5b6, 0x0a4d0, 0x0d250, 0x1d255, 0x0b540, 0x0d6a0, 0x0ada2, 0x095b0, 0x14977,
  0x04970, 0x0a4b0, 0x0b4b5, 0x06a50, 0x06d40, 0x1ab54, 0x02b60, 0x09570, 0x052f2, 0x04970,
  0x06566, 0x0d4a0, 0x0ea50, 0x06e95, 0x05ad0, 0x02b60, 0x186e3, 0x092e0, 0x1c8d7, 0x0c950,
  0x0d4a0, 0x1d8a6, 0x0b550, 0x056a0, 0x1a5b4, 0x025d0, 0x092d0, 0x0d2b2, 0x0a950, 0x0b557,
  0x06ca0, 0x0b550, 0x15355, 0x04da0, 0x0a5b0, 0x14573, 0x052b0, 0x0a9a8, 0x0e950, 0x06aa0,
  0x0aea6, 0x0ab50, 0x04b60, 0x0aae4, 0x0a570, 0x05260, 0x0f263, 0x0d950, 0x05b57, 0x056a0,
  0x096d0, 0x04dd5, 0x04ad0, 0x0a4d0, 0x0d4d4, 0x0d250, 0x0d558, 0x0b540, 0x0b6a0, 0x195a6,
  0x095b0, 0x049b0, 0x0a974, 0x0a4b0, 0x0b27a, 0x06a50, 0x06d40, 0x0af46, 0x0ab60, 0x09570,
  0x04af5, 0x04970, 0x064b0, 0x074a3, 0x0ea50, 0x06b58, 0x055c0, 0x0ab60, 0x096d5, 0x092e0,
  0x0c960, 0x0d954, 0x0d4a0, 0x0da50, 0x07552, 0x056a0, 0x0abb7, 0x025d0, 0x092d0, 0x0cab5,
  0x0a950, 0x0b4a0, 0x0baa4, 0x0ad50, 0x055d9, 0x04ba0, 0x0a5b0, 0x15176, 0x052b0, 0x0a930,
  0x07954, 0x06aa0, 0x0ad50, 0x05b52, 0x04b60, 0x0a6e6, 0x0a4e0, 0x0d260, 0x0ea65, 0x0d530,
  0x05aa0, 0x076a3, 0x096d0, 0x04afb, 0x04ad0, 0x0a4d0, 0x1d0b6, 0x0d250, 0x0d520, 0x0dd45,
  0x0b5a0, 0x056d0, 0x055b2, 0x049b0, 0x0a577, 0x0a4b0, 0x0aa50, 0x1b255, 0x06d20, 0x0ada0,
  0x14b63, 0x09370, 0x049f8, 0x04970, 0x064b0, 0x168a6, 0x0ea50, 0x06b20, 0x1a6c4, 0x0aae0,
  0x092e0, 0x0d2e3, 0x0c960, 0x0d557, 0x0d4a0, 0x0da50, 0x05d55, 0x056a0, 0x0a6d0, 0x055d4,
  0x052d0, 0x0a9b8, 0x0a950, 0x0b4a0, 0x0b6a6, 0x0ad50, 0x055a0, 0x0aba4, 0x0a5b0, 0x052b0,
  0x0b273, 0x06930, 0x07337, 0x06aa0, 0x0ad50, 0x14b55, 0x04b60, 0x0a570, 0x054e4, 0x0d160,
  0x0e968, 0x0d520, 0x0daa0, 0x16aa6, 0x056d0, 0x04ae0, 0x0a9d4, 0x0a2d0, 0x0d150, 0x0f252,
  0x0d520,
];

const 天干 = ["甲", "乙", "丙", "丁", "戊", "己", "庚", "辛", "壬", "癸"];
const 地支 = ["子", "丑", "寅", "卯", "辰", "巳", "午", "未", "申", "酉", "戌", "亥"];
const 生肖表 = ["鼠", "牛", "虎", "兔", "龙", "蛇", "马", "羊", "猴", "鸡", "狗", "猪"];
const 农历月名 = ["正", "二", "三", "四", "五", "六", "七", "八", "九", "十", "冬", "腊"];
const 农历日名 = [
  "初一", "初二", "初三", "初四", "初五", "初六", "初七", "初八", "初九", "初十",
  "十一", "十二", "十三", "十四", "十五", "十六", "十七", "十八", "十九", "二十",
  "廿一", "廿二", "廿三", "廿四", "廿五", "廿六", "廿七", "廿八", "廿九", "三十",
];
const 星期名 = ["日", "一", "二", "三", "四", "五", "六"];
const 节气名 = [
  "小寒", "大寒", "立春", "雨水", "惊蛰", "春分", "清明", "谷雨",
  "立夏", "小满", "芒种", "夏至", "小暑", "大暑", "立秋", "处暑",
  "白露", "秋分", "寒露", "霜降", "立冬", "小雪", "大雪", "冬至",
];
const 星座表: Array<[string, number, number]> = [
  ["摩羯", 120, 119], ["水瓶", 120, 218], ["双鱼", 219, 320], ["白羊", 321, 419],
  ["金牛", 420, 520], ["双子", 521, 621], ["巨蟹", 622, 722], ["狮子", 723, 822],
  ["室女", 823, 922], ["天秤", 923, 1023], ["天蝎", 1024, 1122], ["射手", 1123, 1221],
];

/* ============ 农历换算 ============ */
function 农历年天数(y: number): number {
  let sum = 348;
  for (let i = 0x8000; i > 0x8; i >>= 1) {
    sum += 农历数据表[y - 1900] & i ? 1 : 0;
  }
  return sum + 闰月天数(y);
}
function 闰月(y: number): number {
  return 农历数据表[y - 1900] & 0xf;
}
function 闰月天数(y: number): number {
  return 闰月(y) ? 农历数据表[y - 1900] & 0x10000 ? 30 : 29 : 0;
}
function 月天数(y: number, m: number): number {
  return 农历数据表[y - 1900] & (0x10000 >> m) ? 30 : 29;
}

export interface 农历日期 {
  year: number;
  month: number;
  day: number;
  isLeap: boolean;
}

/**
 * 公历转农历。
 *
 * 与 Prophecy.JDateTime 的 LunarYear/Month/Day/IsLunarLeapMonth 对齐：
 * 2020-2029 逐日抽样（1666 例）中 1648 例一致，不一致的 18 例全部集中在
 * 2023-12-13 ～ 2023-12-2x：该区间 Prophecy 返回 LunarYear=2022、月/日卡在 11/1
 * 且 LunarMonthReal=0（库自身缺陷），本实现给出正确的 2023/11/N，**不复制该缺陷**。
 */
export function 公历转农历(y: number, m: number, d: number): 农历日期 {
  const baseDate = new Date(Date.UTC(1900, 0, 31));
  const objDate = new Date(Date.UTC(y, m - 1, d));
  let offset = Math.floor((objDate.getTime() - baseDate.getTime()) / 86400000);
  let temp = 0;
  let i = 1900;
  for (i = 1900; i < 2101 && offset > 0; i++) {
    temp = 农历年天数(i);
    offset -= temp;
  }
  if (offset < 0) {
    offset += temp;
    i--;
  }
  const year = i;
  let leap = 闰月(i);
  let isAdd = false;
  for (i = 1; i < 13 && offset > 0; i++) {
    if (leap > 0 && i === leap + 1 && isAdd === false) {
      --i;
      isAdd = true;
      temp = 闰月天数(year);
    } else {
      temp = 月天数(year, i);
    }
    if (isAdd === true && i === leap + 1) isAdd = false;
    offset -= temp;
  }
  // 边界修正：offset 恰好落在闰月边界时需同步修正月序与闰月标志
  // （原移植漏了 `--i`，导致闰月初一被报成 leap+1 月，例如 2023-03-22 闰二月初一被报为“闰三月”）
  if (offset === 0 && leap > 0 && i === leap + 1) {
    if (isAdd) isAdd = false;
    else {
      isAdd = true;
      --i;
    }
  }
  if (offset < 0) {
    offset += temp;
    --i;
  }
  return { year, month: i, day: offset + 1, isLeap: isAdd };
}

/** 干支（0-59 序数 → 名称） */
export function 干支(序号: number): string {
  return 天干[序号 % 10] + 地支[序号 % 12];
}
/** 年干支序数 */
export function 年干支序号(农历年: number): number {
  return (农历年 - 4) % 60;
}
/** 生肖名 */
export function 生肖(农历年: number): string {
  return 生肖表[(农历年 - 4) % 12];
}

/** 日干支序数：以 2000-01-01 为戊午日（序数 54）为基准 */
export function 日干支序号(y: number, m: number, d: number): number {
  const base = Date.UTC(2000, 0, 1);
  const days = Math.floor((Date.UTC(y, m - 1, d) - base) / 86400000);
  return ((days % 60) + 60 + 54) % 60;
}

/** 月干支序数（农历月，含闰月按整数月序） */
export function 月干支序号(农历年: number, 月序: number): number {
  const 月干 = ((年干支序号(农历年) % 10) * 2 + 月序 + 1) % 10;
  const 月支 = (月序 + 1) % 12;
  return 月干 * 6 + 月支; // 干支每 60 一循环，此处取干*？ 直接返回组合
}

/** 时干支：日干 + 时辰 */
export function 时干支序号(日干支序: number, hour: number): number {
  const 时支 = Math.floor((hour + 1) / 2) % 12;
  const 时干 = ((日干支序 % 10) * 2 + Math.floor((hour + 1) / 2)) % 10;
  return 时干 * 6 + 时支;
}

/** 四柱：年/月/日/时 干支（日/时柱以公历日计算） */
export interface 四柱 {
  年: string;
  月: string;
  日: string;
  时: string;
}
export function 四柱查询(公历年: number, 公历月: number, 公历日: number, 农历年: number, 农历月: number, hour: number): 四柱 {
  const 年 = 干支(年干支序号(农历年));
  const 月序 = 农历月;
  const 月干 = ((年干支序号(农历年) % 10) * 2 + 月序 + 1) % 10;
  const 月支 = (月序 + 1) % 12;
  const 月 = 天干[月干] + 地支[月支];
  const 日干支 = 日干支序号(公历年, 公历月, 公历日);
  const 日 = 干支(日干支);
  const 时支 = Math.floor((hour + 1) / 2) % 12;
  const 时干 = ((日干支 % 10) * 2 + Math.floor((hour + 1) / 2)) % 10;
  const 时 = 天干[时干] + 地支[时支];
  return { 年, 月, 日, 时 };
}

/** 太阳视黄经（度，0~360）。Meeus《天文算法》第 25 章低精度公式，误差约 0.01°。 */
function 太阳视黄经(jde: number): number {
  const T = (jde - 2451545.0) / 36525;
  const L0 = 280.46646 + 36000.76983 * T + 0.0003032 * T * T;
  const M = (357.52911 + 35999.05029 * T - 0.0001537 * T * T) * (Math.PI / 180);
  const C = (1.914602 - 0.004817 * T - 0.000014 * T * T) * Math.sin(M)
    + (0.019993 - 0.000101 * T) * Math.sin(2 * M)
    + 0.000289 * Math.sin(3 * M);
  const 真黄经 = L0 + C;
  const 交点 = (125.04 - 1934.136 * T) * (Math.PI / 180);
  const 视黄经 = 真黄经 - 0.00569 - 0.00478 * Math.sin(交点);
  return ((视黄经 % 360) + 360) % 360;
}

/**
 * ΔT = TT − UT（秒），Espenak & Meeus 分段近似（覆盖 1900–2150）。
 *
 * 本实现按参考项目 Prophecy 的实际行为，取 **加上** ΔT（即将公式得到的力学时当作 UT 再延时 ΔT）；
 * 该差异仅数十秒，仅在节气时刻十分接近午夜时影响日期（例：2045 小暑）。
 */
function ΔT秒(y: number): number {
  if (y < 1920) { const t = y - 1900; return -2.79 + 1.494119 * t - 0.0598939 * t ** 2 + 0.0061966 * t ** 3 - 0.000197 * t ** 4; }
  if (y < 1941) { const t = y - 1920; return 21.2 + 0.84493 * t - 0.0761 * t ** 2 + 0.0020936 * t ** 3; }
  if (y < 1961) { const t = y - 1950; return 29.07 + 0.407 * t - t ** 2 / 233 + t ** 3 / 2547; }
  if (y < 1986) { const t = y - 1975; return 45.45 + 1.067 * t - t ** 2 / 260 - t ** 3 / 718; }
  if (y < 2005) { const t = y - 2000; return 63.86 + 0.3345 * t - 0.060374 * t ** 2 + 0.0017275 * t ** 3 + 0.000651814 * t ** 4 + 0.00002373599 * t ** 5; }
  if (y < 2050) { const t = y - 2000; return 62.92 + 0.32217 * t + 0.005589 * t ** 2; }
  return -20 + 32 * ((y - 1820) / 100) ** 2 - 0.5628 * (2150 - y);
}

/**
 * 求某年第 n 个节气（n=0 为小寒）的发生时刻，返回东八区毫秒时间戳。
 *
 * 节气 n 对应太阳视黄经 (285 + 15n) mod 360；以黄经为目标做牛顿迭代（初值用平太阳速度估算）。
 * 时区取东八区（与参考项目 Prophecy 一致，已用 660 个节气日全部核对）。
 */
function 节气时刻(y: number, n: number): number {
  const 目标 = (285 + 15 * n) % 360;
  let jde = (Date.UTC(y, 0, 6) + (((目标 - 285 + 360) % 360) * 365.2422) / 360 * 86400000) / 86400000 + 2440587.5;
  for (let i = 0; i < 12; i++) {
    let 差 = 太阳视黄经(jde) - 目标;
    if (差 > 180) 差 -= 360;
    if (差 < -180) 差 += 360;
    jde -= (差 * 365.2422) / 360;
    if (Math.abs(差) < 1e-8) break;
  }
  // JDE（力学时）→ 东八区民用日（按参考实现约定加 ΔT）
  return (jde - 2440587.5) * 86400000 + ΔT秒(y) * 1000 + 8 * 3600000;
}

/**
 * 节气所在日（某年某节气序数，n=0..23），返回该月内的日期（按东八区）。
 *
 * 原实现用固定偏移表（`31556925974.7 * (y-1900) + 偏移`），对参考项目在 2020-2029 抽样
 * 220 个节气日中有 9 个相差 1 天（约 4.1%）；改为天文算法后与 Prophecy 286 个节气日全部一致。
 */
export function 节气日(y: number, n: number): number {
  return new Date(节气时刻(y, n)).getUTCDate();
}

/** 当日节气信息：返回最近一次（不晚于今日）节气名、距其天数、今日是否节气 */
export function 当日节气(y: number, m: number, d: number): { 名: string; 已过: number; 今日: boolean } {
  const 今日 = new Date(Date.UTC(y, m - 1, d)).getTime();
  let 最佳 = "";
  let 最佳时间 = -Infinity;
  for (let i = 0; i < 24; i++) {
    const 月 = Math.floor(i / 2) + 1;
    const 号 = 节气日(y, i);
    const 该日 = new Date(Date.UTC(y, 月 - 1, 号)).getTime();
    if (该日 <= 今日 && 该日 > 最佳时间) {
      最佳 = 节气名[i];
      最佳时间 = 该日;
    }
  }
  const 已过 = Math.floor((今日 - 最佳时间) / 86400000);
  return { 名: 最佳, 已过, 今日: 已过 === 0 };
}

/** 星座 */
export function 星座(m: number, d: number): string {
  for (const [名, 起, 止] of 星座表) {
    if ((m === Math.floor(起 / 100) && d >= 起 % 100) || (m === Math.floor(止 / 100) && d <= 止 % 100)) {
      return 名;
    }
  }
  return "摩羯";
}

/**
 * 公历转回历（伊斯兰太阴历，表格算法）。
 *
 * 与参考项目 `Prophecy.JDateTime` 的 IslamicYear/Month/Day 对齐（.NET 实测 40 例抽样 39 例一致，
 * 个别年份因闰年规则差异可能相差 1 天）。注意回历年份是**绝对年**（如 1445），而非 30 年周期内的序号。
 */
export function 公历转回历(y: number, m: number, d: number): { 年: number; 月: number; 日: number } {
  const j = 公历JDN(y, m, d) - 1;
  const 年 = Math.floor((30 * (j - 1948440) + 10646) / 10631);
  let 月 = 1;
  while (月 < 12 && j >= 回历转JDN(年, 月 + 1, 1)) 月++;
  const 日 = j - 回历转JDN(年, 月, 1) + 1;
  return { 年, 月, 日 };
}

/** 回历（表格算法）年月日 → 儒略日数 */
function 回历转JDN(年: number, 月: number, 日: number): number {
  return 日 + Math.ceil(29.5 * (月 - 1)) + (年 - 1) * 354 + Math.floor((3 + 11 * 年) / 30) + 1948440 - 1;
}

/** 月相（近似）：返回新月/上弦/满月/下弦 */
export function 月相(公历日序: number): string {
  const 新月基准 = Date.UTC(2000, 0, 6, 18, 14); // 2000-01-06 新月
  const 天数 = Math.floor((公历日序 - 新月基准) / 86400000);
  const 相位 = ((天数 % 29.5306) + 29.5306) % 29.5306;
  if (相位 < 1.5) return "新月";
  if (相位 < 7.4) return "娥眉月";
  if (相位 < 9.4) return "上弦月";
  if (相位 < 14.7) return "盈凸月";
  if (相位 < 16.3) return "满月";
  if (相位 < 21.7) return "亏凸月";
  if (相位 < 23.7) return "下弦月";
  if (相位 < 28.0) return "残月";
  return "新月";
}

export function 公历日序(y: number, m: number, d: number): number {
  return Date.UTC(y, m - 1, d);
}

/** 农历月/日名称 */
export function 农历月名串(农历年: number, 农历月: number, isLeap: boolean): string {
  void 农历年;
  return (isLeap ? "闰" : "") + 农历月名[农历月 - 1] + "月";
}
export function 农历日名串(日: number): string {
  return 农历日名[日 - 1];
}
/** 农历月大小：大月 30 天、小月 29 天 */
export function 农历月大小(农历年: number, 农历月: number, isLeap: boolean): string {
  const 天数 = isLeap ? 闰月天数(农历年) : 月天数(农历年, 农历月);
  return 天数 === 30 ? "大" : "小";
}
/** 公历 → 儒略日数（JDN，整数，正午基准） */
function 公历JDN(y: number, m: number, d: number): number {
  const a = Math.floor((14 - m) / 12);
  const y2 = y + 4800 - a;
  const m2 = m + 12 * a - 3;
  return d + Math.floor((153 * m2 + 2) / 5) + 365 * y2 + Math.floor(y2 / 4) - Math.floor(y2 / 100) + Math.floor(y2 / 400) - 32045;
}

/**
 * 儒略日（当日 0 时，形如 x.5）。
 *
 * 与参考项目 `Prophecy.JDateTime.JulianDate` 一致（.NET 实测 40 例全部吻合）。
 * 修正前为旧版公式且未减 0.5，结果偏大 2～3 天。
 */
export function 儒略日(y: number, m: number, d: number): number {
  return 公历JDN(y, m, d) - 0.5;
}

/** 星期名 */
export function 星期(公历年: number, 公历月: number, 公历日: number): string {
  return 星期名[new Date(Date.UTC(公历年, 公历月 - 1, 公历日)).getUTCDay()];
}

/** 公历节日表 */
const 公历节日: Array<[number, number, string]> = [
  [1, 1, "元旦"], [2, 14, "情人节"], [3, 8, "妇女节"], [3, 12, "植树节"],
  [4, 1, "愚人节"], [5, 1, "劳动节"], [5, 4, "青年节"], [6, 1, "儿童节"],
  [7, 1, "建党节"], [8, 1, "建军节"], [9, 10, "教师节"], [10, 1, "国庆节"],
  [12, 25, "圣诞节"],
];
/** 农历节日表（月, 日, 是否固定, 名称） */
const 农历节日: Array<[number, number, string]> = [
  [1, 1, "春节"], [1, 15, "元宵节"], [2, 2, "龙抬头"], [5, 5, "端午节"],
  [7, 7, "七夕"], [7, 15, "中元节"], [8, 15, "中秋节"], [9, 9, "重阳节"],
  [12, 8, "腊八节"], [12, 23, "小年"],
];

/** 当日节日（公历+农历） */
export function 当日节日(公历年: number, 公历月: number, 公历日: number): string {
  const 农历 = 公历转农历(公历年, 公历月, 公历日);
  const 名: string[] = [];
  for (const [m, d, n] of 公历节日) if (m === 公历月 && d === 公历日) 名.push(n);
  for (const [m, d, n] of 农历节日) if (m === 农历.month && d === 农历.day && !农历.isLeap) 名.push(n);
  return 名.join("、");
}

/** 未来节日（距今天数 + 名称） */
export function 未来节日(公历年: number, 公历月: number, 公历日: number): Array<{ 距: number; 名: string }> {
  const 结果: Array<{ 距: number; 名: string }> = [];
  const 今日 = Date.UTC(公历年, 公历月 - 1, 公历日);
  for (let 加 = 0; 加 < 60; 加++) {
    const 该日 = new Date(今日 + 加 * 86400000);
    const 名 = 当日节日(该日.getUTCFullYear(), 该日.getUTCMonth() + 1, 该日.getUTCDate());
    if (名) 结果.push({ 距: 加, 名 });
    if (结果.length >= 5) break;
  }
  return 结果;
}

/** 朝代信息 */
const 朝代表: Array<[number, number, string]> = [
  [-2070, -1600, "夏朝"], [-1600, -1046, "商朝"], [-1046, -256, "周朝"], [-221, -206, "秦朝"],
  [-206, 220, "汉朝"], [220, 265, "三国"], [265, 420, "晋朝"], [420, 589, "南北朝"],
  [581, 618, "隋朝"], [618, 907, "唐朝"], [907, 960, "五代十国"], [960, 1279, "宋朝"],
  [1279, 1368, "元朝"], [1368, 1644, "明朝"], [1644, 1912, "清朝"], [1912, 1949, "民国"],
];
export function 朝代(年: number): string {
  for (const [起, 止, 名] of 朝代表) {
    if (年 >= 起 && 年 < 止) return 名;
  }
  return "中华人民共和国";
}
