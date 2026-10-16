/**
 * 大整数工具
 * 复刻参考项目 `Algorithms/BigUtil.cs` 中的 Div / DivToString。
 */

/**
 * 十进制位数（floor(log10(n))+1，n=0 视为 1 位）。
 *
 * 必须用对数形式而非字符串长度：C# 的 `(int)Math.Floor(BigInteger.Log10(n) + 1)` 在 10^3 处
 * 存在浮点尾差（Log10(1000) = 2.9999999999999996 → 位数 3），字符串长度会算成 4，
 * 导致 `DivToString(355, 113, 4)` 输出 "3.0141" 而 C# 为 "3.141"（已用 .NET 实测比对）。
 */
function 位数(n: bigint): number {
  if (n === 0n) return 1;
  return Math.floor(Math.log(Number(n < 0n ? -n : n)) / Math.log(10) + 1);
}

/** 大整数带小数除法：返回 整数部分 / 小数部分 / 小数分母 */
export function 大整数除法(value1: bigint, value2: bigint, keepN = 2): {
  intPart: bigint;
  decPart: bigint;
  decUnit: bigint;
} {
  if (keepN <= 0) keepN = 1;
  const 位数2 = Math.min(位数(value2), keepN);
  const delta = 10n ** BigInt(位数2);
  const res = (value1 * delta) / value2;
  const intPart = res / delta;
  const decPart = res - (res / delta) * delta;
  return { intPart, decPart, decUnit: delta };
}

/** 大整数带小数除法，保留 keepN 位小数，返回字符串 */
export function 大整数除法转字符串(value1: bigint, value2: bigint, keepN: number): string {
  const { intPart, decPart, decUnit } = 大整数除法(value1, value2, keepN);
  return `${intPart}.${decPart.toString().padStart(位数(decUnit), "0")}`;
}
