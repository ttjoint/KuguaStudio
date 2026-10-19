/**
 * 第五层：**聊天框指令在模块缺席时的表现**。
 *
 * 这是整套可装卸架构里最容易被忽略的一环。
 *
 * ## 问题在哪
 *
 * `04-router.ts` 里有一批**硬编码路由**：`"占卜"` → `divination`、
 * `"吃什么"` → `food`、`"1d6"` → `dice`、图片指令 → `image`……
 * 共 28 处，集中在 dice / food / image / text 四个模块。
 *
 * 路由器是同步纯函数，它**不知道**目标模块在不在线——它只负责
 * 「这句话该归谁」。所以如果 food 模块被卸了，用户输入「今天吃什么」
 * 会走到 `window.kugua.request("food", "food.recommend", ...)`，
 * 而总线那边没有任何叫 food 的模块。
 *
 * ## 这时应该发生什么
 *
 * **必须给出人话的失败**，不能是：
 * - 静默无反应（最坏——用户以为程序卡了）
 * - 抛一个未捕获异常打崩界面
 * - 一直转圈
 *
 * `执行路由()` 把 `request` 包在 try/catch 里，失败时
 * `添加回应(\`【\${描述}】失败：\${String(err)}\`, ..., true)`。
 * 所以正确表现是：**界面上出现一条带「失败」字样的回复**。
 *
 * ## 这一层怎么测
 *
 * 不起浏览器（renderer 依赖 DOM，Node 里跑不了）。测的是**下层契约**：
 * 总线对「发给不存在的模块」的响应必须是 error，且错误信息里要有
 * 那个模块名——否则前端拼出来的「失败：xxx」看不出该去启用哪个模块。
 *
 * 前端的展示逻辑另有源码契约测试守着（`ui-module-contract.test.ts`
 * 那一类），这里不重复。
 */

import { describe, expect, it } from "vitest";
import { 起沙盒, 等到, 模块入口 } from "./isolation-sandbox.js";
import { 取测试端口, 端口段 } from "./port-pool.js";

/** 路由器里硬编码的目标模块 —— 少了任何一个都该有人被迫改这条注释 */
const 路由目标模块 = ["dice", "food", "image", "text", "divination", "nlp"] as const;

describe("模块缺席时的指令降级", () => {
  it("向不存在的模块发请求，总线明确报错并带上模块名", async () => {
    const 端口 = await 取测试端口(端口段.隔离);
    const 沙盒 = await 起沙盒({ 模块: [], 端口 });
    try {
      expect(await 沙盒.在线模块()).toEqual([]);

      const 错 = await 沙盒.裸请求("food", "food.recommend", { time: "今天", verb: "吃" }).then(
        () => null,
        (e: Error) => e,
      );

      expect(错, "向不存在的模块发请求居然成功了？").not.toBeNull();
      // 前端会把它拼成「【今天吃什么】失败：<这里>」。
      // 带模块名的话，用户/日志里能直接看出该去启用谁。
      // 只认「有模块名」这一条：`目标模块不存在` 这种没名字的错误
      // 对用户没用——他要知道的是该去启用**哪个**模块。
      expect(错!.message, `错误信息里没有模块名：${错!.message}`).toContain("food");
    } finally {
      await 沙盒.关停();
    }
  }, 60000);

  it("只装了 dice 时，food 的请求照样明确失败，dice 的却好使", async () => {
    // 这一条防的是「总线把请求错发给了别的模块」——
    // 比全空时更接近真实场景，也是真正的解耦检验。
    const 端口 = await 取测试端口(端口段.隔离);
    const 沙盒 = await 起沙盒({ 模块: ["dice"], 端口 });
    try {
      expect(await 等到(async () => (await 沙盒.在线模块()).includes("dice"))).toBe(true);

      const food错 = await 沙盒.裸请求("food", "food.recommend", { time: "今天", verb: "吃" }).then(
        () => null,
        (e: Error) => e,
      );
      expect(food错, "food 没装却成功了——请求被错误路由到了别的模块").not.toBeNull();

      // dice 自己得正常
      const 骰 = await 沙盒.请求("dice", "dice.roll", { expression: "1d6", count: 1, sides: 6 });
      expect(骰).toBeTruthy();
    } finally {
      await 沙盒.关停();
    }
  }, 90000);
});

describe.skipIf(模块入口("dice") === null)("逐个模块缺席：错误都点名模块", () => {
  it("对每个硬编码路由目标发请求，都不静默", async () => {
    const 端口 = await 取测试端口(端口段.隔离);
    const 沙盒 = await 起沙盒({ 模块: [], 端口 });
    try {
      expect(await 沙盒.在线模块()).toEqual([]);

      const 静默的: string[] = [];
      for (const 名 of 路由目标模块) {
        if (模块入口(名) === null) continue;
        const 结果 = await 沙盒.裸请求(名, `${名}.nonexistent`, {}).then(
          () => "竟返回成功",
          (e: Error) => e.message,
        );
        // 「返回成功」也算静默——一个不存在的模块不该应答任何东西
        if (结果 === "竟返回成功") 静默的.push(`${名}（成功）`);
        else if (!结果 || 结果.trim().length === 0) 静默的.push(`${名}（空错误信息）`);
        // 错误里得能看出是哪个模块
        else if (!结果.includes(名)) 静默的.push(`${名}（错误里没点名：${结果}）`);
      }

      expect(静默的, `这些模块缺席时没给出可读错误：${静默的.join("、")}`).toEqual([]);
    } finally {
      await 沙盒.关停();
    }
  }, 60000);
});
