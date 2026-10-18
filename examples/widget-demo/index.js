/**
 * sysmon —— 系统监控小组件
 *
 * 演示小组件的正确写法，也是用户实际会用的东西：
 *  1. 声明写在 kugua-plugin.json 的 `widgets` 里（**不说位置**，那是平台的事）
 *  2. 数据在插件自己的采样循环里 `ctx.广播("widget.data", { id, 值 })`
 *
 * 为什么由插件采样而不是平台轮询：采样间隔、重试、失败退避都是插件
 * 自己的业务，平台不该知道也不该替它决定。
 *
 * 关于网速：要拿字节计数器，Linux 读 /proc/net/dev 即可；Windows 只能起
 * PowerShell 调 Get-Counter，每 1.5 秒一次既慢又会被杀软盯上。**取不到就
 * 不声明该组件**——声明了却永远无数据，用户会当成坏了。
 *
 * 关于 GPU：同样按「取不到就不声明」处理。`nvidia-smi` 单次约 0.19 秒，
 * 1.5 秒一次会持续占一个进程槽，既费电又容易被杀软盯上（频繁起子进程是
 * 典型的可疑行为特征）。所以这里做了三件事：
 *   1. 启动时探测一次，探不到就**永久放弃**，不再重试；
 *   2. 采样降频到 6 秒一次（GPU 使用率本来也不需要 1.5 秒粒度）；
 *   3. GPU 组件**不进清单**，靠 `ctx.声明小组件` 运行时补声明——
 *      没 N 卡的机器不该看到一个永远「无数据」的卡片。
 * 采样失败只静默跳过这一轮，不注销组件——偶发一次失败不该让卡片消失。
 */
import os from "node:os";
import { execFileSync } from "node:child_process";
import { BasePlugin, 定义插件 } from "@kugua/plugin-sdk";

let 定时器 = null;

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

// ===== GPU（nvidia-smi） =====

/** `null` = 还没探测过；`false` = 探测失败，永久放弃；`true` = 可用 */
let GPU可用 = null;
/** GPU 下次允许采样的时间戳（降频用） */
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

/** 采样一轮并推送 */
function 采样并推送(ctx) {
  // CPU
  const 现在CPU = 算CPU();
  const 总增 = 现在CPU.总 - 上次CPU.总;
  const 空增 = 现在CPU.空闲 - 上次CPU.空闲;
  上次CPU = 现在CPU;
  if (总增 > 0) {
    const 使用率 = Math.max(0, Math.min(100, (1 - 空增 / 总增) * 100));
    ctx.广播("widget.data", { id: "cpu", 值: Number(使用率.toFixed(1)) });
  }

  // 内存：1 - 空闲/总
  const 总内存 = os.totalmem();
  const 内存率 = 总内存 > 0 ? ((总内存 - os.freemem()) / 总内存) * 100 : 0;
  ctx.广播("widget.data", { id: "mem", 值: Number(内存率.toFixed(1)) });

  // GPU：只有探测成功才走到这里
  if (GPU可用 === true && Date.now() >= GPU下次) {
    GPU下次 = Date.now() + 6000;
    const 结果 = 读GPU();
    // 单次失败只跳过这一轮，不改 GPU可用——
    // 驱动重置、超时都是一次性的，永久放弃会让卡片一直停在「无数据」。
    if (结果) {
      if (结果.已用 !== null && 结果.总量 !== null) {
        GPU显存 = { 已用: 结果.已用, 总量: 结果.总量 };
      }
      const 副标题 = GPU显存
        ? `${(GPU显存.已用 / 1024).toFixed(1)}/${(GPU显存.总量 / 1024).toFixed(1)} GB`
        : undefined;
      ctx.广播("widget.data", { id: "gpu", 值: Number(结果.使用率.toFixed(1)), 副标题 });
    }
  }
}

class 系统监控 extends BasePlugin {
  async on_load(ctx) {
    super.on_load(ctx);

    // 探测 GPU。探到才补声明组件，否则不声明——
    // 没显卡的机器看到一个永远「无数据」的卡片，会以为插件坏了。
    GPU可用 = 读GPU() !== null;
    if (GPU可用) {
      await ctx.声明小组件([GPU组件]);
    }

    // 1.5 秒一次：够实时，又远低于 20/秒的限流上限（这里才 2/秒）
    定时器 = setInterval(() => {
      try {
        采样并推送(ctx);
      } catch (err) {
        ctx.日志.警告(`采样失败：${String(err)}`);
      }
    }, 1500);
  }

  async on_unload() {
    // 必须清掉，否则插件卸载后定时器还在推数据，界面会收到「幽灵」推送
    if (定时器) clearInterval(定时器);
    定时器 = null;
  }
}

export default 定义插件(系统监控, {
  name: "sysmon",
  version: "0.2.0",
  description: "系统监控：CPU / 内存 / GPU 小组件",
  author: "kugua",
});
