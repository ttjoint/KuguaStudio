/**
 * 模板插件
 * 演示：生命周期钩子、命令注册、Context 宿主能力（日志/请求/订阅）。
 * 构建后产物 dist/index.js 由插件运行时动态导入。
 */

import {
  BasePlugin,
  定义插件,
  type Context,
  type 消息上下文,
} from "@kugua/plugin-sdk";

class 模板插件 extends BasePlugin {
  async on_load(ctx: Context): Promise<void> {
    super.on_load(ctx);

    // 聊天命令：命中正则即触发，返回字符串/消息段即回复当前会话
    this.注册命令({
      匹配: /^(你好|hello)$/i,
      处理: async (消息: 消息上下文) =>
        `你好呀 ${消息.用户号}！我是模板插件，命令与生命周期均正常。`,
      说明: "问候回复",
    });

    this.注册命令({
      匹配: /^模板ping$/i,
      处理: async (消息: 消息上下文) => {
        // 演示经苦音总线请求其他模块（此处示例银行余额，未安装则报错提示）
        try {
          const r = (await 消息.请求("bank", "bank.balance", {
            user: "local",
            name: "本地用户",
          })) as { 账户?: { name?: string; money?: number }; unit?: string };
          return `pong！本地账户 ${r.账户?.name ?? "?"} 余额：${r.账户?.money ?? "?"}${r.unit ?? ""}`;
        } catch {
          return "pong！（bank 模块不可用，仅演示请求能力）";
        }
      },
      说明: "演示模块请求",
    });

    ctx.日志.信息("模板插件 on_load 完成");
  }

  async on_enable(): Promise<void> {
    this.上下文?.日志.信息("模板插件已启用");
  }

  async on_disable(): Promise<void> {
    this.上下文?.日志.信息("模板插件已禁用");
  }

  async on_unload(): Promise<void> {
    this.上下文?.日志.信息("模板插件已卸载");
  }
}

export default 定义插件(模板插件, {
  name: "template",
  version: "0.1.0",
  description: "模板插件：演示生命周期、命令注册与 Context 宿主能力",
  author: "your-name",
});
