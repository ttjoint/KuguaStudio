/**
 * 能力表：危险闸门（君子协议）
 *
 * 定位：这不是安全防护（同进程可直接改库文件），而是**开发期约束**——
 * 防止自动化模块/AI 入口「顺手」调用删除类能力而没人发现。
 *
 * 关键约定：
 * - `危险: true` 的能力，只有 `调用者 === "用户"` 才放行
 * - 其他调用者（模块名 / capability.call / system / AI 入口）一律拒绝
 */
import { describe, expect, it } from "vitest";
import { 能力注册表, type 能力声明 } from "../src/index.js";

/** 记录路由到的请求，便于断言「是否真的执行了」 */
function 造调用器(): {
  调用器: { 请求: (目标: string, 动作: string, 参数?: unknown) => Promise<unknown> };
  记录: Array<{ 目标: string; 动作: string; 参数: unknown }>;
} {
  const 记录: Array<{ 目标: string; 动作: string; 参数: unknown }> = [];
  return {
    调用器: {
      async 请求(目标, 动作, 参数) {
        记录.push({ 目标, 动作, 参数 });
        return { ok: true };
      },
    },
    记录,
  };
}

const 只读能力: 能力声明 = { 名称: "mkg.note.list", 模块: "mkg", 标题: "笔记列表" };
const 危险能力: 能力声明 = {
  名称: "mkg.tag.delete",
  模块: "mkg",
  标题: "删除标签",
  危险: true,
};

describe("危险闸门：危险能力只允许用户调用", () => {
  it("用户调用危险能力 → 放行", async () => {
    const 表 = new 能力注册表();
    表.批量注册([只读能力, 危险能力]);
    const { 调用器, 记录 } = 造调用器();

    await 表.调用("mkg.tag.delete", { id: 1 }, 调用器, "用户");

    expect(记录).toHaveLength(1);
    expect(记录[0]).toEqual({ 目标: "mkg", 动作: "mkg.tag.delete", 参数: { id: 1 } });
  });

  it("模块调用危险能力 → 拒绝，且不路由到模块", async () => {
    const 表 = new 能力注册表();
    表.批量注册([危险能力]);
    const { 调用器, 记录 } = 造调用器();

    await expect(表.调用("mkg.tag.delete", { id: 1 }, 调用器, "agent")).rejects.toThrow(
      /被标记为危险/,
    );
    // 关键：必须没有真正发出去
    expect(记录).toHaveLength(0);
  });

  it("默认调用者（不传 = system）调用危险能力 → 拒绝", async () => {
    const 表 = new 能力注册表();
    表.批量注册([危险能力]);
    const { 调用器, 记录 } = 造调用器();

    await expect(表.调用("mkg.tag.delete", { id: 1 }, 调用器)).rejects.toThrow(/被标记为危险/);
    expect(记录).toHaveLength(0);
  });

  it("capability.call 作为调用者 → 拒绝（不能借道绕过）", async () => {
    const 表 = new 能力注册表();
    表.批量注册([危险能力]);
    const { 调用器, 记录 } = 造调用器();

    await expect(
      表.调用("mkg.tag.delete", { id: 1 }, 调用器, "capability.call"),
    ).rejects.toThrow(/被标记为危险/);
    expect(记录).toHaveLength(0);
  });

  it("错误信息说明清楚：能力名、标题、调用者、如何放行", async () => {
    const 表 = new 能力注册表();
    表.批量注册([危险能力]);
    const { 调用器 } = 造调用器();

    const 错误 = await 表.调用("mkg.tag.delete", {}, 调用器, "agent").catch((e: Error) => e);
    expect(错误).toBeInstanceOf(Error);
    const 消息 = (错误 as Error).message;
    expect(消息).toContain("mkg.tag.delete");
    expect(消息).toContain("删除标签");
    expect(消息).toContain("agent");
    expect(消息).toContain("用户"); // 提示如何合法放行
  });

  it("非危险能力：任何调用者都放行", async () => {
    const 表 = new 能力注册表();
    表.批量注册([只读能力]);
    const { 调用器, 记录 } = 造调用器();

    for (const 调用者 of ["用户", "agent", "system", "capability.call", "scheduler"]) {
      await 表.调用("mkg.note.list", {}, 调用器, 调用者);
    }
    expect(记录).toHaveLength(5);
  });

  it("能力不存在时先报「不存在」，不是「危险」", async () => {
    const 表 = new 能力注册表();
    const { 调用器 } = 造调用器();
    await expect(表.调用("不存在的能力", {}, 调用器, "agent")).rejects.toThrow(/能力不存在/);
  });
});
