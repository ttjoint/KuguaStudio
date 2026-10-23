/**
 * 画板左侧栏双标签 + 单类型浏览入口：静态契约
 *
 * 背景：画板空状态提示「从左侧拖入」，但左侧是工作区列表不是资源列表；
 * 资源面板浮动在右侧且默认隐藏，用户根本发现不了。
 * 现改为左侧栏「工作区/资源」双标签，资源列表内联常驻。
 * 另：单类型浏览（点子/片段/素材）后端能力就绪但无入口，已补。
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

describe("画板左侧栏双标签", () => {
  it("HTML 有工作区/资源两个标签", () => {
    const 源 = 读("src/renderer/index.html");
    expect(源).toContain('data-wstab="workspaces"');
    expect(源).toContain('data-wstab="palette"');
  });

  it("两页容器都存在", () => {
    const 源 = 读("src/renderer/index.html");
    expect(源).toContain('data-wspage="workspaces"');
    expect(源).toContain('data-wspage="palette"');
  });

  it("旧浮动面板已移除（不再有 ws-palette-close）", () => {
    expect(读("src/renderer/index.html")).not.toContain('id="ws-palette-close"');
    expect(读("src/renderer/index.html")).not.toContain('id="ws-palette"');
  });

  it("提示文字与交互一致（提「资源」标签页）", () => {
    const 源 = 读("src/renderer/index.html");
    expect(源).toContain("从左侧「资源」标签页拖入画布，或双击资源项直接添加");
  });

  it("JS 有标签切换逻辑", () => {
    const 源 = 读("src/renderer/parts/07k-explorer-workspace.ts");
    expect(源).toContain("切换侧栏标签页");
    expect(源).toContain('.ws-side-tab');
    expect(源).toContain('.ws-side-page');
  });

  it("资源项双击仍可添加（不想拖拽的路径）", () => {
    expect(读("src/renderer/parts/07k-explorer-workspace.ts")).toContain("dblclick");
  });
});

describe("单类型浏览入口", () => {
  it("智能视图区有三个内置类型", () => {
    const 源 = 读("src/renderer/parts/07h-explorer-views.ts");
    expect(源).toContain('"点子"');
    expect(源).toContain('"文本段"');
    expect(源).toContain('"素材"');
  });

  it("点击设置类型筛选并重新加载", () => {
    const 源 = 读("src/renderer/parts/07h-explorer-views.ts");
    const 段 = 源.slice(源.indexOf("内置单类型浏览"));
    expect(段).toContain("Explorer.类型筛选 = t.类型");
    expect(段).toContain("Explorer.加载所有内容()");
  });
});
