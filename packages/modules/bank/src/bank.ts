/**
 * 银行核心：账户、签到低保、转账、充值、捐款、排行榜与流水。
 * 与网络解耦，逻辑复刻参考项目 ModBank。
 */

import type { 银行存储 } from "./store.js";
import type { 账户, 流水 } from "./types.js";

export const 系统账户 = "bank";

function 取整(n: number): number {
  return Math.floor(n * 100) / 100;
}

export class 银行 {
  private 账户表 = new Map<string, 账户>();
  private 流水列表: 流水[] = [];

  constructor(
    private 存储: 银行存储,
    private 单位 = "马币",
  ) {}

  load(): void {
    const 数据 = this.存储.load();
    for (const a of 数据.账户) this.账户表.set(a.id, a);
    this.流水列表 = 数据.流水.slice(-500);
  }

  getOrCreate(id: string, name?: string): 账户 {
    const 已有 = this.账户表.get(id);
    if (已有) {
      if (name && 已有.name !== name) {
        已有.name = name;
        已有.updatedAt = Date.now();
        this.保存();
      }
      return 已有;
    }
    const 现在 = Date.now();
    const 账户: 账户 = {
      id,
      name: name?.trim() || id,
      money: 0,
      signTimes: 0,
      lastSignAt: null,
      createdAt: 现在,
      updatedAt: 现在,
    };
    this.账户表.set(id, 账户);
    this.保存();
    return 账户;
  }

  /** 查询账户；不存在则返回 null */
  查询(id: string): 账户 | null {
    return this.账户表.get(id) ?? null;
  }

  /** 每日签到低保（复刻 DailyAttendance：低保金额与余额挂钩） */
  签到(id: string, name?: string): { 账户: 账户; reward: number; message: string } {
    const 账户 = this.getOrCreate(id, name);
    const 今天 = new Date();
    今天.setHours(0, 0, 0, 0);
    if (账户.lastSignAt !== null && 账户.lastSignAt >= 今天.getTime()) {
      return { 账户, reward: 0, message: `今天已经签过到了（${new Date(账户.lastSignAt).toLocaleTimeString()}）` };
    }
    const max = Math.max(1000, 取整(账户.money / 25));
    const min = Math.max(1, 取整(账户.money / 50));
    const reward = 取整(min + Math.random() * (max - min));
    账户.money = 取整(账户.money + reward);
    账户.signTimes += 1;
    账户.lastSignAt = Date.now();
    账户.updatedAt = Date.now();
    this.记流水(系统账户, id, reward, "签到低保", true, "签到");
    this.保存();
    return {
      账户,
      reward,
      message: `签到成功，领取低保 ${reward}${this.单位}，当前余额 ${账户.money}${this.单位}`,
    };
  }

  /** 转账（复刻 TransMoney）：余额不足拒绝；系统账户可透支 */
  转账(from: string, to: string, amount: number, reason = ""): { ok: boolean; message: string; 账户?: 账户 } {
    if (!Number.isFinite(amount) || amount <= 0) {
      return { ok: false, message: "转账金额必须为正数" };
    }
    const 甲 = this.getOrCreate(from);
    const 乙 = this.getOrCreate(to);
    const 金额 = 取整(amount);
    if (from !== 系统账户 && 甲.money < 金额) {
      this.记流水(from, to, 金额, reason, false, "余额不足");
      return { ok: false, message: `余额不足，当前余额 ${甲.money}${this.单位}` };
    }
    甲.money = 取整(甲.money - 金额);
    乙.money = 取整(乙.money + 金额);
    甲.updatedAt = Date.now();
    乙.updatedAt = Date.now();
    this.记流水(from, to, 金额, reason, true, "转账成功");
    this.保存();
    return {
      ok: true,
      message: `向 ${to} 转了 ${金额}${this.单位}，你的余额 ${甲.money}${this.单位}，对方余额 ${乙.money}${this.单位}`,
      账户: 甲,
    };
  }

  /** 充值/发币（复刻 AddMoney，参考项目限管理员） */
  充值(id: string, amount: number, name?: string, reason = "发币"): { ok: boolean; message: string; 账户: 账户 } {
    if (!Number.isFinite(amount) || amount <= 0) {
      throw new Error("充值金额必须为正数");
    }
    const 账户 = this.getOrCreate(id, name);
    账户.money = 取整(账户.money + amount);
    账户.updatedAt = Date.now();
    this.记流水(系统账户, id, amount, reason, true, "充值成功");
    this.保存();
    return { ok: true, message: `账户 ${id} 到账 ${amount}${this.单位}，余额 ${账户.money}${this.单位}`, 账户 };
  }

  /** 捐款给系统（复刻 Donate） */
  捐款(id: string, amount: number): { ok: boolean; message: string; 账户?: 账户 } {
    const 账户 = this.getOrCreate(id);
    const 金额 = Math.min(取整(amount), 账户.money);
    if (金额 <= 0) {
      return { ok: true, message: "虽然你身无分文，但我知道你是个好人", 账户 };
    }
    return this.转账(id, 系统账户, 金额, "捐款");
  }

  /** 排行榜（复刻 showRichest / showPoorest） */
  排行(order: "rich" | "poor" = "rich", limit = 10): 账户[] {
    const 列表 = [...this.账户表.values()].sort((a, b) =>
      order === "rich" ? b.money - a.money : a.money - b.money,
    );
    return 列表.slice(0, Math.max(1, Math.min(limit, 50)));
  }

  /** 流水查询（可按账户过滤） */
  流水(id?: string, limit = 50): 流水[] {
    const 列表 = id ? this.流水列表.filter((l) => l.from === id || l.to === id) : [...this.流水列表];
    return 列表.slice(-Math.max(1, Math.min(limit, 500))).reverse();
  }

  status(): { unit: string; accountCount: number; totalMoney: number } {
    let total = 0;
    for (const a of this.账户表.values()) total += a.money;
    return { unit: this.单位, accountCount: this.账户表.size, totalMoney: 取整(total) };
  }

  private 记流水(from: string, to: string, amount: number, reason: string, ok: boolean, message: string): void {
    this.流水列表.push({ time: Date.now(), from, to, amount, reason: reason || "—", ok, message });
    if (this.流水列表.length > 500) this.流水列表.shift();
  }

  private 保存(): void {
    this.存储.save([...this.账户表.values()], this.流水列表);
  }
}
