/**
 * monitor 模块纯计算测试。
 *
 * 这些数会**直接显示给用户看**。算错了不报错，只显示一个错的数：
 * 磁盘 `NaN%`、`-3%`、或者监控间隔被设成 0 把一个核打满。
 */

import { describe, expect, it } from "vitest";
import { 组装磁盘, 解析df, 归一间隔, 夹百分比, 最小间隔, 最大间隔 } from "../src/calc.js";

describe("组装磁盘", () => {
  it("正常情况", () => {
    const d = 组装磁盘("C:", 1000, 400);
    expect(d).toEqual({ name: "C:", total: 1000, free: 400, used: 600, usagePct: 60 });
  });

  it("全满：free 为 0", () => {
    const d = 组装磁盘("C:", 1000, 0);
    expect(d.used).toBe(1000);
    expect(d.usagePct).toBe(100);
  });

  it("全空：free 等于 total", () => {
    const d = 组装磁盘("C:", 1000, 1000);
    expect(d.used).toBe(0);
    expect(d.usagePct).toBe(0);
  });

  it("total 为 0 时百分比是 0 而不是 NaN", () => {
    // 0/0 = NaN，界面上会显示「NaN%」。这是最典型的坑。
    const d = 组装磁盘("C:", 0, 0);
    expect(d.usagePct).toBe(0);
    expect(Number.isNaN(d.usagePct)).toBe(false);
  });

  it("total 缺失时当 0", () => {
    const d = 组装磁盘("C:", undefined, 100);
    expect(d.total).toBe(0);
    expect(d.usagePct).toBe(0);
  });

  it("total 是负数时当 0", () => {
    expect(组装磁盘("C:", -100, 0).total).toBe(0);
  });

  it("total 是字符串时不认（类型必须对）", () => {
    expect(组装磁盘("C:", "1000" as unknown as number, 400).total).toBe(0);
  });

  it("free 为负时当 0，used 不超过 total", () => {
    // free 是负数说明数据有问题。不兜的话 used = total - (-100) > total。
    const d = 组装磁盘("C:", 1000, -100);
    expect(d.free).toBe(0);
    expect(d.used).toBe(1000);
    expect(d.usagePct).toBe(100);
  });

  it("free 大于 total 时 used 夹到 0，百分比不为负", () => {
    // 虚拟机、配额目录会出现这种：报的空闲比总量还多。
    // 直接用 t-f 会得负数，界面上显示「-50%」。
    const d = 组装磁盘("C:", 1000, 1500);
    expect(d.used).toBe(0);
    expect(d.usagePct).toBe(0);
  });

  it("free 缺失时当 0（不是 total）", () => {
    const d = 组装磁盘("C:", 1000, undefined);
    expect(d.free).toBe(0);
    expect(d.used).toBe(1000);
  });

  it("name 缺失时给 ?", () => {
    expect(组装磁盘(undefined, 100, 50).name).toBe("?");
    expect(组装磁盘(null, 100, 50).name).toBe("?");
  });

  it("name 是数字也能转", () => {
    expect(组装磁盘(1, 100, 50).name).toBe("1");
  });

  it("百分比始终在 0~100 之间", () => {
    const 各种 = [
      组装磁盘("a", 1000, 0),
      组装磁盘("a", 1000, 500),
      组装磁盘("a", 1000, 1000),
      组装磁盘("a", 1000, 2000),
      组装磁盘("a", 0, 0),
      组装磁盘("a", 0, 100),
    ];
    for (const d of 各种) {
      expect(d.usagePct).toBeGreaterThanOrEqual(0);
      expect(d.usagePct).toBeLessThanOrEqual(100);
    }
  });

  it("used + free 始终等于 total（当 free 合法时）", () => {
    for (const free of [0, 1, 333, 999, 1000]) {
      const d = 组装磁盘("a", 1000, free);
      expect(d.used + d.free).toBe(1000);
    }
  });
});

describe("解析df", () => {
  const 输出 = [
    "Filesystem     1024-blocks      Used Available Capacity Mounted on",
    "/dev/sda1         10240000   4096000   6144000      40% /",
    "/dev/sdb1         20480000  20480000         0     100% /data",
  ].join("\n");

  it("跳过表头，解析出两条", () => {
    const r = 解析df(输出);
    expect(r.length).toBe(2);
    expect(r[0].name).toBe("/dev/sda1");
    expect(r[1].name).toBe("/dev/sdb1");
  });

  it("块数 ×1024 转成字节", () => {
    const r = 解析df(输出);
    expect(r[0].total).toBe(10240000 * 1024);
    expect(r[0].used).toBe(4096000 * 1024);
  });

  it("free = total - used", () => {
    expect(解析df(输出)[0].free).toBe((10240000 - 4096000) * 1024);
  });

  it("百分比按已用算", () => {
    expect(解析df(输出)[0].usagePct).toBeCloseTo(40, 5);
    expect(解析df(输出)[1].usagePct).toBeCloseTo(100, 5);
  });

  it("空输出得到空数组（表头都没有）", () => {
    expect(解析df("")).toEqual([]);
  });

  it("只有表头也得到空数组", () => {
    expect(解析df("Filesystem 1024-blocks Used Available Capacity Mounted on")).toEqual([]);
  });

  it("字段不足 6 的行被跳过（挂载点带空格会被截断）", () => {
    const r = 解析df(
      "Filesystem 1024-blocks Used Available Capacity Mounted on\n/dev/sda1 100 50 50 50%",
    );
    expect(r).toEqual([]);
  });

  it("total 非数字的行被跳过", () => {
    const r = 解析df(
      "head\ntmpfs abc 50 50 50% /mnt",
    );
    expect(r).toEqual([]);
  });

  it("total 为 0 的行被跳过", () => {
    const r = 解析df("head\ntmpfs 0 0 0 0% /mnt");
    expect(r).toEqual([]);
  });

  it("挂载点带空格时取前 6 段（POSIX 保证不折行）", () => {
    // df -P 的输出里挂载点可能带空格，split(/\s+/) 会多出段，
    // 但前 6 段的位置是固定的，所以 name/total/used 照样对。
    const r = 解析df("head\n/dev/sda1 100 50 50 50% /mnt/my disk");
    expect(r.length).toBe(1);
    expect(r[0].name).toBe("/dev/sda1");
    expect(r[0].total).toBe(100 * 1024);
  });
});

describe("归一间隔", () => {
  it("正常值照用", () => {
    expect(归一间隔(30)).toBe(30);
  });

  it("默认 10", () => {
    expect(归一间隔(undefined)).toBe(10);
  });

  it("0 被抬到下限，不能给 setInterval(0)", () => {
    // setInterval(0) 会退化成「每帧一次」，把一个核打满。
    // 而 采集快照 本身要阻塞 300ms 做双采样，间隔太短还会让任务排队堆积。
    expect(归一间隔(0)).toBe(最小间隔);
  });

  it("负数被抬到下限", () => {
    expect(归一间隔(-100)).toBe(最小间隔);
  });

  it("下限是 2 秒", () => {
    expect(最小间隔).toBe(2);
    expect(归一间隔(1)).toBe(2);
    expect(归一间隔(2)).toBe(2);
  });

  it("上限是 3600 秒（1 小时）", () => {
    expect(最大间隔).toBe(3600);
    expect(归一间隔(99999)).toBe(3600);
    expect(归一间隔(3600)).toBe(3600);
  });

  it("小数向下取整", () => {
    expect(归一间隔(3.9)).toBe(3);
  });

  it("NaN 退回默认", () => {
    expect(归一间隔(NaN)).toBe(10);
    expect(归一间隔(Infinity)).toBe(10);
  });

  it("字符串数字能转", () => {
    expect(归一间隔("30" as unknown as number)).toBe(30);
  });

  it("非数字字符串退回默认", () => {
    expect(归一间隔("abc" as unknown as number)).toBe(10);
    expect(归一间隔({} as unknown as number)).toBe(10);
  });

  it("null 走的是「转成 0 再抬到下限」，不是退回默认", () => {
    // Number(null) === 0，0 是有限数，所以会走到下限夹取那条路。
    // 结果（2 秒）恰好也是个合理值，但来源不同——
    // 钉住是为了将来改了 Number() 转换方式时能立刻看出来。
    expect(归一间隔(null as unknown as number)).toBe(最小间隔);
  });

  it("可以指定别的默认值", () => {
    expect(归一间隔(undefined, 5)).toBe(5);
  });
});

describe("夹百分比", () => {
  it("正常值原样返回", () => {
    expect(夹百分比(0)).toBe(0);
    expect(夹百分比(50)).toBe(50);
    expect(夹百分比(100)).toBe(100);
  });

  it("超上限夹到 100", () => {
    expect(夹百分比(150)).toBe(100);
  });

  it("负数夹到 0", () => {
    expect(夹百分比(-5)).toBe(0);
  });

  it("NaN 给 0", () => {
    expect(夹百分比(NaN)).toBe(0);
    expect(夹百分比(Infinity)).toBe(0);
  });
});
