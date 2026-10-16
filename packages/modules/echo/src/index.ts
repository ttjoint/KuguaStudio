/**
 * echo 示例模块
 * 注册 "echo" 能力：将收到的请求参数原样返回。
 *
 * 启动样板（读配置 / 连主控 / 处理退出）已收敛到 @kugua/module-kit。
 */

import { 启动模块 } from "@kugua/module-kit";
import type { 能力声明 } from "@kugua/capability";

const 能力清单: 能力声明[] = [
  {
    名称: "echo",
    模块: "echo",
    标题: "回声",
    说明: "将收到的参数原样返回，用于连通性与协议自检",
    暴露: { 指令: true, GUI: true, 定时: true, MCP: true },
  },
];

void 启动模块({
  name: "echo",
  version: "0.1.0",
  能力: 能力清单,
  处理器: {
    echo: (参数) => 参数,
  },
});
