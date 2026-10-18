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
 */
import os from "node:os";
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
}

class 系统监控 extends BasePlugin {
  async on_load(ctx) {
    super.on_load(ctx);
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
  version: "0.1.0",
  description: "系统监控：CPU / 内存小组件",
  author: "kugua",
});
