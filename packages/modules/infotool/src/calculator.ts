/**
 * 数学表达式求值
 * 严格复刻参考项目 `Algorithms/Calculator.cs`：
 * 支持 + - * / % ^ √ 括号、一元负号、常量 e 与 pi。
 */

export class Calculator {
  private 表达式: string;
  private 位置 = 0;

  constructor(表达式: string) {
    this.表达式 = 表达式.replace(/ /g, "").replace(/（/g, "(").replace(/）/g, ")");
  }

  Evaluate(): number {
    return this.解析表达式();
  }

  private 取(偏移 = 0): string {
    return this.表达式[this.位置 + 偏移] ?? "";
  }

  private 解析表达式(): number {
    let 结果 = this.解析项();
    while (this.位置 < this.表达式.length) {
      const op = this.表达式[this.位置];
      if (op === "+" || op === "-") {
        this.位置++;
        const 项 = this.解析项();
        结果 = op === "+" ? 结果 + 项 : 结果 - 项;
      } else {
        break;
      }
    }
    return 结果;
  }

  private 解析项(): number {
    let 结果 = this.解析因子();
    while (this.位置 < this.表达式.length) {
      const op = this.表达式[this.位置];
      if (op === "*" || op === "/" || op === "%") {
        this.位置++;
        const 因子 = this.解析因子();
        if (op === "*") 结果 *= 因子;
        else if (op === "/") 结果 /= 因子;
        else 结果 %= 因子;
      } else {
        break;
      }
    }
    return 结果;
  }

  private 解析因子(): number {
    let 结果 = this.解析基础();
    while (this.位置 < this.表达式.length) {
      const op = this.表达式[this.位置];
      if (op === "^") {
        this.位置++;
        const 基 = this.解析基础();
        结果 = Math.pow(结果, 基);
      } else if (op === "√") {
        this.位置++;
        结果 = Math.sqrt(结果);
      } else {
        break;
      }
    }
    return 结果;
  }

  private 解析基础(): number {
    if (this.取() === "(") {
      this.位置++;
      const 结果 = this.解析表达式();
      if (this.取() !== ")") throw new Error("Expected closing parenthesis");
      this.位置++;
      return 结果;
    }
    if (this.取() === "-") {
      this.位置++;
      return -this.解析基础();
    }
    return this.解析数字();
  }

  private 解析数字(): number {
    const 起 = this.位置;
    if (this.取() === "e") {
      this.位置++;
      return Math.E;
    }
    if (this.取() === "p" && this.取(1) === "i") {
      this.位置 += 2;
      return Math.PI;
    }
    while (this.位置 < this.表达式.length && /[0-9.]/.test(this.表达式[this.位置])) {
      this.位置++;
    }
    return Number(this.表达式.substring(起, this.位置));
  }
}
