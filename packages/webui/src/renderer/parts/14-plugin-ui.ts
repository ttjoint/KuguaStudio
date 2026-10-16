import { 市场条目 } from "./01-types";
import { 添加消息 } from "./03-preview";
import { 刷新插件市场, 刷新本地插件, 刷新模块列表, 刷新统计, 操作插件 } from "./06-shell";
import { 切换视图, 视图映射 } from "./11-tabs";

// ===== 插件自带 UI 页（动态标签 + iframe） =====
export async function 加载插件页面(): Promise<void> {
  let 页列表: Array<{ name: string; title: string }> = [];
  try {
    页列表 = (await (await fetch("/api/plugin-pages")).json()) as Array<{ name: string; title: string }>;
  } catch {
    return;
  }
  const 工作区 = document.getElementById("workspace");
  const 设置按钮 = document.getElementById("tab-settings");
  for (const 页 of 页列表 ?? []) {
    const tabId = `tab-plugin-${页.name}`;
    if (document.getElementById(tabId)) continue;
    const btn = document.createElement("button");
    btn.id = tabId;
    btn.className = "tb-btn nav-tab";
    btn.textContent = 页.title;
    btn.title = `插件页面：${页.name}`;
    设置按钮?.parentElement?.insertBefore(btn, 设置按钮);
    const view = document.createElement("div");
    view.id = `view-plugin-${页.name}`;
    view.className = "oc-view plugin-view hidden";
    const frame = document.createElement("iframe");
    frame.className = "plugin-frame";
    frame.dataset.src = `/plugin-ui/${encodeURIComponent(页.name)}/`;
    view.appendChild(frame);
    工作区?.appendChild(view);
    视图映射[tabId] = {
      视图: view,
      激活时: () => {
        if (!frame.getAttribute("src")) frame.setAttribute("src", frame.dataset.src ?? "");
      },
    };
    btn.addEventListener("click", () => 切换视图(tabId));
  }
}
document.getElementById("plugins-refresh")?.addEventListener("click", () => {
  void 刷新模块列表();
  void 刷新统计();
});
// 检测模块：重新扫描配置/目录，动态加载或卸载发生变化的模块
document.getElementById("plugins-modules-detect")?.addEventListener("click", async () => {
  try {
    await window.kugua.request("nigane", "nigane.registry.reload", {});
    await window.kugua.request("plugins", "plugins.detect", {}).catch(() => undefined);
    添加消息("已重新检测模块与插件（自动加载/卸载变更）", "system");
  } catch (err) {
    添加消息(`检测模块失败：${String(err)}`, "error");
  }
  void 刷新模块列表();
  void 刷新本地插件();
  void 刷新统计();
});
document.getElementById("plugins-refresh-local")?.addEventListener("click", () => void 刷新本地插件());
document.getElementById("plugins-market-refresh")?.addEventListener("click", () => void 刷新插件市场());
document.getElementById("plugins-install-btn")?.addEventListener("click", async () => {
  const input = document.getElementById("plugins-repo-input") as HTMLInputElement;
  const value = input.value.trim();
  if (!value) {
    添加消息("请输入 git 仓库地址或市场插件名", "error");
    return;
  }
  // 非 URL 输入按市场名解析为仓库地址
  if (!/^(https?:\/\/|git@|file:)/.test(value)) {
    try {
      const r = (await window.kugua.request("plugins", "plugins.market.list", {})) as {
        entries: 市场条目[];
      };
      const 条目 = r.entries.find((e) => e.name === value);
      if (条目) {
        await 操作插件("install", 条目.name, 条目.repo);
        input.value = "";
        return;
      }
    } catch {
      // 市场不可用时按仓库地址继续尝试
    }
  }
  await 操作插件("install", "", value);
  input.value = "";
});
document.getElementById("plugins-local-list")?.addEventListener("click", (ev) => {
  const btn = (ev.target as HTMLElement).closest<HTMLButtonElement>(".plugin-op-btn");
  if (!btn) return;
  void 操作插件(
    btn.dataset.action as "enable" | "disable" | "reload" | "uninstall",
    btn.dataset.name ?? "",
  );
});
document.getElementById("plugins-market-list")?.addEventListener("click", (ev) => {
  const btn = (ev.target as HTMLElement).closest<HTMLButtonElement>(".plugin-market-btn");
  if (!btn) return;
  void 操作插件(
    btn.dataset.action as "install" | "update",
    btn.dataset.name ?? "",
    btn.dataset.repo,
  );
});

// ===== 平台运行控制：重启 / 退出 =====
document.getElementById("settings-restart")?.addEventListener("click", () => {
  添加消息("正在重启平台……", "system");
  void fetch("/api/restart", { method: "POST" }).catch(() => undefined);
  // 重启期间断连，稍后自动刷新页面重新连接
  setTimeout(() => window.location.reload(), 8000);
});
document.getElementById("settings-shutdown")?.addEventListener("click", () => {
  添加消息("正在关闭平台……", "system");
  void fetch("/api/shutdown", { method: "POST" }).catch(() => undefined);
});

