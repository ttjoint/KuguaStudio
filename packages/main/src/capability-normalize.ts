/**
 * 能力声明的归一与容错。
 *
 * 外部模块不一定是 TypeScript 写的。Python / Go / Rust 的接入者按自己的
 * 语言习惯写字段是常态（`{"name": "tts.speak"}` 而不是 `{"名称": "..."}`），
 * 协议里又是中文字段名。
 *
 * 早期实现直接 `声明.名称` 取键，`name` 写法的声明会得到 `undefined`，
 * 进而让能力注册表抛错——而这是在**握手回调里**抛的，会把整个主控进程带崩。
 * 一个第三方模块的字段名拼错不该让整个平台挂掉，因此这里做两件事：
 *
 * 1. 归一：`name` / `description` 等常见英文键映射到协议字段名；
 * 2. 容错：单条声明不合法只跳过并告警，绝不向上抛。
 */

import type { 能力声明 } from "@kugua/capability";

/** 常见英文键 → 协议字段名 */
const 别名字典: Record<string, string> = {
  name: "名称",
  description: "说明",
  title: "标题",
  action: "动作",
  params: "参数",
  returns: "返回",
  permissions: "权限",
  expose: "暴露",
  dangerous: "危险",
  long_running: "长任务",
  // 外部模块常用 `exec` 表示「怎么启动这个能力」。
  // 不归一的话 job 侧永远找不到 `执行`，报的是「未声明 执行」——
  // 明明声明了，只是键名不同，这种错误很难自己看出来。
  exec: "执行",
  execute: "执行",
};

/** 把一条能力声明里的英文键换成协议字段名（已是协议名的键原样保留） */
export function 归一能力声明(声明: unknown): Record<string, unknown> {
  if (!声明 || typeof 声明 !== "object") return {};
  const 结果: Record<string, unknown> = {};
  for (const [键, 值] of Object.entries(声明 as Record<string, unknown>)) {
    结果[别名字典[键] ?? 键] = 值;
  }
  return 结果;
}

export interface 能力归一结果 {
  /** 合法声明，键为能力名 */
  合法: Map<string, 能力声明>;
  /** 被跳过的声明及原因（仅用于日志） */
  问题: Array<{ 声明: unknown; 原因: string }>;
}

/**
 * 归一一个模块上报的全部能力声明。
 *
 * 不抛异常——调用方（握手流程）应当只记录告警并继续，
 * 让模块以「能力少了几项」的方式降级，而不是整个平台崩溃。
 */
export function 归一全部能力(声明表: unknown[] | undefined): 能力归一结果 {
  const 合法 = new Map<string, 能力声明>();
  const 问题: Array<{ 声明: unknown; 原因: string }> = [];
  for (const 原始 of 声明表 ?? []) {
    const 归一 = 归一能力声明(原始);
    const 名称 = String(归一.名称 ?? "").trim();
    if (!名称) {
      问题.push({ 声明: 原始, 原因: "缺少名称" });
      continue;
    }
    合法.set(名称, { ...归一, 名称 } as unknown as 能力声明);
  }
  return { 合法, 问题 };
}
