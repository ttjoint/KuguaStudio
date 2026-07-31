/**
 * 苦音协议集成测试（里程碑 M1 验收）
 * 覆盖：握手认证、request/response、未知目标、事件广播、心跳。
 */

import { afterEach, describe, expect, it } from "vitest";
import {
  NiganeClient,
  NiganeServer,
  解析信封,
  构造信封,
  错误码,
} from "../packages/nigane/src/index.js";

// 每个用例使用独立端口，避免冲突
let 端口序号 = 25100;
const 待关闭: Array<() => unknown> = [];

async function 启动服务端(token = ""): Promise<{ server: NiganeServer; url: string }> {
  const port = ++端口序号;
  const server = new NiganeServer({ port, token });
  await server.start();
  待关闭.push(() => server.stop());
  return { server, url: `ws://127.0.0.1:${port}` };
}

async function 接入客户端(
  url: string,
  name: string,
  token = "",
  info?: { version?: string; capabilities?: string[] },
): Promise<NiganeClient> {
  const client = new NiganeClient({ name, url, token, ...info });
  await client.connect();
  待关闭.push(() => client.close());
  return client;
}

afterEach(async () => {
  while (待关闭.length) {
    await 待关闭.pop()?.();
  }
});

describe("信封", () => {
  it("构造与解析互逆", () => {
    const 原 = 构造信封({ type: "request", from: "甲", to: "乙", action: "echo", params: { 数: 1 } });
    const 解析 = 解析信封(JSON.stringify(原));
    expect(解析).toEqual(原);
  });

  it("拒绝非法文本", () => {
    expect(解析信封("不是 json")).toBeNull();
    expect(解析信封("{}")).toBeNull();
    expect(解析信封(JSON.stringify({ nigane: "0.1" }))).toBeNull();
  });
});

describe("苦音全链路", () => {
  it("request/response 回环", async () => {
    const { url } = await 启动服务端();
    const 回声 = await 接入客户端(url, "回声");
    回声.onRequest("echo", (params) => params);

    const 调用方 = await 接入客户端(url, "调用方");
    const 数据 = { 问候: "你好，苦瓜", 列表: [1, 2, 3] };
    await expect(调用方.request("回声", "echo", 数据)).resolves.toEqual(数据);
  });

  it("认证失败被拒绝", async () => {
    const { url } = await 启动服务端("正确令牌");
    await expect(接入客户端(url, "冒名者", "错误令牌")).rejects.toThrow(/1001/);
  });

  it("未注册消息收到未注册错误", async () => {
    const { server, url } = await 启动服务端();
    const { WebSocket } = await import("ws");
    const ws = new WebSocket(url);
    const 收到 = new Promise<Record<string, unknown>>((resolve) => {
      ws.on("message", (原始) => resolve(JSON.parse(原始.toString())));
    });
    await new Promise((r) => ws.on("open", r));
    ws.send(
      JSON.stringify(构造信封({ type: "request", from: "黑户", to: "任意", action: "x" })),
    );
    const 消息 = (await 收到) as { type: string; code: number };
    expect(消息.type).toBe("error");
    expect(消息.code).toBe(错误码.未注册);
    ws.close();
    expect(server.moduleNames()).toEqual([]);
  });

  it("请求不存在模块返回目标不存在", async () => {
    const { url } = await 启动服务端();
    const 调用方 = await 接入客户端(url, "调用方");
    await expect(调用方.request("不存在", "echo")).rejects.toThrow(/1002/);
  });

  it("事件广播送达其他模块", async () => {
    const { url } = await 启动服务端();
    const 甲 = await 接入客户端(url, "甲");
    const 乙 = await 接入客户端(url, "乙");
    const 丙 = await 接入客户端(url, "丙");

    const 乙收到 = new Promise<unknown>((r) => 乙.onEvent("广播", (p) => r(p)));
    const 丙收到 = new Promise<unknown>((r) => 丙.onEvent("广播", (p) => r(p)));
    const 甲静默 = new Promise<string>((r) => {
      const t = setTimeout(() => r("未收到"), 300);
      甲.onEvent("广播", () => {
        clearTimeout(t);
        r("收到了");
      });
    });

    甲.sendEvent("广播", { 内容: "开会了" });
    await expect(乙收到).resolves.toEqual({ 内容: "开会了" });
    await expect(丙收到).resolves.toEqual({ 内容: "开会了" });
    await expect(甲静默).resolves.toBe("未收到");
  });

  it("心跳 ping 收到 pong", async () => {
    const { url } = await 启动服务端();
    const 客户端 = await 接入客户端(url, "心跳者");
    const { WebSocket } = await import("ws");
    // 直接借道底层 socket 验证协议层 ping/pong
    const ws = (客户端 as unknown as { ws: InstanceType<typeof WebSocket> }).ws;
    const pong = new Promise<Record<string, unknown>>((r) => {
      ws.on("message", (原始) => {
        const m = JSON.parse(原始.toString());
        if (m.type === "pong") r(m);
      });
    });
    ws.send(JSON.stringify(构造信封({ type: "ping", from: "心跳者" })));
    const 消息 = (await pong) as { type: string; to: string };
    expect(消息.type).toBe("pong");
    expect(消息.to).toBe("心跳者");
  });

  it("同名模块新连接顶掉旧连接（动态顶号）", async () => {
    const { server, url } = await 启动服务端();
    const 下线: string[] = [];
    server.on("unregistered", (n) => 下线.push(n));
    const 旧客户端 = await 接入客户端(url, "同名", "", { version: "0.1.0", capabilities: ["a"] });
    void 旧客户端;
    const 新客户端 = new NiganeClient({ name: "同名", url, version: "0.2.0", capabilities: ["b"] });
    await 新客户端.connect();
    待关闭.push(() => 新客户端.close());
    await new Promise<void>((r) => setTimeout(r, 80));
    expect(下线).toContain("同名");
    const list = server.moduleInfos();
    expect(list).toHaveLength(1);
    expect(list[0].version).toBe("0.2.0");
    expect(list[0].capabilities).toEqual(["b"]);
  });

  it("内置 nigane.modules.list 返回已注册模块", async () => {
    const { url } = await 启动服务端();
    const 甲 = await 接入客户端(url, "甲", "", { version: "1.0", capabilities: ["a"] });
    await 接入客户端(url, "乙", "", { version: "2.0", capabilities: ["b", "c"] });

    const list = (await 甲.request("kugua-main", "nigane.modules.list", {})) as Array<{
      name: string;
      version?: string;
      capabilities?: string[];
    }>;
    const names = list.map((m) => m.name).sort();
    expect(names).toEqual(["乙", "甲"]);
    const 甲信息 = list.find((m) => m.name === "甲")!;
    expect(甲信息.version).toBe("1.0");
    expect(甲信息.capabilities).toEqual(["a"]);
  });
});



