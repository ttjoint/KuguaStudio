// WebUI 无头验证器：用 Chrome DevTools Protocol 打开页面，收集控制台错误并执行 DOM 断言。
// 用法：node _ui_check.mjs [url]
import { spawn, spawnSync } from "node:child_process";
import { mkdtempSync, rmSync, existsSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { createRequire } from "node:module";
import { createServer } from "node:net";

const URL_ = process.argv[2] || "http://127.0.0.1:24600/";

/** 取一个当前空闲的 TCP 端口（避免硬编码端口落入 Windows 保留区或被占用）。 */
function 取空闲端口() {
  return new Promise((resolve, reject) => {
    const srv = createServer();
    srv.once("error", reject);
    srv.listen(0, "127.0.0.1", () => {
      const { port } = srv.address();
      srv.close(() => resolve(port));
    });
  });
}

const PORT = await 取空闲端口();
// Chrome 在 IPv4 绑定失败（如 Windows 保留端口，WSAEACCES 0x271D）时会回退到 IPv6 [::1]，
// 因此两个主机名都要探测，不能只认 127.0.0.1。
const 调试主机 = [`127.0.0.1`, `[::1]`];
const CHROME = [
  "C:/Program Files/Google/Chrome/Application/chrome.exe",
  "C:/Program Files (x86)/Google/Chrome/Application/chrome.exe",
  "C:/Program Files (x86)/Microsoft/Edge/Application/msedge.exe",
  "C:/Program Files/Microsoft/Edge/Application/msedge.exe",
].find((p) => existsSync(p));
if (!CHROME) {
  console.error("未找到 Chrome/Edge");
  process.exit(2);
}

const require_ = createRequire(import.meta.url);
let WebSocket;
try {
  WebSocket = require_("ws");
} catch {
  WebSocket = require_(join(process.cwd(), "packages/webui/node_modules/ws"));
}

const userDir = mkdtempSync(join(tmpdir(), "kugua-ui-"));
const chrome = spawn(
  CHROME,
  [
    "--headless=new",
    "--disable-gpu",
    "--no-first-run",
    "--no-default-browser-check",
    "--disable-extensions",
    "--mute-audio",
    `--remote-debugging-port=${PORT}`,
    "--remote-allow-origins=*",
    `--user-data-dir=${userDir}`,
    URL_,
  ],
  { stdio: "ignore", windowsHide: true },
);

function killChrome() {
  // 仅结束本脚本启动的 Chrome 进程树（独立 user-data-dir / 调试端口），不影响用户浏览器
  try {
    if (chrome.pid) {
      spawnSync("taskkill", ["/PID", String(chrome.pid), "/T", "/F"], { stdio: "ignore", windowsHide: true });
    }
  } catch {}
  try {
    chrome.kill();
  } catch {}
  try {
    rmSync(userDir, { recursive: true, force: true });
  } catch {}
}

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

async function getTarget() {
  for (let i = 0; i < 80; i++) {
    for (const host of 调试主机) {
      try {
        const res = await fetch(`http://${host}:${PORT}/json/list`);
        const list = await res.json();
        const page = list.find((t) => t.type === "page" && t.webSocketDebuggerUrl);
        if (page) {
          // Chrome 可能把 webSocketDebuggerUrl 写成其实际绑定的主机，统一改为已探通的主机，避免 IPv6 字面量解析问题。
          page.webSocketDebuggerUrl = page.webSocketDebuggerUrl.replace(/^ws:\/\/[^/]+\//, `ws://${host}:${PORT}/`);
          return page;
        }
      } catch {}
    }
    await sleep(250);
  }
  throw new Error("等待 Chrome 调试目标超时");
}

const 断言 = `(() => {
  const R = {};
  const has = (id) => !!document.getElementById(id);
  R.kugua = typeof (window.kugua && window.kugua.request) === "function";
  R.总线订阅 = typeof (window.kugua && window.kugua.onBus) === "function";
  R.标题 = document.title;
  R.标签 = ["tab-chat","tab-kb","tab-jobs","tab-tools","tab-plugins","tab-logs","tab-settings"].filter(has);
  R.对话页 = has("chat-page-view");
  R.对话列表 = has("conv-list");
  R.项目区 = has("conv-projects");
  R.AI选择器 = has("chat-ai-model");
  R.日志页 = has("logs-view");
  R.系统日志 = has("syslog-list");
  R.知识库 = has("explorer-area");
  R.筛选摘要 = has("ex-filter-summary");
  R.聊天日志 = has("chat-log");
  R.输入框 = has("chat-input");
  R.指令面板 = has("cmd-panel") && has("cmd-panel-list");
  R.指令面板搜索 = has("cmd-panel-search");
  R.持续前缀提示条 = has("cmd-sticky-bar");
  try { document.getElementById("tab-logs")?.click(); R.切日志页 = !document.getElementById("logs-view")?.classList.contains("hidden"); } catch (e) { R.切日志页异常 = String(e); }
  try { document.getElementById("tab-kb")?.click(); R.切知识库 = !document.getElementById("explorer-area")?.classList.contains("hidden"); } catch (e) { R.切知识库异常 = String(e); }
  try { document.getElementById("tab-chat")?.click(); R.切对话页 = !document.getElementById("chat-page-view")?.classList.contains("hidden"); } catch (e) { R.切对话页异常 = String(e); }
  const 导入索引 = ["添加消息","处理输入","切换视图","渲染系统日志","刷新系统日志","初始化对话页","与AI对话","新建对话","切换对话","渲染对话列表","刷新AI模型选择器"];
  R.函数 = {};
  for (const n of 导入索引) R.函数[n] = typeof window[n];
  return JSON.stringify(R);
})()`;

const 异步断言 = `(async () => {
  const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
  const R = {};
  document.getElementById("tab-logs")?.click();
  await sleep(1800);
  R.系统日志条数 = document.querySelectorAll("#syslog-list > *").length;
  document.getElementById("tab-chat")?.click();
  await sleep(600);
  // 等指令面板从注册表加载完成
  for (let i = 0; i < 20 && document.querySelectorAll("#cmd-panel-list .cmd-item").length === 0; i++) await sleep(300);
  R.对话条数 = document.querySelectorAll("#conv-list .conv-item").length;
  document.getElementById("conv-new")?.click();
  await sleep(500);
  R.新建后对话条数 = document.querySelectorAll("#conv-list .conv-item").length;
  R.对话标题 = document.getElementById("chat-conv-title")?.textContent || "";
  const inp = document.getElementById("chat-input");
  if (inp) { inp.value = "占卜"; inp.dispatchEvent(new Event("input", { bubbles: true })); }
  await sleep(400);
  const hint = document.getElementById("chat-cmd-hint");
  R.指令提示 = !!(hint && !hint.classList.contains("hidden"));
  R.指令提示条数 = document.querySelectorAll("#chat-cmd-hint .cmd-hint-item").length;
  // 输入框改为多行 textarea，并验证 Enter 语义（末尾发送 / 中间换行 / Ctrl+Enter 换行）
  R.输入框为多行 = inp instanceof HTMLTextAreaElement;
  // 指令面板：数据从注册表加载、单击填前缀、双击进入持续前缀模式
  R.指令面板项数 = document.querySelectorAll("#cmd-panel-list .cmd-item").length;
  const 面板项 = [...document.querySelectorAll("#cmd-panel-list .cmd-item")];
  const 翻译项 = 面板项.find((e) => e.querySelector(".cmd-item-cmd")?.textContent === "翻译");
  if (翻译项 && inp) {
    翻译项.click();
    await sleep(150);
    R.单击填前缀 = inp.value === "翻译 ";
    inp.value = "";
    inp.dispatchEvent(new Event("input", { bubbles: true }));
  } else {
    R.单击填前缀 = "无翻译项";
  }
  const 吃什么项 = 面板项.find((e) => e.querySelector(".cmd-item-cmd")?.textContent === "吃什么");
  if (吃什么项 && inp) {
    const 前消息 = document.querySelectorAll("#chat-log .chat-msg").length;
    吃什么项.click();
    await sleep(200);
    // 需参指令：只填前缀，不直接发送（消息数不增）
    R.吃什么填前缀 = inp.value === "吃什么 ";
    R.吃什么不直接发 = document.querySelectorAll("#chat-log .chat-msg").length === 前消息;
    inp.value = "";
    inp.dispatchEvent(new Event("input", { bubbles: true }));
  } else {
    R.吃什么填前缀 = "无吃什么项";
  }
  const ai项 = 面板项.find((e) => e.querySelector(".cmd-item-cmd")?.textContent === "ai");
  if (ai项) {
    ai项.dispatchEvent(new MouseEvent("dblclick", { bubbles: true }));
    await sleep(150);
    R.持续前缀高亮 = !!document.querySelector("#cmd-panel-list .cmd-item.active");
    R.持续前缀提示可见 = !document.getElementById("cmd-sticky-bar")?.classList.contains("hidden");
    document.getElementById("cmd-sticky-exit")?.click();
    await sleep(150);
    R.持续前缀已退出 = document.getElementById("cmd-sticky-bar")?.classList.contains("hidden");
  } else {
    R.持续前缀高亮 = "无ai项";
  }
  if (inp && inp instanceof HTMLTextAreaElement) {
    inp.value = "第一行";
    inp.selectionStart = inp.selectionEnd = inp.value.length;
    const 发送前 = document.querySelectorAll("#chat-log .chat-msg").length;
    inp.dispatchEvent(new KeyboardEvent("keydown", { key: "Enter", bubbles: true, cancelable: true }));
    await sleep(300);
    R.末尾Enter发送 = document.querySelectorAll("#chat-log .chat-msg").length > 发送前 && inp.value === "";
    // 光标在中间：换行而非发送
    inp.value = "前半后半";
    inp.selectionStart = inp.selectionEnd = 2;
    const 中间前 = document.querySelectorAll("#chat-log .chat-msg").length;
    inp.dispatchEvent(new KeyboardEvent("keydown", { key: "Enter", bubbles: true, cancelable: true }));
    await sleep(150);
    R.中间Enter换行 = inp.value === "前半" + String.fromCharCode(10) + "后半" && document.querySelectorAll("#chat-log .chat-msg").length === 中间前;
    // Ctrl+Enter：总是换行
    inp.value = "尾部";
    inp.selectionStart = inp.selectionEnd = inp.value.length;
    inp.dispatchEvent(new KeyboardEvent("keydown", { key: "Enter", ctrlKey: true, bubbles: true, cancelable: true }));
    await sleep(150);
    R.ctrlEnter换行 = inp.value === "尾部" + String.fromCharCode(10);
    inp.value = "";
  }
  document.getElementById("btn-theme")?.click();
  await sleep(300);
  R.主题 = document.documentElement.dataset.theme || "";
  R.AI模型选项数 = document.getElementById("chat-ai-model")?.options?.length ?? 0;
  // AI 应答（含报错）应单独成气泡，不吸附到上一条消息
  try {
    const 保存请求 = window.kugua.request;
    window.kugua.request = async (目标, 动作, 参数, 超时) => {
      if (目标 === "ai" && 动作 === "ai.chat") throw new Error("模拟 AI 失败");
      return 保存请求.call(window.kugua, 目标, 动作, 参数, 超时);
    };
    const inp2 = document.getElementById("chat-input");
    const 前 = document.querySelectorAll("#chat-log .chat-msg.chat-msg-independent").length;
    if (inp2) {
      inp2.value = "ai 测试独立气泡";
      inp2.dispatchEvent(new Event("input", { bubbles: true }));
      inp2.selectionStart = inp2.selectionEnd = inp2.value.length;
      inp2.dispatchEvent(new KeyboardEvent("keydown", { key: "Enter", bubbles: true, cancelable: true }));
    }
    await sleep(1200);
    const 独立 = document.querySelectorAll("#chat-log .chat-msg.chat-msg-independent");
    R.AI独立气泡 = 独立.length > 前;
    const 最后 = 独立[独立.length - 1];
    R.AI独立气泡不嵌user = !!最后 && !最后.closest(".chat-msg.user");
    R.AI报错在独立气泡 = !!最后 && (最后.textContent || "").includes("AI 调用失败");
    window.kugua.request = 保存请求;
    if (inp2) inp2.value = "";
  } catch (e) {
    R.AI独立气泡 = "异常:" + String(e);
  }
  // 随机汉字：随机5*4 → 5字一行共4行（对齐参考 C#）
  try {
    const inp3 = document.getElementById("chat-input");
    if (inp3) {
      inp3.value = "随机5*4";
      inp3.dispatchEvent(new Event("input", { bubbles: true }));
      inp3.selectionStart = inp3.selectionEnd = inp3.value.length;
      inp3.dispatchEvent(new KeyboardEvent("keydown", { key: "Enter", bubbles: true, cancelable: true }));
      await sleep(1500);
      const 回复 = [...document.querySelectorAll("#chat-log .msg-reply-content")].pop();
      const 文本 = (回复?.textContent || "").trim();
      const 换行 = String.fromCharCode(10);
      const 行 = 文本.split(换行).map((s) => s.replace(String.fromCharCode(13), ""));
      R.随机汉字行数 = 行.length;
      R.随机汉字每行字数 = [...new Set(行.map((s) => [...s].length))].join(",");
      R.随机汉字符合 = 行.length === 4 && 行.every((s) => [...s].length === 5);
      inp3.value = "";
    }
  } catch (e) {
    R.随机汉字符合 = "异常:" + String(e);
  }
  // 点击已发送消息就地编辑：改动后原回复栏内新增版本，左箭头可回切
  try {
    const inp4 = document.getElementById("chat-input");
    if (inp4) {
      inp4.value = "统计";
      inp4.dispatchEvent(new Event("input", { bubbles: true }));
      inp4.selectionStart = inp4.selectionEnd = inp4.value.length;
      inp4.dispatchEvent(new KeyboardEvent("keydown", { key: "Enter", bubbles: true, cancelable: true }));
      await sleep(1800);
      const 气泡 = [...document.querySelectorAll("#chat-log .chat-msg.user")].pop();
      R.用户气泡可编辑属性 = !!气泡?.dataset.原文;
      const 编辑前气泡数 = document.querySelectorAll("#chat-log .chat-msg.user").length;
      // 点击进入编辑
      气泡?.querySelector(".msg-content")?.click();
      await sleep(200);
      R.进入编辑态 = !!气泡?.querySelector("textarea.msg-edit");
      const 编辑框 = 气泡?.querySelector("textarea.msg-edit");
      if (编辑框) {
        编辑框.value = "资源列表";
        编辑框.dispatchEvent(new KeyboardEvent("keydown", { key: "Enter", bubbles: true, cancelable: true }));
      }
      await sleep(2000);
      R.编辑后气泡数不变 = document.querySelectorAll("#chat-log .chat-msg.user").length === 编辑前气泡数;
      const 用户气泡列表 = [...document.querySelectorAll("#chat-log .chat-msg.user")];
      const 容器 = 用户气泡列表[用户气泡列表.length - 1]?.querySelector(".msg-replies");
      const 版本 = JSON.parse(容器?.getAttribute("data-versions") || "[]");
      R.版本数 = 版本.length;
      R.版本数增加 = 版本.length >= 2;
      R.版本导航条 = !!容器?.querySelector(".msg-reply-versions");
      const 标 = 容器?.querySelector(".msg-reply-versions .vlabel")?.textContent || "";
      R.版本标签 = 标;
      R.版本标签形如 = 标.includes("/") && 标.split("/").length === 2 && 标.split("/").every((s) => s.length > 0 && Number.isFinite(Number(s)));
      const 切前HTML = 容器?.innerHTML || "";
      // 左箭头回切上一版
      const 上 = 容器?.querySelectorAll(".msg-reply-versions .vbtn")[0];
      上?.click();
      await sleep(300);
      R.回切后标签 = 容器?.querySelector(".msg-reply-versions .vlabel")?.textContent || "";
      R.回切生效 = R.回切后标签 !== 标;
      R.回切后内容变化 = (容器?.innerHTML || "") !== 切前HTML;
      // 回复栏图标：折叠 / 刷新 / 收藏
      const 头 = 容器?.querySelector(".msg-reply-head");
      R.回复头部行 = !!头;
      R.回复图标数 = 容器?.querySelectorAll(".msg-reply-head .msg-reply-actions .rbtn").length ?? 0;
      R.模块名右侧图标 = !!头?.querySelector(".msg-reply-sender") && !!头?.querySelector(".msg-reply-actions");
      // 折叠：只留模块名一行
      容器?.querySelector(".rbtn-collapse")?.click();
      await sleep(250);
      const 首块 = 容器?.querySelector(".msg-reply");
      R.折叠生效 = 首块?.classList.contains("collapsed") === true;
      R.折叠后正文隐藏 = !!容器?.querySelector(".msg-reply-content") &&
        (容器.querySelector(".msg-reply-content")?.style.display === "none");
      R.折叠后模块名仍在 = !!容器?.querySelector(".msg-reply-head .msg-reply-sender");
      容器?.querySelector(".rbtn-collapse")?.click();
      await sleep(200);
      R.展开恢复 = 容器?.querySelector(".msg-reply-content")?.style.display !== "none";
      // 收藏（★）→ 知识库笔记
      容器?.querySelector(".rbtn-fav")?.click();
      await sleep(2500);
      R.收藏已标记 = !!容器?.querySelector(".msg-reply[data-收藏='1']");
      R.收藏星星 = 容器?.querySelector(".rbtn-fav")?.textContent === "★";
      try {
        const 笔记 = await window.kugua.request("mkg", "mkg.note.list", {});
        R.知识库有笔记 = Array.isArray(笔记) && 笔记.length > 0;
        R.笔记标题含模块名 = Array.isArray(笔记) && String(笔记[0]?.title || "").includes("【");
      } catch (e) {
        R.知识库有笔记 = "异常:" + String(e);
      }
      // 取消收藏
      容器?.querySelector(".rbtn-fav")?.click();
      await sleep(1800);
      R.取消收藏星星 = 容器?.querySelector(".rbtn-fav")?.textContent === "☆";
      // 刷新 → 新版本（开始回复组 会重建容器，故刷新后重新查询）
      容器?.querySelector(".rbtn-refresh")?.click();
      await sleep(3000);
      const 新容器 = 气泡?.querySelector(".msg-replies") ?? 容器;
      R.刷新后仍有图标 = (新容器?.querySelectorAll(".msg-reply-head .msg-reply-actions .rbtn").length ?? 0) === 3;
      R.刷新后版本标签 = 新容器?.querySelector(".msg-reply-versions .vlabel")?.textContent || "";
      R.刷新后版本数 = JSON.parse(新容器?.getAttribute("data-versions") || "[]").length;
      R.刷新产生新版本 = R.刷新后版本数 >= 3;
    }
  } catch (e) {
    R.就地编辑 = "异常:" + String(e);
  }
  document.getElementById("tab-kb")?.click();
  await sleep(800);
  R.知识库位置数 = document.querySelectorAll("#ex-locations .ex-loc-item, #ex-locations > *").length;
  R.标签树节点数 = document.querySelectorAll("#ex-tag-tree > *").length;
  // 标签树交互（覆盖 07j：跳转标签 / 筛选摘要 / 关联标签）
  document.querySelector("#ex-tag-tree .ex-tag-all")?.click();
  await sleep(1000);
  R.状态栏文本 = (document.getElementById("ex-status-count")?.textContent || "").trim();
  R.点全部标签 = R.状态栏文本.length > 0;
  const tagItem = document.querySelector("#ex-tag-tree .ex-tag-item");
  if (tagItem) {
    tagItem.click();
    await sleep(1300);
    R.筛选摘要可见 = !document.getElementById("ex-filter-summary")?.classList.contains("hidden");
  } else {
    R.筛选摘要可见 = "无标签节点（跳过）";
  }
  const 次级 = {};
  for (const mode of ["board", "workspace"]) {
    const btn = document.querySelector('.ex-sub-tab[data-mode="' + mode + '"]');
    if (!btn) { 次级[mode] = "无按钮"; continue; }
    btn.click();
    await sleep(1500);
    const 面板名 = mode === "board" ? "boards" : "workspace";
    const pane = document.querySelector(".ex-pane-" + 面板名);
    const 可见 = !!(pane && !pane.classList.contains("hidden"));
    const addId = mode === "board" ? "ex-board-add-col" : "ws-add";
    次级[mode] = 可见 ? true : "可见=" + 可见;
    if (addId === "ex-board-add-col") {
      document.getElementById(addId)?.click();
      await sleep(300);
      const dlg = document.getElementById("column-dialog");
      const 对话框 = !!(dlg && !dlg.classList.contains("hidden"));
      if (对话框) dlg.classList.add("hidden");
      if (!对话框) 次级[mode] = "可见=" + 可见 + ",弹窗=" + 对话框;
    }
  }
  R.次级视图 = 次级;
  // 回到文件视图
  document.querySelector('.ex-sub-tab[data-mode="files"]')?.click();
  await sleep(300);
  R.回到文件 = !document.querySelector(".ex-pane-files")?.classList.contains("hidden");
  return JSON.stringify(R);
})()`;

const 写入断言 = `(async () => {
  const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
  const R = {};
  document.getElementById("tab-kb")?.click();
  await sleep(400);
  // 点子已合并入统一资料库：从工具栏新建并在统一列表中核对
  const n0 = document.querySelectorAll("#ex-items-large .ex-file-tile, #ex-items-list .ex-list-item, .ex-details-body .ex-detail-row").length;
  document.getElementById("ex-note-add")?.click();
  await sleep(250);
  document.getElementById("note-title").value = "自动化测试点子";
  document.getElementById("note-content").value = "由无头验证器创建";
  document.getElementById("note-save")?.click();
  await sleep(1800);
  R.新建点子 = document.querySelectorAll("#ex-items-large .ex-file-tile, #ex-items-list .ex-list-item, .ex-details-body .ex-detail-row").length > n0;
  document.querySelector('.ex-sub-tab[data-mode="board"]')?.click();
  await sleep(1400);
  const c0 = document.querySelectorAll("#ex-board .ex-board-col").length;
  document.getElementById("ex-board-add-col")?.click();
  await sleep(250);
  document.getElementById("column-name").value = "自动化列";
  document.getElementById("column-save")?.click();
  await sleep(1600);
  R.新建看板列 = document.querySelectorAll("#ex-board .ex-board-col").length > c0;
  document.querySelector('.ex-sub-tab[data-mode="files"]')?.click();
  await sleep(1400);
  const m0 = document.querySelectorAll("#ex-items-large .ex-file-tile, #ex-items-list .ex-list-item, .ex-details-body .ex-detail-row").length;
  document.getElementById("ex-mat-add")?.click();
  await sleep(250);
  document.getElementById("material-title").value = "自动化素材";
  document.getElementById("material-kind").value = "链接";
  document.getElementById("material-content").value = "由验证器创建";
  document.getElementById("material-save")?.click();
  await sleep(1800);
  R.新建素材 = document.querySelectorAll("#ex-items-large .ex-file-tile, #ex-items-list .ex-list-item, .ex-details-body .ex-detail-row").length > m0;
  document.querySelector('.ex-sub-tab[data-mode="board"]')?.click();
  await sleep(1400);
  const k0 = document.querySelectorAll("#ex-board .ex-board-card").length;
  document.getElementById("ex-board-add-card")?.click();
  await sleep(300);
  document.getElementById("card-title").value = "自动化卡片";
  document.getElementById("card-content").value = "由验证器创建";
  const sel = document.getElementById("card-column");
  if (sel && sel.options.length > 1) sel.value = sel.options[1].value;
  document.getElementById("card-save")?.click();
  await sleep(1800);
  R.新建卡片 = document.querySelectorAll("#ex-board .ex-board-card").length > k0;
  // 片段 + 内置编辑器（验证 07g-explorer-editor）
  document.querySelector('.ex-sub-tab[data-mode="files"]')?.click();
  await sleep(900);
  document.getElementById("ex-btn-new-snippet")?.click();
  await sleep(350);
  const sDlg = document.getElementById("snippet-dialog");
  R.片段弹窗 = !!(sDlg && !sDlg.classList.contains("hidden"));
  document.getElementById("snippet-title").value = "自动化片段";
  document.getElementById("snippet-content").value = "由验证器创建";
  document.getElementById("snippet-save")?.click();
  await sleep(1800);
  R.片段已保存 = document.getElementById("snippet-dialog")?.classList.contains("hidden") === true;
  let 目标 = null;
  for (const el of document.querySelectorAll("#ex-items-large > *")) {
    if ((el.textContent || "").includes("自动化片段")) { 目标 = el; break; }
  }
  if (目标) {
    目标.dispatchEvent(new MouseEvent("dblclick", { bubbles: true }));
    await sleep(1300);
    const pDlg = document.getElementById("preview-dialog");
    R.内置编辑器 = !!(pDlg && !pDlg.classList.contains("hidden"));
    document.getElementById("preview-close")?.click();
    await sleep(400);
  } else {
    R.内置编辑器 = "未找到片段条目";
  }
  return JSON.stringify(R);
})()`;

const 插件SDK断言 = `(async () => {
  const R = {};
  await new Promise((res, rej) => {
    const s = document.createElement("script");
    s.src = "/plugin-sdk.js";
    s.onload = () => res();
    s.onerror = () => rej(new Error("plugin-sdk.js 加载失败"));
    document.head.appendChild(s);
  });
  R.request = typeof window.kugua.request;
  R.onReady = typeof window.kugua.onReady;
  R.onLog = typeof window.kugua.onLog;
  R.窗口控制 = typeof window.kugua.window;
  try {
    const r = await window.kugua.request("monitor", "monitor.stats", {});
    R.调用成功 = !!r;
  } catch (e) {
    R.调用失败 = String(e);
  }
  return JSON.stringify(R);
})()`;

async function main() {
  const target = await getTarget();
  const ws = new WebSocket(target.webSocketDebuggerUrl, { perMessageDeflate: false });
  let id = 0;
  const pending = new Map();
  const 错误 = [];
  const 控制台 = [];

  const send = (method, params = {}) =>
    new Promise((resolve, reject) => {
      const mid = ++id;
      pending.set(mid, { resolve, reject });
      ws.send(JSON.stringify({ id: mid, method, params }));
    });

  await new Promise((resolve, reject) => {
    ws.on("open", resolve);
    ws.on("error", reject);
  });

  ws.on("message", (raw) => {
    let msg;
    try {
      msg = JSON.parse(raw.toString());
    } catch {
      return;
    }
    if (msg.id && pending.has(msg.id)) {
      const { resolve, reject } = pending.get(msg.id);
      pending.delete(msg.id);
      msg.error ? reject(new Error(msg.error.message)) : resolve(msg.result);
      return;
    }
    if (msg.method === "Runtime.exceptionThrown") {
      const d = msg.params.exceptionDetails;
      错误.push((d.exception && (d.exception.description || d.exception.value)) || d.text);
    } else if (msg.method === "Runtime.consoleAPICalled" && (msg.params.type === "error" || msg.params.type === "warning")) {
      控制台.push(msg.params.type + ": " + msg.params.args.map((a) => a.value ?? a.description ?? "").join(" "));
    } else if (msg.method === "Log.entryAdded" && msg.params.entry.level === "error") {
      错误.push("[log] " + msg.params.entry.text);
    }
  });

  await send("Runtime.enable");
  await send("Log.enable");
  await send("Page.enable");

  // 等待页面就绪
  for (let i = 0; i < 40; i++) {
    const r = await send("Runtime.evaluate", { expression: "document.readyState", returnByValue: true });
    if (r.result && r.result.value === "complete") break;
    await sleep(250);
  }
  await sleep(1500); // 等模块/WebSocket 初始化

  // 等待主控桥接就绪：隔离实例下 26 个模块启动 + WS 建连可能要数十秒
  for (let i = 0; i < 120; i++) {
    const r = await send("Runtime.evaluate", {
      expression: `(async () => {
        if (!window.kugua || !window.kugua.request) return false;
        try {
          const r = await window.kugua.request("kugua-main", "capability.list", {});
          return Array.isArray(r) ? r.length > 0 : !!r;
        } catch { return false; }
      })()`,
      returnByValue: true,
      awaitPromise: true,
    });
    if (r.result && r.result.value === true) break;
    await sleep(1000);
  }

  const out = await send("Runtime.evaluate", { expression: 断言, returnByValue: true, awaitPromise: false });
  if (out.exceptionDetails) {
    console.error("断言执行异常：", out.exceptionDetails.text, out.exceptionDetails.exception?.description || "");
    ws.close();
    killChrome();
    process.exit(1);
  }
  const R = JSON.parse(out.result.value);
  const out2 = await send("Runtime.evaluate", { expression: 异步断言, returnByValue: true, awaitPromise: true });
  const R2 = out2.result && out2.result.value ? JSON.parse(out2.result.value) : {};
  const out3 = await send("Runtime.evaluate", { expression: 写入断言, returnByValue: true, awaitPromise: true });
  const R3 = out3.result && out3.result.value ? JSON.parse(out3.result.value) : {};
  const out4 = await send("Runtime.evaluate", { expression: 插件SDK断言, returnByValue: true, awaitPromise: true });
  const R4 = out4.result && out4.result.value ? JSON.parse(out4.result.value) : {};
  const 未定义函数 = Object.entries(R.函数).filter(([, t]) => t !== "function").map(([n]) => n);
  const 标签应含 = ["tab-chat", "tab-kb", "tab-jobs", "tab-tools", "tab-logs", "tab-settings"];
  const 缺标签 = 标签应含.filter((t) => !R.标签.includes(t));

  console.log("=== 页面断言 ===");
  console.log(JSON.stringify(R, null, 2));
  console.log("=== 功能断言 ===");
  console.log(JSON.stringify(R2, null, 2));
  console.log("=== 写入断言 ===");
  console.log(JSON.stringify(R3, null, 2));
  console.log("=== 插件 SDK 断言 ===");
  console.log(JSON.stringify(R4, null, 2));
  console.log("=== 控制台错误 ===");
  console.log(错误.length ? 错误.join("\n") : "(无)");
  if (控制台.length) {
    console.log("=== 控制台告警 ===");
    console.log(控制台.join("\n"));
  }
  const 失败 =
    错误.length > 0 ||
    缺标签.length > 0 ||
    !R.kugua ||
    !R.总线订阅 ||
    !R.对话页 ||
    !R.日志页 ||
    !R.切日志页 ||
    !R.切知识库 ||
    !R.切对话页 ||
    (R2.系统日志条数 ?? 0) < 1 ||
    (R2.对话条数 ?? 0) < 1 ||
    (R2.新建后对话条数 ?? 0) <= (R2.对话条数 ?? 0) ||
    (R2.指令提示条数 ?? 0) < 1 ||
    R2.输入框为多行 !== true ||
    R2.末尾Enter发送 !== true ||
    R2.中间Enter换行 !== true ||
    R2.ctrlEnter换行 !== true ||
    !R.指令面板 ||
    !R.指令面板搜索 ||
    !R.持续前缀提示条 ||
    (R2.指令面板项数 ?? 0) < 10 ||
    R2.单击填前缀 !== true ||
    R2.吃什么填前缀 !== true ||
    R2.吃什么不直接发 !== true ||
    R2.持续前缀高亮 !== true ||
    R2.持续前缀提示可见 !== true ||
    R2.持续前缀已退出 !== true ||
    R2.AI独立气泡 !== true ||
    R2.AI独立气泡不嵌user !== true ||
    R2.AI报错在独立气泡 !== true ||
    R2.随机汉字符合 !== true ||
    R2.用户气泡可编辑属性 !== true ||
    R2.进入编辑态 !== true ||
    R2.编辑后气泡数不变 !== true ||
    R2.版本数增加 !== true ||
    R2.版本导航条 !== true ||
    R2.版本标签形如 !== true ||
    R2.回切生效 !== true ||
    R2.回复头部行 !== true ||
    R2.回复图标数 !== 3 ||
    R2.模块名右侧图标 !== true ||
    R2.折叠生效 !== true ||
    R2.折叠后正文隐藏 !== true ||
    R2.折叠后模块名仍在 !== true ||
    R2.展开恢复 !== true ||
    R2.收藏星星 !== true ||
    R2.知识库有笔记 !== true ||
    R2.取消收藏星星 !== true ||
    R2.刷新后仍有图标 !== true ||
    R2.刷新产生新版本 !== true ||
    !R2.回到文件 ||
    !R2.点全部标签 ||
    !R2.次级视图 ||
    Object.values(R2.次级视图 || {}).some((v) => v !== true) ||
    !R3.新建点子 ||
    !R3.新建看板列 ||
    !R3.新建素材 ||
    !R3.新建卡片 ||
    !R3.片段弹窗 ||
    !R3.片段已保存 ||
    R3.内置编辑器 !== true ||
    R4.request !== "function" ||
    R4.onReady !== "function" ||
    R4.窗口控制 !== "undefined" ||
    !R4.调用成功;
  console.log(失败 ? "RESULT=FAIL" : "RESULT=PASS");
  if (未定义函数.length) console.log("（提示：打包后函数不再挂载到 window，属正常）未挂载：" + 未定义函数.join(", "));
  if (缺标签.length) console.log("缺标签：" + 缺标签.join(", "));

  ws.close();
  killChrome();
  process.exit(失败 ? 1 : 0);
}

main().catch((e) => {
  console.error("验证器异常：", e.message);
  killChrome();
  process.exit(2);
});
