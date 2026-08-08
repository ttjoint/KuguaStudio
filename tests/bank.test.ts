/**
 * 积分系统模块（P3）：银行核心逻辑与苦音总线集成
 */

import { afterEach, describe, expect, it } from "vitest";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { resolve } from "node:path";
import { NiganeClient, NiganeServer } from "../packages/nigane/src/index.js";
import { 银行, 系统账户 } from "../packages/modules/bank/src/bank.js";
import { 银行存储 } from "../packages/modules/bank/src/store.js";
import { 注册银行处理器 } from "../packages/modules/bank/src/handlers.js";

let 端口序号 = 25700;
const 待关闭: Array<() => unknown> = [];
const 临时目录: string[] = [];

function 建银行(): { 银行实例: 银行; 目录: string } {
  const 目录 = mkdtempSync(resolve(tmpdir(), "kugua-bank-"));
  临时目录.push(目录);
  const 银行实例 = new 银行(new 银行存储(目录));
  银行实例.load();
  return { 银行实例, 目录 };
}

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
  while (临时目录.length) {
    try {
      rmSync(临时目录.pop()!, { recursive: true, force: true });
    } catch {
      // ignore
    }
  }
});

describe("银行核心逻辑", () => {
  it("签到：新账户领取低保，同日重复签到被拒绝", () => {
    const { 银行实例 } = 建银行();
    const 第一次 = 银行实例.签到("甲", "阿甲");
    expect(第一次.reward).toBeGreaterThan(0);
    expect(第一次.账户.money).toBe(第一次.reward);
    expect(第一次.账户.signTimes).toBe(1);

    const 第二次 = 银行实例.签到("甲");
    expect(第二次.reward).toBe(0);
    expect(第二次.message).toContain("已经签过");
    expect(第二次.账户.money).toBe(第一次.reward);
  });

  it("充值/转账/余额不足/捐款", () => {
    const { 银行实例 } = 建银行();
    银行实例.充值("甲", 1000, "阿甲");
    银行实例.充值("乙", 500, "阿乙");

    const 转 = 银行实例.转账("甲", "乙", 300, "请客");
    expect(转.ok).toBe(true);
    expect(银行实例.查询("甲")!.money).toBe(700);
    expect(银行实例.查询("乙")!.money).toBe(800);

    const 不足 = 银行实例.转账("乙", "甲", 99999);
    expect(不足.ok).toBe(false);
    expect(不足.message).toContain("余额不足");

    const 捐 = 银行实例.捐款("甲", 100);
    expect(捐.ok).toBe(true);
    expect(银行实例.查询("甲")!.money).toBe(600);
    expect(银行实例.查询(系统账户)!.money).toBe(100);
  });

  it("非法金额被拒绝", () => {
    const { 银行实例 } = 建银行();
    expect(() => 银行实例.充值("甲", -5)).toThrow("正数");
    expect(银行实例.转账("甲", "乙", 0).ok).toBe(false);
  });

  it("排行榜按余额排序", () => {
    const { 银行实例 } = 建银行();
    银行实例.充值("甲", 100);
    银行实例.充值("乙", 900);
    银行实例.充值("丙", 500);
    const 富 = 银行实例.排行("rich");
    expect(富.map((a) => a.id)).toEqual(["乙", "丙", "甲"]);
    const 穷 = 银行实例.排行("poor");
    expect(穷.map((a) => a.id)).toEqual(["甲", "丙", "乙"]);
  });

  it("流水记录与持久化重载", () => {
    const { 银行实例, 目录 } = 建银行();
    银行实例.充值("甲", 100, "阿甲", "开张");
    银行实例.转账("甲", "乙", 30, "打赏");
    const 流水 = 银行实例.流水("甲");
    expect(流水.length).toBe(2);
    expect(流水[0].message).toBe("转账成功");
    expect(流水[1].message).toBe("充值成功");

    const 重载 = new 银行(new 银行存储(目录));
    重载.load();
    expect(重载.查询("甲")!.money).toBe(70);
    expect(重载.查询("乙")!.money).toBe(30);
    expect(重载.流水("甲").length).toBe(2);
  });

  it("系统账户可透支转账", () => {
    const { 银行实例 } = 建银行();
    const 转 = 银行实例.转账(系统账户, "乙", 1000);
    expect(转.ok).toBe(true);
    expect(银行实例.查询(系统账户)!.money).toBe(-1000);
  });
});

describe("苦音总线集成", () => {
  it("bank 全部动作经总线可用", async () => {
    const { url } = await 启动服务端();
    const { 银行实例 } = 建银行();
    const bank端 = await 接入(url, "bank端");
    注册银行处理器(bank端, 银行实例);
    const 调用方 = await 接入(url, "调用方");

    const 充 = (await 调用方.request("bank端", "bank.grant", { user: "甲", amount: 500 })) as {
      ok: boolean;
      message: string;
    };
    expect(充.ok).toBe(true);

    const 签 = (await 调用方.request("bank端", "bank.sign", { user: "甲", name: "阿甲" })) as {
      reward: number;
      message: string;
    };
    expect(签.reward).toBeGreaterThan(0);

    const 余额 = (await 调用方.request("bank端", "bank.balance", { user: "甲" })) as {
      账户: { id: string; money: number; name: string };
    };
    expect(余额.账户.id).toBe("甲");
    expect(余额.账户.money).toBeCloseTo(500 + 签.reward, 2);

    const 转 = (await 调用方.request("bank端", "bank.transfer", { from: "甲", to: "乙", amount: 100 })) as {
      ok: boolean;
    };
    expect(转.ok).toBe(true);

    const 榜 = (await 调用方.request("bank端", "bank.rank", { order: "rich" })) as {
      list: Array<{ id: string; money: number }>;
    };
    expect(榜.list[0].id).toBe("甲");

    const 流水 = (await 调用方.request("bank端", "bank.ledger", { user: "甲" })) as {
      list: unknown[];
    };
    expect(流水.list.length).toBeGreaterThanOrEqual(3);

    const 状态 = (await 调用方.request("bank端", "bank.status", {})) as { unit: string; accountCount: number };
    expect(状态.unit).toBe("马币");
    expect(状态.accountCount).toBeGreaterThanOrEqual(2);
  });
});
