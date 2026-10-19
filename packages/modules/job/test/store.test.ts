/**
 * job 的纯函数测试：`映射` / `夹取数量` / `推入日志`。
 *
 * ## 为什么测这三个
 *
 * `job` 的主体是进程管理，很难在单测里跑（要真起进程、真杀进程树）。
 * 但有三处「错了也看不出来」的纯逻辑：
 *
 * 1. **`映射`**：SQLite 返回的行是 `Record<string, unknown>`，字段可能是
 *    `null` / `undefined` / 数字 / 字符串。抄错一处的结果是**历史列表里
 *    某列空白**，而列表本身照样能显示——用户不会意识到数据丢了。
 *
 * 2. **`夹取数量`**：用户传 `limit: 0` 时，`LIMIT 0` 返回空集。
 *    界面上看就是「历史记录没了」，比给 1 条难排查得多。
 *
 * 3. **`推入日志`**：环形缓冲多丢一条或少丢一条，
 *    表现是「日志好像缺了几行」。这种问题几乎不可能靠肉眼发现，
 *    因为没人能记住两万行日志本来应该长什么样。
 *
 * ## 数据库测试怎么做
 *
 * `映射` 是纯函数，直接喂行对象即可，不需要真数据库。
 * 只有 `作业存储` 的读写才需要临时 db 文件——那部分用 `mkdtempSync`。
 */

import { existsSync, mkdtempSync, readdirSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { 作业存储, 夹取数量, 日志缓冲上限, 推入日志, 映射 } from "../src/store.js";
import type { 作业记录 } from "../src/types.js";

describe("映射：字段容错", () => {
  const 最小行 = { id: "a" };

  it("缺所有可选字段时不抛错，全部给默认值", () => {
    const r = 映射(最小行);
    expect(r.id).toBe("a");
    expect(r.标题).toBe("");
    expect(r.命令).toBe("");
    expect(r.参数).toEqual([]);
    expect(r.工作目录).toBe("");
    expect(r.shell).toBe(false);
    expect(r.状态).toBe("done"); // 注意：默认不是 running
    expect(r.退出码).toBeNull();
    expect(r.启动时间).toBe(0);
    expect(r.结束时间).toBeNull();
    expect(r.耗时毫秒).toBeNull();
    expect(r.日志文件).toBe("");
    expect(r.错误).toBeNull();
  });

  it("id 缺失时是字符串 \"undefined\" 而不是 undefined", () => {
    // SQLite 的 id 是主键，实际不会缺；但这里钉住 String() 的行为
    expect(typeof 映射({}).id).toBe("string");
  });

  describe("参数（JSON 字符串 → 数组）", () => {
    it("正常 JSON 数组", () => {
      expect(映射({ id: "a", args: '["-c","echo hi"]' }).参数).toEqual(["-c", "echo hi"]);
    });

    it("坏 JSON 退空数组（不抛错）", () => {
      expect(映射({ id: "a", args: "not json" }).参数).toEqual([]);
      expect(映射({ id: "a", args: "{" }).参数).toEqual([]);
    });

    it("args 为 null 时退空数组", () => {
      expect(映射({ id: "a", args: null }).参数).toEqual([]);
    });

    it("args 是 JSON 但不是数组时**原样返回**（不校验形状）", () => {
      // 这里刻意不校验：写入侧永远写数组，读到非数组说明有人手改过库。
      // 原样透出比悄悄变成 [] 更容易发现问题。
      expect(映射({ id: "a", args: '{"x":1}' }).参数).toEqual({ x: 1 });
      expect(映射({ id: "a", args: "42" }).参数).toBe(42);
    });
  });

  describe("shell（0/1 → boolean）", () => {
    it("1 → true", () => {
      expect(映射({ id: "a", shell: 1 }).shell).toBe(true);
    });
    it("0 → false", () => {
      expect(映射({ id: "a", shell: 0 }).shell).toBe(false);
    });
    it("字符串 \"1\" → true（Number(\"1\") === 1）", () => {
      expect(映射({ id: "a", shell: "1" }).shell).toBe(true);
    });

    it("2 → false（只有 1 才算 true，Boolean(2) 会错）", () => {
      // SQLite 里 shell 列存的是 0/1，但有人手改库写成 2 时，
      // Boolean(2)=true 与 Number(2)===1=false 表现不同。
      // 用 「=== 1」 更严格：不是 1 就是 false。
      expect(映射({ id: "a", shell: 2 }).shell).toBe(false);
    });

    it("\"true\" → false（Boolean(\"true\")=true 会错）", () => {
      expect(映射({ id: "a", shell: "true" }).shell).toBe(false);
    });
    it("null → false", () => {
      expect(映射({ id: "a", shell: null }).shell).toBe(false);
    });
  });

  describe("可空数值字段（退出码 / 结束时间 / 耗时）", () => {
    it("null 和 undefined 都保持 null（不能被 Number(null)=0 骗过去）", () => {
      // 这是最容易写错的地方：Number(null) === 0，会让「还没结束」变成「耗时 0ms」
      const r = 映射({ id: "a", exit_code: null, ended_at: null, duration_ms: null });
      expect(r.退出码).toBeNull();
      expect(r.结束时间).toBeNull();
      expect(r.耗时毫秒).toBeNull();
    });

    it("0 是合法值，不能变成 null", () => {
      // 退出码 0 表示成功，绝不能当成「没有退出码」
      const r = 映射({ id: "a", exit_code: 0, ended_at: 0, duration_ms: 0 });
      expect(r.退出码).toBe(0);
      expect(r.结束时间).toBe(0);
      expect(r.耗时毫秒).toBe(0);
    });

    it("有值时转数字", () => {
      const r = 映射({ id: "a", exit_code: 1, ended_at: 1700000000000, duration_ms: 1234 });
      expect(r.退出码).toBe(1);
      expect(r.结束时间).toBe(1700000000000);
      expect(r.耗时毫秒).toBe(1234);
    });
  });

  describe("错误字段", () => {
    it("null / undefined → null", () => {
      expect(映射({ id: "a", error: null }).错误).toBeNull();
      expect(映射({ id: "a" }).错误).toBeNull();
    });

    it("空串 → 空串（不是 null）", () => {
      expect(映射({ id: "a", error: "" }).错误).toBe("");
    });

    it("有值转字符串", () => {
      expect(映射({ id: "a", error: "spawn ENOENT" }).错误).toBe("spawn ENOENT");
    });
  });

  describe("启动时间", () => {
    it("缺省给 0（排序靠它，不能是 NaN）", () => {
      expect(映射({ id: "a" }).启动时间).toBe(0);
    });
    it("有值转数字", () => {
      expect(映射({ id: "a", started_at: 1700000000000 }).启动时间).toBe(1700000000000);
    });
  });
});

describe("夹取数量", () => {
  it("合法值原样通过", () => {
    expect(夹取数量(1)).toBe(1);
    expect(夹取数量(100)).toBe(100);
    expect(夹取数量(500)).toBe(500);
  });

  it("上界 500（防一次拉十万条）", () => {
    expect(夹取数量(501)).toBe(500);
    expect(夹取数量(999999)).toBe(500);
  });

  it("下界 1（0 会返回空集，界面上看就是历史没了）", () => {
    expect(夹取数量(0)).toBe(1);
    expect(夹取数量(-5)).toBe(1);
  });

  it("小数截断", () => {
    expect(夹取数量(10.9)).toBe(10);
    expect(夹取数量(0.5)).toBe(1); // 截断成 0 → 夹到 1
  });

  it("NaN / Infinity 退默认 100", () => {
    // Infinity 若不特判，Math.min(Infinity,500)=500，也还行；
    // 但 NaN 会一路传进 SQL 变成 LIMIT NaN，SQLite 会抛错。
    expect(夹取数量(NaN)).toBe(100);
    expect(夹取数量(Infinity)).toBe(100);
    expect(夹取数量(-Infinity)).toBe(100);
  });
});

describe("推入日志：环形缓冲", () => {
  it("未超限时逐条追加", () => {
    let 列: number[] = [];
    列 = 推入日志(列, 1, 3);
    列 = 推入日志(列, 2, 3);
    expect(列).toEqual([1, 2]);
  });

  it("正好等于上限时不丢", () => {
    let 列: number[] = [];
    for (let i = 1; i <= 3; i++) 列 = 推入日志(列, i, 3);
    expect(列).toEqual([1, 2, 3]);
  });

  it("正好等于上限时结果不变", () => {
    // 注意这条**不能证伪** `<=` 与 `<` 的互换：
    // 等号时 `新.length - 上限` 是 0，`slice(0)` 返回完整数组，
    // 所以两种写法产出完全相同。这里只作冒烟，不当作守门人。
    expect(推入日志([1, 2], 3, 3)).toEqual([1, 2, 3]);
  });

  it("超过上限时从**头部**丢（保留最新）", () => {
    // 保留最新是关键：排查问题要看的总是最后几行
    let 列: number[] = [];
    for (let i = 1; i <= 5; i++) 列 = 推入日志(列, i, 3);
    expect(列).toEqual([3, 4, 5]);
  });

  it("一次超很多也只保留最后 上限 条（不会残留）", () => {
    let 列: number[] = [];
    for (let i = 0; i < 100; i++) 列 = 推入日志(列, i, 10);
    expect(列.length).toBe(10);
    expect(列).toEqual([90, 91, 92, 93, 94, 95, 96, 97, 98, 99]);
  });

  it("不修改原数组（返回新数组）", () => {
    const 原 = [1, 2];
    推入日志(原, 3, 10);
    expect(原).toEqual([1, 2]);
  });

  it("上限为 1 时只留最新一条", () => {
    let 列: number[] = [];
    for (let i = 1; i <= 3; i++) 列 = 推入日志(列, i, 1);
    expect(列).toEqual([3]);
  });

  it("默认上限是 2000", () => {
    expect(日志缓冲上限).toBe(2000);
    const 列: number[] = [];
    expect(推入日志(列, "x")).toEqual(["x"]);
  });

  it("默认上限下确实按 2000 裁", () => {
    let 列: number[] = [];
    for (let i = 0; i < 2100; i++) 列 = 推入日志(列, i);
    expect(列.length).toBe(2000);
    expect(列[0]).toBe(100);
    expect(列[1999]).toBe(2099);
  });
});

describe("作业存储：真数据库读写", () => {
  let 目录: string;
  let 存储: 作业存储;

  const 造记录 = (改: Partial<作业记录> = {}): 作业记录 => ({
    id: "job-1",
    标题: "测试作业",
    命令: "echo",
    参数: ["hi"],
    工作目录: "C:/tmp",
    shell: false,
    状态: "done",
    退出码: 0,
    启动时间: 1700000000000,
    结束时间: 1700000001234,
    耗时毫秒: 1234,
    日志文件: "C:/tmp/a.log",
    错误: null,
    ...改,
  });

  beforeEach(() => {
    目录 = mkdtempSync(join(tmpdir(), "kugua-job-"));
    存储 = new 作业存储(join(目录, "jobs.db"));
  });

  afterEach(() => {
    存储.关闭();
    rmSync(目录, { recursive: true, force: true });
  });

  it("保存后能按 id 读回，所有字段一致（含 null 字段）", () => {
    存储.保存(造记录());
    const r = 存储.获取("job-1");
    expect(r).toEqual(造记录());
  });

  it("退出码为 null 时读回仍是 null（不能变 0）", () => {
    存储.保存(造记录({ 状态: "running", 退出码: null, 结束时间: null, 耗时毫秒: null }));
    const r = 存储.获取("job-1")!;
    expect(r.退出码).toBeNull();
    expect(r.结束时间).toBeNull();
    expect(r.耗时毫秒).toBeNull();
  });

  it("参数数组往返一致（经 JSON 序列化）", () => {
    存储.保存(造记录({ 参数: ["-c", "echo 你好", "--flag=value"] }));
    expect(存储.获取("job-1")!.参数).toEqual(["-c", "echo 你好", "--flag=value"]);
  });

  it("id 不存在返回 null", () => {
    expect(存储.获取("没有这个")).toBeNull();
  });

  it("同 id 再保存是更新不是重复（ON CONFLICT）", () => {
    存储.保存(造记录({ 状态: "running", 退出码: null }));
    存储.保存(造记录({ 状态: "failed", 退出码: 1 }));
    expect(存储.列表().length).toBe(1);
    expect(存储.获取("job-1")!.状态).toBe("failed");
    expect(存储.获取("job-1")!.退出码).toBe(1);
  });

  it("删除后读不到", () => {
    存储.保存(造记录());
    存储.删除("job-1");
    expect(存储.获取("job-1")).toBeNull();
  });

  it("列表按启动时间倒序（最新的在最前）", () => {
    存储.保存(造记录({ id: "a", 启动时间: 1000 }));
    存储.保存(造记录({ id: "b", 启动时间: 3000 }));
    存储.保存(造记录({ id: "c", 启动时间: 2000 }));
    expect(存储.列表().map((r) => r.id)).toEqual(["b", "c", "a"]);
  });

  it("列表 limit 走夹取（0 条也能拿到 1 条）", () => {
    存储.保存(造记录({ id: "a" }));
    存储.保存(造记录({ id: "b", 启动时间: 1 }));
    expect(存储.列表(0).length).toBe(1);
  });

  it("父目录不存在时自动创建（不会在构造时崩）", () => {
    const 深 = join(目录, "a", "b", "c");
    const s2 = new 作业存储(join(深, "jobs.db"));
    s2.保存(造记录());
    expect(s2.列表().length).toBe(1);
    s2.关闭();
    expect(existsSync(join(深, "jobs.db"))).toBe(true);
  });

  it("WAL 模式开启后不残留 -wal/-shm 以外的垃圾文件", () => {
    // WAL 会在关闭时自动 checkpoint，正常只剩 .db（可能带 -wal/-shm）
    存储.保存(造记录());
    const 文件 = readdirSync(目录);
    expect(文件.some((f) => f.endsWith(".db"))).toBe(true);
    expect(文件.every((f) => /\.db(-wal|-shm)?$/.test(f))).toBe(true);
  });
});
