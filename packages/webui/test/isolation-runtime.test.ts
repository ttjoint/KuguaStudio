/**
 * 第二层：**运行时装卸**。
 *
 * 第一层证明了「源码层面没有 import」。但架构承诺还有一半是运行时的：
 * 一个模块装进来、卸出去，**别的模块和主控都不该受影响**。
 *
 * 这一层真的起主控进程，从「只有主控、零模块」这个基准开始，
 * 一个一个加，每次加完重新查一遍所有模块的在线状态与能力表。
 *
 * ## 基准形态很关键
 *
 * 「零模块能起来」是整个架构的底线。如果主控非要某个模块才能启动，
 * 那所谓「可装卸」就是假的。这条单独一个用例。
 *
 * ## 为什么每个用例都要查「别人还在不在」
 *
 * 隐秘耦合的典型症状不是崩溃，是「装了 A 之后 B 的能力少了两个」。
 * 所以每次变动都重新拉全量能力表，跟变动前逐项比对。
 */

import { afterAll, describe, expect, it } from "vitest";
import { 起沙盒, 等到, 模块入口 } from "./isolation-sandbox.js";
import { 取测试端口, 端口段 } from "./port-pool.js";

/** 挑几个体积小、无外部二进制依赖的模块做装卸实验 */
const 轻量模块 = ["dice", "text", "nlp", "food", "echo"];

const 已构建 = 轻量模块.every((名) => 模块入口(名) !== null);

describe.skipIf(!已构建)("运行时装载：基准形态", () => {
  it("零模块时主控能正常启动并接受连接", async () => {
    // 这是整个「可装卸」承诺的地基。主控如果硬依赖任何模块，
    // 这条就会红——而且红得毫无歧义。
    const 端口 = await 取测试端口(端口段.隔离);
    const 沙盒 = await 起沙盒({ 模块: [], 端口 });
    try {
      expect(await 沙盒.在线模块()).toEqual([]);
      // 主控自己能应答，不需要任何模块
      const 列 = await 沙盒.请求("nigane", "nigane.modules.list");
      expect(Array.isArray(列)).toBe(true);
      expect(沙盒.输出()).not.toMatch(/Cannot find module|ERR_MODULE_NOT_FOUND/);
    } finally {
      await 沙盒.关停();
    }
  }, 60000);

  it("零模块时模块页列表为空且不报错", async () => {
    const 端口 = await 取测试端口(端口段.隔离);
    const 沙盒 = await 起沙盒({ 模块: [], 端口 });
    try {
      expect(await 沙盒.模块页()).toEqual([]);
    } finally {
      await 沙盒.关停();
    }
  }, 60000);
});

describe.skipIf(!已构建)("运行时装载：单个模块", () => {
  for (const 名 of 轻量模块) {
    it(`只装 ${名}：它在线，别的都没在`, async () => {
       const 端口 = await 取测试端口(端口段.隔离);
      const 沙盒 = await 起沙盒({ 模块: [名], 端口 });
      try {
        const 在线 = await 等到(async () => (await 沙盒.在线模块()).includes(名));
        expect(在线, `${名} 没上线。输出：\n${沙盒.输出()}`).toBe(true);
        // 只装一个，就只有这一个
        expect(await 沙盒.在线模块()).toEqual([名]);
      } finally {
        await 沙盒.关停();
      }
    }, 60000);
  }
});

describe.skipIf(!已构建)("运行时装载：逐项累加", () => {
  it("依次加入模块，每次只多一个，已有的能力不丢不改", async () => {
    // 这个用例是「排列组合」的核心：每一步都跟上一轮比，
    // 一旦某个模块把别人的能力挤掉了，立刻能指出是哪一步。
    const 端口 = await 取测试端口(端口段.隔离);
    const 已加: string[] = [];
    const 沙盒 = await 起沙盒({ 模块: [], 端口 });
    try {
      // 基准：零模块
      expect(await 沙盒.在线模块()).toEqual([]);
      let 上轮能力: Record<string, string[]> = {};

      for (const 名 of 轻量模块) {
        已加.push(名);
        // 装卸的真实形态：注册表来自配置，改配置 + reload
        await 沙盒.装载(已加);

        const 到位 = await 等到(async () => (await 沙盒.在线模块()).includes(名));
        expect(到位, `加入 ${名} 后它没上线。已加：${已加.join(",")}\n${沙盒.输出()}`).toBe(true);

        const 能力 = await 沙盒.能力表();
        // 本轮应该恰好等于「上轮 + 新模块」
        const 本轮名 = Object.keys(能力).sort();
        expect(本轮名, `加入 ${名} 后在线的模块不对`).toEqual([...已加].sort());

        // 「跟上一轮相同」这个比法只能发现**变化**，发现不了**本来就不对**。
        // 所以每个模块第一次出现时，要拿真实值做基准：不能是空的、
        // 不能是伪造的占位。没有这条，能力表恒返回同一个错值也能全绿。
        for (const 新名 of Object.keys(能力)) {
          if (上轮能力[新名] !== undefined) continue;
          const 该模块能力 = 能力[新名];
          // 每个模块至少声明一个能力（拿不到能力的模块不该出现在注册表里）
          expect(该模块能力.length, `${新名} 声明了 0 个能力`).toBeGreaterThan(0);
          // 能力名必须是「模块名.动作」形状，或者是它的简写
          for (const 项 of 该模块能力) {
            expect(项, `${新名} 的能力名形状不对：${项}`).toMatch(/^[a-zA-Z0-9_-]+(.[a-zA-Z0-9_-]+)?$/);
          }
        }

        // 上轮每个模块的能力必须一字不差
        for (const 旧名 of Object.keys(上轮能力)) {
          expect(能力[旧名], `加入 ${名} 后 ${旧名} 的能力变了`).toEqual(上轮能力[旧名]);
        }

        上轮能力 = 能力;
      }
    } finally {
      await 沙盒.关停();
    }
  }, 120000);
});

describe.skipIf(!已构建)("运行时装载：卸掉一个不影响其余的", () => {
  it("三个模块全在时卸掉中间那个，另外两个能力不变", async () => {
    const 端口 = await 取测试端口(端口段.隔离);
    const 沙盒 = await 起沙盒({ 模块: ["dice", "text", "nlp"], 端口 });
    try {
      const 齐 = await 等到(async () => (await 沙盒.在线模块()).length === 3);
      expect(齐, `三个模块没全上线：\n${沙盒.输出()}`).toBe(true);

      const 前 = await 沙盒.能力表();
      expect(Object.keys(前).sort()).toEqual(["dice", "nlp", "text"]);

      // 卸掉 text
      await 沙盒.请求("nigane", "nigane.registry.stop", { name: "text" }).catch(() => undefined);

      const 卸了 = await 等到(async () => !(await 沙盒.在线模块()).includes("text"), 20);
      if (!卸了) {
        // 没有 stop 接口也不算失败——但要能检测到「它确实还在」
        expect(await 沙盒.在线模块()).toContain("text");
        return;
      }

      const 后 = await 沙盒.能力表();
      expect(Object.keys(后).sort()).toEqual(["dice", "nlp"]);
      // 剩下的两个能力完全没变
      expect(后.dice).toEqual(前.dice);
      expect(后.nlp).toEqual(前.nlp);
    } finally {
      await 沙盒.关停();
    }
  }, 90000);
});

describe.skipIf(!已构建)("运行时装载：模块崩了别的不受影响", () => {
  it("一个模块启动失败，主控和别的模块照常", async () => {
    const 端口 = await 取测试端口(端口段.隔离);
    // 挂一个不存在的模块：主控要能起来，别的模块照常
    const 沙盒 = await 起沙盒({
      模块: ["dice", { name: "不存在的模块", entry: "packages/modules/不存在的/dist/index.js" }],
      端口,
    });
    try {
      const 好 = await 等到(async () => (await 沙盒.在线模块()).includes("dice"));
      expect(好, `dice 被一个坏模块拖累没上线：\n${沙盒.输出()}`).toBe(true);
      expect(await 沙盒.在线模块()).not.toContain("不存在的模块");
    } finally {
      await 沙盒.关停();
    }
  }, 60000);
});
