import { 资源 } from "./01-types";
import { 刷新附件区, 当前附件, 是图片路径, 聊天日志, 输入框, 附件区 } from "./02-chat-core";
import { 图片旋转角度, 图片缩放倍率, 设置图片旋转角度, 设置图片缩放倍率, 图片预览状态, 复制剪贴板文本, 复制图片元素, 复制当前预览图片, 应用图片变换, 打开聊天图片预览, 时间编码, 显示顶层右键菜单, 本地路径从URL, 添加提示, 添加消息, 读文件DataURL, 重置图片变换 } from "./03-preview";
import { 刷新统计 } from "./06-shell";
import { Explorer } from "./07-explorer";

// ===== 主题切换（日间/夜间） =====
export function 应用主题(t: "dark" | "light"): void {
  document.documentElement.dataset.theme = t;
  localStorage.setItem("kugua-theme", t);
  const btn = document.getElementById("btn-theme") as HTMLButtonElement;
  if (btn) btn.innerHTML = t === "light" ? "&#x1F319;" : "&#x2600;&#xFE0F;";
  document.querySelectorAll<HTMLButtonElement>(".oc-theme-btn").forEach((b) => {
    b.classList.toggle("active", b.dataset.theme === t);
  });
}
(function 初始化主题(): void {
  const saved = localStorage.getItem("kugua-theme");
  应用主题(saved === "light" ? "light" : "dark");
})();
document.getElementById("btn-theme")?.addEventListener("click", () => {
  应用主题(document.documentElement.dataset.theme === "light" ? "dark" : "light");
});
document.querySelectorAll<HTMLButtonElement>(".oc-theme-btn").forEach((b) => {
  b.addEventListener("click", () => 应用主题(b.dataset.theme === "light" ? "light" : "dark"));
});

// ===== 聊天侧边栏折叠 =====
export const 聊天侧边栏 = document.getElementById("chat-sidebar") as HTMLElement;
export const 聊天折叠按钮 = document.getElementById("chat-toggle") as HTMLButtonElement;
export function 设置聊天折叠(折叠: boolean): void {
  聊天侧边栏.classList.toggle("chat-collapsed", 折叠);
  聊天折叠按钮.innerHTML = 折叠 ? "&#x25C2;" : "&#x25B8;";
  聊天折叠按钮.title = 折叠 ? "展开聊天面板" : "收起聊天面板";
  const 手 = document.getElementById("chat-resize") as HTMLElement | null;
  if (手) 手.style.display = 折叠 ? "none" : "";
}
聊天折叠按钮.addEventListener("click", () => {
  设置聊天折叠(!聊天侧边栏.classList.contains("chat-collapsed"));
});

// ===== 聊天侧边栏宽度拖拽调整 =====
export const 聊天调整手柄 = document.getElementById("chat-resize") as HTMLElement;
export let 聊天拖拽中 = false;
聊天调整手柄.addEventListener("mousedown", (e) => {
  聊天拖拽中 = true;
  e.preventDefault();
});
document.addEventListener("mousemove", (e) => {
  if (!聊天拖拽中) return;
  if (聊天侧边栏.classList.contains("chat-collapsed")) return;
  const 宽 = Math.max(220, Math.min(window.innerWidth * 0.6, window.innerWidth - e.clientX - 聊天调整手柄.offsetWidth));
  聊天侧边栏.style.width = 宽 + "px";
  聊天侧边栏.style.minWidth = 宽 + "px";
  聊天侧边栏.style.maxWidth = 宽 + "px";
});
document.addEventListener("mouseup", () => { 聊天拖拽中 = false; });

// ===== 拖拽交互：知识库 <-> 聊天 =====
// 聊天侧边栏作为放置目标：接收知识库资源或外部文件，把引用放入输入框供指令使用
export const 聊天面板 = document.getElementById("chat-view") as HTMLElement;
聊天侧边栏.addEventListener("dragover", (e) => {
  e.preventDefault();
  if (e.dataTransfer) e.dataTransfer.dropEffect = "copy";
  聊天侧边栏.classList.add("drop-target");
});
聊天侧边栏.addEventListener("dragleave", () => 聊天侧边栏.classList.remove("drop-target"));
聊天侧边栏.addEventListener("drop", async (e) => {
  e.preventDefault();
  聊天侧边栏.classList.remove("drop-target");
  const 资源 = e.dataTransfer?.getData("text/kugua-resource");
  if (资源) {
    let obj: { id: number; name: string; path: string | null };
    try { obj = JSON.parse(资源); } catch { return; }
    if (是图片路径(obj.path)) {
      当前附件.push({ path: obj.path ?? undefined, name: obj.name, type: "image/" });
      刷新附件区();
      添加消息("已将图片「" + obj.name + "」加入，请输入处理指令（如：灰度、旋转90度、反色）。", "system");
    } else if (obj.path) {
      输入框.value = (输入框.value ? 输入框.value + " " : "") + "[资源:" + obj.path + "]";
      添加消息("已将知识库资源「" + obj.name + "」加入，请告诉我如何操作它。", "system");
    }
    输入框.focus();
    return;
  }
  const files = e.dataTransfer?.files;
  if (files && files.length > 0) {
    const f = files[0] as File & { path?: string };
    if (是图片路径(f.path) || /^image\//.test(f.type)) {
      if (f.path) {
        当前附件.push({ path: f.path, name: f.name || "图片", type: f.type || "image/" });
      } else if (f.type) {
        // 无本地路径（如从浏览器拖入）：读取为 base64 附件
        try {
          const 读 = await 读文件DataURL(f);
          当前附件.push({ base64: 读.base64, name: 读.name || "图片", type: 读.mime });
        } catch (err) {
          添加消息("读取图片失败：" + String(err), "error");
          return;
        }
      }
      刷新附件区();
      添加消息("已将图片「" + (f.name || "图片") + "」加入，请输入处理指令（如：灰度、旋转90度、反色）。", "system");
    } else if (f.path) {
      输入框.value = (输入框.value ? 输入框.value + " " : "") + "[文件:" + f.path + "]";
      添加消息("已将文件「" + f.name + "」加入，请告诉我如何处理它。", "system");
    } else if (f.type) {
      try {
        const 读 = await 读文件DataURL(f);
        当前附件.push({ base64: 读.base64, name: 读.name || "附件", type: 读.mime });
        刷新附件区();
        添加消息("已将文件「" + (f.name || "附件") + "」加入。", "system");
      } catch (err) {
        添加消息("读取文件失败：" + String(err), "error");
      }
    }
    输入框.focus();
  }
});

// 知识库浏览区域作为放置目标：接收来自聊天/知识库/外部文件的路径，导入为新资源
export const 知识库区域 = document.getElementById("explorer-area") as HTMLElement;
export const 导入提示 = document.getElementById("explorer-drop-hint") as HTMLDivElement;
知识库区域.addEventListener("dragover", (e) => {
  e.preventDefault();
  if (e.dataTransfer) e.dataTransfer.dropEffect = "copy";
  知识库区域.classList.add("drop-target");
  导入提示.classList.remove("hidden");
});
知识库区域.addEventListener("dragleave", (e) => {
  if (!知识库区域.contains(e.relatedTarget as Node)) {
    知识库区域.classList.remove("drop-target");
    导入提示.classList.add("hidden");
  }
});
知识库区域.addEventListener("drop", async (e) => {
  e.preventDefault();
  知识库区域.classList.remove("drop-target");
  导入提示.classList.add("hidden");
  // 收集所有可导入项：知识库资源、聊天文件引用、及外部文件的物理路径
  const 路径项: string[] = [];
  const 资源 = e.dataTransfer?.getData("text/kugua-resource");
  if (资源) {
    try {
      const p = (JSON.parse(资源) as { path: string | null }).path;
      if (p) 路径项.push(p);
    } catch { /* 忽略 */ }
  }
  const 聊天文件 = e.dataTransfer?.getData("text/kugua-file");
  if (聊天文件) 路径项.push(聊天文件);
  const files = Array.from(e.dataTransfer?.files ?? []);
  for (const fl of files) {
    const 路径 = (fl as File & { path?: string }).path;
    if (路径) 路径项.push(路径);
  }
  // 无本地路径的外部内容（如从浏览器拖入）：写入临时文件后导入
  const 临时项: Array<{ sourcePath: string; name: string }> = [];
  for (const fl of files) {
    const 路径 = (fl as File & { path?: string }).path;
    if (路径) continue;
    if (!fl.type) continue;
    try {
      const 读 = await 读文件DataURL(fl);
      const ext = (读.mime.split("/")[1] || "bin").replace(/\+.*$/, "").toLowerCase();
      const 原名 = 读.name || "";
      const 最终名 = 原名 || (时间编码() + "." + ext);
      const 临时路径 = await window.kugua.writeTempFile({ base64: 读.base64, name: 最终名 });
      临时项.push({ sourcePath: 临时路径, name: 最终名 });
    } catch (err) {
      添加消息("读取外部文件失败：" + String(err), "error");
    }
  }
  const 全部项 = 路径项.map((p) => ({ sourcePath: p })).concat(临时项);
  if (全部项.length === 0) return;
  添加消息("正在把 " + 全部项.length + " 个内容导入知识库…", "system");
  try {
    const r = (await window.kugua.request("mkg", "mkg.resource.importFiles", { items: 全部项 })) as Array<{
      duplicate?: boolean;
      name?: string;
    }>;
    const 重复数 = r.filter((x) => x && (x as { duplicate?: boolean }).duplicate).length;
    添加消息(
      `已导入 ${r.length - 重复数} 个内容到知识库${重复数 > 0 ? `，跳过 ${重复数} 个重复文件（资料库中已有完全一致的）` : ""}`,
      "system",
    );
    void Explorer.刷新();
    void 刷新统计();
  } catch (err) {
    添加消息("批量导入失败：" + String(err), "error");
  }
});

// 聊天消息中的资源链接可拖拽到知识库保存
聊天面板.addEventListener("dragstart", (e) => {
  const target = e.target as HTMLElement;
  const link = target.closest<HTMLElement>("[data-resource-path]");
  if (link) {
    e.dataTransfer?.setData("text/kugua-file", link.dataset.resourcePath || "");
    e.dataTransfer?.setData("text/plain", link.dataset.resourcePath || "");
    if (e.dataTransfer) e.dataTransfer.effectAllowed = "copy";
  }
});

// ===== 图片预览交互：聊天图片双击/右键、弹窗快捷键、缩放/GIF 控制 =====
export function 注册图片预览交互(): void {
  const 提示复制结果 = async (ok: boolean): Promise<void> => {
    添加提示(ok ? "已复制图片" : "复制失败：图片无法访问或跨域受限", !ok);
  };
  // 聊天日志与附件区的图片：双击预览、右键菜单
  const 图片容器列表 = [聊天日志, 附件区];
  for (const 容器 of 图片容器列表) {
    容器.addEventListener("dblclick", (e) => {
      const img = (e.target as HTMLElement).closest("img");
      if (!img) return;
      e.preventDefault();
      e.stopPropagation();
      void 打开聊天图片预览(img);
    });
    容器.addEventListener("contextmenu", (e) => {
      const img = (e.target as HTMLElement).closest("img");
      if (!img) return;
      e.preventDefault();
      e.stopPropagation();
      const 本地 = 本地路径从URL(img.currentSrc || img.src || "");
      显示顶层右键菜单(e.clientX, e.clientY, [
        { label: "打开预览", icon: "🔍", onClick: () => void 打开聊天图片预览(img) },
        { label: "复制图片", icon: "📋", onClick: () => void 复制图片元素(img).then(提示复制结果).catch(() => 提示复制结果(false)) },
        ...(本地 ? [null, { label: "复制图片路径", icon: "📄", onClick: () => void 复制剪贴板文本(本地) }] : []),
      ]);
    });
  }
  // 预览弹窗内的右键：复制图片 / 复制地址
  const 滚动区 = document.getElementById("preview-image-scroll");
  滚动区?.addEventListener("contextmenu", (e) => {
    if (图片预览状态 === null) return;
    e.preventDefault();
    e.stopPropagation();
    const 状态 = 图片预览状态;
    const 菜单: Array<{ label: string; icon?: string; onClick: () => void } | null> = [
      { label: "复制图片", icon: "📋", onClick: () => void 复制当前预览图片().then(提示复制结果).catch(() => 提示复制结果(false)) },
    ];
    if (状态.本地路径) {
      菜单.push(null, { label: "复制图片路径", icon: "📄", onClick: () => void 复制剪贴板文本(状态.本地路径 || "") });
    }
    显示顶层右键菜单(e.clientX, e.clientY, 菜单);
  });
  // 弹窗内 Ctrl+C 复制当前图片（文本编辑框内保持默认复制文本）
  document.addEventListener("keydown", (e) => {
    if (!(e.ctrlKey || e.metaKey) || (e.key !== "c" && e.key !== "C")) return;
    const 预览框 = document.getElementById("preview-dialog");
    const 图片框 = document.getElementById("preview-image-wrap");
    if (!预览框 || !图片框 || 预览框.classList.contains("hidden") || 图片框.classList.contains("hidden")) return;
    const tag = ((e.target as HTMLElement).tagName || "").toUpperCase();
    if (tag === "INPUT" || tag === "TEXTAREA") return;
    e.preventDefault();
    void 复制当前预览图片().then(提示复制结果).catch(() => 提示复制结果(false));
  });
  // 缩放 / 旋转
  const 级别 = document.getElementById("preview-img-zoom-level");
  const 缩放 = (倍率: number): void => {
    设置图片缩放倍率(Math.min(4, Math.max(0.25, +(图片缩放倍率 + 倍率).toFixed(2))));
    应用图片变换();
    if (级别) 级别.textContent = Math.round(图片缩放倍率 * 100) + "%";
  };
  document.getElementById("preview-img-zoom-in")?.addEventListener("click", () => 缩放(0.25));
  document.getElementById("preview-img-zoom-out")?.addEventListener("click", () => 缩放(-0.25));
  document.getElementById("preview-img-reset")?.addEventListener("click", () => 重置图片变换());
  document.getElementById("preview-img-rotate")?.addEventListener("click", () => {
    设置图片旋转角度((图片旋转角度 + 90) % 360);
    应用图片变换();
  });
  // GIF 暂停/继续与进度拖拽
  document.getElementById("preview-anim-toggle")?.addEventListener("click", () => {
    const p = 图片预览状态?.gif播放器;
    if (!p) return;
    if (p.是否暂停()) p.播放(); else p.暂停();
  });
  document.getElementById("preview-anim-slider")?.addEventListener("input", (e) => {
    const p = 图片预览状态?.gif播放器;
    if (!p) return;
    p.跳帧(Number((e.target as HTMLInputElement).value) || 0);
  });
}
注册图片预览交互();

// ===== 文本编辑器增强：Alt+滚轮缩放字号 + 实时字符数 =====
export function 注册文本编辑器增强(): void {
  const 编辑区 = document.getElementById("preview-text") as HTMLTextAreaElement;
  const 状态条 = document.getElementById("preview-text-status") as HTMLSpanElement | null;
  const 更新字符数 = (): void => {
    if (状态条) 状态条.textContent = 编辑区.value.length + " 字符";
  };
  // 打开时同步（值在打开内置编辑器里已设置）
  更新字符数();
  // 借用 document 轮询以覆盖每次打开后更新：改为 input 监听即可
  编辑区.addEventListener("input", 更新字符数);
  const 取字号 = (): number => {
    const 存 = localStorage.getItem("kugua-text-font");
    if (存) { const n = parseFloat(存); if (n >= 10 && n <= 28) return n; }
    return 13;
  };
  编辑区.style.fontSize = 取字号() + "px";
  编辑区.addEventListener("wheel", (e) => {
    if (!e.altKey) return;
    e.preventDefault();
    const 当前 = parseFloat(编辑区.style.fontSize) || 取字号();
    const 新 = Math.min(28, Math.max(10, Math.round((当前 + (e.deltaY < 0 ? 1 : -1)) * 10) / 10));
    编辑区.style.fontSize = 新 + "px";
    localStorage.setItem("kugua-text-font", String(新));
  }, { passive: false });
}
注册文本编辑器增强();

