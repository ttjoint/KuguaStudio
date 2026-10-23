/**
 * 批量打标签 UI 契约
 *
 * 使用者视角：多选内容后此前只能删除。想给 10 条统一打标签，
 * 只能一条条点开详情栏——而 setNodeTags 是覆盖式，单条操作也会
 * 冲掉原有标签。现提供批量追加/移除。
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
const 批量源 = () => 读("src/renderer/parts/07p-explorer-batch-tags.ts");

describe("批量打标签 UI", () => {
  it("工具栏有批量标签按钮", () => {
    const 源 = 读("src/renderer/index.html");
    expect(源).toContain('id="ex-btn-tag-selected"');
    expect(源).toContain('id="ex-tag-selected-count"');
  });

  it("按钮标题说明「不覆盖原有标签」", () => {
    expect(读("src/renderer/index.html")).toContain("不覆盖原有标签");
  });

  it("支持追加与移除两种模式", () => {
    const 源 = 批量源();
    expect(源).toContain('"mkg.node.addTags"');
    expect(源).toContain('"mkg.node.removeTags"');
  });

  it("勾选标签后才能提交", () => {
    const 源 = 批量源();
    expect(源).toContain("确定.disabled = 勾选.size === 0");
  });

  it("提示文案区分两种模式的风险", () => {
    const 源 = 批量源();
    expect(源).toContain("原有标签会保留，只追加勾选的标签");
    expect(源).toContain("只移除勾选的标签，其它标签保留");
  });

  it("结果反馈包含更新数与跳过数", () => {
    const 源 = 批量源();
    expect(源).toContain("结果.更新");
    expect(源).toContain("结果.跳过");
  });

  it("按钮可见性与删除按钮同步（挂在 更新批量删除按钮 里）", () => {
    const 源 = 读("src/renderer/parts/07i-explorer-actions.ts");
    const 段 = 源.slice(源.indexOf("export function 更新批量删除按钮"), 源.indexOf("export function 更新批量删除按钮") + 400);
    expect(段).toContain("更新批量标签按钮()");
  });

  it("初始化时绑定按钮", () => {
    expect(读("src/renderer/parts/09-init.ts")).toContain("绑定批量标签事件()");
  });

  it("标签列表支持按名搜索", () => {
    expect(批量源()).toContain("搜索标签名");
  });
});
