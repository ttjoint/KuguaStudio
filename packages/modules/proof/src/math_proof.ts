/**
 * MathProof 算法移植
 * 严格复刻 C# MathProof.cs：用给定的一串数字通过加减乘除与乘方，
 * 逆波兰表达式搜索拼凑出目标数字，返回等式链。
 * 随机源改用统一随机源 `@kugua/random`。
 */

import { NextInt } from "@kugua/random";

export class MathProof {
  private tbase: number[] = [];
  private proofres: string[] = [];
  private desired = 0;
  private calculation = 0;

  /** 证明 desired 可以由 baseNumbers 拼凑得到，返回等式链 */
  Proof(desired1: number, baseNumbers: number[]): string[] {
    const proofChain: string[] = [];
    this.desired = desired1;
    if (!baseNumbers || baseNumbers.length <= 0) return proofChain;

    let res = this.GetStrongProofs(this.desired, baseNumbers);
    if (res.length > 0) {
      proofChain.push(res[NextInt(res.length)]);
    } else {
      try {
        this.desired = Math.abs(this.desired);
        let time = 5;
        while (time-- > 0) {
          proofChain.push(String(this.desired).split("").join("+"));
          this.desired = String(this.desired)
            .split("")
            .reduce((a, c) => a + (c.charCodeAt(0) - 48), 0);
          proofChain.push(String(this.desired));
          res = this.GetStrongProofs(this.desired, baseNumbers);
          if (res.length > 0) {
            proofChain.push(this.proofres[NextInt(this.proofres.length)]);
            break;
          } else {
            proofChain.length = 0;
          }
        }
      } catch {
        // 忽略
      }
    }
    return proofChain;
  }

  /** 搜索所有能拼出 desired 的逆波兰表达式路径 */
  GetStrongProofs(inputDesired: number, inputTbase: number[]): string[] {
    this.desired = inputDesired;
    this.proofres = [];
    this.calculation = 0;
    const alltbase = this.getMixed(inputTbase);
    const MAXTRY = 200000;
    for (const t of alltbase) {
      if (this.calculation > MAXTRY || this.proofres.length > 10) break;
      if (t.length <= 1) {
        if (Math.abs(t[0] - this.desired) < 1e-6) this.proofres.push(`${t[0]}\r\n`);
        continue;
      }
      this.tbase = t.map((x) => Number(x));
      const totalLength = t.length + t.length - 1;
      this.Process(0, totalLength);
      this.Process(-1, totalLength);
    }
    return this.proofres;
  }

  /** 生成所有「相邻数字可以拼接」的组合 */
  private *getMixed(inputTbase: number[]): IterableIterator<number[]> {
    if (inputTbase.length <= 1) {
      yield inputTbase;
    } else {
      const r0 = inputTbase[0];
      const r1 = this.getMixed(inputTbase.slice(1));
      for (const r of r1) {
        const cr = this.convert(r0, r[0]);
        if (cr > 0) {
          const rr2 = [cr, ...r.slice(1)];
          yield rr2;
        }
        const rr1 = [r0, ...r];
        yield rr1;
      }
    }
  }

  /** 拼接两个数字（忽略符号） */
  private convert(a: number, b: number): number {
    const aa = String(Math.abs(a));
    const bb = String(Math.abs(b));
    const n = parseInt(aa + bb, 10);
    return Number.isNaN(n) ? -1 : n;
  }

  private Process(firstToken: number, maxLength: number): void {
    const v: number[] = [firstToken];
    this.Put(v, 1, 1, 0, maxLength);
  }

  /** 递归生成逆波兰表达式的所有可能排列 */
  private Put(v: number[], pos: number, numCount: number, symCount: number, length: number): void {
    if (this.proofres.length > 10) return;
    if (pos === length) {
      if (this.CheckExpression(v)) {
        this.PrintRPN(v);
      }
      this.calculation++;
      return;
    }

    const targetNum = Math.floor((length + 1) / 2);
    const targetSym = length - targetNum;

    const canPlaceNumber = numCount < targetNum;
    const canPlaceSymbol = symCount < targetSym && symCount < numCount - 1;

    if (canPlaceNumber) {
      if (pos >= v.length) v.push(0);
      else v[pos] = 0;
      this.Put(v, pos + 1, numCount + 1, symCount, length);
    }

    if (canPlaceSymbol) {
      for (let op = 1; op <= 5; op++) {
        if (pos >= v.length) v.push(op);
        else v[pos] = op;
        this.Put(v, pos + 1, numCount, symCount + 1, length);
      }
    }
  }

  private CheckExpression(seed: number[]): boolean {
    const stack: number[] = [];
    let numIndex = 0;
    for (const token of seed) {
      if (token === 0 || token === -1) {
        if (numIndex >= this.tbase.length) return false;
        const value = token === -1 ? -this.tbase[numIndex++] : this.tbase[numIndex++];
        stack.push(value);
      } else {
        if (stack.length < 2) return false;
        const second = stack.pop()!;
        const first = stack.pop()!;
        if (token === 4 && second === 0) return false;
        if (token === 5 && first < 0 && Math.abs(second - Math.trunc(second)) > 1e-9) return false;
        switch (token) {
          case 1: stack.push(first + second); break;
          case 2: stack.push(first - second); break;
          case 3: stack.push(first * second); break;
          case 4: stack.push(first / second); break;
          case 5: stack.push(Math.pow(first, second)); break;
        }
      }
    }
    return stack.length === 1 && Math.abs(stack[0] - this.desired) < 1e-6;
  }

  private PrintRPN(seed: number[]): void {
    let output = "";
    let numIndex = 0;
    for (const token of seed) {
      switch (token) {
        case -1:
          output += `-${numIndex < this.tbase.length ? Math.trunc(this.tbase[numIndex++]) : 0} `;
          break;
        case 0:
          output += `${numIndex < this.tbase.length ? Math.trunc(this.tbase[numIndex++]) : 0} `;
          break;
        case 1: output += "+ "; break;
        case 2: output += "- "; break;
        case 3: output += "* "; break;
        case 4: output += "/ "; break;
        case 5: output += "^ "; break;
      }
    }
    const rs = this.Translate(output);
    if (rs && rs.trim()) {
      this.proofres.push(`${rs}\r\n`);
    }
  }

  /** 逆波兰表达式 -> 中缀表达式（带括号） */
  private Translate(input: string): string {
    const stack: Array<{ expr: string; sym: string }> = [];
    const symbols = "+-*/^";
    for (let i = 0; i < input.length; i++) {
      const ch = input[i];
      if (ch === " ") continue;
      if (symbols.indexOf(ch) === -1 || (ch === "-" && i + 1 < input.length && input[i + 1] !== " ")) {
        let operand = ch;
        while (i + 1 < input.length && input[i + 1] !== " ") {
          i++;
          operand += input[i];
        }
        stack.push({ expr: operand, sym: " " });
      } else {
        if (stack.length < 2) return "";
        const right = stack.pop()!;
        const left = stack.pop()!;
        const sym = ch;
        let subExpr = "";
        if (this.levelLow(left.sym, sym)) subExpr += `(${left.expr})`;
        else subExpr += left.expr;
        subExpr += sym;
        if (this.levelLow(right.sym, sym)) subExpr += `(${right.expr})`;
        else subExpr += right.expr;
        stack.push({ expr: subExpr, sym });
      }
    }
    return stack.length > 0 ? stack[0].expr : "";
  }

  private levelLow(sym1: string, sym2: string): boolean {
    if (sym1 === " " || sym2 === " ") return false;
    if (sym1 === "+" && sym2 === "-") return true;
    if (sym1 === "-" && sym2 === "-") return true;
    if ((sym1 === "+" || sym1 === "-") && sym2 !== "+" && sym2 !== "-") return true;
    if (sym1 === "*" && sym2 === "/") return true;
    if (sym1 === "/" && (sym2 === "*" || sym2 === "/")) return true;
    if ((sym1 === "*" || sym1 === "/") && sym2 === "^") return true;
    if (sym1 === "^" && sym2 === "^") return true;
    return false;
  }
}