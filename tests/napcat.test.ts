/**
 * M2 集成测试：OneBot 11 协议库 + Napcat 桥接模块
 * 以 ws 模拟 Napcat 服务端，验证：
 *  - API 调用 echo 匹配与错误分支
 *  - 事件分类派发
 *  - 桥接上行（Napcat 事件 → 苦音广播）
 *  - 桥接下行（苦音请求 → Napcat API）
 */

import { afterEach, describe, expect, it } from "vitest";
import { WebSocketServer, WebSocket } from "ws";
import { Ob11Client, 段, 提取纯文本 } from "../packages/onebot11/src/index.js";
import { NiganeServer, NiganeClient } from "../packages/nigane/src/index.js";
import { 启动Napcat桥, type Napcat桥 } from "../packages/modules/napcat/src/bridge.js";

let 端口序号 = 26100;
const 待关闭: Array<() => unknown> = [];

afterEach(async () => {
  while (待关闭.length) {
    await 待关闭.pop()?.();
  }
});

/** 启动模拟 Napcat 服务端，返回收到帧的队列与发送函数 */
async function 启动模拟Napcat(): Promise<{
  url: string;
  收到帧: Record<string, unknown>[];
  连接就绪: Promise<WebSocket>;
  推送: (对象: Record<string, unknown>) => void;
}> {
  const port = ++端口序号;
  const wss = new WebSocketServer({ host: "127.0.0.1", port });
  待关闭.push(
    () => new Promise((r) => wss.close(() => r(undefined))),
  );
  const 收到帧: Record<string, unknown>[] = [];
  let 当前socket: WebSocket | undefined;
  let 解锁: (ws: WebSocket) => void;
  const 连接就绪 = new Promise<WebSocket>((r) => (解锁 = r));
  wss.on("connection", (ws) => {
    当前socket = ws;
    解锁(ws);
    ws.on("message", (数据) => {
      const 帧 = JSON.parse(数据.toString()) as Record<string, unknown>;
      收到帧.push(帧);
      // 模拟 Napcat API 应答
      if (typeof 帧.action === "string") {
        if (帧.action === "永远失败") {
          ws.send(
            JSON.stringify({ status: "failed", retcode: 1404, message: "模拟失败", echo: 帧.echo }),
          );
        } else {
          ws.send(
            JSON.stringify({ status: "ok", retcode: 0, data: { message_id: 233 }, echo: 帧.echo }),
          );
        }
      }
    });
  });
  await new Promise((r) => wss.on("listening", r));
  return {
    url: `ws://127.0.0.1:${port}`,
    收到帧,
    连接就绪,
    推送: (对象) => 当前socket?.send(JSON.stringify(对象)),
  };
}

/** 构造标准群消息事件 */
function 群消息报文(文本: string): Record<string, unknown> {
  return {
    time: 1720000000,
    self_id: 10000,
    post_type: "message",
    message_type: "group",
    sub_type: "normal",
    message_id: 555,
    group_id: 123456,
    user_id: 789,
    message: [{ type: "text", data: { text: 文本 } }],
    raw_message: 文本,
    font: 0,
    sender: { user_id: 789, nickname: "测试员" },
  };
}

describe("OneBot 11 协议库", () => {
  it("消息段构造与纯文本提取", () => {
    const 段列 = [段.文本("你好"), 段.at(123), 段.文本("苦瓜")];
    expect(提取纯文本(段列)).toBe("你好苦瓜");
    expect(段.图片("a.jpg").data.file).toBe("a.jpg");
    expect(段.商城表情(1, 2, "k").type).toBe("mface");
  });

  it("callApi 经 echo 匹配返回 data", async () => {
    const 模拟 = await 启动模拟Napcat();
    const 客户端 = new Ob11Client({ url: 模拟.url });
    待关闭.push(() => 客户端.close());
    await 客户端.connect();
    await 模拟.连接就绪;

    const data = (await 客户端.sendGroupMsg(123456, "测试消息")) as { message_id: number };
    expect(data.message_id).toBe(233);

    const 请求帧 = 模拟.收到帧.find((f) => f.action === "send_group_msg");
    expect(请求帧).toBeTruthy();
    expect((请求帧!.params as { group_id: number }).group_id).toBe(123456);
    expect(typeof 请求帧!.echo).toBe("string");
  });

  it("callApi 失败时 reject 并带 retcode", async () => {
    const 模拟 = await 启动模拟Napcat();
    const 客户端 = new Ob11Client({ url: 模拟.url });
    待关闭.push(() => 客户端.close());
    await 客户端.connect();
    await 模拟.连接就绪;
    await expect(客户端.callApi("永远失败")).rejects.toThrow(/1404/);
  });

  it("事件按分类派发", async () => {
    const 模拟 = await 启动模拟Napcat();
    const 客户端 = new Ob11Client({ url: 模拟.url });
    待关闭.push(() => 客户端.close());
    await 客户端.connect();
    const socket = await 模拟.连接就绪;

    const 收到 = new Promise<Record<string, unknown>>((r) =>
      客户端.on("message.group", (e) => r(e as Record<string, unknown>)),
    );
    socket.send(JSON.stringify(群消息报文("分类测试")));
    const 事件 = await 收到;
    expect(事件.group_id).toBe(123456);
    expect(提取纯文本(事件.message as never[])).toBe("分类测试");
  });

  it("主动关闭后停止重连", async () => {
    const port = ++端口序号;
    const wss = new WebSocketServer({ host: "127.0.0.1", port });
    await new Promise((r) => wss.on("listening", r));
    待关闭.push(
      () => new Promise((r) => wss.close(() => r(undefined))),
    );
    const 客户端 = new Ob11Client({ url: `ws://127.0.0.1:${port}` });
    await 客户端.connect();
    expect(客户端.在线).toBe(true);
    客户端.close();
    await new Promise((r) => setTimeout(r, 50));
    expect(客户端.在线).toBe(false);
    expect((客户端 as unknown as { 重连计时?: NodeJS.Timeout }).重连计时).toBeFalsy();
  });
});

describe("Napcat 桥接模块", () => {
  it("上行：Napcat 事件广播到苦音总线", async () => {
    const 模拟 = await 启动模拟Napcat();
    const 主控 = new NiganeServer({ port: ++端口序号 });
    await 主控.start();
    待关闭.push(() => 主控.stop());
    const 苦音地址 = `ws://127.0.0.1:${主控端口(主控)}`;

    const 桥 = await 启动Napcat桥({ 苦音地址, napcat地址: 模拟.url });
    待关闭.push(() => 桥.关闭());

    const 观察者 = new NiganeClient({ name: "观察者", url: 苦音地址 });
    await 观察者.connect();
    待关闭.push(() => 观察者.close());

    const 收到 = new Promise<unknown>((r) =>
      观察者.onEvent("napcat.message.group", (p) => r(p)),
    );
    模拟.推送(群消息报文("桥上测试"));
    const 事件 = (await 收到) as { group_id: number; raw_message: string };
    expect(事件.group_id).toBe(123456);
    expect(事件.raw_message).toBe("桥上测试");
  });

  it("下行：苦音请求经桥调用 Napcat API", async () => {
    const 模拟 = await 启动模拟Napcat();
    const 主控 = new NiganeServer({ port: ++端口序号 });
    await 主控.start();
    待关闭.push(() => 主控.stop());
    const 苦音地址 = `ws://127.0.0.1:${主控端口(主控)}`;

    const 桥 = await 启动Napcat桥({ 苦音地址, napcat地址: 模拟.url });
    待关闭.push(() => 桥.关闭());

    const 调用方 = new NiganeClient({ name: "调用方", url: 苦音地址 });
    await 调用方.connect();
    待关闭.push(() => 调用方.close());

    const data = (await 调用方.request("napcat", "send_group_msg", {
      group_id: 123456,
      message: [段.文本("桥下测试")],
    })) as { message_id: number };
    expect(data.message_id).toBe(233);

    const 请求帧 = 模拟.收到帧.find((f) => f.action === "send_group_msg");
    expect(请求帧).toBeTruthy();
    const 参数 = 请求帧!.params as { message: { type: string; data: { text: string } }[] };
    expect(参数.message[0].data.text).toBe("桥下测试");
  });

  it("下行：api 透传任意动作", async () => {
    const 模拟 = await 启动模拟Napcat();
    const 主控 = new NiganeServer({ port: ++端口序号 });
    await 主控.start();
    待关闭.push(() => 主控.stop());
    const 苦音地址 = `ws://127.0.0.1:${主控端口(主控)}`;

    const 桥 = await 启动Napcat桥({ 苦音地址, napcat地址: 模拟.url });
    待关闭.push(() => 桥.关闭());

    const 调用方 = new NiganeClient({ name: "调用方", url: 苦音地址 });
    await 调用方.connect();
    待关闭.push(() => 调用方.close());

    await 调用方.request("napcat", "api", { action: "get_login_info", params: {} });
    expect(模拟.收到帧.some((f) => f.action === "get_login_info")).toBe(true);
  });
});

/** 从服务端实例取端口（测试内网场景） */
function 主控端口(server: NiganeServer): number {
  return (server as unknown as { 选项: { port: number } }).选项.port;
}

