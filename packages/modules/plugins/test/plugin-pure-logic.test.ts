/**
 * 插件纯逻辑测试：`examples/widget-demo`（sysmon）与 `examples/widget-netspeed`。
 *
 * 为什么测这两个文件：它们是**用户真正会装的东西**，不全是示例。而其中最容易
 * 出错的判断——间隔夹取、计数器回退、默认关闭——都不需要起子进程就能测，
 * 没必要为它们拉一个真实 PowerShell。
 *
 * 测试直接 import 插件的源码文件（纯 JS，无构建步骤）。插件加载器靠默认导出
 * 找插件类，命名导出不影响加载。
 */
import { describe, expect, it } from "vitest";
import { 读选项 as 读sysmon选项 } from "../../../../examples/widget-demo/index.js";
import { 读选项 as 读net选项, 处理一行, 重置基线 } from "../../../../examples/widget-netspeed/index.js";

describe("sysmon 读选项", () => {
  it("缺省配置给出清单里声明的默认值", () => {
    const o = 读sysmon选项({});
    expect(o.间隔).toBe(1500);
    expect(o.gpu间隔).toBe(6000);
    // 清单里默认是 true，所以"没写"必须等于"开启"——
    // 否则用户刚装上就看不到 GPU 卡，和文档不符
    expect(o.gpu).toBe(true);
  });

  it("间隔填写过小会被夹到 500ms 下限", () => {
    // 真机验证过：不夹取时填 1 会得到 1ms 定时器，1.6 秒采样 107 轮，
    // CPU 直接被吃满。这条测试就是那次事故的守门人。
    expect(读sysmon选项({ intervalMs: 1 }).间隔).toBe(500);
    expect(读sysmon选项({ intervalMs: -9999 }).间隔).toBe(500);
  });

  it("间隔填写过大会被夹到 10 秒上限", () => {
    expect(读sysmon选项({ intervalMs: 999999 }).间隔).toBe(10000);
  });

  it("GPU 间隔有独立的 2 秒下限", () => {
    // GPU 下限比 CPU 高：nvidia-smi 单次约 0.2 秒，
    // 2 秒一次已经是能承受的最快频率
    expect(读sysmon选项({ gpuIntervalMs: 1 }).gpu间隔).toBe(2000);
    expect(读sysmon选项({ gpuIntervalMs: 999999 }).gpu间隔).toBe(60000);
  });

  it("非数字间隔回落默认值而非 NaN", () => {
    // 配置来自 JSON 与用户输入，可能是字符串或 null。
    // 回落到默认值，绝不能让 NaN 走进 setInterval——
    // setInterval(fn, NaN) 等于 0ms 间隔，比填 1 更糟。
    expect(读sysmon选项({ intervalMs: "abc" }).间隔).toBe(1500);
    expect(读sysmon选项({ intervalMs: null }).间隔).toBe(1500);
    expect(读sysmon选项({ intervalMs: undefined }).间隔).toBe(1500);
  });

  it("字符串数字能被接受", () => {
    // 表单里 number 输入框可能给出 "2000" 这样的字符串
    expect(读sysmon选项({ intervalMs: "2000" }).间隔).toBe(2000);
  });

  it("只有显式 false 才关闭 GPU", () => {
    expect(读sysmon选项({ gpu: false }).gpu).toBe(false);
    // 别把 0 / "" / null 当成关闭——用户没表达这个意思
    expect(读sysmon选项({ gpu: 0 }).gpu).toBe(true);
    expect(读sysmon选项({ gpu: null }).gpu).toBe(true);
  });
});

describe("netspeed 读选项", () => {
  it("默认关闭：enabled 缺省时启用为 false", () => {
    // 这是本插件最重要的默认值。开着就是一个 60-80MB 常驻进程，
    // 用户只是想装个插件看看，不该被动付这个代价。
    expect(读net选项({}).启用).toBe(false);
    expect(读net选项({ enabled: false }).启用).toBe(false);
    expect(读net选项({ enabled: "true" }).启用).toBe(false);
  });

  it("显式 true 才启用", () => {
    expect(读net选项({ enabled: true }).启用).toBe(true);
  });

  it("默认不统计虚拟网卡", () => {
    // 代理的虚拟网卡流量本身就走物理网卡，一起累加会让速率翻倍
    expect(读net选项({}).包含虚拟).toBe(false);
    expect(读net选项({ includeVirtual: true }).包含虚拟).toBe(true);
  });

  it("采样间隔下限 500ms", () => {
    // 网卡计数器本身的更新粒度就在几百毫秒，再快只是重复读同一个数
    expect(读net选项({ intervalMs: 1 }).间隔).toBe(500);
    expect(读net选项({ intervalMs: 999999 }).间隔).toBe(10000);
    expect(读net选项({ intervalMs: "x" }).间隔).toBe(1000);
  });
});

describe("netspeed 处理一行", () => {
  /** 桩 ctx：只记录广播 */
  function 造ctx() {
    const 推送 = [];
    return {
      推送,
      ctx: { 广播: (_动作, 参数) => 推送.push(参数) },
    };
  }

  it("第一行只建立基线，不推送", () => {
    // 没有参照物时算出任何速率都是错的
    重置基线();
    const { 推送, ctx } = 造ctx();
    处理一行(ctx, "1000000|100000|200000");
    expect(推送).toHaveLength(0);
  });

  it("第二行按时间差算出速率", () => {
    重置基线();
    const { 推送, ctx } = 造ctx();
    处理一行(ctx, "1000000|100000|200000");
    // 1 秒后收到 1024*100 字节 = 100 KB/s
    处理一行(ctx, "1001000|202400|302400");
    const 下行 = 推送.find((p) => p.id === "net.down");
    const 上行 = 推送.find((p) => p.id === "net.up");
    expect(下行?.值).toBe(100);
    expect(上行?.值).toBe(100);
  });

  it("计数器回退时丢弃该轮并重建基线，不推负数", () => {
    // 网卡重置 / 拔网线 / 休眠恢复都会让累计值变小。
    // 显示负速率显然不对；当成 0 也不对（看着像"没流量"，实际是数据源断了）。
    重置基线();
    const { 推送, ctx } = 造ctx();
    处理一行(ctx, "1000000|999999999|999999999");
    const 回退前 = 推送.length;
    处理一行(ctx, "1001000|1000|1000"); // 计数器回退
    expect(推送).toHaveLength(回退前);

    // 回退后应已重建基线：下一轮正常差值能算出速率
    处理一行(ctx, "1002000|1024|1024");
    expect(推送.length).toBeGreaterThan(回退前);
    expect(推送.every((p) => p.值 >= 0)).toBe(true);
  });

  it("相同的整数值不重复推送", () => {
    // 每轮都推一模一样的数只是白白刷界面
    重置基线();
    const { 推送, ctx } = 造ctx();
    处理一行(ctx, "1000000|0|0");
    处理一行(ctx, "1001000|102400|102400"); // 100 KB/s
    const 一轮后 = 推送.length;
    处理一行(ctx, "1002000|2048|2048"); // 还是 100 KB/s
    expect(推送).toHaveLength(一轮后);
  });

  it("NONE / 空行 / 垃圾数据被忽略而不抛异常", () => {
    重置基线();
    const { 推送, ctx } = 造ctx();
    expect(() => 处理一行(ctx, "NONE")).not.toThrow();
    expect(() => 处理一行(ctx, "")).not.toThrow();
    expect(() => 处理一行(ctx, "a|b|c")).not.toThrow();
    expect(() => 处理一行(ctx, "\u0000\u0000")).not.toThrow();
    expect(推送).toHaveLength(0);
  });

  it("行尾 \\r 与 NUL 填充被剥掉", () => {
    // PowerShell 输出过管道时可能带 \r 和 NUL，Number("\r") 是 NaN，
    // 表现为"完全收不到数据"但没有任何报错
    重置基线();
    const { 推送, ctx } = 造ctx();
    处理一行(ctx, "1000000|0|0\r");
    // 1 秒内 102400 字节 = 100 KB/s（1024 字节/秒 只有 1 KB/s）
    处理一行(ctx, "1001000|102400|102400\u0000\r");
    expect(推送.find((p) => p.id === "net.down")?.值).toBe(100);
  });
});

describe("plugins 模块源码契约", () => {
  /**
   * `注册插件小组件()` 必须走 `合并声明()`，不能用清单里的原始声明。
   *
   * 这个 bug 在真机上复现过：sysmon 的 `on_load` 探测到 N 卡后补声明了 GPU，
   * 但 `注册小组件()` 在 `加载全部()` 之后跑，用清单原始声明把整份覆盖掉——
   * 日志说「已启用 GPU 监控」，界面上却没有 GPU 卡，两边都没有报错。
   *
   * 不做集成测试（要真起平台 + 真 N 卡），直接读源码比对：这类「用错变量」
   * 的错误，一行正则就能钉死，改名或改回去立刻红。
   */
  it("注册插件小组件 用 合并声明 而非原始清单声明", async () => {
    const { readFileSync } = await import("node:fs");
    const { join } = await import("node:path");
    const 源码 = readFileSync(join(__dirname, "..", "src", "index.ts"), "utf8");

    const 起点 = 源码.indexOf("const 注册插件小组件 = async");
    expect(起点).toBeGreaterThan(-1);
    // 取到下一个同级函数定义为止
    const 终点 = 源码.indexOf("const 同步小组件", 起点);
    expect(终点).toBeGreaterThan(起点);
    const 函数体 = 源码.slice(起点, 终点);

    expect(函数体).toContain("合并声明(记录.name)");
    // 这一条是真正的守门：出现原始清单声明就说明覆盖 bug 回来了。
    // 只看代码行——说明性注释里会提到那个坏写法（正是为了让后人知道
    // 为什么不能这么写），拿整段裸比对会把注释也算进去。
    const 代码行 = 函数体
      .split("\n")
      .filter((行) => !行.trim().startsWith("//") && !行.trim().startsWith("*"))
      .join("\n");
    expect(代码行).not.toContain("记录.元数据.widgets");
  });
});
