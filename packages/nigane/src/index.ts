/**
 * 苦音（Nigane）协议 SDK
 * 提供信封类型定义、主控服务端（NiganeServer）与模块客户端（NiganeClient）。
 * 协议规范见 docs/开发细则.md 第三节。
 */

import { EventEmitter } from "node:events";
import { randomUUID } from "node:crypto";
import { WebSocketServer, WebSocket } from "ws";

/** 当前协议版本 */
export const 协议版本 = "0.1";

/** 消息类型枚举 */
export type 消息类型 =
  | "hello"
  | "hello_ack"
  | "request"
  | "response"
  | "event"
  | "error"
  | "ping"
  | "pong";

/** 苦音协议信封 */
export interface 信封 {
  nigane: string;
  id: string;
  type: 消息类型;
  from: string;
  to?: string;
  action?: string;
  params?: unknown;
  data?: unknown;
  code?: number;
  message?: string;
  echo?: string;
  time: number;
}

/** 错误码表（见开发细则 3.5） */
export const 错误码 = {
  认证失败: 1001,
  目标不存在: 1002,
  未注册: 1003,
  格式非法: 1004,
  请求超时: 1005,
} as const;

/** 构造信封，自动填充版本、id 与时间戳 */
export function 构造信封(部分: Pick<信封, "type" | "from"> & Partial<信封>): 信封 {
  return {
    nigane: 协议版本,
    id: randomUUID(),
    time: Math.floor(Date.now() / 1000),
    ...部分,
  };
}

/** 校验并解析 JSON 文本为信封；非法时返回 null */
export function 解析信封(文本: string): 信封 | null {
  let 对象: unknown;
  try {
    对象 = JSON.parse(文本);
  } catch {
    return null;
  }
  if (typeof 对象 !== "object" || 对象 === null) return null;
  const 候选 = 对象 as Record<string, unknown>;
  if (typeof 候选.nigane !== "string") return null;
  if (typeof 候选.id !== "string") return null;
  if (typeof 候选.type !== "string") return null;
  if (typeof 候选.from !== "string") return null;
  if (typeof 候选.time !== "number") return null;
  return 候选 as unknown as 信封;
}

export interface 服务端选项 {
  host?: string;
  port: number;
  /** 认证令牌；为空串时不校验 */
  token?: string;
}

/** 模块类型：process=独立进程；library=静态库/无需启动进程 */
export type 模块类型 = "process" | "library";

/** 模块描述（注册配置），由主控注入，用来区分进程型与库型模块以及它们的启动方式 */
export interface 模块描述 {
  name: string;
  type: 模块类型;
  /** process 类型：node 可执行脚本入口路径（绝对或相对 cwd） */
  entry?: string;
  /** library 类型：文件路径（存在即视为就绪） */
  file?: string;
  /** 是否自动启动（process 类型） */
  autoStart?: boolean;
  /** 说明文字 */
  description?: string;
  /** 附加参数，传递给子进程 */
  args?: string[];
}

/** 模块运行时详细信息（注册配置 + 状态） */
export interface 模块详情 extends 模块信息 {
  type?: 模块类型;
  /** process 类型：是否运行中（已连上主控且握过手） */
  online?: boolean;
  /** process 类型：子进程 PID（主控侧管理） */
  pid?: number;
  /** library 类型：文件是否存在 */
  fileExists?: boolean;
  autoStart?: boolean;
  description?: string;
  entry?: string;
  file?: string;
}

/** 模块握手信息 */
export interface 模块信息 {
  name: string;
  version?: string;
  capabilities?: string[];
}

/**
 * 主控服务端：维护模块注册表并路由消息。
 * 事件：
 *  - "registered" (模块信息) —— 模块注册成功
 *  - "unregistered" (模块名) —— 模块断线
 */
type 内置处理器 = (
    params: unknown,
    发送者: string,
  ) => unknown | Promise<unknown>;

export class NiganeServer extends EventEmitter {
  private wss?: WebSocketServer;
  private 注册表 = new Map<string, { socket: WebSocket; info: 模块信息 }>();
  private 连接名 = new Map<WebSocket, string>();
  private 描述表 = new Map<string, 模块描述>();
  private 内置处理器表 = new Map<string, 内置处理器>();

  constructor(private 选项: 服务端选项) {
    super();
  }

  /** 启动监听 */
  start(): Promise<void> {
    const host = this.选项.host ?? "127.0.0.1";
    return new Promise((resolve, reject) => {
      this.wss = new WebSocketServer({ host, port: this.选项.port });
      this.wss.on("listening", () => resolve());
      this.wss.on("error", (err) => reject(err));
      this.wss.on("connection", (socket) => this.处理连接(socket));
    });
  }

  /** 注册或更新一条模块描述（由主控注入） */
  setDescription(描述: 模块描述): void {
    this.描述表.set(描述.name, 描述);
  }

  /** 批量设置模块描述 */
  setDescriptions(列表: 模块描述[]): void {
    for (const d of 列表) this.描述表.set(d.name, d);
  }

  /** 获取模块描述 */
  getDescription(name: string): 模块描述 | undefined {
    return this.描述表.get(name);
  }

  /** 当前已注册模块名列表 */
  moduleNames(): string[] {
    return [...this.注册表.keys()];
  }

  /** 获取已注册模块信息（握手时上报的信息） */
  moduleInfos(): 模块信息[] {
    return [...this.注册表.values()].map((v) => v.info);
  }

  /** 获取模块详情（注册配置 + 运行时状态），可由外部设置 pid 等字段 */
  moduleDetails(附加信息?: Record<string, Partial<Pick<模块详情, "pid" | "fileExists" | "online">>>): 模块详情[] {
    const 全部名 = new Set([...this.描述表.keys(), ...this.注册表.keys()]);
    const 结果: 模块详情[] = [];
    for (const name of 全部名) {
      const 描述 = this.描述表.get(name);
      const 已注册 = this.注册表.get(name);
      const 附加 = 附加信息?.[name] ?? {};
      const online = 附加.online ?? Boolean(已注册);
      结果.push({
        name,
        version: 已注册?.info.version,
        capabilities: 已注册?.info.capabilities,
        type: 描述?.type,
        online,
        pid: 附加.pid,
        fileExists: 附加.fileExists,
        autoStart: 描述?.autoStart,
        description: 描述?.description,
        entry: 描述?.entry,
        file: 描述?.file,
      });
    }
    return 结果;
  }

  /** 注册一个自定义内置动作处理器（由主控侧注入业务动作） */
  handle(action: string, 处理器: 内置处理器): void {
    this.内置处理器表.set(action, 处理器);
  }

  /** 向全模块（除排除项）广播事件 */
  broadcast(action: string, params?: unknown, 排除?: string): void {
    const 消息 = JSON.stringify(
      构造信封({ type: "event", from: "kugua-main", action, params }),
    );
    for (const [名, { socket }] of this.注册表) {
      if (名 !== 排除 && socket.readyState === WebSocket.OPEN) socket.send(消息);
    }
  }

  /** 关闭服务端：先广播 system.shutdown，再断连接；可等待若干毫秒让各模块自行处理 */
  async stop(等待毫秒 = 200): Promise<void> {
    this.broadcast("system.shutdown", { time: Date.now() });
    if (等待毫秒 > 0) {
      await new Promise<void>((resolve) => setTimeout(resolve, 等待毫秒));
    }
    for (const { socket } of this.注册表.values()) socket.close(1001, "主控关闭");
    this.注册表.clear();
    this.连接名.clear();
    await new Promise<void>((resolve) => {
      if (!this.wss) return resolve();
      this.wss.close(() => resolve());
    });
  }

  private 处理连接(socket: WebSocket): void {
    // 握手超时：5 秒内未 hello 则断开
    const 定时器 = setTimeout(() => {
      if (!this.连接名.has(socket)) socket.close(1002, "握手超时");
    }, 5000);

    socket.on("message", (原始) => {
      const 消息 = 解析信封(原始.toString());
      if (!消息) {
        socket.close(1003, "消息格式非法");
        return;
      }
      if (消息.type === "hello") {
        clearTimeout(定时器);
        this.处理握手(socket, 消息);
        return;
      }
      const 发送者 = this.连接名.get(socket);
      if (!发送者) {
        this.回复错误(socket, 消息, 错误码.未注册, "请先完成 hello 握手");
        return;
      }
      this.路由(socket, 发送者, 消息);
    });

    socket.on("close", () => {
      clearTimeout(定时器);
      const 名 = this.连接名.get(socket);
      if (名) {
        this.连接名.delete(socket);
        // 仅当注册表中仍是本连接时才移除（防止顶号后误删）
        if (this.注册表.get(名)?.socket === socket) {
          this.注册表.delete(名);
          this.emit("unregistered", 名);
        }
      }
    });
  }

  private 处理握手(socket: WebSocket, 消息: 信封): void {
    const 参数 = (消息.params ?? {}) as Partial<模块信息> & { token?: string };
    const 名 = typeof 参数.name === "string" ? 参数.name : "";
    if (!名) {
      this.回复错误(socket, 消息, 错误码.格式非法, "hello 缺少模块名");
      socket.close(1003, "缺少模块名");
      return;
    }
    if (this.选项.token && 参数.token !== this.选项.token) {
      this.回复错误(socket, 消息, 错误码.认证失败, "令牌错误");
      socket.close(1002, "认证失败");
      return;
    }
    // 顶号：若旧连接存在则先关闭旧的，再以新连接替换
    if (this.注册表.has(名)) {
      const 旧 = this.注册表.get(名)!;
      try {
        旧.socket.close(1001, "顶号：模块以新连接重连");
      } catch {
        // ignore
      }
      this.连接名.delete(旧.socket);
      this.emit("unregistered", 名);
    }
    this.注册表.set(名, { socket, info: { name: 名, version: 参数.version, capabilities: 参数.capabilities } });
    this.连接名.set(socket, 名);
    socket.send(
      JSON.stringify(
        构造信封({
          type: "hello_ack",
          from: "kugua-main",
          to: 名,
          echo: 消息.id,
          data: { modules: this.moduleNames() },
        }),
      ),
    );
    this.emit("registered", {
      name: 名,
      version: 参数.version,
      capabilities: 参数.capabilities,
    } satisfies 模块信息);
  }

  private 路由(socket: WebSocket, 发送者: string, 消息: 信封): void {
    switch (消息.type) {
      case "ping": {
        socket.send(
          JSON.stringify(
            构造信封({ type: "pong", from: "kugua-main", to: 发送者, echo: 消息.id }),
          ),
        );
        return;
      }
      case "request":
      case "response":
      case "error": {
        if (消息.type === "request" && (消息.to === "kugua-main" || 消息.to === "nigane")) {
          void this.处理内置请求(socket, 发送者, 消息);
          return;
        }
        const 目标 = 消息.to ? this.注册表.get(消息.to)?.socket : undefined;
        if (!目标 || 目标.readyState !== WebSocket.OPEN) {
          if (消息.type === "request") {
            this.回复错误(socket, 消息, 错误码.目标不存在, `目标模块不存在：${消息.to ?? ""}`);
          }
          return;
        }
        目标.send(JSON.stringify(消息));
        return;
      }
      case "event": {
        const 文本 = JSON.stringify(消息);
        for (const [名, { socket: 成员 }] of this.注册表) {
          if (名 !== 发送者 && 成员.readyState === WebSocket.OPEN) 成员.send(文本);
        }
        return;
      }
      default:
        break;
    }
  }

  private async 处理内置请求(socket: WebSocket, 发送者: string, 消息: 信封): Promise<void> {
    const action = 消息.action ?? "";
    try {
      // 优先使用主控自定义处理器
      const 自定义 = this.内置处理器表.get(action);
      if (自定义) {
        const data = await 自定义(消息.params, 发送者);
        socket.send(
          JSON.stringify(
            构造信封({
              type: "response",
              from: "kugua-main",
              to: 发送者,
              echo: 消息.id,
              data,
            }),
          ),
        );
        return;
      }
      let data: unknown;
      switch (action) {
        case "nigane.modules.list":
          data = this.moduleInfos();
          break;
        case "nigane.modules.names":
          data = this.moduleNames();
          break;
        default:
          this.回复错误(socket, 消息, 错误码.目标不存在, `未知内置动作：${action}`);
          return;
      }
      socket.send(
        JSON.stringify(
          构造信封({
            type: "response",
            from: "kugua-main",
            to: 发送者,
            echo: 消息.id,
            data,
          }),
        ),
      );
    } catch (err) {
      this.回复错误(socket, 消息, 2000, err instanceof Error ? err.message : String(err));
    }
  }

  private 回复错误(socket: WebSocket, 原消息: 信封, code: number, message: string): void {
    if (socket.readyState !== WebSocket.OPEN) return;
    socket.send(
      JSON.stringify(
        构造信封({
          type: "error",
          from: "kugua-main",
          to: 原消息.from || undefined,
          echo: 原消息.id,
          code,
          message,
        }),
      ),
    );
  }
}

export interface 客户端选项 {
  /** 模块名（唯一） */
  name: string;
  /** 主控地址，如 ws://127.0.0.1:24601 */
  url: string;
  token?: string;
  version?: string;
  capabilities?: string[];
}

type 请求处理器 = (params: unknown, 消息: 信封) => unknown | Promise<unknown>;
type 事件处理器 = (params: unknown, 消息: 信封) => void;

/**
 * 模块客户端：连接主控、注册自身、收发消息。
 * 事件：
 *  - "event" (action, params, 消息) —— 收到未注册处理器的广播事件
 *  - "close" —— 连接关闭
 *  - "shutdown" (params) —— 主控即将关闭（system.shutdown 广播），模块可自行决定是否退出
 */
export class NiganeClient extends EventEmitter {
  private ws?: WebSocket;
  private 挂起 = new Map<
    string,
    { resolve: (data: unknown) => void; reject: (err: Error) => void; 定时器: NodeJS.Timeout }
  >();
  private 请求表 = new Map<string, 请求处理器>();
  private 事件表 = new Map<string, 事件处理器>();

  constructor(private 选项: 客户端选项) {
    super();
  }

  /** 建立连接并完成握手；认证失败或超时则 reject */
  connect(): Promise<void> {
    return new Promise((resolve, reject) => {
      const ws = new WebSocket(this.选项.url);
      this.ws = ws;
      const 超时 = setTimeout(() => {
        ws.close();
        reject(new Error("连接主控超时"));
      }, 5000);

      const 收尾 = () => clearTimeout(超时);

      ws.on("open", () => {
        ws.send(
          JSON.stringify(
            构造信封({
              type: "hello",
              from: this.选项.name,
              params: {
                name: this.选项.name,
                version: this.选项.version,
                capabilities: this.选项.capabilities ?? [],
                token: this.选项.token ?? "",
              },
            }),
          ),
        );
      });

      ws.on("message", (原始) => {
        const 消息 = 解析信封(原始.toString());
        if (!消息) return;
        if (消息.type === "hello_ack") {
          收尾();
          resolve();
          return;
        }
        if (消息.type === "error" && !this.连接名已确立(消息)) {
          收尾();
          reject(new Error(`握手被拒绝：[${消息.code}] ${消息.message ?? ""}`));
          return;
        }
        this.分发(消息);
      });

      ws.on("error", (err) => {
        收尾();
        reject(err);
      });

      ws.on("close", () => {
        收尾();
        this.清理挂起(new Error("连接已关闭"));
        this.emit("close");
      });
    });
  }

  /** 握手完成前 error 视为握手拒绝；此后 echo 对应挂起请求 */
  private 连接名已确立(消息: 信封): boolean {
    return typeof 消息.echo === "string" && this.挂起.has(消息.echo);
  }

  /** 关闭连接 */
  close(): void {
    this.ws?.close();
  }

  /** 发起请求并等待响应（默认 10 秒超时） */
  request(to: string, action: string, params?: unknown, 超时毫秒 = 10000): Promise<unknown> {
    const ws = this.ws;
    if (!ws || ws.readyState !== WebSocket.OPEN) {
      return Promise.reject(new Error("尚未连接主控"));
    }
    const 消息 = 构造信封({ type: "request", from: this.选项.name, to, action, params });
    this.记录日志("发送", 消息);
    return new Promise((resolve, reject) => {
      const 定时器 = setTimeout(() => {
        this.挂起.delete(消息.id);
        this.记录日志("超时", 消息);
        reject(new Error(`请求超时（${错误码.请求超时}）：${to}/${action}`));
      }, 超时毫秒);
      this.挂起.set(消息.id, { resolve, reject, 定时器 });
      ws.send(JSON.stringify(消息));
    });
  }

  /** 广播事件 */
  sendEvent(action: string, params?: unknown): void {
    if (this.ws?.readyState === WebSocket.OPEN) {
      const 消息 = 构造信封({ type: "event", from: this.选项.name, action, params });
      this.记录日志("发送", 消息);
      this.ws.send(JSON.stringify(消息));
    }
  }

  /** 记录一条通信日志，以 "log" 事件发出 */
  private 记录日志(方向: "发送" | "接收" | "超时", 消息: 信封): void {
    this.emit("log", {
      时间: Date.now(),
      方向,
      类型: 消息.type,
      from: 消息.from,
      to: 消息.to,
      action: 消息.action,
      id: 消息.id,
      echo: 消息.echo,
      code: 消息.code,
      message: 消息.message,
    });
  }

  /** 注册请求处理器 */
  onRequest(action: string, 处理器: 请求处理器): void {
    this.请求表.set(action, 处理器);
  }

  /** 注册事件处理器 */
  onEvent(action: string, 处理器: 事件处理器): void {
    this.事件表.set(action, 处理器);
  }

  private 分发(消息: 信封): void {
    this.记录日志("接收", 消息);
    switch (消息.type) {
      case "response":
      case "error": {
        if (typeof 消息.echo !== "string") return;
        const 项 = this.挂起.get(消息.echo);
        if (!项) return;
        this.挂起.delete(消息.echo);
        clearTimeout(项.定时器);
        if (消息.type === "error") {
          项.reject(new Error(`[${消息.code}] ${消息.message ?? "远端错误"}`));
        } else {
          项.resolve(消息.data);
        }
        return;
      }
      case "request": {
        void this.处理请求(消息);
        return;
      }
      case "event": {
        // 主控广播 system.shutdown：默认 emit shutdown 事件让模块自行决定是否退出
        if (消息.action === "system.shutdown") {
          this.emit("shutdown", 消息.params);
        }
        const 处理器 = 消息.action ? this.事件表.get(消息.action) : undefined;
        if (处理器) {
          处理器(消息.params, 消息);
        } else {
          this.emit("event", 消息.action, 消息.params, 消息);
        }
        return;
      }
      case "pong":
      default:
        return;
    }
  }

  private async 处理请求(消息: 信封): Promise<void> {
    const ws = this.ws;
    if (!ws || ws.readyState !== WebSocket.OPEN) return;
    const 处理器 = 消息.action ? this.请求表.get(消息.action) : undefined;
    if (!处理器) {
      ws.send(
        JSON.stringify(
          构造信封({
            type: "error",
            from: this.选项.name,
            to: 消息.from,
            echo: 消息.id,
            code: 错误码.目标不存在,
            message: `未知动作：${消息.action ?? ""}`,
          }),
        ),
      );
      return;
    }
    try {
      const data = await 处理器(消息.params, 消息);
      ws.send(
        JSON.stringify(
          构造信封({
            type: "response",
            from: this.选项.name,
            to: 消息.from,
            echo: 消息.id,
            data,
          }),
        ),
      );
    } catch (err) {
      ws.send(
        JSON.stringify(
          构造信封({
            type: "error",
            from: this.选项.name,
            to: 消息.from,
            echo: 消息.id,
            code: 2000,
            message: err instanceof Error ? err.message : String(err),
          }),
        ),
      );
    }
  }

  private 清理挂起(err: Error): void {
    for (const [, 项] of this.挂起) {
      clearTimeout(项.定时器);
      项.reject(err);
    }
    this.挂起.clear();
  }
}




