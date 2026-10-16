/**
 * 系统监控模块
 * 提供 monitor.stats（CPU/内存/磁盘快照）与 monitor.watch（周期广播）。
 *
 * 启动样板（读配置 / 连主控 / 处理退出）已收敛到 @kugua/module-kit。
 */

import { 启动模块 } from "@kugua/module-kit";
import { 注册监控处理器 } from "./handlers.js";

void 启动模块({
  name: "monitor",
  version: "0.6.0",
  注册: (客户端) => 注册监控处理器(客户端),
  就绪: (_客户端, _配置, 连接) => console.log(`[监控] 已接入主控：${连接.url}`),
});
