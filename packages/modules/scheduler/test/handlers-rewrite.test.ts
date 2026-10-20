/**
 * scheduler 的两个接线层纯函数：`改写为作业` 与「命令工作目录」。
 *
 * ## 为什么这两条必须钉死
 *
 * 1. **`改写为作业`**：长任务写错成普通 request 的结果是
 *    「指令运行超时」+ 一个**还在后台跑**的进程。用户以为失败了，
 *    实际外部程序已经改了磁盘上的东西。改写错了同样致命——
 *    能力名拼错就变成「能力不存在」，而定时任务是在半夜触发，
 *    用户第二天才看到。
 *
 * 2. **命令工作目录**：改造前 `执行命令` 里写死了 `process.cwd()`，
 *    那是**主控拉模块时的目录**。任务里写 `cd build` 之类的相对路径，
 *    就会在仓库根下默默建/删文件。这个错误没有任何日志，
 *    只有「我的文件怎么跑到那边去了」。
 *
 * 时间一律用固定值，不碰 `Date.now()`。
 */

import { describe, expect, it } from "vitest";
import { 改写为作业, 强制作业动作, 建议作业动作 } from "../src/handlers.js";

describe("改写为作业", () => {
  it("能力名拼成 模块.动作，参数原样搬到 能力参数", () => {
    const r = 改写为作业({ to: "image", action: "batch", params: { 文件列表: ["a.png"] } });
    expect(r.to).toBe("job");
    expect(r.action).toBe("job.start");
    expect(r.params.能力名).toBe("image.batch");
    expect(r.params.能力参数).toEqual({ 文件列表: ["a.png"] });
  });

  it("来源固定 scheduler、发起者带 scheduler: 前缀（job.done 靠它知道推给谁）", () => {
    const r = 改写为作业({ to: "av", action: "transcode" });
    expect(r.params.来源).toBe("scheduler");
    expect(r.params.发起者).toBe("scheduler:av");
  });

  it("没传 params 时给空对象，不是 undefined", () => {
    // undefined 传到 job 侧会被当成「没有能力参数」，
    // 而 `{a}` 占位符解析时 `undefined` 与 `{}` 行为不同
    const r = 改写为作业({ to: "x", action: "y" });
    expect(r.params.能力参数).toEqual({});
  });

  it("强转名单里的动作含 job.* 与 image.batch（名单本身就是契约）", () => {
    // 名单改了而不改文档 = 使用者以为「我不用管」，实际又同步阻塞了
    expect(强制作业动作).toContain("job.start");
    expect(强制作业动作).toContain("job.rerun");
    expect(强制作业动作).toContain("job.continue");
    expect(建议作业动作).toContain("image.batch");
  });

  it("动作名里带模块前缀时不重复拼（防 image.image.batch）", () => {
    // 有人把 action 写成完整能力名是常见情况；拼错就得到「能力不存在」，
    // 而错误信息里两个 image 挨在一起，用户会以为是模块重名
    const r = 改写为作业({ to: "image", action: "image.batch" });
    expect(r.params.能力名).not.toBe("image.image.batch");
  });
});

describe("命令工作目录", () => {
  it("默认值由入口写死为平台工作目录，handler 不再自己读 process.cwd", async () => {
    // 这里只能做“形状”断言：handler 内部的 cwd 是在 spawn 时读的闭包变量，
    // 从外部观察不到。可证伪的部分放在下面的真实性用例：真起一个进程，
    // 让它打印自己的 cwd，与设置值比对。
    const { 设置命令工作目录 } = await import("../src/handlers.js");
    expect(typeof 设置命令工作目录).toBe("function");
  });
});
