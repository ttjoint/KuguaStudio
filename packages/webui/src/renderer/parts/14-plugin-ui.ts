import { 市场条目 } from "./01-types";
import { 添加消息 } from "./03-preview";
import { 刷新插件市场, 刷新本地插件, 刷新模块列表, 刷新统计, 操作插件, 显示确认对话框 } from "./06-shell";
import { 切换视图, 视图映射 } from "./11-tabs";
import { 挂载配置表单 } from "./17-config-form";

/** 已上报配置声明的模块名（缓存，刷新列表时更新） */
let 已声明配置 = new Set<string>();

/** 拉取所有模块的配置声明名，供列表渲染判断哪些模块有配置页 */
async function 同步声明名单(): Promise<void> {
  try {
    const 声明表 = (await window.kugua.request("nigane", "nigane.moduleConfig.declarations", {})) as Record<
      string,
      { 字段?: unknown[] }
    >;
    已声明配置 = new Set(
      Object.entries(声明表 ?? {})
        .filter(([, v]) => Array.isArray(v?.字段) && v.字段.length > 0)
        .map(([k]) => k),
    );
  } catch {
    // 主控尚未支持此接口时静默跳过
    已声明配置 = new Set();
  }
}

/** 全局提示：模块卡片上的局部提示位不可用时退回消息区 */
function 提示全局(文本: string, 错 = false): void {
  添加消息(文本, 错 ? "error" : "system");
}

// ===== 插件自带 UI 页（动态标签 + iframe） =====
/** 自定义页来源：插件（plugins/ 目录）或模块（模块握手自报 ui） */
interface 自定义页 {
  name: string;
  title: string;
  /** iframe 基地址前缀 */
  前缀: "/plugin-ui/" | "/module-ui/";
  /** 来源标签，用于 tooltip */
  来源: "插件" | "模块";
}

/** 拉取两侧的自定义页列表 */
async function 读取自定义页(): Promise<自定义页[]> {
  const 取 = async (地址: string, 前缀: 自定义页["前缀"], 来源: 自定义页["来源"]): Promise<自定义页[]> => {
    try {
      const r = await fetch(地址);
      if (!r.ok) return [];
      const 列 = (await r.json()) as Array<{ name: string; title: string }>;
      return (列 ?? []).map((p) => ({ name: p.name, title: p.title, 前缀, 来源 }));
    } catch {
      return [];
    }
  };
  // 模块页优先展示：模块的核心功能通常比插件更重
  const [模块页, 插件页] = await Promise.all([
    取("/api/module-pages", "/module-ui/", "模块"),
    取("/api/plugin-pages", "/plugin-ui/", "插件"),
  ]);
  return [...模块页, ...插件页];
}

/**
 * 加载自定义页（插件 + 模块）。
 *
 * 两者共用同一套 iframe 机制与 `window.kugua` 桥，区别只在静态资源前缀——
 * 这正是「上层统一、底层保留」的具体体现。
 */
export async function 加载插件页面(): Promise<void> {
  const 页列表 = await 读取自定义页();
  const 工作区 = document.getElementById("workspace");
  const 设置按钮 = document.getElementById("tab-settings");
  for (const 页 of 页列表) {
    const tabId = 页.来源 === "模块" ? `tab-mod-${页.name}` : `tab-plugin-${页.name}`;
    if (document.getElementById(tabId)) continue;
    const btn = document.createElement("button");
    btn.id = tabId;
    btn.className = "tb-btn nav-tab";
    btn.textContent = 页.title;
    btn.title = `${页.来源}页面：${页.name}`;
    设置按钮?.parentElement?.insertBefore(btn, 设置按钮);
    const view = document.createElement("div");
    view.id = `view-${tabId}`;
    view.className = "oc-view plugin-view hidden";
    const frame = document.createElement("iframe");
    frame.className = "plugin-frame";
    frame.dataset.src = `${页.前缀}${encodeURIComponent(页.name)}/`;
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



// ===== 模块管理：版本 / 更新 / 替换 / 移除 =====

interface 模块配置条目 {
  name: string;
  类型: string;
  启用: boolean;
  路径: string;
  参数: string[];
  说明: string;
  在线: boolean;
  子进程: number | null;
  版本: string;
  自动更新: boolean;
  外部: boolean;
  /** online | offline | blocked（blocked = 待确认或被拒绝，红灯） */
  状态: "online" | "offline" | "blocked";
  待确认: { 原因: string; 旧版本: string; 新版本: string; 差异: string[] } | null;
  拒绝原因: string | null;
  拒绝详情: string | null;
  /** 上报的新版本（未采纳前仅用于展示「更新」按钮） */
  待更新版本?: string | null;
}

/** 转义 HTML（本文件局部使用，避免依赖其它 part） */
function 转义(文本: unknown): string {
  return String(文本 ?? "")
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;");
}

/**
 * 决定模块卡片上显示哪些动作按钮。
 *
 * | 情形 | 按钮 |
 * |---|---|
 * | 被拒绝（非原位/重复注册） | 只能移除 |
 * | 待确认（信息变化/版本回退/同版本信息变） | 替换（黄，旧→新）+ 移除 |
 * | 有新版本且未开自动更新 | 更新（绿，旧→新）+ 移除 |
 * | 其余 | 只显示移除 |
 *
 * 「更新」与「替换」互斥，最多只出现一个。
 */
function 渲染动作按钮(m: 模块配置条目): string {
  const 移除 = `<button class="mod-btn mod-btn-remove" data-act="remove" title="移除（取消注册）">&#x1F5D1;</button>`;

  if (m.拒绝原因) return 移除;

  if (m.待确认) {
    const { 旧版本, 新版本 } = m.待确认;
    return `
      <button class="mod-btn mod-btn-replace" data-act="apply" title="按该模块上报的新信息替换">
        替换 <span class="mod-ver">${转义(旧版本)} &rarr; ${转义(新版本)}</span>
      </button>
      ${移除}`;
  }

  if (m.待更新版本 && m.待更新版本 !== m.版本) {
    return `
      <button class="mod-btn mod-btn-update" data-act="apply" title="更新到上报的新版本">
        更新 <span class="mod-ver">${转义(m.版本)} &rarr; ${转义(m.待更新版本)}</span>
      </button>
      ${移除}`;
  }

  return 移除;
}

/** 渲染模块管理列表 */
export async function 刷新模块配置(
  容器: HTMLElement | null = document.getElementById("settings-module-list"),
): Promise<void> {
  if (!容器) return;
  await 同步声明名单();
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
      const 灯 = m.状态 === "online" ? "on" : m.状态 === "blocked" ? "blocked" : "off";
      const 状态文本 = m.状态 === "online" ? "在线" : m.状态 === "blocked" ? "异常" : "离线";
      const pid = m.在线 && m.子进程 ? ` · pid ${m.子进程}` : "";
      const 版本文本 = m.版本 ? `v${转义(m.版本)}` : "v?";
      const 拒绝 = m.拒绝原因
        ? `<div class="mod-alert err">拒绝接入（${转义(m.拒绝原因)}）：${转义(m.拒绝详情 ?? "")}</div>`
        : "";
      const 待确认 = m.待确认
        ? `<div class="mod-alert warn">待确认（${转义(m.待确认.原因)}）：${转义(m.待确认.差异.join("；"))}</div>`
        : "";
      // 内置模块强制自动更新：开关置灰且固定勾选
      const 内置 = !m.外部;
      return `
      <div class="mod-item" data-index="${i}" data-name="${转义(m.name)}">
        <div class="mod-row mod-row-head">
          <span class="mod-name">
            <span class="mod-light ${灯}" title="${状态文本}"></span>
            ${转义(m.name)}
            <span class="mod-version">${版本文本}</span>
          </span>
          <span class="mod-tags">
            <span class="mod-badge ${灯 === "on" ? "on" : "off"}">${状态文本}${pid}</span>
            <span class="mod-badge type">${转义(m.类型)}</span>
          </span>
        </div>
        <div class="mod-row mod-row-actions">
          <button class="mod-btn mod-btn-refresh" data-act="refresh" title="向模块查询最新状态">&#x21BB;</button>
          ${渲染动作按钮(m)}
          <label class="mod-switch" title="是否启用（下次启动平台时一并拉起）">
            <input type="checkbox" class="mod-input-enable" ${m.启用 ? "checked" : ""} ${内置 ? "disabled" : ""}>
            <span class="mod-switch-track"><span class="mod-switch-knob"></span></span>
            <span class="mod-switch-label">启用</span>
          </label>
          <label class="mod-switch" title="自动更新：检测到新版本时随平台重启自动更新">
            <input type="checkbox" class="mod-input-autoupdate" ${m.自动更新 || 内置 ? "checked" : ""} ${内置 ? "disabled" : ""}>
            <span class="mod-switch-track"><span class="mod-switch-knob"></span></span>
            <span class="mod-switch-label">自动更新</span>
          </label>
        </div>
        ${拒绝}${待确认}
        ${
          // 模块自定义配置区：仅对上报了配置声明的模块渲染，内容在展开时按需加载
          已声明配置.has(m.name)
            ? `<details class="mod-details mod-cfg">
                 <summary>模块配置</summary>
                 <div class="cfg-body" data-module="${转义(m.name)}">
                   <div class="mod-empty">展开以加载…</div>
                 </div>
               </details>`
            : ""
        }
        <details class="mod-details">
          <summary>平台配置</summary>
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
            <span class="mod-msg"></span>
          </div>
        </details>
      </div>`;
    })
    .join("");
}

/** 绑定模块管理交互（只绑一次） */
export function 绑定模块管理事件(): void {
  const 容器 = document.getElementById("settings-module-list");
  if (!容器) return;

  // 切到设置页时刷新（由 11-tabs 触发，避免两文件互相 import）
  window.addEventListener("kugua:settings-shown", () => void 刷新模块配置());

  document.getElementById("settings-mod-refresh")?.addEventListener("click", () => {
    void 刷新模块配置();
  });

  // —— 「模块配置」展开时懒加载表单 ——
  容器.addEventListener("toggle", (ev) => {
    const 详情 = ev.target as HTMLElement;
    if (!详情.classList?.contains("mod-cfg") || !详情.hasAttribute("open")) return;
    const 区 = 详情.querySelector<HTMLElement>(".cfg-body");
    const 模块名 = 区?.dataset.module ?? "";
    if (!区 || !模块名 || 区.dataset.loaded === "1") return;
    区.dataset.loaded = "1";
    void (async () => {
      try {
        const 模型 = (await window.kugua.request("nigane", "nigane.moduleConfig.get", {
          name: 模块名,
        })) as {
          模块: string;
          说明?: string;
          字段: unknown[];
        };
        if (!Array.isArray(模型.字段) || 模型.字段.length === 0) {
          区.innerHTML = '<div class="mod-empty">该模块未声明可配置项</div>';
          return;
        }
        挂载配置表单(
          区,
          模型 as Parameters<typeof 挂载配置表单>[1],
          async (变更) => {
            await window.kugua.request("nigane", "nigane.moduleConfig.set", { name: 模块名, 变更 });
          },
          (文本, 错) => 提示全局(`${模块名}：${文本}`, 错),
        );
      } catch (err) {
        区.innerHTML = `<div class="mod-empty">加载失败：${转义(err)}</div>`;
        区.dataset.loaded = "";
      }
    })();
  }, true);

  const 提示 = (项: HTMLElement, 文本: string, 错 = false): void => {
    const 位 = 项.querySelector<HTMLElement>(".mod-msg");
    if (位) {
      位.textContent = 文本;
      位.classList.toggle("err", 错);
      setTimeout(() => {
        位.textContent = "";
        位.classList.remove("err");
      }, 4000);
      return;
    }
    // 「配置」折叠块收起时，回退到全局提示
    提示全局(文本, 错);
  };

  容器.addEventListener("change", (ev) => {
    const 目标 = ev.target as HTMLInputElement;
    const 项 = 目标.closest<HTMLElement>(".mod-item");
    if (!项) return;
    const 名 = 项.dataset.name ?? "";

    if (目标.classList.contains("mod-input-enable")) {
      void (async () => {
        try {
          await window.kugua.request("nigane", "nigane.registry.config.set", { name: 名, 启用: 目标.checked });
          提示全局(`${名}：已${目标.checked ? "启用" : "停用"}随平台启动`);
          await 刷新模块配置();
        } catch (err) {
          提示全局(`保存失败：${String(err)}`, true);
          目标.checked = !目标.checked;
        }
      })();
      return;
    }

    if (目标.classList.contains("mod-input-autoupdate")) {
      void (async () => {
        try {
          await window.kugua.request("nigane", "nigane.registry.config.set", {
            name: 名,
            自动更新: 目标.checked,
          });
          提示全局(`${名}：自动更新已${目标.checked ? "开启" : "关闭"}`);
          await 刷新模块配置();
        } catch (err) {
          提示全局(`保存失败：${String(err)}`, true);
          目标.checked = !目标.checked;
        }
      })();
    }
  });

  容器.addEventListener("click", (ev) => {
    const 目标 = ev.target as HTMLElement;
    const 项 = 目标.closest<HTMLElement>(".mod-item");
    if (!项) return;
    const 名 = 项.dataset.name ?? "";
    const 按钮 = 目标.closest<HTMLButtonElement>("[data-act]");
    const 动作 = 按钮?.dataset.act;

    if (动作 === "refresh") {
      按钮?.setAttribute("disabled", "true");
      void (async () => {
        try {
          const r = (await window.kugua.request("nigane", "nigane.registry.query", { name: 名 })) as {
            在线: boolean;
            状态: string;
            原因?: string;
          };
          提示(项, r.在线 ? `状态：${r.状态}` : `离线：${r.原因 ?? ""}`, !r.在线);
        } catch (err) {
          提示(项, `刷新失败：${String(err)}`, true);
        } finally {
          按钮?.removeAttribute("disabled");
          await 刷新模块配置();
        }
      })();
      return;
    }

    if (动作 === "apply") {
      按钮?.setAttribute("disabled", "true");
      void (async () => {
        try {
          await window.kugua.request("nigane", "nigane.registry.apply", { name: 名 });
          提示全局(`${名}：已按其上报信息更新`);
          await 刷新模块配置();
        } catch (err) {
          提示(项, `更新失败：${String(err)}`, true);
          按钮?.removeAttribute("disabled");
        }
      })();
      return;
    }

    if (动作 === "remove") {
      显示确认对话框(`确定移除模块「${名}」？将取消其注册，下次启动平台不再拉起。`, (ok: boolean) => {
        if (!ok) return;
        void (async () => {
          try {
            await window.kugua.request("nigane", "nigane.registry.remove", { name: 名 });
            提示全局(`已移除模块：${名}`);
            await 刷新模块配置();
          } catch (err) {
            提示(项, `移除失败：${String(err)}`, true);
          }
        })();
      });
      return;
    }

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
          提示(项, 结果.更新 ? `已保存：${(结果.变更 ?? []).join("；")}` : "无变更");
          await 刷新模块配置();
        } catch (err) {
          提示(项, `保存失败：${String(err)}`, true);
        } finally {
          目标.removeAttribute("disabled");
        }
      })();
    }
  });
}
