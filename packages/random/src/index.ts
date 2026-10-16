/**
 * @kugua/random —— 苦瓜统一随机源
 *
 * 复刻参考项目 `Algorithms/MyRandom.cs`：以密码学安全随机（CSPRNG）作为**全平台统一随机数来源**，
 * 供 dice / chatmode / 生成器等模块共用（等价于 C# 里的 `MyRandom` 静态提供器）。
 *
 * 说明：按项目所有者要求，使用比原实现更好的随机数生成器（Node `crypto`，无模偏差），
 * 因此不追求与 C# 逐位一致，但分布语义（区间、边界）保持一致：
 *   - `NextInt(min, max)`：返回 [min, max)，min==max 返回 min，min>max 自动交换。
 */

import { randomBytes, randomInt } from "node:crypto";

/** 去掉易混淆字符（0/O/I/l 等）的可打印字符集 */
const 安全字符集 = "ABCDEFGHJKMNPQRSTUVWXYZabcdefghjkmnpqrstuvwxyz23456789";

/** 随机 32 位无符号整数 [0, 2^32) */
export function NextUInt(): number {
  return randomBytes(4).readUInt32LE(0);
}

/** 随机 64 位无符号整数 [0, 2^64) */
export function NextULong(): bigint {
  return randomBytes(8).readBigUInt64LE(0);
}

/**
 * 均匀随机整数。
 * - `NextInt(max)`：返回 [0, max)
 * - `NextInt(min, max)`：返回 [min, max)
 */
export function NextInt(min: number, max?: number): number {
  let lo = min;
  let hi = max;
  if (hi === undefined) {
    hi = min;
    lo = 0;
  }
  lo = Math.ceil(lo);
  hi = Math.floor(hi);
  if (lo === hi) return lo;
  if (lo > hi) [lo, hi] = [hi, lo];
  return randomInt(lo, hi);
}

/** 均匀随机浮点数 [0, 1) */
export function NextDouble(): number {
  return Number(NextULong()) / 18446744073709551616; // 2^64
}

/** 从数组/可迭代对象中随机取一个元素 */
export function Pick<T>(items: readonly T[]): T {
  if (items.length === 0) throw new Error("Pick：数组为空");
  return items[NextInt(items.length)];
}

/** 生成指定长度的随机字符串（安全字符集） */
export function NextString(length: number): string {
  const 长度 = Math.max(Math.floor(length), 0);
  const 字节 = randomBytes(长度);
  let 结果 = "";
  for (let i = 0; i < 长度; i++) 结果 += 安全字符集[字节[i] % 安全字符集.length];
  return 结果;
}

/** 洗牌（Fisher–Yates，返回新数组，不改原数组） */
export function Shuffle<T>(items: readonly T[]): T[] {
  const 结果 = [...items];
  for (let i = 结果.length - 1; i > 0; i--) {
    const j = NextInt(i + 1);
    [结果[i], 结果[j]] = [结果[j], 结果[i]];
  }
  return 结果;
}
