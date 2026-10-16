import { 同步能力指令库 } from "./02-chat-core";
import { 添加消息 } from "./03-preview";
import { 刷新本地插件, 刷新模块列表 } from "./06-shell";

// ===== 初始化 =====

添加消息("苦瓜工作室已启动。输入「帮助」查看可用指令。", "system");

// 定时刷新模块列表与本地插件
setInterval(() => {
  void 刷新模块列表();
  void 刷新本地插件();
  void 同步能力指令库();
}, 10000);


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

