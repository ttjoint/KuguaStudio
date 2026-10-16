/**
 * MCP Client：连接外部 MCP server，把其工具导入为本平台能力。
 *
 * 用途：任何实现 MCP 的外部小项目（爬虫 / 安全测试 / 自研工具），
 * 无需编写 Node 适配，即可作为苦瓜工作室的模块使用。
 *
 * 详见 docs/互操作设计.md 第四节。
 */

import { spawn, type ChildProcessWithoutNullStreams } from "node:child_process";
import type { 能力声明 } from "@kugua/capability";
import { 工具转能力声明, type MCP工具, type MCP资源 } from "./schema.js";

export interface MCP客户端选项 {
  /** 启动命令，如 "python" / "node" / 可执行文件路径 */
  命令: string;
  /** 命令参数 */
  参数?: string[];
  /** 追加环境变量 */
  环境?: Record<string, string>;
  /** 工作目录 */
  工作目录?: string;
  /** 单次请求超时（毫秒），默认 30000 */
  超时毫秒?: number;
  /** 本客户端在能力声明里的模块名，默认 "mcp-client" */
  模块名?: string;
  /** 导入工具时的名称前缀，默认 "ext" */
  前缀?: string;
  日志?: (消息: string) => void;
}

interface 挂起项 {
  resolve: (值: unknown) => void;
  reject: (错误: Error) => void;
  定时器: NodeJS.Timeout;
}

interface JSONRPC消息 {
  jsonrpc?: string;
  id?: number | string | null;
  method?: string;
  params?: Record<string, unknown>;
  result?: unknown;
  error?: { code: number; message: string; data?: unknown };
}

/** 外部 MCP server 的连接句柄 */
export class MCP客户端 {
  private 缓冲 = "";
  private 序号 = 0;
  private 挂起 = new Map<number, 挂起项>();
  private 已关闭 = false;
  服务器信息: unknown = null;

  private constructor(
    private 子进程: ChildProcessWithoutNullStreams,
    private 选项: MCP客户端选项,
  ) {
    const 日志 = 选项.日志 ?? ((消息: string) => process.stderr.write(`[mcp-client] ${消息}\n`));
    子进程.stdout.setEncoding("utf-8");
    子进程.stdout.on("data", (块: string) => this.接收(块));
    子进程.stderr.setEncoding("utf-8");
    子进程.stderr.on("data", (块: string) => 日志(String(块).trimEnd()));
    子进程.on("exit", (码) => {
      this.已关闭 = true;
      for (const [, 项] of this.挂起) {
        clearTimeout(项.定时器);
        项.reject(new Error(`MCP server 已退出（code=${码}）`));
      }
      this.挂起.clear();
    });
  }

  /** 启动并完成 initialize 握手 */
  static async 连接(选项: MCP客户端选项): Promise<MCP客户端> {
    const 子进程 = spawn(选项.命令, 选项.参数 ?? [], {
      cwd: 选项.工作目录,
      env: { ...process.env, ...(选项.环境 ?? {}) },
      stdio: ["pipe", "pipe", "pipe"],
      windowsHide: true,
    });
    const 客户端 = new MCP客户端(子进程, 选项);
    await 客户端.请求("initialize", {
      protocolVersion: "2025-06-18",
      capabilities: {},
      clientInfo: { name: "kugua-studio", version: "0.1.0" },
    }).then((信息) => {
      客户端.服务器信息 = 信息;
    });
    客户端.通知("notifications/initialized", {});
    return 客户端;
  }

  /** 发送请求并等待响应 */
  async 请求(方法: string, 参数: Record<string, unknown>): Promise<unknown> {
    if (this.已关闭) throw new Error("MCP server 已关闭");
    const id = ++this.序号;
    const 超时 = this.选项.超时毫秒 ?? 30000;
    return new Promise<unknown>((resolve, reject) => {
      const 定时器 = setTimeout(() => {
        this.挂起.delete(id);
        reject(new Error(`MCP 请求超时：${方法}`));
      }, 超时);
      this.挂起.set(id, { resolve, reject, 定时器 });
      this.写出({ jsonrpc: "2.0", id, method: 方法, params: 参数 });
    });
  }

  /** 发送通知（无响应） */
  通知(方法: string, 参数: Record<string, unknown>): void {
    this.写出({ jsonrpc: "2.0", method: 方法, params: 参数 });
  }

  /** 列出外部工具 */
  async 列出工具(): Promise<MCP工具[]> {
    const 结果 = (await this.请求("tools/list", {})) as { tools?: MCP工具[] };
    return 结果.tools ?? [];
  }

  /** 调用外部工具 */
  async 调用工具(名称: string, 参数: unknown): Promise<unknown> {
    return this.请求("tools/call", { name: 名称, arguments: 参数 });
  }

  /** 列出外部资源 */
  async 列出资源(): Promise<MCP资源[]> {
    const 结果 = (await this.请求("resources/list", {})) as { resources?: MCP资源[] };
    return 结果.resources ?? [];
  }

  /** 读取外部资源 */
  async 读取资源(uri: string): Promise<unknown> {
    return this.请求("resources/read", { uri });
  }

  /** 把外部工具导入为本地能力声明 */
  async 导入能力(模块名 = this.选项.模块名 ?? "mcp-client"): Promise<能力声明[]> {
    const 工具列表 = await this.列出工具();
    return 工具列表.map((工具) =>
      工具转能力声明(工具, 模块名, {
        前缀: this.选项.前缀 ?? "ext",
        服务器: this.选项.命令,
      }),
    );
  }

  /** 关闭连接与子进程 */
  关闭(): void {
    if (this.已关闭) return;
    this.已关闭 = true;
    this.子进程.kill();
  }

  private 写出(消息: unknown): void {
    this.子进程.stdin.write(`${JSON.stringify(消息)}\n`);
  }

  private 接收(块: string): void {
    this.缓冲 += 块;
    let 换行位置 = this.缓冲.indexOf("\n");
    while (换行位置 >= 0) {
      const 行 = this.缓冲.slice(0, 换行位置).trim();
      this.缓冲 = this.缓冲.slice(换行位置 + 1);
      if (行) this.处理行(行);
      换行位置 = this.缓冲.indexOf("\n");
    }
  }

  private 处理行(行: string): void {
    let 消息: JSONRPC消息;
    try {
      消息 = JSON.parse(行) as JSONRPC消息;
    } catch {
      return;
    }
    if (typeof 消息.id !== "number") return; // 通知或服务端主动消息，暂不处理
    const 项 = this.挂起.get(消息.id);
    if (!项) return;
    this.挂起.delete(消息.id);
    clearTimeout(项.定时器);
    if (消息.error) {
      项.reject(new Error(`MCP 错误 ${消息.error.code}：${消息.error.message}`));
    } else {
      项.resolve(消息.result);
    }
  }
}
