/**
 * 扩展统一列表
 *
 * 「模块」与「插件」是两种进程模型，底层不合并——模块跑在独立进程、经 WebSocket
 * 接入，可被外部程序调用；插件在主控进程内动态 import，用于注册聊天正则命令。
 *
 * 但对用户来说，两者都是「给平台加功能的东西」，不应该分两处找。于是上层统一为
 * **扩展（Extension）**：一个列表、一套筛选、一致的图标与状态表达。
 *
 * 这个文件只做「读两侧数据 → 合表 → 渲染」，不改变任何一方的语义。
 */

import type { 插件记录, 模块详情 } from "./01-types";
import { 刷新本地插件, 刷新模块列表 } from "./06-shell";

/** 统一后的扩展条目 */
interface 扩展条目 {
  /** 唯一键：模块名与插件名可能重名，故前缀区分 */
  键: string;
  类型: "模块" | "插件";
  名称: string;
  版本: string;
  说明: string;
  在线: boolean;
  状态文本: string;
  /** 能力清单（模块）或命令清单（插件） */
  能力: string[];
  /** 离线/错误原因 */
  问题?: string;
  /** 是否有配置声明（仅模块；由调用方填充） */
  有配置?: boolean;
}

let 已加载 = false;

/** 转义 */
function 转义(文本: unknown): string {
  return String(文本 ?? "")
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;");
}

/** 把模块详情转成统一条目 */
function 转模块(m: 模块详情): 扩展条目 {
  const 在线 = Boolean(m.online);
  const 类型标签 = m.type === "library" ? "库" : m.type === "process" ? "进程" : "未知";
  let 状态文本 = "离线";
  if (在线) 状态文本 = m.type === "process" ? `运行中 (pid=${m.pid ?? "?"})` : m.type === "library" ? "就绪" : "在线";
  else if (m.type === "library" && m.fileExists === false) 状态文本 = "文件缺失";
  return {
    键: `模块:${m.name}`,
    类型: "模块",
    名称: m.name,
    版本: m.version ?? "?",
    说明: m.description ?? "",
    在线,
    状态文本: `${类型标签} · ${状态文本}`,
    能力: m.capabilities ?? [],
    问题: 在线 ? undefined : m.fileExists === false ? "模块文件不存在" : undefined,
  };
}

/** 把插件记录转成统一条目 */
function 转插件(p: 插件记录): 扩展条目 {
  const 状态文本 =
    ({ enabled: "运行中", disabled: "已停用", loaded: "已加载", error: "错误" } as const)[p.状态] ?? p.状态;
  return {
    键: `插件:${p.name}`,
    类型: "插件",
    名称: p.name,
    版本: p.version,
    说明: p.description ?? "",
    在线: p.状态 === "enabled" || p.状态 === "loaded",
    状态文本,
    能力: p.命令.map((c) => c.匹配),
    问题: p.错误,
  };
}

/** 读取两侧数据；任一侧失败不影响另一侧 */
async function 读取全部(): Promise<扩展条目[]> {
  const 条目: 扩展条目[] = [];

  const [模块结果, 插件结果] = await Promise.allSettled([
    window.kugua.request("nigane", "nigane.registry.details", {}) as Promise<模块详情[]>,
    window.kugua.request("plugins", "plugins.list", {}) as Promise<插件记录[]>,
  ]);

  if (模块结果.status === "fulfilled" && Array.isArray(模块结果.value)) {
    for (const m of 模块结果.value) 条目.push(转模块(m));
  }
  if (插件结果.status === "fulfilled" && Array.isArray(插件结果.value)) {
    for (const p of 插件结果.value) 条目.push(转插件(p));
  }

  // 补上「有配置页」标记：只有上报了配置声明的模块才有
  try {
    const 声明表 = (await window.kugua.request("nigane", "nigane.moduleConfig.declarations", {})) as Record<
      string,
      unknown
    >;
    const 有声明 = new Set(Object.keys(声明表 ?? {}));
    for (const 条 of 条目) if (条.类型 === "模块") 条.有配置 = 有声明.has(条.名称);
  } catch {
    // 主控不支持时忽略
  }

  // 排序：在线优先 → 模块优先 → 名称
  条目.sort((a, b) => {
    if (a.在线 !== b.在线) return a.在线 ? -1 : 1;
    if (a.类型 !== b.类型) return a.类型 === "模块" ? -1 : 1;
    return a.名称.localeCompare(b.名称);
  });
  return 条目;
}

/** 渲染单个条目 */
function 渲染条目(条: 扩展条目): string {
  const 点色 = 条.在线 ? "var(--green)" : "var(--text-dim)";
  const 类型类 = 条.类型 === "模块" ? "ext-badge-module" : "ext-badge-plugin";
  const 能力标签 =
    条.类型 === "模块"
      ? 条.能力.length > 0
        ? `${条.能力.length} 项能力`
        : "无能力"
      : 条.能力.length > 0
        ? `${条.能力.length} 条命令`
        : "无命令";
  const 能力预览 = 条.能力.slice(0, 6).join("、") + (条.能力.length > 6 ? ` 等 ${条.能力.length} 项` : "");
  const 问题 = 条.问题 ? `<div class="module-desc" style="color:var(--red)">${转义(条.问题)}</div>` : "";
  const 配置标记 = 条.有配置 ? '<span class="ext-cfg-flag" title="该模块提供配置页">可配置</span>' : "";

  return `
    <li class="ext-item" data-key="${转义(条.键)}" data-search="${转义(
      [条.名称, 条.说明, ...条.能力].join(" ").toLowerCase(),
    )}">
      <span class="module-dot" style="background:${点色}"></span>
      <div class="module-info" style="flex:1">
        <div class="module-name">
          ${转义(条.名称)}
          <span class="ext-badge ${类型类}">${条.类型}</span>
          ${配置标记}
          <span class="ext-state">${转义(条.状态文本)}</span>
        </div>
        <div class="module-desc">
          v${转义(条.版本)} · ${能力标签}${条.说明 ? ` · ${转义(条.说明)}` : ""}
        </div>
        ${能力预览 ? `<div class="module-desc ext-caps" title="${转义(条.能力.join("、"))}">${转义(能力预览)}</div>` : ""}
        ${问题}
      </div>
    </li>`;
}

/** 渲染统计摘要 */
function 渲染摘要(条目: 扩展条目[]): void {
  const 盒 = document.getElementById("ext-summary");
  if (!盒) return;
  const 模块 = 条目.filter((e) => e.类型 === "模块");
  const 插件 = 条目.filter((e) => e.类型 === "插件");
  const 在线模块 = 模块.filter((e) => e.在线).length;
  const 在线插件 = 插件.filter((e) => e.在线).length;
  盒.innerHTML = `
    <span class="ext-stat"><strong>${模块.length}</strong> 个模块（在线 ${在线模块}）</span>
    <span class="ext-stat"><strong>${插件.length}</strong> 个插件（启用 ${在线插件}）</span>
  `;
}

/** 按筛选词过滤已渲染条目 */
function 应用筛选(关键词: string): void {
  const 词 = 关键词.trim().toLowerCase();
  document.querySelectorAll<HTMLElement>("#ext-list .ext-item").forEach((li) => {
    const hay = li.dataset.search ?? "";
    li.style.display = !词 || hay.includes(词) ? "" : "none";
  });
}

/** 刷新统一扩展列表 */
export async function 刷新扩展列表(): Promise<void> {
  const 列表 = document.getElementById("ext-list");
  if (!列表) return;
  if (!已加载) 列表.innerHTML = '<li style="color:var(--text-dim)">加载中…</li>';
  try {
    const 条目 = await 读取全部();
    渲染摘要(条目);
    if (条目.length === 0) {
      列表.innerHTML = '<li style="color:var(--text-dim)">暂无扩展。可安装插件，或在 kugua.config.json 配置模块。</li>';
      return;
    }
    列表.innerHTML = 条目.map(渲染条目).join("");
    const 筛选框 = document.getElementById("ext-filter") as HTMLInputElement | null;
    if (筛选框?.value) 应用筛选(筛选框.value);
    已加载 = true;
  } catch (err) {
    列表.innerHTML = `<li style="color:var(--red)">加载失败：${转义(err)}</li>`;
  }
}

/** 初始化：筛选与刷新按钮 */
export function 初始化扩展列表(): void {
  const 筛选框 = document.getElementById("ext-filter") as HTMLInputElement | null;
  筛选框?.addEventListener("input", () => 应用筛选(筛选框.value));
  document.getElementById("ext-refresh")?.addEventListener("click", () => {
    void (async () => {
      // 一并刷新下方的分项列表，避免同一屏数据不一致
      await Promise.allSettled([刷新扩展列表(), 刷新本地插件(), 刷新模块列表()]);
    })();
  });
}
