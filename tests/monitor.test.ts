/**
 * 系统监控模块：系统状态采集与苦音总线集成
 */

import { afterEach, describe, expect, it } from "vitest";
import { NiganeClient, NiganeServer } from "../packages/nigane/src/index.js";
import { 采样CPU使用率, 采集快照, type 系统快照 } from "../packages/modules/monitor/src/system.js";
import { 注册监控处理器 } from "../packages/modules/monitor/src/handlers.js";

let 端口序号 = 25400;
const 待关闭: Array<() => unknown> = [];

async function 启动服务端(): Promise<{ url: string }> {
  const port = ++端口序号;
  const server = new NiganeServer({ port });
  await server.start();
  待关闭.push(() => server.stop());
  return { url: `ws://127.0.0.1:${port}` };
}

async function 接入(url: string, name: string): Promise<NiganeClient> {
  const client = new NiganeClient({ name, url });
  await client.connect();
  待关闭.push(() => client.close());
  return client;
}

afterEach(async () => {
  while (待关闭.length) await 待关闭.pop()?.();
});

describe("系统状态采集", () => {
  it("CPU 使用率为 0-100 的数字，核心数大于 0", async () => {
    const cpu = await 采样CPU使用率();
    expect(cpu.usagePct).toBeGreaterThanOrEqual(0);
    expect(cpu.usagePct).toBeLessThanOrEqual(100);
    expect(cpu.cores).toBeGreaterThan(0);
  }, 10000);

  it("完整快照结构：内存/磁盘字段齐全", async () => {
    const s = await 采集快照();
    expect(s.cpu).toBeDefined();
    expect(s.memory.total).toBeGreaterThan(0);
    expect(s.memory.usagePct).toBeGreaterThanOrEqual(0);
    expect(s.memory.usagePct).toBeLessThanOrEqual(100);
    expect(Array.isArray(s.disk)).toBe(true);
    for (const d of s.disk) {
      expect(typeof d.name).toBe("string");
      expect(d.total).toBeGreaterThan(0);
      expect(d.usagePct).toBeGreaterThanOrEqual(0);
    }
    expect(s.hostname.length).toBeGreaterThan(0);
  }, 15000);
});

describe("苦音总线集成", () => {
  it("monitor.stats 经总线返回快照，monitor.watch 可关闭", async () => {
    const { url } = await 启动服务端();
    const 监控端 = await 接入(url, "监控端");
    const 清理 = 注册监控处理器(监控端);
    const 调用方 = await 接入(url, "调用方");
    try {
      const 快照 = (await 调用方.request("监控端", "monitor.stats", {})) as 系统快照;
      expect(快照.cpu).toBeDefined();
      expect(快照.memory.total).toBeGreaterThan(0);
      expect(Array.isArray(快照.disk)).toBe(true);

      const 关 = (await 调用方.request("监控端", "monitor.watch", { enabled: false })) as { watching: boolean };
      expect(关.watching).toBe(false);
    } finally {
      清理();
    }
  }, 15000);
});
