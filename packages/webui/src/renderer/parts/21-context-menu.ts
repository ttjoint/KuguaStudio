// ===== 统一右键菜单 =====
//
// 背景：原界面到处是浏览器默认右键菜单（"另存为"、"检查"、"翻译成中文"…），
// 既难看也和平台的功能脱节。这里统一接管全界面的 contextmenu 事件。
//
// 设计分层：
// 1. **全局兜底**：document 上捕获所有 contextmenu，一律 preventDefault，
//    绝不让浏览器默认菜单出现。
// 2. **按目标分流**：
//    - 可编辑元素（input / textarea / contenteditable）→ 剪切/复制/粘贴/全选
//    - 有选区的只读文本 → 复制选中/全选/复制全部
//    - 其它 → 交给各功能区自己注册的菜单；没有注册就给一个最小菜单（复制/刷新）
// 3. **专用菜单优先**：元素上打 `data-context-menu` 标记或调用 `注册右键菜单()`
//    注册的处理器优先级最高，全局兜底只在没人处理时生效。
//
// 为什么不用原生菜单：原生菜单包含"检查元素""另存为""翻译"等与平台无关的项，
// 且样式无法统一；用户在这个界面里想要的是"复制这段文字""打开这个文件"这类操作。

/** 一个菜单项；null 表示分隔线 */
export type 菜单项 = { label: string; icon?: string; danger?: boolean; onClick: () => void } | null;

/** 菜单容器（全局唯一） */
let 菜单容器: HTMLDivElement | null = null;

/** 当前是否已打开 */
let 已打开 = false;

function 取容器(): HTMLDivElement {
  if (菜单容器 && document.body.contains(菜单容器)) return 菜单容器;
  let el = document.getElementById("context-menu") as HTMLDivElement | null;
  if (!el) {
    el = document.createElement("div");
    el.id = "context-menu";
    el.className = "context-menu hidden";
    document.body.appendChild(el);
  }
  菜单容器 = el;
  return el;
}

/** 隐藏菜单 */
export function 隐藏菜单(): void {
  const el = 取容器();
  el.classList.add("hidden");
  el.innerHTML = "";
  已打开 = false;
}

/** 菜单当前是否打开（供外部判断，如避免点击穿透） */
export function 菜单已打开(): boolean {
  return 已打开;
}

/**
 * 在指定位置显示菜单。
 *
 * 会自动做视口边界保护（贴边时向左/向上翻转），并在点击别处、滚动、按 Esc 时关闭。
 */
export function 显示菜单(x: number, y: number, items: 菜单项[]): void {
  const el = 取容器();
  el.innerHTML = "";

  for (const it of items) {
    if (it === null) {
      const sep = document.createElement("div");
      sep.className = "cm-sep";
      el.appendChild(sep);
      continue;
    }
    const div = document.createElement("div");
    div.className = "cm-item" + (it.danger ? " danger" : "");
    div.textContent = (it.icon ? it.icon + " " : "") + it.label;
    div.addEventListener("click", () => {
      隐藏菜单();
      try {
        it.onClick();
      } catch (err) {
        console.error("[右键菜单] 执行失败：", err);
      }
    });
    el.appendChild(div);
  }

  // 先显示再量尺寸，否则 offsetWidth 为 0
  el.classList.remove("hidden");
  el.style.left = "0px";
  el.style.top = "0px";
  const 宽 = el.offsetWidth;
  const 高 = el.offsetHeight;
  // 边界保护：超出视口时向左/向上翻转，而不是简单截断（截断会丢失右侧菜单项）
  const 左 = x + 宽 > window.innerWidth - 4 ? Math.max(4, x - 宽) : x;
  const 上 = y + 高 > window.innerHeight - 4 ? Math.max(4, y - 高) : y;
  el.style.left = 左 + "px";
  el.style.top = 上 + "px";
  已打开 = true;
}

// ===== 剪贴板辅助 =====

/** 复制文本；返回是否成功 */
export async function 复制(文本: string): Promise<boolean> {
  if (!文本) return false;
  try {
    await navigator.clipboard.writeText(文本);
    return true;
  } catch {
    // 兜底：clipboard API 在非安全上下文/无权限时失败，用 execCommand
    try {
      const ta = document.createElement("textarea");
      ta.value = 文本;
      ta.style.position = "fixed";
      ta.style.opacity = "0";
      document.body.appendChild(ta);
      ta.select();
      const ok = document.execCommand("copy");
      ta.remove();
      return ok;
    } catch {
      return false;
    }
  }
}

/** 读取剪贴板文本（可能因权限失败） */
async function 读剪贴板(): Promise<string | null> {
  try {
    return await navigator.clipboard.readText();
  } catch {
    return null;
  }
}

// ===== 按元素类型构造菜单 =====

/** 元素是否可编辑（输入框 / textarea / contenteditable） */
function 是否可编辑(el: HTMLElement): boolean {
  const tag = el.tagName.toLowerCase();
  if (tag === "input" || tag === "textarea") return true;
  return el.isContentEditable;
}

/** 取输入框的选区 */
function 输入框选区(el: HTMLElement): { 起始: number; 结束: number } | null {
  const 任意 = el as unknown as { selectionStart?: number; selectionEnd?: number };
  if (typeof 任意.selectionStart !== "number" || typeof 任意.selectionEnd !== "number") return null;
  return { 起始: 任意.selectionStart, 结束: 任意.selectionEnd };
}

/** 可编辑元素的菜单：剪切/复制/粘贴/全选 */
function 可编辑菜单(el: HTMLElement, x: number, y: number): void {
  const 选区 = 输入框选区(el);
  const 有选中 = 选区 ? 选区.结束 > 选区.起始 : (window.getSelection()?.toString().length ?? 0) > 0;
  const 项: 菜单项[] = [];

  if (有选中) {
    项.push({
      label: "剪切",
      icon: "✂️",
      onClick: () => {
        const 文本 = 取选中文本(el);
        void 复制(文本).then((ok) => {
          if (!ok) return;
          if (el.tagName.toLowerCase() === "input" || el.tagName.toLowerCase() === "textarea") {
            document.execCommand("cut");
          } else {
            // contenteditable 交给浏览器
            document.execCommand("delete");
          }
        });
      },
    });
    项.push({ label: "复制", icon: "📋", onClick: () => void 复制(取选中文本(el)) });
    项.push(null);
  }

  项.push({
    label: "粘贴",
    icon: "📥",
    onClick: () => {
      void 读剪贴板().then((文本) => {
        if (文本 === null) return;
        if (el.tagName.toLowerCase() === "input" || el.tagName.toLowerCase() === "textarea") {
          const 输入 = el as HTMLInputElement | HTMLTextAreaElement;
          const 起 = 输入.selectionStart ?? 输入.value.length;
          const 止 = 输入.selectionEnd ?? 输入.value.length;
          输入.value = 输入.value.slice(0, 起) + 文本 + 输入.value.slice(止);
          输入.selectionStart = 输入.selectionEnd = 起 + 文本.length;
          输入.dispatchEvent(new Event("input", { bubbles: true }));
        } else {
          document.execCommand("insertText", false, 文本);
        }
      });
    },
  });
  项.push({ label: "全选", icon: "🔲", onClick: () => 全选元素(el) });

  显示菜单(x, y, 项);
}

/** 取元素内的选中文本（输入框走选区，其它走 window 选区） */
function 取选中文本(el: HTMLElement): string {
  const tag = el.tagName.toLowerCase();
  if (tag === "input" || tag === "textarea") {
    const 输入 = el as HTMLInputElement | HTMLTextAreaElement;
    return 输入.value.slice(输入.selectionStart ?? 0, 输入.selectionEnd ?? 0);
  }
  return window.getSelection()?.toString() ?? "";
}

/** 全选元素内容 */
function 全选元素(el: HTMLElement): void {
  const tag = el.tagName.toLowerCase();
  if (tag === "input" || tag === "textarea") {
    const 输入 = el as HTMLInputElement | HTMLTextAreaElement;
    输入.focus();
    输入.select();
    return;
  }
  const 范围 = document.createRange();
  范围.selectNodeContents(el);
  const 选区 = window.getSelection();
  选区?.removeAllRanges();
  选区?.addRange(范围);
}

/** 只读文本区的菜单：复制选中/全选/复制全部 */
function 只读文本菜单(目标: HTMLElement, x: number, y: number): void {
  const 选中 = window.getSelection()?.toString() ?? "";
  const 全部 = (目标.innerText ?? 目标.textContent ?? "").trim();
  const 项: 菜单项[] = [];

  if (选中) {
    项.push({ label: `复制选中（${选中.length} 字）`, icon: "📋", onClick: () => void 复制(选中) });
  }
  项.push({ label: "复制全部", icon: "📄", onClick: () => void 复制(全部) });
  项.push({ label: "全选", icon: "🔲", onClick: () => 全选元素(目标) });

  显示菜单(x, y, 项);
}

// ===== 注册机制 =====

/** 自定义处理器：返回 true 表示已处理（不再走默认逻辑） */
type 右键处理器 = (e: MouseEvent, 目标: HTMLElement) => boolean;

const 处理器表 = new WeakMap<HTMLElement, 右键处理器>();

/**
 * 为某个元素注册专用右键菜单。
 *
 * 用法：
 * ```ts
 * 注册右键菜单(列表容器, (e, 目标) => {
 *   const 项 = 目标.closest(".item");
 *   if (!项) return false;
 *   显示菜单(e.clientX, e.clientY, [...]);
 *   return true;
 * });
 * ```
 */
export function 注册右键菜单(el: HTMLElement, 处理器: 右键处理器): void {
  处理器表.set(el, 处理器);
}

/** 从目标向上找已注册的处理器 */
function 找处理器(目标: HTMLElement): 右键处理器 | null {
  let 当前: HTMLElement | null = 目标;
  while (当前) {
    const h = 处理器表.get(当前);
    if (h) return h;
    当前 = 当前.parentElement;
  }
  return null;
}

// ===== 初始化 =====

/** 初始化全局右键接管（只调一次） */
export function 初始化右键菜单(): void {
  // ===== 两阶段策略 =====
  //
  // 界面上有 10+ 处元素自带 contextmenu 监听器（内容列表、标签树、看板、聊天图片…）。
  // 如果全局在捕获阶段就弹菜单，会和那些专用菜单**叠成两个**。
  //
  // 所以：
  // 1. 捕获阶段：只 preventDefault（屏蔽浏览器默认菜单），不动菜单
  // 2. 冒泡阶段（document 是最后一个）：此时所有元素自己的监听器都跑完了；
  //    如果它们开了菜单（已打开 === true）就不再兜底，否则用默认菜单。
  document.addEventListener(
    "contextmenu",
    (e) => {
      // 只负责屏蔽浏览器默认菜单；菜单由后续阶段决定
      e.preventDefault();
      if (已打开) 隐藏菜单();
    },
    true,
  );

  document.addEventListener("contextmenu", (e) => {
    const 目标 = e.target as HTMLElement | null;
    if (!目标) return;
    // 元素自己的监听器已经弹了菜单 → 不覆盖
    if (已打开) return;

    // 1. 已注册的专用处理器
    const 处理器 = 找处理器(目标);
    if (处理器 && 处理器(e, 目标)) return;
    if (已打开) return;

    // 2. 可编辑元素：剪切/复制/粘贴/全选
    const 可编辑 = 目标.closest("input, textarea, [contenteditable='true']") as HTMLElement | null;
    if (可编辑) {
      可编辑菜单(可编辑, e.clientX, e.clientY);
      return;
    }

    // 3. 其它：只读文本菜单（有选中则优先复制选中）
    只读文本菜单(目标, e.clientX, e.clientY);
  });

  // 点击别处 / 滚动 / 窗口尺寸变化 / Esc → 关闭菜单
  document.addEventListener("mousedown", (e) => {
    if (!已打开) return;
    const 目标 = e.target as HTMLElement | null;
    if (目标 && 取容器().contains(目标)) return;
    隐藏菜单();
  });
  document.addEventListener("scroll", () => 已打开 && 隐藏菜单(), true);
  window.addEventListener("resize", () => 已打开 && 隐藏菜单());
  document.addEventListener("keydown", (e) => {
    if (e.key === "Escape" && 已打开) 隐藏菜单();
  });
}

// ===== 各功能区的专用菜单注册 =====
//
// 在全局兜底之外，为有明确语义的区域提供更贴合的菜单。
// 注册后：右键该区域时优先用这里的菜单；未注册的子元素仍走全局兜底（复制文本）。

/** 取元素纯文本（去掉按钮等噪音） */
function 取纯文本(el: HTMLElement): string {
  return (el.innerText ?? el.textContent ?? "").trim();
}

/** 复制并给出轻量反馈（不弹消息，避免打断） */
function 复制并提示(文本: string): void {
  void 复制(文本).then((ok) => {
    if (ok) 显示轻提示("已复制");
  });
}

/** 屏幕中央下方一闪而过的提示 */
export function 显示轻提示(文本: string): void {
  const 旧 = document.getElementById("cm-toast");
  旧?.remove();
  const el = document.createElement("div");
  el.id = "cm-toast";
  el.textContent = 文本;
  el.style.cssText = [
    "position:fixed",
    "left:50%",
    "bottom:64px",
    "transform:translateX(-50%)",
    "background:rgba(0,0,0,0.82)",
    "color:#fff",
    "padding:0.35rem 0.8rem",
    "border-radius:6px",
    "font-size:0.8rem",
    "z-index:9999",
    "pointer-events:none",
    "transition:opacity 0.2s",
  ].join(";");
  document.body.appendChild(el);
  setTimeout(() => {
    el.style.opacity = "0";
    setTimeout(() => el.remove(), 220);
  }, 1100);
}

/**
 * 为一批「只读文本区」注册统一的复制菜单。
 *
 * 用于：聊天日志、作业日志、系统日志、预览区、工具输出等。
 * 这些区域的共同点是——用户想要的几乎只有「复制某段文字」。
 */
export function 注册文本区菜单(元素: HTMLElement | null, 名称: string): void {
  if (!元素) return;
  注册右键菜单(元素, (e, 目标) => {
    const 选中 = window.getSelection()?.toString() ?? "";
    const 项: 菜单项[] = [];

    if (选中.trim()) {
      项.push({ label: `复制选中（${选中.length} 字）`, icon: "📋", onClick: () => 复制并提示(选中) });
    }
    // 单条消息/日志行：只复制那一条，而不是整个面板
    const 单条 = 目标.closest("[data-text], .chat-msg, .log-line, .job-item") as HTMLElement | null;
    const 单条文本 = 单条 ? (单条.dataset.text || 取纯文本(单条)) : "";
    if (单条文本 && 单条文本 !== 选中) {
      项.push({
        label: "复制本条",
        icon: "📄",
        onClick: () => 复制并提示(单条文本),
      });
    }
    项.push({ label: `复制全部${名称}`, icon: "🗒️", onClick: () => 复制并提示(取纯文本(元素)) });
    项.push(null);
    项.push({ label: "全选", icon: "🔲", onClick: () => 全选元素(元素) });

    显示菜单(e.clientX, e.clientY, 项);
    return true;
  });
}
