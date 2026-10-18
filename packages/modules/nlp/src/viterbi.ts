/**
 * 维特比模型（拼音首字母 → 汉字句）
 *
 * 严格复刻参考项目 `Algorithms/Generators/ViterbiModel.cs`。
 * 概率在转移/发射时乘以随机扰动（原 C# 用 `Random.Next(10,100)`），
 * 此处改用统一随机源 `@kugua/random`。
 */

import { readFileSync } from "node:fs";
import { NextInt } from "@kugua/random";

/** 拼音提供者：给出单字的完整拼音（用于取首字母判断相关性） */
export interface 拼音提供者 {
  单字拼音: (字符: string) => string;
}

export class ViterbiModel {
  private 起始概率 = new Map<string, number>();
  private 转移概率 = new Map<string, Map<string, number>>();
  private 发射概率 = new Map<string, Map<string, number>>();
  private 状态: string[] = [];
  private readonly 空状态 = "\0";

  constructor(private 拼音: 拼音提供者) {}

  /** 把「拼音首字母序列」还原为最可能的汉字句（非字母部分原样保留） */
  GetSamePinyinSentnse(inputSequence: string): string {
    let output = "";
    if (!inputSequence || !inputSequence.trim()) return output;

    let beginIndex = 0;
    let endIndex = -1;
    for (let i = 0; i < inputSequence.length; i++) {
      const c = inputSequence[i];
      if (c >= "a" && c <= "z") {
        endIndex = i;
      } else {
        if (endIndex >= beginIndex) {
          output += this.ViterbiFirstPinyin(inputSequence.substring(beginIndex, endIndex + 1));
        }
        output += c;
        beginIndex = i + 1;
      }
    }
    if (endIndex >= beginIndex) output += this.ViterbiFirstPinyin(inputSequence.substring(beginIndex));
    return output;
  }

  /** 得到首字母序列推算的汉字 */
  private ViterbiFirstPinyin(inputSequence: string): string {
    const observations = [...inputSequence];
    const n = observations.length;
    if (n === 0) return "";

    const dp: Array<Map<string, number>> = Array.from({ length: n }, () => new Map());
    const path: Array<Map<string, string>> = Array.from({ length: n }, () => new Map());

    for (const state of this.状态.filter((s) => this.是否相关(s, observations[0]))) {
      const startProbability = this.起始概率.get(state);
      dp[0].set(state, startProbability !== undefined ? startProbability * this.发射概率值(state, observations[0]) : 0);
      path[0].set(state, this.空状态);
    }

    for (let i = 1; i < n; i++) {
      const relevantStates = this.状态.filter((s) => this.是否相关(s, observations[i]));
      for (const state of relevantStates) {
        let maxProb = -Infinity;
        let maxState = this.空状态;
        for (const prevState of dp[i - 1].keys()) {
          const prob =
            dp[i - 1].get(prevState)! *
            this.转移概率值(prevState, state) *
            this.发射概率值(state, observations[i]);
          if (prob > maxProb) {
            maxProb = prob;
            maxState = prevState;
          }
        }
        if (maxState !== this.空状态) {
          dp[i].set(state, maxProb);
          path[i].set(state, maxState);
        }
      }
    }

    let finalMax = -Infinity;
    let bestState = this.空状态;
    for (const [state, p] of dp[n - 1]) {
      if (p > finalMax) {
        finalMax = p;
        bestState = state;
      }
    }

    const bestPath: string[] = [];
    for (let i = n - 1; i >= 0; i--) {
      bestPath.push(bestState);
      const prev = path[i].get(bestState);
      bestState = prev ?? this.空状态;
      if (bestState === this.空状态) break;
    }
    bestPath.reverse();
    return bestPath.join("");
  }

  /** 状态能否生成所观测的值（剪枝） */
  private 是否相关(state: string, observation: string): boolean {
    if (!state || !state.trim() || !observation || !observation.trim()) return false;
    const a = this.拼音.单字拼音(state[0]);
    if (!a || !a.trim()) return false;
    return a[0] === observation[0];
  }

  private 发射概率值(state: string, observation: string): number {
    const m = this.发射概率.get(state);
    if (m) {
      const p = m.get(observation);
      if (p !== undefined) return p * NextInt(10, 100);
    }
    return 0.00001 * NextInt(1, 100);
  }

  private 转移概率值(fromState: string, toState: string): number {
    const m = this.转移概率.get(fromState);
    if (m) {
      const p = m.get(toState);
      if (p !== undefined) return p * NextInt(10, 100);
    }
    return 0.00001 * NextInt(1, 100);
  }

  /** 从文件加载模型（StartProb / TransProb / EmitProb 三段，制表符分隔） */
  LoadModel(filePath: string): boolean {
    // 文件缺失时返回 false 而不是让 readFileSync 抛 ENOENT。
    // 签名写的是 boolean，调用方 `if (!模型.LoadModel(...))` 也按 boolean 处理，
    // 抛异常会让那个判断形同虚设——错误在更外层以完全无关的样子爆出来。
    let 文本: string;
    try {
      文本 = readFileSync(filePath, "utf-8").replace(/^\uFEFF/, "");
    } catch {
      return false;
    }
    let section = "";
    for (const raw of 文本.split(/\r?\n/)) {
      const line = raw.trim();
      if (line === "StartProb") {
        section = "StartProb";
      } else if (line === "TransProb") {
        section = "TransProb";
      } else if (line === "EmitProb") {
        section = "EmitProb";
      } else {
        const parts = line.split("\t");
        if (section === "StartProb" && parts.length === 2) {
          this.起始概率.set(parts[0], Number(parts[1]));
        } else if (section === "TransProb" && parts.length === 3) {
          let m = this.转移概率.get(parts[0]);
          if (!m) {
            m = new Map();
            this.转移概率.set(parts[0], m);
          }
          m.set(parts[1], Number(parts[2]));
        } else if (section === "EmitProb" && parts.length === 3) {
          let m = this.发射概率.get(parts[0]);
          if (!m) {
            m = new Map();
            this.发射概率.set(parts[0], m);
          }
          m.set(parts[1], Number(parts[2]));
        }
      }
    }
    this.状态 = [...this.起始概率.keys()];
    return true;
  }
}
