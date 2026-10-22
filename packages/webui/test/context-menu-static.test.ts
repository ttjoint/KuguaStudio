/**
 * 全局右键菜单：静态契约检查
 *
 * WebUI 测试跑在 Node 环境（无 DOM），无法直接测菜单渲染。
 * 这里检查源码层面的关键契约，防止将来重构时破坏：
 * 1. 全局 contextmenu 必须 preventDefault（否则浏览器默认菜单会冒出来）
 * 2. 必须用「两阶段」策略（捕获只屏蔽、冒泡才兜底），否则会和现有专用菜单叠成两个
 * 3. 可编辑元素必须给粘贴能力（否则用户没法粘贴）
 * 4. 各功能区必须注册了菜单
 */
import { describe, expect, it } from "vitest";
import { existsSync, readFileSync } from "node:fs";
import { resolve } from "node:path";

// vitest 的工作目录是包根（packages/webui），源码在 src/ 下
const 根 = resolve(process.cwd(), "packages/webui");
if (!existsSync(根)) {
  throw new Error(`找不到包目录：${根}（cwd=${process.cwd()}）`);
}
function 读(相对: string): string {
  return readFileSync(resolve(根, 相对), "utf-8");
}

const 菜单源 = () => 读("src/renderer/parts/21-context-menu.ts");
const 初始化源 = () => 读("src/renderer/parts/09-init.ts");

describe("全局右键菜单：关键契约", () => {
  it("全局监听必须 preventDefault（屏蔽浏览器默认菜单）", () => {
    const 源 = 菜单源();
    // 捕获阶段的监听里必须有 preventDefault
    const 捕获段 = 源.slice(源.indexOf('"contextmenu"'));
    expect(捕获段).toContain("e.preventDefault()");
  });

  it("必须用两阶段策略：捕获阶段只屏蔽，不在捕获阶段弹菜单", () => {
    const 源 = 菜单源();
    const 捕获监听 = 源.match(/document\.addEventListener\(\s*"contextmenu",[\s\S]*?true,?\s*\);/);
    expect(捕获监听, "必须存在捕获阶段监听（第三参 true）").not.toBeNull();
    // 捕获阶段不应调用任何弹菜单的函数
    const 捕获体 = 捕获监听![0];
    expect(捕获体).not.toContain("只读文本菜单(");
    expect(捕获体).not.toContain("可编辑菜单(");
    expect(捕获体).not.toContain("显示菜单(");
  });

  it("冒泡阶段兜底：已打开时不覆盖（避免双菜单）", () => {
    const 源 = 菜单源();
    // 冒泡监听里必须有「已打开则 return」的守卫
    expect(源).toMatch(/if\s*\(已打开\)\s*return;/);
  });

  it("可编辑元素菜单提供粘贴（否则用户无法粘贴）", () => {
    const 源 = 菜单源();
    expect(源).toContain('label: "粘贴"');
    expect(源).toContain('label: "全选"');
  });

  it("可编辑判定覆盖 input / textarea / contenteditable", () => {
    const 源 = 菜单源();
    expect(源).toContain("input, textarea, [contenteditable='true']");
  });

  it("剪贴板写入有 execCommand 兜底（clipboard API 在无权限时会失败）", () => {
    const 源 = 菜单源();
    expect(源).toContain("execCommand(\"copy\")");
  });

  it("菜单贴边时翻转而非截断", () => {
    const 源 = 菜单源();
    expect(源).toContain("x - 宽");
    expect(源).toContain("y - 高");
  });

  it("点击别处 / 滚动 / Esc 会关闭菜单", () => {
    const 源 = 菜单源();
    expect(源).toContain('"mousedown"');
    expect(源).toContain('"scroll"');
    expect(源).toContain('"Escape"');
  });

  it("初始化时调用了全局接管", () => {
    expect(初始化源()).toContain("初始化右键菜单()");
  });

  it("主要文本区都注册了菜单", () => {
    const 源 = 初始化源();
    for (const id of ["chat-log", "jobs-log", "logs-pane-bus", "logs-pane-sys"]) {
      expect(源, `${id} 应注册右键菜单`).toContain(id);
    }
  });
});

describe("旧菜单实现已委托（不留重复渲染逻辑）", () => {
  it("07i 的 显示上下文菜单 委托给统一实现", () => {
    const 源 = 读("src/renderer/parts/07i-explorer-actions.ts");
    expect(源).toContain("显示菜单(x, y");
    // 不应再有自己拼 cm-item 的逻辑
    expect(源).not.toContain('className = "cm-item"');
  });

  it("03-preview 的 显示顶层右键菜单 委托给统一实现", () => {
    const 源 = 读("src/renderer/parts/03-preview.ts");
    expect(源).toContain("显示菜单(x, y, items)");
    expect(源).not.toContain('className = "cm-item"');
  });
});
