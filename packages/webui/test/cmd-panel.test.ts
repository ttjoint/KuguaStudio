/**
 * 指令面板 / AI 前缀契约测试
 *
 * 锁定 2026-10 的交互约定：
 *  1. 「未识别的输入」不再自动兜底为 AI 对话（避免把任意文本灌给 LM Studio 排队）；
 *  2. AI 对话只能由显式前缀触发，且前缀 `ai` 忽略大小写；
 *  3. 聊天页存在指令面板（左侧列表 + 持续前缀提示条），且只在聊天页；
 *  4. 持续前缀在发送时被自动拼接到输入之前。
 *
 * 采用源码静态断言，避免依赖真实浏览器。
 */
import { describe, expect, it } from "vitest";
import { readFileSync, existsSync } from "node:fs";
import { join, dirname } from "node:path";
import { fileURLToPath } from "node:url";

const 仓库根 = join(dirname(fileURLToPath(import.meta.url)), "..", "..", "..");
const 渲染层 = join(仓库根, "packages", "webui", "src", "renderer");

function 读(相对: string): string {
  const p = join(渲染层, 相对);
  return existsSync(p) ? readFileSync(p, "utf-8") : "";
}

const 路由器 = 读("parts/04-router.ts");
const 日志 = 读("parts/08-logs.ts");
const 面板 = 读("parts/16-cmd-panel.ts");
const 初始化 = 读("parts/09-init.ts");
const HTML = 读("index.html");
const 入口 = 读("parts/main.ts");

describe("AI 对话前缀", () => {
  it("AI 前缀匹配忽略大小写（/i 标志）", () => {
    const m = 路由器.match(/文本\.match\(\/\^\(\?:问AI\|AI问答\|ai\)[^/]*\/(\w*)\)/);
    expect(m, "未找到 AI 前缀匹配表达式").toBeTruthy();
    expect(m![1]).toContain("i");
  });

  it("不再对未识别输入自动兜底调用 AI", () => {
    // 处理输入的兜底分支不应出现 与AI对话 调用
    const 处理输入块 = 路由器.slice(路由器.indexOf("export async function 处理输入"), 路由器.indexOf("export async function 尝试能力指令"));
    expect(处理输入块).not.toContain("与AI对话");
    expect(处理输入块).toContain("未识别的指令");
  });

  it("ai.chat 路由委托给带记忆的 与AI对话", () => {
    expect(路由器).toContain('路由.动作 === "ai.chat"');
    expect(路由器).toContain("await 与AI对话(");
  });
});

describe("指令面板", () => {
  it("聊天页存在面板与持续前缀提示条", () => {
    expect(HTML).toContain('id="cmd-panel"');
    expect(HTML).toContain('id="cmd-panel-list"');
    expect(HTML).toContain('id="cmd-panel-search"');
    expect(HTML).toContain('id="cmd-panel-toggle"');
    expect(HTML).toContain('id="cmd-sticky-bar"');
  });

  it("面板位于聊天页容器之内（不污染其他视图）", () => {
    const 聊天页 = HTML.slice(HTML.indexOf('id="chat-page-view"'), HTML.indexOf('id="logs-view"'));
    expect(聊天页).toContain('id="cmd-panel"');
  });

  it("面板数据来自能力注册表并随能力变更刷新", () => {
    expect(面板).toContain('"nigane", "capability.list"');
    expect(初始化).toContain("加载指令面板数据");
    expect(初始化).toContain("capability.changed");
  });

  it("持续前缀互斥（再双击取消）且退出按钮带 id", () => {
    expect(面板).toContain('持续前缀 = 持续前缀 === 命令 ? "" : 命令');
    expect(面板).toContain('退.id = "cmd-sticky-exit"');
  });

  it("发送时自动拼接持续前缀", () => {
    expect(日志).toContain("应用持续前缀");
    expect(日志).toContain("记录使用");
    expect(日志).toContain("${前缀.命令} ${前缀.参数}");
  });

  it("最近使用记录持久化到 localStorage", () => {
    expect(面板).toContain("kugua_recent_cmds_v1");
    expect(面板).toContain("记录使用");
  });

  it("面板被入口显式引入", () => {
    expect(入口).toContain('import "./16-cmd-panel"');
  });
});
