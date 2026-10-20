/**
 * job 的「能力作业 + 断点续跑」纯逻辑测试。
 *
 * ## 测什么、为什么
 *
 * 这一批改动有三处**错了也照样能跑**的地方：
 *
 * 1. **`解析能力命令`**：占位符没替换、或只替换了第一个，
 *    表现是子进程收到一个字面量 `{path}` 的路径，报的是
 *    「文件不存在」——看起来像用户传错了路径。
 *
 * 2. **`注入作业环境`**：`KUGUA_JOB_ATTEMPT` 写成字符串 `"1"` 还是 `1`、
 *    忘注入 `KUGUA_JOB_PROGRESS`，批处理那边就是「永远从头跑」，
 *    而界面上一切正常。这是断点续跑的**唯一依据**，必须钉死。
 *
 * 3. **`归一尝试次数`**：`Number(null) === 0` 会让从没跑过的作业
 *    显示成「第 0 次尝试」。job 在 `映射` 的三字段上已经栽过一次。
 *
 * 时间相关的一律用固定值，不碰 `Date.now()`。
 */

import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import {
  带计数标题,
  注入作业环境,
  标题已含计数,
  解析能力命令,
  归一来源,
} from "../src/pure.js";
import { 作业存储, 归一尝试次数, 归一来源 as 存储来源, 映射, 解析JSON列 } from "../src/store.js";
import type { 作业记录 } from "../src/types.js";

describe("解析能力命令：占位符", () => {
  it("把 {键} 替换成参数里的值", () => {
    const r = 解析能力命令(
      { 执行: { 命令: "magick", 参数: ["{path}", "-fuzz", "{fuzz}%", "{out}"] } },
      { path: "C:/a.png", fuzz: 15, out: "C:/b.png" },
    );
    expect(r).not.toBeNull();
    expect(r!.命令).toBe("magick");
    expect(r!.参数).toEqual(["C:/a.png", "-fuzz", "15%", "C:/b.png"]);
  });

  it("同一个占位符出现多次全部替换（不是只换第一个）", () => {
    // 用 `replace` 只换第一个是经典翻车点。
    //
    // 注意怎么写这个测试才**真的能变红**：第一版用的是 `["{path}", "{path}.bak"]`
    // 配 `path: "a.txt"`，结果 `replace` 也通过了——`"{path}.bak"` 里那个
    // `{path}` 后面跟的 `.bak` 恰好与 `a.txt` 的尾巴拼上，看不出差别。
    // 这里用 `"{path}{path}"`：只换一次得到 `"a.txt{path}"`，与期待的
    // `"a.txta.txt"` 明显不同。（已实测：把 split/join 换成 replace 后本条变红。）
    const r = 解析能力命令({ 执行: { 命令: "cp", 参数: ["{path}", "{path}{path}"] } }, { path: "a.txt" });
    expect(r!.参数).toEqual(["a.txt", "a.txta.txt"]);
  });

  it("命令字段里也能用占位符", () => {
    const r = 解析能力命令({ 执行: { 命令: "{exe}", 参数: [] } }, { exe: "python" });
    expect(r!.命令).toBe("python");
  });

  it("没有对应键的占位符保持原样（不静默变空串）", () => {
    // 静默变空串的后果更坏：用户看到的是「缺参数」，而不是「占位符名字写错了」
    const r = 解析能力命令({ 执行: { 命令: "echo", 参数: ["{不存在的键}"] } }, { path: "a" });
    expect(r!.参数[0]).toBe("{不存在的键}");
  });

  it("{参数} 展开成整个参数的 JSON", () => {
    const r = 解析能力命令({ 执行: { 命令: "node", 参数: ["run.js", "{参数}"] } }, { 模式: "快", n: 2 });
    expect(JSON.parse(r!.参数[1])).toEqual({ 模式: "快", n: 2 });
  });

  it("值为 null/undefined 的键不产生占位替换", () => {
    const r = 解析能力命令({ 执行: { 命令: "x", 参数: ["{a}"] } }, { a: null });
    expect(r!.参数[0]).toBe("{a}");
  });

  it("没有 执行 声明时返回 null，而不是抛错或返回假命令", () => {
    // 返回 null 让调用方给出「请用 命令 直接起」的可执行提示；
    // 抛错会让人以为是 job 坏了，返回假命令会让子进程跑一个空命令
    expect(解析能力命令({}, {})).toBeNull();
    expect(解析能力命令(null, {})).toBeNull();
    expect(解析能力命令({ 执行: { 参数: ["x"] } as never }, {})).toBeNull();
    expect(解析能力命令({ 执行: { 命令: "   " } }, {})).toBeNull();
  });

  it("能力参数原样带出（重跑/续跑要用它重新解析）", () => {
    const 参数 = { path: "a.png", files: [1, 2] };
    const r = 解析能力命令({ 执行: { 命令: "x" } }, 参数);
    expect(r!.能力参数).toEqual(参数);
  });

  it("shell 声明透传布尔值", () => {
    expect(解析能力命令({ 执行: { 命令: "x", shell: true } }, {})!.shell).toBe(true);
    expect(解析能力命令({ 执行: { 命令: "x" } }, {})!.shell).toBe(false);
  });

  it("能力参数不是对象时不炸（字符串/undefined）", () => {
    expect(解析能力命令({ 执行: { 命令: "x", 参数: ["{参数}"] } }, undefined)!.参数[0]).toBe("{}");
    expect(解析能力命令({ 执行: { 命令: "x", 参数: ["{参数}"] } }, "abc")!.参数[0]).toBe("{}");
  });
});

describe("注入作业环境：断点续跑的契约", () => {
  it("注入三个键，ATTEMPT 是十进制字符串", () => {
    // 为什么必须是字符串：环境变量的值只能是字符串，写 number 会被 Node 静默丢弃
    const 环境: Record<string, string> = {};
    注入作业环境(环境, "job-7", 3, "C:/data/jobs/job-7.progress");
    expect(环境).toEqual({
      KUGUA_JOB_ID: "job-7",
      KUGUA_JOB_ATTEMPT: "3",
      KUGUA_JOB_PROGRESS: "C:/data/jobs/job-7.progress",
    });
    expect(typeof 环境.KUGUA_JOB_ATTEMPT).toBe("string");
  });

  it("不覆盖调用方自己传的其它环境变量", () => {
    const 环境: Record<string, string> = { MY_VAR: "1" };
    注入作业环境(环境, "id", 1, "/p");
    expect(环境.MY_VAR).toBe("1");
  });

  it("调用方自己写的 KUGUA_JOB_ATTEMPT 会被覆盖（不能让作业谎报尝试次数）", () => {
    // 批处理如果发现「我能自己写 ATTEMPT」，就能骗掉续跑逻辑跳过已完成的部分
    const 环境: Record<string, string> = { KUGUA_JOB_ATTEMPT: "99" };
    注入作业环境(环境, "id", 2, "/p");
    expect(环境.KUGUA_JOB_ATTEMPT).toBe("2");
  });
});

describe("归一尝试次数：null 不能变 0", () => {
  it("null / undefined / 空串 / 非法值一律兜底为 1", () => {
    expect(归一尝试次数(null)).toBe(1);
    expect(归一尝试次数(undefined)).toBe(1);
    expect(归一尝试次数("")).toBe(1);
    expect(归一尝试次数("abc")).toBe(1);
    expect(归一尝试次数(NaN)).toBe(1);
  });

  it("0 和负数也兜底为 1（「第 0 次尝试」没有意义）", () => {
    expect(归一尝试次数(0)).toBe(1);
    expect(归一尝试次数(-3)).toBe(1);
  });

  it("合法值原样保留，小数截断", () => {
    expect(归一尝试次数(1)).toBe(1);
    expect(归一尝试次数("4")).toBe(4);
    expect(归一尝试次数(2.9)).toBe(2);
  });
});

describe("归一来源：认不出的按 user", () => {
  it("四个合法值原样返回", () => {
    for (const 值 of ["user", "module", "plugin", "scheduler"] as const) {
      expect(归一来源(值)).toBe(值);
    }
  });

  it("脏数据不产生「未知来源」这个空类别", () => {
    expect(归一来源("")).toBe("user");
    expect(归一来源(null)).toBe("user");
    expect(归一来源("Module")).toBe("user"); // 大小写不宽容：来源是代码写的，不该靠猜
    expect(归一来源("weird")).toBe("user");
  });

  it("store 侧的同名函数与 index 侧行为一致（两份实现不能漂移）", () => {
    for (const 值 of ["user", "plugin", "", null, "Module"]) {
      expect(存储来源(值)).toBe(归一来源(值));
    }
  });
});

describe("带计数标题", () => {
  it("批量参数里有数组时补上条数", () => {
    expect(带计数标题("批量去背景", { 文件列表: [1, 2, 3] })).toBe("批量去背景（3 项）");
  });

  it("没有可数的数组时标题不变", () => {
    expect(带计数标题("转码", { path: "a.mp4" })).toBe("转码");
    expect(带计数标题("转码", { 文件列表: "不是数组" })).toBe("转码");
    expect(带计数标题("转码", null)).toBe("转码");
  });

  it("已加过计数时不再叠加（续跑多次标题不会变长）", () => {
    expect(带计数标题("批量（3 项）", { 文件列表: [1, 2] }, true)).toBe("批量（3 项）");
  });

  it("标题已含计数的判定只认结尾的「（N 项）」", () => {
    expect(标题已含计数("批量（3 项）")).toBe(true);
    expect(标题已含计数("批量（3 项）备注")).toBe(false);
    expect(标题已含计数("批量（三项）")).toBe(false);
  });
});

describe("存储：新列往返", () => {
  let 目录: string;
  let 存储: 作业存储;

  const 造记录 = (改: Partial<作业记录> = {}): 作业记录 => ({
    id: "job-1",
    标题: "批量",
    命令: "magick",
    参数: ["a.png"],
    工作目录: "C:/tmp",
    shell: false,
    状态: "cancelled",
    退出码: null,
    启动时间: 1700000000000,
    结束时间: 1700000001234,
    耗时毫秒: 1234,
    日志文件: "C:/tmp/a.log",
    错误: "用户取消",
    发起者: "plugin:去背景",
    来源: "plugin",
    尝试次数: 2,
    进度文件: "C:/tmp/a.progress",
    能力名: "image.batch",
    能力参数: { files: ["a.png"] },
    ...改,
  });

  afterEach(() => {
    存储?.关闭();
    rmSync(目录, { recursive: true, force: true });
  });

  const 打开 = (): void => {
    目录 = mkdtempSync(join(tmpdir(), "kugua-job2-"));
    存储 = new 作业存储(join(目录, "jobs.db"));
  };

  it("发起者/来源/尝试次数/进度文件/能力名/能力参数全部往返一致", () => {
    打开();
    存储.保存(造记录());
    const r = 存储.获取("job-1")!;
    expect(r.发起者).toBe("plugin:去背景");
    expect(r.来源).toBe("plugin");
    expect(r.尝试次数).toBe(2);
    expect(r.进度文件).toBe("C:/tmp/a.progress");
    expect(r.能力名).toBe("image.batch");
    expect(r.能力参数).toEqual({ files: ["a.png"] });
  });

  it("续跑后同 id 更新记录、留下更大的尝试次数（不是新插一条）", () => {
    打开();
    存储.保存(造记录());
    存储.保存(造记录({ 状态: "running", 尝试次数: 3 }));
    expect(存储.列表().length).toBe(1);
    expect(存储.获取("job-1")!.尝试次数).toBe(3);
  });

  it("能力参数为 null 时读回仍是 null", () => {
    打开();
    存储.保存(造记录({ 能力名: null, 能力参数: null }));
    const r = 存储.获取("job-1")!;
    expect(r.能力名).toBeNull();
    expect(r.能力参数).toBeNull();
  });
});

describe("映射：新字段容错", () => {
  it("老行（没有新列）也能映射，尝试次数兜底为 1 而不是 0", () => {
    const r = 映射({ id: "x" });
    expect(r.尝试次数).toBe(1);
    expect(r.发起者).toBe("");
    expect(r.来源).toBe("user");
    expect(r.进度文件).toBe("");
    expect(r.能力名).toBeNull();
    expect(r.能力参数).toBeNull();
  });

  it("capability_params 是坏 JSON 时返回 null 不抛", () => {
    expect(解析JSON列("{不是 json")).toBeNull();
    expect(解析JSON列("")).toBeNull();
    expect(解析JSON列(null)).toBeNull();
    expect(解析JSON列('{"a":1}')).toEqual({ a: 1 });
  });
});
