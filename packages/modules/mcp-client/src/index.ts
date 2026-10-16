/**
 * MCP 接入模块
 *
 * 把两类"外部能力"导入为平台能力（能力注册表）：
 *  1) 外部 MCP server：配置于 kugua.config.json 的 mcp.servers[]；
 *  2) 本地脚本模块：扫描 mcp.scriptsDir 下各子目录中的 kugua-module.json 清单，
 *     按 manifest 启动进程并以 JSON Lines（MCP）通信。
 *
 * 每个外部工具注册为能力 `前缀.工具名`，动作同名，便于主控统一调用。
 * 详见 docs/互操作设计.md 第四、五节。
 */

import { existsSync, readFileSync, readdirSync } from "node:fs";
import { join, resolve } from "node:path";
import { 启动模块 } from "@kugua/module-kit";
import { MCP客户端 } from "@kugua/mcp";
import type { 能力声明 } from "@kugua/capability";

interface 外部服务配置 {
  name: string;
  command: string;
  args?: string[];
  env?: Record<string, string>;
  cwd?: string;
  prefix?: string;
  timeoutMs?: number;
}

/** 运行时发现的提供者（能力发现阶段写入） */
interface 提供者 {
  name: string;
  prefix: string;
  客户端: MCP客户端;
  动作表: Map<string, string>; // 动作名 -> 外部工具名
}

/** 扫描脚本模块清单：<scriptsDir>/<name>/kugua-module.json */
function 读取脚本清单(目录: string): 外部服务配置[] {
  const 绝对 = resolve(process.cwd(), 目录);
  if (!existsSync(绝对)) return [];
  const 结果: 外部服务配置[] = [];
  for (const 项 of readdirSync(绝对, { withFileTypes: true })) {
    if (!项.isDirectory()) continue;
    const 清单路径 = join(绝对, 项.name, "kugua-module.json");
    if (!existsSync(清单路径)) continue;
    try {
      const m = JSON.parse(readFileSync(清单路径, "utf-8")) as {
        name?: string;
        command?: string;
        entry?: string;
        args?: string[];
        env?: Record<string, string>;
        prefix?: string;
        timeoutMs?: number;
      };
      const command = m.command ?? m.entry;
      if (!m.name || !command) {
        console.warn(`[mcp-client] 清单缺少 name 或 command：${清单路径}`);
        continue;
      }
      结果.push({
        name: m.name,
        command,
        args: Array.isArray(m.args) ? m.args : [],
        env: m.env,
        cwd: join(绝对, 项.name),
        prefix: m.prefix ?? m.name,
        timeoutMs: m.timeoutMs,
      });
    } catch (err) {
      console.warn(`[mcp-client] 清单解析失败：${清单路径} — ${String(err)}`);
    }
  }
  return 结果;
}

/** 规范化前缀：去掉空白与非法字符 */
function 规范前缀(前缀: string, 回退: string): string {
  const p = (前缀 || 回退).trim().replace(/[^a-zA-Z0-9_.-]/g, "_");
  return p || 回退;
}

let 提供者列表: 提供者[] = [];
/** 由读配置阶段写入 */
let 脚本服务目录: string | null = null;
let 配置服务: 外部服务配置[] = [];

void 启动模块({
  name: "mcp-client",
  version: "0.1.0",
  读配置: (文件配置) => {
    const m = (文件配置.mcp ?? {}) as { scriptsDir?: string; servers?: 外部服务配置[] };
    脚本服务目录 = m.scriptsDir ?? "scripts/modules";
    配置服务 = m.servers ?? [];
    return {};
  },
  能力: async () => {
    const 脚本服务 = 读取脚本清单(脚本服务目录!);
    const 外部服务 = [...配置服务, ...脚本服务];
    const 能力清单: 能力声明[] = [];
    for (const 服务 of 外部服务) {
      const 前缀 = 规范前缀(服务.prefix ?? 服务.name, 服务.name);
      try {
        const 客户端 = await MCP客户端.连接({
          命令: 服务.command,
          参数: 服务.args,
          环境: 服务.env,
          工作目录: 服务.cwd,
          超时毫秒: 服务.timeoutMs,
          前缀,
          日志: (消息) => console.warn(`[mcp-client:${服务.name}] ${消息}`),
        });
        const 工具列表 = await 客户端.列出工具();
        const 动作表 = new Map<string, string>();
        for (const 工具 of 工具列表) {
          const 动作 = `${前缀}.${工具.name}`;
          动作表.set(动作, 工具.name);
          能力清单.push({
            名称: 动作,
            模块: "mcp-client",
            动作,
            标题: `${服务.name} · ${工具.name}`,
            说明: 工具.description ?? `外部 MCP 工具（${服务.name}）`,
            参数: 工具.inputSchema as 能力声明["参数"],
            权限: ["exec"],
            危险: true,
            暴露: { 指令: false, GUI: true, 定时: false, MCP: false },
            扩展: { mcp: { provider: 服务.name, tool: 工具.name } },
          });
        }
        提供者列表.push({ name: 服务.name, prefix: 前缀, 客户端, 动作表 });
        console.log(`[mcp-client] 已接入 ${服务.name}：${工具列表.length} 个工具（前缀 ${前缀}）`);
      } catch (err) {
        console.error(`[mcp-client] 接入失败 ${服务.name}：${String(err)}`);
      }
    }
    return 能力清单;
  },
  注册: (客户端) => {
    // 为每个外部工具注册动作处理器
    for (const 提供者 of 提供者列表) {
      for (const [动作, 工具名] of 提供者.动作表) {
        客户端.onRequest(动作, async (params) => {
          const 结果 = (await 提供者.客户端.调用工具(工具名, params ?? {})) as {
            content?: Array<{ type: string; text?: string }>;
            isError?: boolean;
          };
          if (结果?.isError) {
            throw new Error(结果.content?.[0]?.text ?? "外部工具返回错误");
          }
          const 文本 = 结果?.content?.find((c) => c.type === "text")?.text;
          return 文本 ?? 结果;
        });
      }
    }

    客户端.onRequest("mcp-client.providers", () =>
      提供者列表.map((p) => ({ name: p.name, prefix: p.prefix, tools: [...p.动作表.values()] })),
    );
  },
  关闭: () => {
    for (const p of 提供者列表) p.客户端.关闭();
  },
  就绪: () => console.log("[mcp-client] 已接入主控"),
});
