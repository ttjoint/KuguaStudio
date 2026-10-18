/**
 * 模板插件
 * 演示：生命周期钩子、命令注册、Context 宿主能力（日志/请求/订阅/配置）。
 * 构建后产物 dist/index.js 由插件运行时动态导入。
 *
 * 配置声明写在 kugua-plugin.json 的「配置声明」里，平台据此生成配置页。
 * 插件侧用 ctx.配置() 读当前值——**每次调用都取最新值**，平台改完立即生效。
 */

import {
  BasePlugin,
  定义插件,
  type Context,
  type 消息上下文,
} from "@kugua/plugin-sdk";

/** 小组件采样定时器（卸载时必须清掉） */
let 定时器: ReturnType<typeof setInterval> | null = null;

class 模板插件 extends BasePlugin {
  async on_load(ctx: Context): Promise<void> {
    super.on_load(ctx);

    // 读配置：拿到的是本插件的配置节本身（不是整个配置文件）。
    // 没声明过头时返回空对象，所以这里一律给默认值兜底。
    const 配置 = await ctx.配置();
    const 打招呼语 = typeof 配置.greeting === "string" && 配置.greeting ? 配置.greeting : "你好呀";
    ctx.日志.信息(`配置读取成功：打招呼语=「${打招呼语}」，启用=${配置.enabled !== false}`);

    // 聊天命令：命中正则即触发，返回字符串/消息段即回复当前会话
    this.注册命令({
      匹配: /^(你好|hello)$/i,
      处理: async (消息: 消息上下文) => {
        // 每次命令都重新读配置：用户刚在配置页改完，下一条命令就该按新值回应，
        // 不需要重载插件。
        const 当前 = await ctx.配置();
        if (当前.enabled === false) return; // 用户关掉了回应
        const 语 = typeof 当前.greeting === "string" && 当前.greeting ? 当前.greeting : 打招呼语;
        return `${语} ${消息.用户号}！我是模板插件，命令与生命周期均正常。`;
      },
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

    // —— 小组件：向主界面注入实时数字（声明写在 kugua-plugin.json 的 widgets 里）——
    // 注意这里**不说放在哪**：位置、大小、形态都由平台决定。
    // 你只负责「块里显示什么」和「多久推一次」。
    let 问候次数 = 0;
    let 活跃度 = 0;
    定时器 = setInterval(() => {
      活跃度 = Math.min(100, 活跃度 + 7);
      ctx.广播("widget.data", { id: "hello.level", 值: 活跃度 });
      if (活跃度 >= 100) {
        问候次数 += 1;
        ctx.广播("widget.data", { id: "hello.count", 值: 问候次数 });
        活跃度 = 0;
      }
    }, 1500);

    ctx.日志.信息("模板插件 on_load 完成");
  }

  async on_enable(): Promise<void> {
    this.上下文?.日志.信息("模板插件已启用");
  }

  async on_disable(): Promise<void> {
    this.上下文?.日志.信息("模板插件已禁用");
  }

  async on_unload(): Promise<void> {
    // 必须清掉定时器：否则插件卸载后还在推数据，界面会收到「幽灵」值
    if (定时器) clearInterval(定时器);
    定时器 = null;
    this.上下文?.日志.信息("模板插件已卸载");
  }
}

export default 定义插件(模板插件, {
  name: "template",
  version: "0.1.0",
  description: "模板插件：演示生命周期、命令注册与 Context 宿主能力",
  author: "your-name",
});
