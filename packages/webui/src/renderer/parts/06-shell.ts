import { 市场条目, 插件记录, 模块详情, 知识库统计 } from "./01-types";
import { 添加消息 } from "./03-preview";

// ===== 侧边栏 =====

export async function 启动模块(名: string): Promise<boolean> {
  try {
    const r = (await window.kugua.request("nigane", "nigane.registry.start", { name: 名 })) as {
      started: boolean;
      pid?: number | null;
      reason?: string;
    };
    if (!r.started && r.reason === "already") return true;
    if (r.started) return true;
    添加消息(`启动模块 ${名} 失败：${r.reason ?? "未知"}`, "error");
    return false;
  } catch (err) {
    添加消息(`启动模块 ${名} 失败：${String(err)}`, "error");
    return false;
  }
}

export async function 停止模块(名: string): Promise<boolean> {
  try {
    const r = (await window.kugua.request("nigane", "nigane.registry.stop", { name: 名 })) as {
      stopped: boolean;
      reason?: string;
    };
    if (r.stopped || r.reason === "not_running") return true;
    添加消息(`停止模块 ${名} 失败：${r.reason ?? "未知"}`, "error");
    return false;
  } catch (err) {
    添加消息(`停止模块 ${名} 失败：${String(err)}`, "error");
    return false;
  }
}

export async function 刷新模块列表(): Promise<void> {
  const list = document.getElementById("plugins-module-list") as HTMLUListElement;
  try {
    const modules = (await window.kugua.request("nigane", "nigane.registry.details", {})) as 模块详情[];
    list.innerHTML = "";
    if (modules.length === 0) {
      list.innerHTML = '<li style="color:var(--text-dim)">暂无节点注册</li>';
      return;
    }
    for (const m of modules) {
      const li = document.createElement("li");
      const caps = (m.capabilities ?? []).join("、") || "无能力";
      const online = Boolean(m.online);
      const dotColor = online ? "var(--green)" : "var(--text-dim)";
      const 类型标签 = m.type === "library" ? "库" : m.type === "process" ? "进程" : "?";
      const 状态 = online
        ? m.type === "process"
          ? `运行中 (pid=${m.pid ?? "?"})`
          : m.type === "library"
            ? "就绪"
            : "在线"
        : m.type === "library" && m.fileExists === false
          ? "文件缺失"
          : "离线";
      const autoBadge = m.autoStart ? '<span class="badge" style="background:var(--accent);margin-left:4px">自启</span>' : "";
      const desc = m.description ? `<div class="module-desc" style="margin-top:2px">${m.description}</div>` : "";
      // 启停按钮：仅 process 型支持
      const can启停 = m.type === "process";
      const startBtn = can启停
        ? `<button class="mini-btn start-btn" data-name="${m.name}" title="启动" ${online ? "disabled" : ""}>▶</button>`
        : "";
      const stopBtn = can启停
        ? `<button class="mini-btn stop-btn" data-name="${m.name}" title="停止" ${online ? "" : "disabled"}>■</button>`
        : "";
      li.innerHTML = `
        <span class="module-dot" style="background:${dotColor}"></span>
        <div class="module-info" style="flex:1">
          <div class="module-name">
            ${m.name}${autoBadge}
            <span style="font-weight:normal;color:var(--text-dim);font-size:0.75rem;margin-left:6px">[${类型标签}] ${状态}</span>
          </div>
          <div class="module-desc">v${m.version ?? "?"} · ${caps}</div>
          ${desc}
        </div>
        <div style="display:flex;gap:4px">${startBtn}${stopBtn}</div>
      `;
      list.appendChild(li);
    }
    // 绑定按钮
    list.querySelectorAll<HTMLButtonElement>(".start-btn").forEach((btn) => {
      btn.addEventListener("click", () => {
        const name = btn.getAttribute("data-name")!;
        void (async () => {
          if (await 启动模块(name)) setTimeout(() => void 刷新模块列表(), 600);
        })();
      });
    });
    list.querySelectorAll<HTMLButtonElement>(".stop-btn").forEach((btn) => {
      btn.addEventListener("click", () => {
        const name = btn.getAttribute("data-name")!;
        void (async () => {
          if (await 停止模块(name)) setTimeout(() => void 刷新模块列表(), 600);
        })();
      });
    });
  } catch (err) {
    list.innerHTML = `<li style="color:var(--red)">加载失败：${String(err)}</li>`;
  }
}

/** 刷新本地插件列表（plugins/ 目录，来自插件运行时） */
export async function 刷新本地插件(): Promise<void> {
  const list = document.getElementById("plugins-local-list") as HTMLUListElement;
  try {
    const 插件 = (await window.kugua.request("plugins", "plugins.list", {})) as 插件记录[];
    list.innerHTML = "";
    if (插件.length === 0) {
      list.innerHTML =
        '<li style="color:var(--text-dim)">暂无插件。可在上方输入 git 仓库地址安装，或从下方插件市场安装。</li>';
      return;
    }
    for (const p of 插件) {
      const li = document.createElement("li");
      const 状态类 = p.状态 === "enabled" ? "enabled" : p.状态 === "error" ? "error" : "";
      const 状态文本 =
        ({ enabled: "运行中", disabled: "已停用", loaded: "已加载", error: "错误" } as const)[p.状态] ?? p.状态;
      const 命令 = p.命令.map((c) => c.匹配).join("、") || "无";
      const 错误 = p.错误 ? `<div class="module-desc" style="color:var(--red)">${p.错误}</div>` : "";
      const 按钮 = (动作: string, 标签: string): string =>
        `<button class="mini-btn plugin-op-btn" data-name="${p.name}" data-action="${动作}" title="${标签}">${标签}</button>`;
      li.innerHTML = `
        <div class="module-info" style="flex:1">
          <div class="module-name">${p.name}<span class="oc-plugin-state ${状态类}">[${状态文本}] v${p.version}</span></div>
          <div class="module-desc">${p.description ?? ""} · 命令：${命令}</div>
          ${错误}
        </div>
        <div style="display:flex;gap:4px">
          ${p.状态 === "enabled" ? 按钮("disable", "停用") : 按钮("enable", "启用")}
          ${按钮("reload", "重载")}
          ${按钮("uninstall", "卸载")}
        </div>
      `;
      list.appendChild(li);
    }
  } catch (err) {
    list.innerHTML = `<li style="color:var(--red)">加载失败：${String(err)}</li>`;
  }
}

/** 刷新插件市场（GitHub raw 索引） */
export async function 刷新插件市场(): Promise<void> {
  const list = document.getElementById("plugins-market-list") as HTMLUListElement;
  list.innerHTML = '<li style="color:var(--text-dim)">正在拉取市场索引……</li>';
  try {
    const r = (await window.kugua.request("plugins", "plugins.market.list", {})) as {
      url: string;
      entries: 市场条目[];
    };
    list.innerHTML = "";
    const url行 = `<div class="oc-market-url">索引：${r.url}</div>`;
    if (r.entries.length > 0) {
      const 头 = document.createElement("li");
      头.innerHTML = url行;
      list.appendChild(头);
    }
    if (r.entries.length === 0) {
      list.innerHTML = `<li style="color:var(--text-dim)">市场为空${url行}</li>`;
      return;
    }
    for (const e of r.entries) {
      const li = document.createElement("li");
      const 已装 = Boolean(e.installed);
      const 更新 = 已装 && e.version && e.localVersion && e.version !== e.localVersion;
      li.innerHTML = `
        <div class="module-info" style="flex:1">
          <div class="module-name">${e.name}<span class="oc-plugin-state ${已装 ? "enabled" : ""}">${已装 ? `[已安装 ${e.localVersion}${更新 ? "，可更新" : ""}]` : "[未安装]"}</span></div>
          <div class="module-desc">${e.description ?? ""} · ${e.author ?? ""} · ${e.repo}</div>
        </div>
        <div style="display:flex;gap:4px">
          ${已装
            ? 更新
              ? `<button class="mini-btn plugin-market-btn" data-name="${e.name}" data-repo="${e.repo}" data-action="update">更新</button>`
              : ""
            : `<button class="mini-btn plugin-market-btn" data-name="${e.name}" data-repo="${e.repo}" data-action="install">安装</button>`}
        </div>
      `;
      list.appendChild(li);
    }
  } catch (err) {
    list.innerHTML =
      `<li style="color:var(--red)">市场拉取失败：${String(err)}。可在 kugua.config.json 的 plugins.marketIndex 配置索引地址。</li>`;
  }
}

/** 插件操作：启用/停用/重载/卸载/安装/更新 */
export async function 操作插件(
  动作: "enable" | "disable" | "reload" | "uninstall" | "install" | "update",
  name: string,
  repo?: string,
): Promise<void> {
  try {
    if (动作 === "uninstall") {
      显示确认对话框(`确定卸载插件「${name}」？将删除其目录。`, (ok) => {
        if (!ok) return;
        void (async () => {
          try {
            await window.kugua.request("plugins", "plugins.uninstall", { name });
            添加消息(`插件已卸载：${name}`, "system");
            await Promise.all([刷新本地插件(), 刷新插件市场()]);
          } catch (err) {
            添加消息(`卸载失败：${String(err)}`, "error");
          }
        })();
      });
      return;
    }
    const 参数 = 动作 === "install" || 动作 === "update" ? { name, repo } : { name };
    const r = (await window.kugua.request(
      "plugins",
      `plugins.${动作}`,
      参数,
    )) as 插件记录 & { updated?: boolean; from?: string; to?: string };
    const 提示: Record<string, string> = {
      install: `插件已安装：${r.name} v${r.version}`,
      update: `插件已更新：${r.name}${r.updated ? `（${r.from ?? ""} → ${r.to ?? ""}）` : "（已是最新）"}`,
      enable: `插件已启用：${r.name}`,
      disable: `插件已停用：${r.name}`,
      reload: `插件已重载：${r.name}`,
    };
    添加消息(提示[动作] ?? "操作完成", "system");
    await Promise.all([刷新本地插件(), 刷新插件市场()]);
  } catch (err) {
    添加消息(`操作失败：${String(err)}`, "error");
  }
}

export async function 刷新统计(): Promise<void> {
  try {
    const s = (await window.kugua.request("mkg", "mkg.stats", {})) as 知识库统计;
    document.getElementById("oc-stat-total")!.textContent = String(s.资源总数);
    document.getElementById("oc-stat-files")!.textContent = String(s.文件数);
    document.getElementById("oc-stat-dirs")!.textContent = String(s.目录数);
    document.getElementById("oc-stat-tags")!.textContent = String(s.标签数);
    document.getElementById("oc-stat-links")!.textContent = String(s.关联数);
    document.getElementById("oc-stat-texts")!.textContent = String(s.文本内容数);
  } catch {
    // 统计不可用时静默
  }
}

// ===== 通用确认对话框（应用内实现，替代原生 confirm，避免窗口失去键盘焦点后无法输入） =====
export let 确认回调: ((ok: boolean) => void) | null = null;

export function 显示确认对话框(message: string, onResult: (ok: boolean) => void): void {
  确认回调 = onResult;
  const 消息 = document.getElementById("confirm-message");
  if (消息) 消息.textContent = message;
  document.getElementById("confirm-dialog")?.classList.remove("hidden");
  const 默认按钮 = document.getElementById("confirm-cancel") as HTMLButtonElement | null;
  默认按钮?.focus();
}

export function 关闭确认对话框(ok: boolean): void {
  const 对话框 = document.getElementById("confirm-dialog");
  if (!对话框 || 对话框.classList.contains("hidden")) return;
  对话框.classList.add("hidden");
  const cb = 确认回调;
  确认回调 = null;
  cb?.(ok);
  // 关闭后把焦点归还页面主体，避免焦点停留在已隐藏元素上导致输入失效
  (document.activeElement as HTMLElement | null)?.blur?.();
}


