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


// ===== 模块管理：查看 / 编辑托管配置 =====

interface 模块配置条目 {
  name: string;
  类型: string;
  启用: boolean;
  路径: string;
  参数: string[];
  说明: string;
  在线: boolean;
  子进程: number | null;
}

/** 转义 HTML（本文件局部使用，避免依赖其它 part） */
function 转义(文本: unknown): string {
  return String(文本 ?? "")
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;");
}

/** 渲染模块管理列表 */
export async function 刷新模块配置(容器: HTMLElement | null = document.getElementById("settings-module-list")): Promise<void> {
  if (!容器) return;
  let 列表: 模块配置条目[] = [];
  try {
    列表 = (await window.kugua.request("nigane", "nigane.registry.config.list", {})) as 模块配置条目[];
  } catch (err) {
    容器.innerHTML = `<div class="mod-empty">读取失败：${转义(err)}</div>`;
    return;
  }
  if (列表.length === 0) {
    容器.innerHTML = `<div class="mod-empty">暂无已注册模块</div>`;
    return;
  }
  容器.innerHTML = 列表
    .map((m, i) => {
      const 状态 = m.在线
        ? `<span class="mod-badge on">在线${m.子进程 ? ` · pid ${m.子进程}` : ""}</span>`
        : `<span class="mod-badge off">离线</span>`;
      const 托管 = m.启用
        ? `<span class="mod-badge managed">随平台启动</span>`
        : `<span class="mod-badge temp">仅手动</span>`;
      return `
      <div class="mod-item" data-index="${i}">
        <div class="mod-row mod-row-head">
          <span class="mod-name">${转义(m.name)}</span>
          <span class="mod-tags">${状态}${托管}<span class="mod-badge type">${转义(m.类型)}</span></span>
        </div>
        <div class="mod-row">
          <label class="mod-label">托管启动</label>
          <input type="checkbox" class="mod-input-enable" ${m.启用 ? "checked" : ""} ${m.类型 === "library" ? "disabled" : ""}>
          <span class="mod-hint">勾选后下次启动平台时一并拉起</span>
        </div>
        <div class="mod-row">
          <label class="mod-label">路径</label>
          <input type="text" class="mod-input-path" value="${转义(m.路径)}" placeholder="可执行文件或脚本的物理路径">
        </div>
        <div class="mod-row">
          <label class="mod-label">参数</label>
          <input type="text" class="mod-input-args" value="${转义(m.参数.join(" "))}" placeholder="空格分隔，例如 script.py --hosted">
        </div>
        <div class="mod-row">
          <label class="mod-label">说明</label>
          <input type="text" class="mod-input-desc" value="${转义(m.说明)}">
        </div>
        <div class="mod-row mod-row-actions">
          <button class="tb-btn small mod-save">保存</button>
          <button class="tb-btn small mod-start" ${m.类型 === "library" ? "disabled" : ""}>启动</button>
          <button class="tb-btn small mod-stop" ${m.类型 === "library" || !m.子进程 ? "disabled" : ""}>停止</button>
          <span class="mod-msg"></span>
        </div>
      </div>`;
    })
    .join("");
}

/** 绑定模块管理交互（只绑一次） */
export function 绑定模块管理事件(): void {
  const 容器 = document.getElementById("settings-module-list");
  if (!容器) return;

  document.getElementById("settings-mod-refresh")?.addEventListener("click", () => {
    void 刷新模块配置();
  });

  容器.addEventListener("click", (ev) => {
    const 目标 = ev.target as HTMLElement;
    const 项 = 目标.closest<HTMLElement>(".mod-item");
    if (!项) return;
    const 名 = 项.querySelector<HTMLElement>(".mod-name")?.textContent ?? "";
    const 提示位 = 项.querySelector<HTMLElement>(".mod-msg");

    const 提示 = (文本: string, 错 = false): void => {
      if (!提示位) return;
      提示位.textContent = 文本;
      提示位.classList.toggle("err", 错);
      setTimeout(() => {
        提示位.textContent = "";
        提示位.classList.remove("err");
      }, 4000);
    };

    if (目标.classList.contains("mod-save")) {
      const 启用 = 项.querySelector<HTMLInputElement>(".mod-input-enable")?.checked ?? false;
      const 路径 = 项.querySelector<HTMLInputElement>(".mod-input-path")?.value.trim() ?? "";
      const 参数字符串 = 项.querySelector<HTMLInputElement>(".mod-input-args")?.value.trim() ?? "";
      const 说明 = 项.querySelector<HTMLInputElement>(".mod-input-desc")?.value ?? "";
      const 参数 = 参数字符串 ? 参数字符串.split(/\s+/).filter(Boolean) : [];
      目标.setAttribute("disabled", "true");
      void (async () => {
        try {
          const 结果 = (await window.kugua.request("nigane", "nigane.registry.config.set", {
            name: 名,
            启用,
            路径,
            参数,
            说明,
          })) as { 更新: boolean; 变更?: string[] };
          提示(结果.更新 ? `已保存：${(结果.变更 ?? []).join("；")}` : "无变更");
          await 刷新模块配置();
        } catch (err) {
          提示(`保存失败：${String(err)}`, true);
        } finally {
          目标.removeAttribute("disabled");
        }
      })();
      return;
    }

    if (目标.classList.contains("mod-start")) {
      目标.setAttribute("disabled", "true");
      void (async () => {
        try {
          await window.kugua.request("nigane", "nigane.registry.start", { name: 名 });
          提示("已请求启动");
          setTimeout(() => void 刷新模块配置(), 1200);
        } catch (err) {
          提示(`启动失败：${String(err)}`, true);
          目标.removeAttribute("disabled");
        }
      })();
      return;
    }

    if (目标.classList.contains("mod-stop")) {
      目标.setAttribute("disabled", "true");
      void (async () => {
        try {
          await window.kugua.request("nigane", "nigane.registry.stop", { name: 名 });
          提示("已请求停止");
          setTimeout(() => void 刷新模块配置(), 800);
        } catch (err) {
          提示(`停止失败：${String(err)}`, true);
          目标.removeAttribute("disabled");
        }
      })();
    }
  });
}
