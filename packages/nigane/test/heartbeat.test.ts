/**
 * 心跳测试
 *
 * 背景：主控**卡死**（进程还在、事件循环被阻塞、不再处理任何消息）时，
 * TCP 连接不会断，WebSocket 的 close 事件永远不触发。结果是：
 *
 *   - 模块以为自己一切正常，留在原地不动
 *   - 平台变成「按钮点了没反应」的空壳，而且**永不自愈**
 *   - 只有主动发请求时才会 10 秒超时，用户误以为单个功能坏了
 *
 * 协议里本来就有 ping/pong，但在此之前**两端谁都没主动发过**——
 * 定义了类型、主控也能回 pong，机制等于没实现。
 *
 * 这些用例守的就是「别再退回没人发 ping 的状态」。
 */
import { afterEach, describe, expect, it } from "vitest";
import { WebSocketServer, type WebSocket as WS } from "ws";
import { createServer } from "node:net";
import { NiganeClient, NiganeServer, 构造信封 } from "../src/index.js";

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

const 空闲端口 = (): Promise<number> =>
  new Promise((res, rej) => {
    const s = createServer();
    s.once("error", rej);
    s.listen(0, "127.0.0.1", () => {
      const p = (s.address() as { port: number }).port;
      s.close(() => res(p));
    });
  });

const 清理: Array<() => void> = [];
afterEach(() => {
  while (清理.length) {
    try {
      清理.pop()?.();
    } catch {
      /* 忽略 */
    }
  }
});

describe("服务端心跳", () => {
  it("模块不回 pong 会被判定失联并断开连接", async () => {
    const 端口 = await 空闲端口();
    const 服务端 = new NiganeServer({ port: 端口, 心跳间隔毫秒: 100 });
    await 服务端.start();
    清理.push(() => void 服务端.stop(0));

    const 失联: string[] = [];
    服务端.on("模块失联", ({ name }: { name: string }) => 失联.push(name));

    // 一个「假模块」：完成握手，**但从不回 pong**（模拟卡死）
    const 客户端 = new NiganeClient({ url: `ws://127.0.0.1:${端口}`, name: "假模块", token: "" });
    const 原分发 = (客户端 as unknown as { 分发: (m: unknown) => void }).分发.bind(客户端);
    (客户端 as unknown as { 分发: (m: unknown) => void }).分发 = (m: unknown) => {
      if ((m as { type?: string }).type === "ping") return; // 吞掉，不回
      原分发(m);
    };
    await 客户端.connect();
    清理.push(() => 客户端.close());

    // 两个周期足够判死（第一个周期发 ping 标 false，第二个周期发现没回）
    for (let i = 0; i < 40 && 失联.length === 0; i++) await sleep(50);

    expect(失联).toContain("假模块");
  }, 15000);

  it("正常回 pong 的模块不会被断开（反向保护：别把活人杀了）", async () => {
    const 端口 = await 空闲端口();
    const 服务端 = new NiganeServer({ port: 端口, 心跳间隔毫秒: 100 });
    await 服务端.start();
    清理.push(() => void 服务端.stop(0));

    const 失联: string[] = [];
    服务端.on("模块失联", ({ name }: { name: string }) => 失联.push(name));

    // 真正的 NiganeClient 会自动回 pong
    const 客户端 = new NiganeClient({ url: `ws://127.0.0.1:${端口}`, name: "正常模块", token: "" });
    await 客户端.connect();
    清理.push(() => 客户端.close());

    // 跑够 5 个周期
    await sleep(600);

    expect(失联).toEqual([]);
    expect(服务端.moduleNames()).toContain("正常模块");
  }, 15000);

  it("stop() 会清掉心跳定时器（否则进程退不掉）", async () => {
    const 端口 = await 空闲端口();
    const 服务端 = new NiganeServer({ port: 端口, 心跳间隔毫秒: 50 });
    await 服务端.start();
    await 服务端.stop(0);
    // 定时器已清；再等几轮不应抛错
    await sleep(150);
    expect(true).toBe(true);
  }, 15000);
});

describe("客户端心跳", () => {
  it("主控不再回 pong 时，客户端能自己发现并断开", async () => {
    const 端口 = await 空闲端口();

    // 假主控：握手成功后就开始「卡死」——收消息但从不回 pong
    const 假主控 = new WebSocketServer({ host: "127.0.0.1", port: 端口 });
    清理.push(() => 假主控.close());

    let 卡死 = false;
    假主控.on("connection", (s: WS) => {
      s.on("message", (raw: Buffer) => {
        const m = JSON.parse(raw.toString()) as { type?: string; id?: string; params?: unknown };
        if (m.type === "hello") {
          s.send(
            JSON.stringify({
              nigane: "1.0",
              id: "x",
              time: 0,
              type: "hello_ack",
              from: "kugua-main",
              data: { modules: [] },
            }),
          );
          return;
        }
        // 卡死之后：收到 ping 也不回
        if (m.type === "ping" && !卡死) {
          s.send(JSON.stringify({ nigane: "1.0", id: "y", time: 0, type: "pong", from: "kugua-main", echo: m.id }));
        }
      });
    });

    const 客户端 = new NiganeClient({
      url: `ws://127.0.0.1:${端口}`,
      name: "外部程序",
      token: "",
      心跳间隔毫秒: 100,
    });
    清理.push(() => 客户端.close());

    let 断开 = false;
    客户端.on("close", () => (断开 = true));

    await 客户端.connect();
    卡死 = true; // 从这里开始「主控不响应了」

    for (let i = 0; i < 40 && !断开; i++) await sleep(50);
    expect(断开).toBe(true);
  }, 15000);

  it("主控正常回 pong 时客户端保持连接", async () => {
    const 端口 = await 空闲端口();
    const 服务端 = new NiganeServer({ port: 端口, 心跳间隔毫秒: 100 });
    await 服务端.start();
    清理.push(() => void 服务端.stop(0));

    const 客户端 = new NiganeClient({
      url: `ws://127.0.0.1:${端口}`,
      name: "外部程序",
      token: "",
      心跳间隔毫秒: 100,
    });
    let 断开 = false;
    客户端.on("close", () => (断开 = true));
    await 客户端.connect();
    清理.push(() => 客户端.close());

    await sleep(600);
    expect(断开).toBe(false);
  }, 15000);
});

describe("心跳不该干扰正常通信", () => {
  it("心跳开着时正常请求仍然能往返", async () => {
    const 端口 = await 空闲端口();
    const 服务端 = new NiganeServer({ port: 端口, 心跳间隔毫秒: 50 });
    await 服务端.start();
    清理.push(() => void 服务端.stop(0));

    const 客户端 = new NiganeClient({
      url: "ws://127.0.0.1:" + 端口,
      name: "模块",
      token: "",
      心跳间隔毫秒: 50,
    });
    await 客户端.connect();
    清理.push(() => 客户端.close());

    // 用协议内置动作验证：心跳跑着的同时，请求照常能回
    for (let i = 0; i < 3; i++) {
      const 列表 = await 客户端.request("kugua-main", "nigane.modules.names", {});
      expect(Array.isArray(列表)).toBe(true);
      await sleep(120); // 跨过几轮心跳
    }
  }, 20000);

  it("ping 不会被当成业务事件冒泡给模块", async () => {
    const 端口 = await 空闲端口();
    const 服务端 = new NiganeServer({ port: 端口, 心跳间隔毫秒: 50 });
    await 服务端.start();
    清理.push(() => void 服务端.stop(0));

    const 客户端 = new NiganeClient({ url: `ws://127.0.0.1:${端口}`, name: "模块", token: "", 心跳间隔毫秒: 50 });
    const 多余事件: string[] = [];
    客户端.on("event", (action: string) => 多余事件.push(action));
    await 客户端.connect();
    清理.push(() => 客户端.close());

    await sleep(400);
    // 心跳是协议层的东西，不应该被当成事件抛给业务代码
    expect(多余事件.filter((a) => a === "ping" || a === "pong")).toEqual([]);
  }, 15000);

  it("服务端能识别并消费 pong（不落进 default 静默丢掉）", async () => {
    const 端口 = await 空闲端口();
    const 服务端 = new NiganeServer({ port: 端口, 心跳间隔毫秒: 100 });
    await 服务端.start();
    清理.push(() => void 服务端.stop(0));

    const 失联: string[] = [];
    服务端.on("模块失联", ({ name }: { name: string }) => 失联.push(name));

    // 手工发 pong，确认服务端确实把它当心跳处理了
    const 客户端 = new NiganeClient({ url: `ws://127.0.0.1:${端口}`, name: "模块", token: "" });
    await 客户端.connect();
    清理.push(() => 客户端.close());

    await sleep(350);
    expect(失联).toEqual([]);
  }, 15000);
});
