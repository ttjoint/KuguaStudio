/**
 * sysmon —— 系统监控小组件（CPU / 内存 / GPU）
 *
 * 这是 `docs/小组件设计.md` 的参考实现，也是用户实际会用的插件。
 *
 * 三条分工：
 *  1. **声明**写在 `kugua-plugin.json` 的 `widgets` 里，**不说位置**——那是平台的事。
 *  2. **采样**由插件自己做：间隔、重试、降频都是插件的业务，平台不该替它决定。
 *  3. **推送**走 `ctx.广播("widget.data", { id, 值 })`，平台负责限流与渲染。
 *
 * 关于「取不到就不声明」：
 *   没显卡的机器不该看到一个永远「无数据」的 GPU 卡片——用户分不清是
 *   「还没采到」还是「这台机器根本没法采」。所以 GPU 启动探测一次，
 *   探不到就**永久放弃**，组件也不声明。
 *
 * 关于 GPU 为什么要降频：
 *   `nvidia-smi` 单次约 0.2 秒，每 1.5 秒起一个子进程既费电又容易被杀软
 *   盯上（频繁起子进程是典型的可疑行为特征）。GPU 使用率本来就是慢变量，
 *   6 秒一轮完全够用。
 */
import os from "node:os";
import { execFileSync } from "node:child_process";
import { BasePlugin, 定义插件 } from "@kugua/plugin-sdk";

/** 默认值必须与清单里 `配置声明` 的默认值一致，否则首次启用行为对不上 */
const 默认间隔 = 1500;
const 默认GPU间隔 = 6000;

/** 采样定时器（`on_unload` 必须清掉，否则卸载后还在推「幽灵」数据） */
let 定时器 = null;
/** 当前生效的采样间隔，用于配置变化时判断要不要重建定时器 */
let 当前间隔 = 默认间隔;

// ===== CPU =====

/** CPU 累计 tick：用两次采样间的增量算使用率 */
function 算CPU() {
  let 空闲 = 0;
  let 总 = 0;
  for (const cpu of os.cpus()) {
    const t = cpu.times;
    空闲 += t.idle;
    for (const k of Object.keys(t)) 总 += t[k];
  }
  return { 空闲, 总 };
}

let 上次CPU = 算CPU();

// ===== GPU =====

/** `null` = 还没探测过；`false` = 探测失败，永久放弃；`true` = 可用 */
let GPU可用 = null;
/** 下次允许采样 GPU 的时间戳（降频用） */
let GPU下次 = 0;
/** 上一次成功的显存占用（MB），用于副标题 */
let GPU显存 = null;

/**
 * 读一次 nvidia-smi。
 *
 * 返回 `{ 使用率, 已用, 总量 }`，取不到返回 null。
 * 探测和采样共用：两边要的字段一样，分开写迟早改一边忘另一边。
 */
function 读GPU() {
  try {
    const 输出 = execFileSync(
      "nvidia-smi",
      ["--query-gpu=utilization.gpu,memory.used,memory.total", "--format=csv,noheader,nounits"],
      { encoding: "utf8", timeout: 4000, windowsHide: true },
    );
    // 只要第一块卡：多卡全塞进一个小组件没有意义，真要多卡应该拆成多个组件。
    // split(/[\r\n]+/) 而不是 split("\n")：Windows 下是 CRLF，
    // 只按 \n 切会在数字尾部留下 \r，Number("\r") 是 NaN。
    const 行 = 输出.trim().split(/[\r\n]+/)[0] ?? "";
    const [使用率, 已用, 总量] = 行.split(",").map((s) => Number(s.trim()));
    if (!Number.isFinite(使用率)) return null;
    return {
      使用率: Math.max(0, Math.min(100, 使用率)),
      已用: Number.isFinite(已用) ? 已用 : null,
      总量: Number.isFinite(总量) && 总量 > 0 ? 总量 : null,
    };
  } catch {
    // 没装驱动 / 不是 N 卡 / 命令被杀软拦下，都走这里。
    return null;
  }
}

/** GPU 组件声明（只在探测成功后才交给平台） */
const GPU组件 = {
  id: "gpu",
  type: "gauge",
  title: "GPU",
  unit: "%",
  max: 100,
  prominence: "normal",
  warn: 80,
  danger: 95,
  stale: 20,
};

/** 把数字夹到 [0,100] 并保留一位小数——避免浮点噪声让界面抖动 */
function 规范化(值) {
  return Number(Math.max(0, Math.min(100, 值)).toFixed(1));
}

/** 采样一轮并推送 */
function 采样并推送(ctx, 选项) {
  // CPU：两次 tick 的增量比
  const 现在CPU = 算CPU();
  const 总增 = 现在CPU.总 - 上次CPU.总;
  const 空增 = 现在CPU.空闲 - 上次CPU.空闲;
  上次CPU = 现在CPU;
  if (总增 > 0) {
    ctx.广播("widget.data", { id: "cpu", 值: 规范化((1 - 空增 / 总增) * 100) });
  }

  // 内存：1 - 空闲/总
  const 总内存 = os.totalmem();
  if (总内存 > 0) {
    ctx.广播("widget.data", { id: "mem", 值: 规范化(((总内存 - os.freemem()) / 总内存) * 100) });
  }

  // GPU：只有探测成功且用户没关掉才走到这里
  if (GPU可用 === true && 选项.gpu && Date.now() >= GPU下次) {
    GPU下次 = Date.now() + 选项.gpu间隔;
    const 结果 = 读GPU();
    // 单次失败只跳过这一轮，**不改** GPU可用——
    // 驱动重置、超时都是一次性的，永久放弃会让卡片一直停在「无数据」。
    if (结果) {
      if (结果.已用 !== null && 结果.总量 !== null) {
        GPU显存 = { 已用: 结果.已用, 总量: 结果.总量 };
      }
      const 副标题 = GPU显存
        ? `${(GPU显存.已用 / 1024).toFixed(1)}/${(GPU显存.总量 / 1024).toFixed(1)} GB`
        : undefined;
      ctx.广播("widget.data", { id: "gpu", 值: 规范化(结果.使用率), 副标题 });
    }
  }
}

/** 启动/重启采样定时器 */
function 重设定时器(ctx, 选项) {
  if (定时器) clearInterval(定时器);
  定时器 = setInterval(() => {
    try {
      采样并推送(ctx, 选项);
    } catch (err) {
      ctx.日志.警告(`采样失败：${String(err)}`);
    }
  }, 选项.间隔);
  当前间隔 = 选项.间隔;
}

/**
 * 把配置值夹进 [最小, 最大]，非数字一律回落默认值。
 *
 * **不能直接用 `Number()` 判有限性**：`Number(null)` 和 `Number("")` 都是 `0`，
 * 是有限数，于是「用户没填」会被当成「填了 0」再夹成下限，静默变成 500ms——
 * 比直接用默认值更费 CPU，而且完全看不出来。
 * 所以先要求「确实是个能当数字用的值」，再谈夹取。
 */
function 夹数值(值, 默认, 最小, 最大) {
  if (值 === null || 值 === undefined || 值 === "") return 默认;
  const 数 = Number(值);
  // NaN 显然要回落；空数组之类 Number() 给 0 的也要挡在外面
  if (!Number.isFinite(数) || (数 === 0 && 值 !== 0 && 值 !== "0")) return 默认;
  return Math.max(最小, Math.min(最大, 数));
}

/**
 * 把用户配置读成内部选项，坏值一律回落到默认。
 *
 * 导出是为了单测：夹取逻辑（尤其 500ms 下限）写错了会把 CPU 吃满，
 * 而它完全不需要起采样就能验证。
 */
export function 读选项(配置) {
  return {
    间隔: 夹数值(配置?.intervalMs, 默认间隔, 500, 10000),
    gpu间隔: 夹数值(配置?.gpuIntervalMs, 默认GPU间隔, 2000, 60000),
    // 没写就当开启（默认值是 true），只有显式 false 才关
    gpu: 配置?.gpu !== false,
  };
}

class 系统监控 extends BasePlugin {
  async on_load(ctx) {
    super.on_load(ctx);

    let 配置 = {};
    try {
      配置 = await ctx.配置();
    } catch (err) {
      // 读不到配置不该让插件直接废掉：用默认值继续跑，
      // 比什么都不显示好，至少用户能看到监控还在工作。
      ctx.日志.警告(`读取配置失败，使用默认值：${String(err)}`);
    }
    const 选项 = 读选项(配置);

    // 探测 GPU。探到才补声明组件，否则不声明。
    // 用户把 gpu 关掉时也不探测——省一次 0.2 秒的子进程。
    if (选项.gpu) {
      GPU可用 = 读GPU() !== null;
      if (GPU可用) {
        await ctx.声明小组件([GPU组件]);
        ctx.日志.信息("已启用 GPU 监控（nvidia-smi）");
      } else {
        ctx.日志.信息("未检测到可用的 nvidia-smi，跳过 GPU 组件");
      }
    } else {
      GPU可用 = false;
    }

    重设定时器(ctx, 选项);

    // 配置改动后立即生效：间隔变了就重建定时器。
    //
    // 订阅的是 `module.config.changed` 广播而不是 `module.config`：
    // 后者由主控 `sendEventTo(模块名)` 定向发送，只发给**注册过的模块进程**，
    // 插件不是独立模块、收不到。广播不带具体值，所以收到后重新 `ctx.配置()`
    // 拉一次——这正是 `ctx.配置()` 设计成「每次现拉」的原因。
    ctx.订阅("module.config.changed", async (参数) => {
      // 广播覆盖所有模块与插件，先看是不是改的自己
      const 目标 = 参数 && typeof 参数 === "object" ? 参数.模块 : undefined;
      if (目标 && 目标 !== "sysmon") return;
      try {
        const 新选项 = 读选项(await ctx.配置());
        if (新选项.间隔 !== 当前间隔) {
          重设定时器(ctx, 新选项);
          ctx.日志.信息(`采样间隔已改为 ${新选项.间隔}ms`);
        }
      } catch (err) {
        ctx.日志.警告(`应用新配置失败：${String(err)}`);
      }
    });
  }

  async on_unload() {
    if (定时器) clearInterval(定时器);
    定时器 = null;
  }
}

export default 定义插件(系统监控, {
  name: "sysmon",
  version: "1.0.0",
  description: "系统监控：CPU / 内存 / GPU 小组件",
  author: "kugua",
});
