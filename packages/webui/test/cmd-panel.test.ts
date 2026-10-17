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

  it("AI 应答（含报错）单独成气泡，不吸附上一条消息", () => {
    const 对话页 = 读("parts/10-chat-page.ts");
    expect(对话页).toContain("添加独立回应");
    // AI 不应再走吸附式的 添加回应
    expect(对话页).not.toMatch(/添加回应\(/);
  });
});

describe("指令前缀推断（从路由）", () => {
  it("导出前缀表与推断函数", () => {
    expect(路由器).toContain("export const 指令前缀表");
    expect(路由器).toContain("export function 推断指令需参");
  });

  it("必带后缀的指令标记为需参", () => {
    for (const 命令 of ["吃什么", "谐音", "反转", "讽刺", "ai"]) {
      const re = new RegExp(`命令: "${命令}",\\s*需参: true`);
      expect(路由器, `${命令} 应标记需参`).toMatch(re);
    }
  });

  it("可选参数的指令不标记需参", () => {
    expect(路由器).toMatch(/命令: "随机",\s*需参: false/);
    expect(路由器).toMatch(/命令: "随机汉字",\s*需参: false/);
  });

  it("面板引用路由推断且需参时只填前缀不发送", () => {
    expect(面板).toContain("推断指令需参");
    expect(面板).toContain("指令前缀表");
    // 需参分支不得调用 直接调用
    const 起点 = 面板.indexOf("async function 单击指令");
    const 单击块 = 面板.slice(起点, 面板.indexOf("/** 直接调用", 起点));
    // 免参分支才直接调用；需参分支只填前缀
    expect(单击块).toContain("await 直接调用(项.命令)");
    const 需参分支 = 单击块.slice(单击块.indexOf("需要参数的指令"));
    expect(需参分支).toContain('输入框.value = 项.命令 + " "');
    expect(需参分支).not.toContain("直接调用");
  });
});

describe("随机汉字语法（对齐参考 C#）", () => {
  it("支持 随机n*m（n=列 m=行）与 随机n、随机汉字n", () => {
    const 模块 = readFileSync(join(仓库根, "packages", "modules", "text", "src", "index.ts"), "utf-8");
    // 路由正则应支持可选 *m 并映射 列数=n、行数=m
    expect(路由器).toContain("随机(?:汉字)?");
    expect(路由器).toMatch(/参数: \{ 行数, 列数 \}/);
    // 模块侧已有行列参数
    expect(模块).toContain('客户端.onRequest("text.randomHans"');
    expect(模块).toContain("随机汉字(rows, cols)");
  });

  it("格式化层不再把随机汉字当 JSON 输出", () => {
    const 格式化 = 读("parts/05-format.ts");
    expect(格式化).toContain('case "text.randomHans"');
  });
});

describe("用户消息就地编辑 + 回复版本切换", () => {
  const 预览 = 读("parts/03-preview.ts");
  const 路由器 = 读("parts/04-router.ts");
  const 聊天页 = 读("parts/10-chat-page.ts");
  const 样式 = readFileSync(join(渲染层, "style.css"), "utf-8");

  it("用户消息可点击就地编辑，且不改动时仅恢复", () => {
    expect(预览).toContain("export function 绑定消息编辑");
    expect(预览).toContain('dataset.原文');
    // 未改动 / 空白 / Esc 时不重发
    expect(预览).toMatch(/if \(!提交 \|\| !新值 \|\| 新值 === 原文\.trim\(\)\) return/);
    expect(预览).toContain('if (e.key === "Escape")');
  });

  it("编辑后重发在原回复容器内形成新版本，不新增 user 气泡", () => {
    // 重发走 处理输入重发；其中不得调用 添加消息(..., "user")
    expect(路由器).toContain("export async function 处理输入重发");
    const 起点 = 路由器.indexOf("export async function 处理输入重发");
    const 块 = 路由器.slice(起点, 路由器.indexOf("export async function 执行路由", 起点));
    expect(块).toContain("开始回复组(宿主)");
    expect(块).toContain("结束回复组()");
    expect(块).not.toMatch(/添加消息\([^)]*"user"/);
  });

  it("回复容器以 data-versions 持久化版本（innerHTML 可回放）", () => {
    expect(预览).toContain("dataset.versions");
    expect(预览).toContain("dataset.vindex");
    expect(预览).toContain("export function 开始回复组");
    expect(预览).toContain("export function 结束回复组");
    // 结束回复组把历史版本与新版本合并
    expect(预览).toMatch(/设定版本\(容器, \[\.\.\.历史, 当前\], 历史\.length\)/);
  });

  it("版本导航条位于回复下方（左下 ‹ n/N ›）", () => {
    expect(预览).toContain("msg-reply-versions");
    expect(预览).toContain('上一.textContent = "‹"');
    expect(预览).toContain('下一.textContent = "›"');
    expect(样式).toContain(".msg-reply-versions");
  });

  it("恢复对话后重新绑定编辑与版本导航（innerHTML 不保留监听器）", () => {
    expect(聊天页).toContain("export function 恢复对话交互");
    expect(聊天页).toContain("绑定消息编辑");
    expect(聊天页).toContain("恢复回复交互");
    expect(预览).toContain("export function 恢复回复交互");
    // 切换对话时调用
    const 起点 = 聊天页.indexOf("export function 切换对话");
    expect(聊天页.slice(起点, 起点 + 400)).toContain("恢复对话交互()");
  });

  it("回复组期间的非指令提示归入回复容器（保证版本非空）", () => {
    const 起点 = 预览.indexOf("export function 添加提示");
    const 块 = 预览.slice(起点, 起点 + 700);
    expect(块).toContain("当前回复容器");
  });
});

describe("回复栏图标：折叠 / 刷新 / 收藏", () => {
  const 预览 = 读("parts/03-preview.ts");
  const 样式 = readFileSync(join(渲染层, "style.css"), "utf-8");
  const mkg模块 = readFileSync(
    join(仓库根, "packages", "modules", "mkg", "src", "index.ts"),
    "utf-8",
  );
  const mkg文件域 = readFileSync(join(仓库根, "packages", "mkg", "src", "domains", "files.ts"), "utf-8");

  it("图标位于模块名右侧同一行（.msg-reply-head + .msg-reply-actions）", () => {
    expect(预览).toContain("msg-reply-head");
    expect(预览).toContain("msg-reply-actions");
    expect(样式).toContain(".msg-reply-head");
    expect(样式).toContain(".msg-reply-actions");
  });

  it("折叠只保留模块名一行", () => {
    expect(预览).toContain("rbtn-collapse");
    expect(预览).toContain('块.classList.toggle("collapsed")');
    // 折叠隐藏正文类节点
    expect(预览).toMatch(/应用折叠\(块\)/);
    expect(预览).toMatch(/:scope > \.msg-reply-content, :scope > \.msg-sender/);
    expect(样式).toContain(".msg-reply.collapsed");
  });

  it("刷新 = 重跑原指令并作为新版本", () => {
    const 起点 = 预览.indexOf("rbtn-refresh");
    const 块 = 预览.slice(起点, 起点 + 900);
    expect(块).toContain("处理输入重发");
    expect(块).toContain("dataset.指令");
  });

  it("收藏写入知识库笔记：标签 = 模块名 + 对话标题", () => {
    expect(预览).toContain("rbtn-fav");
    expect(预览).toContain("mkg.note.create");
    expect(预览).toContain("确保标签");
    expect(预览).toMatch(/模块名 \+ 当前对话标题|模块.*对话/);
  });

  it("收藏多媒体：base64 → 知识库资源文件 + 笔记引用", () => {
    expect(预览).toContain("mkg.resource.saveBase64");
    expect(预览).toContain("收集多媒体");
    // 后端能力：saveBase64 落临时文件后复用 importFile 索引
    expect(mkg模块).toContain('客户端.onRequest("mkg.resource.saveBase64"');
    expect(mkg文件域).toContain("proto.saveBase64");
    expect(mkg文件域).toContain("mkdtempSync");
  });

  it("已收藏回复左侧显示 ★，再点取消收藏", () => {
    expect(样式).toMatch(/\.msg-reply\.faved::before/);
    expect(样式).toContain('content: "★"');
    const 起点 = 预览.indexOf("async function 切换收藏");
    const 块 = 预览.slice(起点, 起点 + 1200);
    expect(块).toContain("mkg.note.delete");
    expect(块).toContain('按钮.textContent = "☆"');
  });
});

describe("文本编辑器重做：布局与操作逻辑", () => {
  const 源码 = 读("parts/07g-explorer-editor.ts");
  const 页面 = readFileSync(join(渲染层, "index.html"), "utf-8");
  const 样式 = readFileSync(join(渲染层, "style.css"), "utf-8");
  const mkg模块 = readFileSync(join(仓库根, "packages", "modules", "mkg", "src", "index.ts"), "utf-8");

  it("三区布局：工具栏 + 行号槽 + 状态栏", () => {
    expect(页面).toContain('class="editor-toolbar"');
    expect(页面).toContain('id="editor-gutter"');
    expect(页面).toContain('class="editor-statusbar"');
    // 旧版只有一个裸 textarea + 单行页脚
    expect(页面).not.toContain("preview-text-footer");
    expect(样式).toContain(".editor-gutter");
    expect(样式).toContain(".editor-statusbar");
  });

  it("保存按钮移入工具栏（原来在弹窗底部）", () => {
    const 工具栏 = 页面.slice(页面.indexOf('class="editor-toolbar"'), 页面.indexOf('id="editor-find-bar"'));
    expect(工具栏).toContain('id="preview-save"');
    // 弹窗底部不应再有第二个保存按钮
    const 底部 = 页面.slice(页面.indexOf('class="modal-actions"'));
    expect(底部.slice(0, 400)).not.toContain('id="preview-save"');
  });

  it("状态栏实时反映 行/列/字符/行数/脏标记", () => {
    expect(页面).toContain('id="editor-cursor-status"');
    expect(页面).toContain('id="editor-dirty-status"');
    expect(源码).toContain("function 刷新光标状态");
    expect(源码).toContain("function 刷新编辑器状态");
    expect(源码).toContain("已修改");
  });

  it("Tab 缩进 / Shift+Tab 反缩进 / Enter 保持缩进", () => {
    expect(源码).toContain("function 处理缩进键");
    expect(源码).toContain("function 处理回车缩进");
    // Shift+Tab 去缩进
    expect(源码).toMatch(/e\.shiftKey\s*\?\s*行\.replace/);
  });

  it("Ctrl+S 保存、Ctrl+F 查找、Ctrl+滚轮缩放", () => {
    expect(源码).toMatch(/ev\.key\.toLowerCase\(\) === "s"/);
    expect(源码).toMatch(/ev\.key\.toLowerCase\(\) === "f"/);
    expect(源码).toContain("function 调整字号");
    expect(源码).toContain("kugua_editor_font");
    expect(源码).toContain("kugua_editor_wrap");
  });

  it("查找：命中计数与上下切换", () => {
    expect(源码).toContain("function 执行查找");
    expect(源码).toContain("editor-find-count");
    expect(页面).toContain('id="editor-find-next"');
    expect(页面).toContain('id="editor-find-prev"');
  });

  it("保存后刷新左侧列表（不再只对片段刷新）", () => {
    const 起点 = 源码.indexOf("async function 保存编辑器内容");
    const 块 = 源码.slice(起点, 起点 + 1800);
    // 关键：无条件调用 加载所有内容，而不是 resourceId == null 才刷新
    expect(块).toContain("await Explorer.加载所有内容()");
    expect(块).not.toMatch(/if \(编辑器当前文件\.resourceId == null\) await Explorer\.加载所有内容/);
    expect(块).toContain("刷新编辑器状态()");
  });

  it("原址扫描文件保存前提示将修改原始文件", () => {
    expect(mkg模块).toContain('客户端.onRequest("mkg.file.pathInfo"');
    expect(mkg模块).toContain("inPlace");
    const 起点 = 源码.indexOf("async function 保存编辑器内容");
    const 块 = 源码.slice(起点, 起点 + 1800);
    expect(块).toContain("这将直接修改原始文件");
    expect(块).toContain("编辑目标非原件");
  });
});
