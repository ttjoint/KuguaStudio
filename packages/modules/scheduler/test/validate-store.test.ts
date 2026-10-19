/**
 * scheduler 的动作校验与持久化测试。
 *
 * `校验动作` 是用户录入定时任务时唯一的入口检查。它漏了会怎样：
 *
 * - `request` 缺 `to` → 触发时 `客户端.request(undefined, ...)`，
 *   报「目标模块不存在：undefined」，用户完全看不懂
 * - `command` 是空白串 → `spawn("")` 报 ENOENT
 * - `kind` 拼错 → `switch` 落到 default，但**如果不校验**，
 *   触发器会拿着一个不认识的动作去 `执行`，然后在更深的地方炸
 *
 * 这些错应该在**录入时**就明确报出来，而不是等到半夜三点任务触发时。
 */

import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { 校验动作 } from "../src/scheduler.js";
import { 任务存储 } from "../src/store.js";
import type { 任务动作 } from "../src/types.js";

/** 绕过 TS 的类型检查，专门构造非法数据 */
const 乱 = (x: unknown): 任务动作 => x as 任务动作;

describe("校验动作：request", () => {
  it("合法的最小形态", () => {
    expect(() => 校验动作({ kind: "request", to: "dice", action: "dice.roll" })).not.toThrow();
  });

  it("带 params / timeoutMs 也合法", () => {
    expect(() =>
      校验动作({ kind: "request", to: "dice", action: "dice.roll", params: { a: 1 }, timeoutMs: 5000 }),
    ).not.toThrow();
  });

  it("缺 to 报错", () => {
    expect(() => 校验动作(乱({ kind: "request", action: "a" }))).toThrow(/缺少 to/);
  });

  it("to 是空串报错", () => {
    expect(() => 校验动作(乱({ kind: "request", to: "", action: "a" }))).toThrow(/缺少 to/);
  });

  it("to 不是字符串报错", () => {
    expect(() => 校验动作(乱({ kind: "request", to: 123, action: "a" }))).toThrow(/缺少 to/);
  });

  it("缺 action 报错", () => {
    expect(() => 校验动作(乱({ kind: "request", to: "dice" }))).toThrow(/缺少 action/);
  });

  it("action 是空串报错", () => {
    expect(() => 校验动作(乱({ kind: "request", to: "dice", action: "" }))).toThrow(/缺少 action/);
  });
});

describe("校验动作：event", () => {
  it("合法形态（不需要 to）", () => {
    expect(() => 校验动作({ kind: "event", action: "system.shutdown" })).not.toThrow();
  });

  it("缺 action 报错", () => {
    expect(() => 校验动作(乱({ kind: "event" }))).toThrow(/缺少 action/);
  });

  it("action 空串报错", () => {
    expect(() => 校验动作(乱({ kind: "event", action: "" }))).toThrow(/缺少 action/);
  });

  it("给了 to 也不报错（event 忽略它）", () => {
    expect(() => 校验动作(乱({ kind: "event", action: "x", to: "y" }))).not.toThrow();
  });
});

describe("校验动作：command", () => {
  it("合法形态", () => {
    expect(() => 校验动作({ kind: "command", command: "echo hi" })).not.toThrow();
  });

  it("缺 command 报错", () => {
    expect(() => 校验动作(乱({ kind: "command" }))).toThrow(/缺少 command/);
  });

  it("空白串报错（用 trim 判）", () => {
    // 这条专门防 `typeof x === "string" && x` 那种写法：
    // "   " 是真值，但 spawn 出去就是 ENOENT。
    expect(() => 校验动作(乱({ kind: "command", command: "   " }))).toThrow(/缺少 command/);
    expect(() => 校验动作(乱({ kind: "command", command: "\t\n" }))).toThrow(/缺少 command/);
  });

  it("首尾有空白但中间有内容是合法的", () => {
    expect(() => 校验动作(乱({ kind: "command", command: "  echo hi  " }))).not.toThrow();
  });

  it("非字符串报错", () => {
    expect(() => 校验动作(乱({ kind: "command", command: 123 }))).toThrow(/缺少 command/);
  });
});

describe("校验动作：整体", () => {
  it("null / undefined 报错", () => {
    expect(() => 校验动作(乱(null))).toThrow(/缺少 action/);
    expect(() => 校验动作(乱(undefined))).toThrow(/缺少 action/);
  });

  it("非对象报错", () => {
    expect(() => 校验动作(乱("command"))).toThrow(/缺少 action/);
    expect(() => 校验动作(乱(42))).toThrow(/缺少 action/);
  });

  it("未知 kind 报错并带上原值", () => {
    // 报错信息要能让人看懂是哪里写错了，所以带上 JSON
    expect(() => 校验动作(乱({ kind: "http", url: "x" }))).toThrow(/未知动作类型/);
    expect(() => 校验动作(乱({ kind: "http", url: "x" }))).toThrow(/http/);
  });

  it("缺 kind 也走未知分支", () => {
    expect(() => 校验动作(乱({ to: "a", action: "b" }))).toThrow(/未知动作类型/);
  });
});

describe("任务存储：load 的容错", () => {
  let 目录: string | null = null;

  afterEach(() => {
    if (目录) {
      rmSync(目录, { recursive: true, force: true });
      目录 = null;
    }
  });

  const 临时路径 = (): string => {
    目录 = mkdtempSync(join(tmpdir(), "kugua-sched-"));
    return join(目录, "tasks.json");
  };

  it("文件不存在返回空数组", () => {
    const p = 临时路径();
    expect(new 任务存储(p).load()).toEqual([]);
  });

  it("正常读回", () => {
    const p = 临时路径();
    writeFileSync(p, JSON.stringify([{ id: "a", name: "n", cron: "* * * * *" }]), "utf-8");
    const r = new 任务存储(p).load();
    expect(r.length).toBe(1);
    expect(r[0].id).toBe("a");
  });

  it("不是数组时返回空数组", () => {
    // 文件被写成了 `{...}` 这种对象，不能当数组用
    const p = 临时路径();
    writeFileSync(p, JSON.stringify({ id: "a" }), "utf-8");
    expect(new 任务存储(p).load()).toEqual([]);
  });

  it("JSON 坏了返回空数组而不抛错", () => {
    // 关键：一个坏文件不能让整个调度模块起不来。
    const p = 临时路径();
    writeFileSync(p, "{ 这不是 json", "utf-8");
    expect(() => new 任务存储(p).load()).not.toThrow();
    expect(new 任务存储(p).load()).toEqual([]);
  });

  it("只保留 id/name/cron 都是字符串的条目", () => {
    const p = 临时路径();
    writeFileSync(
      p,
      JSON.stringify([
        { id: "ok", name: "n", cron: "* * * * *" },
        { id: 1, name: "n", cron: "* * * * *" }, // id 不是 string
        { name: "n", cron: "* * * * *" }, // 缺 id
        { id: "x", cron: "* * * * *" }, // 缺 name
        { id: "x", name: "n" }, // 缺 cron
        null,
        "字符串",
        42,
      ]),
      "utf-8",
    );
    const r = new 任务存储(p).load();
    expect(r.map((t) => t.id)).toEqual(["ok"]);
  });

  it("空数组照样是空数组", () => {
    const p = 临时路径();
    writeFileSync(p, "[]", "utf-8");
    expect(new 任务存储(p).load()).toEqual([]);
  });
});

describe("任务存储：save 的原子性", () => {
  let 目录: string | null = null;

  afterEach(() => {
    if (目录) {
      rmSync(目录, { recursive: true, force: true });
      目录 = null;
    }
  });

  const 临时路径 = (): string => {
    目录 = mkdtempSync(join(tmpdir(), "kugua-sched-"));
    return join(目录, "tasks.json");
  };

  it("目录不存在时自动创建", () => {
    const p = 临时路径();
    // 路径本身在一个还不存在的子目录里
    const 深 = join(p.replace(/tasks\.json$/, ""), "子目录", "tasks.json");
    expect(() => new 任务存储(深).save([])).not.toThrow();
    expect(new 任务存储(深).load()).toEqual([]);
  });

  it("写进去能读回来", () => {
    const p = 临时路径();
    const 存储 = new 任务存储(p);
    存储.save([{ id: "a", name: "n", cron: "* * * * *" } as never]);
    expect(存储.load().length).toBe(1);
  });

  it("写失败时不抛错（静默吞掉，但不崩）", () => {
    // 磁盘满、没权限这类情况：调度器不该因为存不下就挂掉。
    // 用一个不可能创建的路径（在文件下面建目录）
    const p = 临时路径();
    writeFileSync(p, "占位", "utf-8");
    const 不可能 = join(p, "子", "tasks.json");
    expect(() => new 任务存储(不可能).save([])).not.toThrow();
  });

  it("不留 .tmp 文件（改名是原子的）", () => {
    const p = 临时路径();
    new 任务存储(p).save([]);
    const { readdirSync } = require("node:fs") as typeof import("node:fs");
    expect(readdirSync(目录!).filter((f) => f.endsWith(".tmp"))).toEqual([]);
  });
});
