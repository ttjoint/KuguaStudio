/**
 * 插件健壮性测试：超时与错误隔离。
 *
 * 插件与平台同进程（刻意的设计：常用功能不值得 IPC 往返，生命周期也归
 * 平台管），所以「插件出错」必须等于「插件自己的那一份失败」，
 * 不能等于「整个 Studio 消失」。这里守住两条：
 *
 *  1. 命令处理卡住 → 按时放弃，不把分发流程永久挂住
 *  2. 命令处理抛错 → 记录并继续，不影响后续消息
 */

import { mkdtempSync, rmSync, writeFileSync, mkdirSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { pathToFileURL } from "node:url";
import { afterAll, describe, expect, it } from "vitest";
import { 插件加载器, type 加载器日志 } from "../src/loader.js";
import type { 消息上下文 } from "@kugua/plugin-sdk";

const 临时 = mkdtempSync(join(tmpdir(), "kugua-plugin-robust-"));
afterAll(() => rmSync(临时, { recursive: true, force: true }));

const 静默日志: 加载器日志 = { 信息: () => {}, 警告: () => {}, 错误: () => {} };

/** 造一个插件目录，入口代码由调用方给 */
function 造插件(name: string, 源码: string): string {
  const 目录 = join(临时, name);
  mkdirSync(目录, { recursive: true });
  writeFileSync(
    join(目录, "kugua-plugin.json"),
    JSON.stringify({ name, version: "0.1.0", entry: "index.mjs" }),
    "utf-8",
  );
  writeFileSync(join(目录, "index.mjs"), 源码, "utf-8");
  return 目录;
}

/** 最小消息上下文（插件命令只用到 文本 与 回复） */
function 造上下文(文本: string, 回复记录: unknown[] = []): 消息上下文 {
  return {
    类型: "group",
    群号: "1",
    用户号: "2",
    机器人号: "3",
    消息段: [],
    文本,
    at们: [],
    事件: {},
    回复: async (内容) => {
      回复记录.push(内容);
      return {};
    },
    转发: async () => ({}),
    请求: async () => ({}),
  } as 消息上下文;
}

function 造加载器(插件目录: string, 超时?: number): 插件加载器 {
  return new 插件加载器({
    插件目录,
    宿主工厂: () => ({
      日志: { 信息: () => {}, 警告: () => {}, 错误: () => {} },
      请求: async () => ({}),
      广播: () => {},
      订阅: () => ({ 取消: () => {} }),
      配置: async () => ({}),
    }),
    日志: 静默日志,
    命令超时毫秒: 超时,
    导入: async (url: string) => import(url),
  });
}

describe("插件命令超时", () => {
  it("命令永不返回时按时放弃，不阻塞分发", async () => {
    造插件(
      "hang",
      `class P {
         命令 = [];
         注册命令(d) { this.命令.push(d); }
         async on_load() {
           this.注册命令({ 匹配: /^卡$/, 处理: () => new Promise(() => {}) });
         }
         on_enable() {} on_disable() {} on_unload() {}
       }
       export default P;`,
    );
    const 加载器 = 造加载器(临时, 300);
    await 加载器.加载全部();
    await 加载器.启用("hang");

    const 开始 = Date.now();
    const 已处理 = await 加载器.分发消息(造上下文("卡"));
    const 耗时 = Date.now() - 开始;

    expect(已处理).toBe(true);
    // 应当按时结束（留足 CI 抖动余量），而不是永久挂住
    expect(耗时).toBeLessThan(2000);
  });

  it("命令抛错不影响后续消息分发", async () => {
    造插件(
      "thrower",
      `class P {
         命令 = [];
         注册命令(d) { this.命令.push(d); }
         async on_load() {
           this.注册命令({ 匹配: /^炸$/, 处理: () => { throw new Error("插件内部错误"); } });
           this.注册命令({ 匹配: /^好$/, 处理: () => "正常回复" });
         }
         on_enable() {} on_disable() {} on_unload() {}
       }
       export default P;`,
    );
    const 加载器 = 造加载器(临时, 1000);
    await 加载器.加载全部();
    await 加载器.启用("thrower");

    // 抛错的那条被吞掉并记为已处理（不抛给调用方）
    await expect(加载器.分发消息(造上下文("炸"))).resolves.toBe(true);

    // 后续消息照常工作
    const 记录: unknown[] = [];
    await expect(加载器.分发消息(造上下文("好", 记录))).resolves.toBe(true);
    expect(记录).toEqual(["正常回复"]);
  });

  it("回复失败不会把异常抛给调用方", async () => {
    造插件(
      "replyfail",
      `class P {
         命令 = [];
         注册命令(d) { this.命令.push(d); }
         async on_load() {
           this.注册命令({ 匹配: /^回$/, 处理: () => "内容" });
         }
         on_enable() {} on_disable() {} on_unload() {}
       }
       export default P;`,
    );
    const 加载器 = 造加载器(临时, 1000);
    await 加载器.加载全部();
    await 加载器.启用("replyfail");

    const 上下文 = 造上下文("回");
    // 模拟机器人掉线：回复 reject
    上下文.回复 = async () => {
      throw new Error("连接已断开");
    };
    // 回复失败属于「消息没发出去」，不该让分发流程崩溃
    await expect(加载器.分发消息(上下文)).resolves.toBe(true);
  });
});
