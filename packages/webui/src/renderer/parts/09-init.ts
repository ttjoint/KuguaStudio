import { 同步能力指令库 } from "./02-chat-core";
import { 添加消息 } from "./03-preview";
import { 刷新本地插件, 刷新模块列表 } from "./06-shell";
import { Explorer } from "./07-explorer";
import { 初始化指令面板, 加载指令面板数据 } from "./16-cmd-panel";

// ===== 初始化 =====

添加消息("苦瓜工作室已启动。输入「帮助」查看可用指令。", "system");

// 注册表 / 能力 / 插件变更：由主控广播事件驱动刷新（不再固定轮询，避免空闲时持续产生总线日志）
let 刷新排队 = false;
function 排队刷新(动作: () => void): void {
  // 同一轮事件里可能连续收到多个变更，合并到下一帧执行一次
  if (刷新排队) return;
  刷新排队 = true;
  window.setTimeout(() => {
    刷新排队 = false;
    动作();
  }, 200);
}

window.kugua.onBus((action) => {
  if (action === "capability.changed") 排队刷新(() => { void 同步能力指令库(); void 加载指令面板数据(); });
  else if (action === "registry.changed") 排队刷新(() => void 刷新模块列表());
  else if (action === "plugins.changed") 排队刷新(() => void 刷新本地插件());
});

// 初始化聊天页左侧「指令面板」
初始化指令面板();

// 知识库浏览器的初始化统一在这里编排。
// 放在 09 而不是 08-logs，是为了断开 08-logs ↔ 07-explorer 的循环依赖：
// 07-explorer 依赖日志模块的工具函数，若日志模块又反向依赖 Explorer，
// 打包后 onReady 回调里拿到的 Explorer 绑定可能尚未就绪。
window.kugua.onReady(() => {
  void Explorer.init();
});

// 低频兜底：仅用于事件丢失时的最终一致（例如初次连接前的变更），不参与常态刷新
setInterval(() => {
  void 刷新模块列表();
  void 刷新本地插件();
  void 同步能力指令库();
}, 120000);


// ===== 顶栏：窗口控制（无边框窗口） =====
export function 更新最大化按钮(isMax: boolean): void {
  const btn = document.getElementById("win-max") as HTMLButtonElement;
  if (btn) btn.innerHTML = isMax ? "&#x2750;" : "&#x25A1;";
}
document.getElementById("win-min")?.addEventListener("click", () => void window.kugua.window.minimize());
document.getElementById("win-max")?.addEventListener("click", async () => {
  更新最大化按钮(await window.kugua.window.toggleMaximize());
});
document.getElementById("win-close")?.addEventListener("click", () => void window.kugua.window.close());
window.kugua.window.onMaximized(更新最大化按钮);
void window.kugua.window.isMaximized().then(更新最大化按钮);
