/** 积分系统类型定义（复刻参考项目 ModBank 的玩家账户与转账记录） */

/** 本地账户 */
export interface 账户 {
  id: string;
  name: string;
  money: number;
  /** 累计签到次数 */
  signTimes: number;
  /** 最近签到时间戳（毫秒），未签过为 null */
  lastSignAt: number | null;
  createdAt: number;
  updatedAt: number;
}

/** 一条资金流水 */
export interface 流水 {
  time: number;
  from: string;
  to: string;
  amount: number;
  reason: string;
  ok: boolean;
  message: string;
}
