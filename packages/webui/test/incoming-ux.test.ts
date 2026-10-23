/**
 * 反向关联 UI + 删除前警告
 *
 * 使用者视角的问题：
 * 1. 只能看到「我引用了谁」，看不到「谁引用了我」
 * 2. 删除被引用的内容时，那些引用会被外键级联**静默删除**，
 *    引用方不会收到任何提示——数据在无警告下消失。
 */
import { describe, expect, it } from "vitest";
import { existsSync, readFileSync } from "node:fs";
import { resolve } from "node:path";

const 根 = resolve(process.cwd(), "packages/webui");
function 读(相对: string): string {
  const p = resolve(根, 相对);
  if (!existsSync(p)) throw new Error(`找不到：${p}`);
  return readFileSync(p, "utf-8");
}

const 关联源 = () => 读("src/renderer/parts/07o-explorer-relations.ts");
const 操作源 = () => 读("src/renderer/parts/07i-explorer-actions.ts");

describe("详情栏「被引用」区块", () => {
  it("调 mkg.relation.incoming", () => {
    expect(关联源()).toContain('"mkg.relation.incoming"');
  });

  it("显示「被引用 (N)」且视觉可区分", () => {
    expect(关联源()).toContain("被引用 (");
    expect(关联源()).toContain('className = "ex-info-relation-group incoming"');
  });

  it("标注对方用了哪种关系", () => {
    expect(关联源()).toContain("ex-info-relation-type");
    expect(关联源()).toContain("对方以「");
  });

  it("无人引用时不显示空区块（避免噪音）", () => {
    const 源 = 关联源();
    const 段 = 源.slice(源.indexOf("async function 渲染反向关联"));
    expect(段).toContain("if (列表.length === 0) return;");
  });

  it("异步守卫：切换内容时不画旧结果", () => {
    const 源 = 关联源();
    const 段 = 源.slice(源.indexOf("async function 渲染反向关联"));
    expect(段.slice(0, 800)).toContain("渲染中的节点ID !== nodeId");
  });
});

describe("删除前引用警告", () => {
  it("有 统计被引用数 辅助函数", () => {
    expect(操作源()).toContain("async function 统计被引用数");
    expect(操作源()).toContain('"mkg.relation.incoming"');
  });

  it("批量删除：有引用时弹确认", () => {
    const 源 = 操作源();
    const 段 = 源.slice(源.indexOf("export async function 删除选中内容"), 源.indexOf("async function 执行删除选中内容"));
    expect(段).toContain("统计被引用数");
    expect(段).toContain("显示确认对话框");
    expect(段).toContain("正被其它内容引用");
  });

  it("批量删除：无引用时直接执行（不打扰）", () => {
    const 源 = 操作源();
    const 段 = 源.slice(源.indexOf("export async function 删除选中内容"), 源.indexOf("async function 执行删除选中内容"));
    expect(段).toContain("await 执行删除选中内容(ids)");
  });

  it("删除到回收站：有引用时也弹确认", () => {
    const 源 = 操作源();
    const 段 = 源.slice(源.indexOf("export async function 删除到回收站"), 源.indexOf("async function 执行删除到回收站"));
    expect(段).toContain("统计被引用数");
    expect(段).toContain("正被 ${引用.总数} 处内容引用");
  });

  it("警告文案说明「引用方不会收到提示」", () => {
    expect(操作源()).toContain("引用方不会收到提示");
  });

  it("确认后才真正删除（取消则不删）", () => {
    const 源 = 操作源();
    // 回调里判断 ok 才执行
    expect(源).toMatch(/\(ok\) => \{\s*if \(ok\) void 执行删除/);
  });
});
