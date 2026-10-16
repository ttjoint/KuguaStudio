// ===== 打开内容 / 内置编辑器 / 新建片段 =====
// 由 07-explorer.ts 拆分而来。
import { Explorer } from "./07-explorer";
import { 更新内容信息面板, 渲染标签chips, 绑定标签联想输入 } from "./07j-explorer-tags";
import { 取媒体编解码, 打开图片预览弹窗, 添加消息, 清理图片预览 } from "./03-preview";
import { 显示确认对话框 } from "./06-shell";

// ===== 打开内容（文本类用内置编辑器，其他用系统打开） =====
export async function 打开内容(item: Explorer.内容条目, programPath?: string): Promise<void> {
  if (item.resourceId == null) {
    // 片段（文本段）没有物理文件：按文本编辑方式打开，可预览与修改
    if (item.category === "文本段" || item.type === "snippet") {
      void 打开内置编辑器(item);
      return;
    }
    Explorer.选中内容 = item;
    更新内容信息面板();
    return;
  }
  try {
    if (programPath) {
      await window.kugua.request("mkg", "mkg.file.openWith", { resourceId: item.resourceId, programPath });
      return;
    }
    // 检查文件类型：文本/图片/视频/音乐用内置预览，其他用系统打开
    const 类型结果 = await window.kugua.request("mkg", "mkg.file.isText", { resourceId: item.resourceId }) as { isText: boolean; isArchive: boolean; isImage: boolean; isVideo: boolean; isAudio: boolean; extension: string } | undefined;
    if (类型结果?.isText || 类型结果?.isImage || 类型结果?.isVideo || 类型结果?.isAudio) {
      await 打开内置编辑器(item);
    } else {
      await window.kugua.request("mkg", "mkg.file.open", { resourceId: item.resourceId });
    }
  } catch (err) {
    const 文本 = String(err);
    const 友好 = /ENOENT|no such file|EACCES|已移动|不存在/.test(文本)
      ? "打开失败：文件可能已被移动、删除或不可访问，请刷新列表后重试。"
      : "打开失败：" + 文本;
    添加消息(友好, "error");
  }
}

/** 以系统默认方式打开文件（绕过内置编辑器） */
export async function 系统默认打开(item: Explorer.内容条目): Promise<void> {
  if (item.resourceId == null) return;
  try {
    await window.kugua.request("mkg", "mkg.file.open", { resourceId: item.resourceId });
  } catch (err) {
    添加消息("打开失败：" + String(err), "error");
  }
}

// ===== 内置编辑器（文本/片段/图片/视频/音频/二进制） =====
let 编辑器当前文件: Explorer.内容条目 | null = null;
let 编辑器原始内容 = "";
let 预览聚焦定时器: number | null = null;

async function 打开内置编辑器(item: Explorer.内容条目): Promise<void> {
  const 对话框 = document.getElementById("preview-dialog") as HTMLDivElement;
  const 标题 = document.getElementById("preview-title") as HTMLDivElement;
  const 文本编辑区 = document.getElementById("preview-text") as HTMLTextAreaElement;
  const 文本容器 = document.getElementById("preview-text-wrap") as HTMLDivElement;
  const 加载中 = document.getElementById("preview-loading") as HTMLDivElement;
  const 保存按钮 = document.getElementById("preview-save") as HTMLButtonElement;
  const 十六进制容器 = document.getElementById("preview-hex-wrap") as HTMLDivElement;
  const 压缩包容器 = document.getElementById("preview-archive-wrap") as HTMLDivElement;
  const 图片容器 = document.getElementById("preview-image-wrap") as HTMLDivElement;
  const 视频容器 = document.getElementById("preview-video-wrap") as HTMLDivElement;
  const 音频容器 = document.getElementById("preview-audio-wrap") as HTMLDivElement;

  // 隐藏所有区域，显示加载中
  文本容器.classList.add("hidden");
  十六进制容器.classList.add("hidden");
  压缩包容器.classList.add("hidden");
  图片容器.classList.add("hidden");
  视频容器.classList.add("hidden");
  音频容器.classList.add("hidden");
  加载中.classList.remove("hidden");
  保存按钮.classList.add("hidden");
  对话框.classList.remove("hidden");
  标题.textContent = "加载中...";

  try {
    const 是本地文件 = item.resourceId != null;
    const 类型结果 = 是本地文件
      ? (await window.kugua.request("mkg", "mkg.file.isText", { resourceId: item.resourceId! })) as { isText: boolean; isArchive: boolean; isImage: boolean; isVideo: boolean; isAudio: boolean; extension: string }
      : { isText: true, isArchive: false, isImage: false, isVideo: false, isAudio: false, extension: item.extension || "" };
    const 原始数据 = 是本地文件
      ? (await window.kugua.request("mkg", "mkg.file.readRaw", { resourceId: item.resourceId! })) as { base64: string; size: number; path: string }
      : null;

    加载中?.classList.add("hidden");

    if (类型结果.isText) {
      // 文本：片段直接取节点内容；文本文件按 UTF-8 解码
      let 文本 = item.content ?? "";
      if (是本地文件 && 原始数据) {
        const 内容 = atob(原始数据.base64);
        文本 = 内容;
        try {
          const 解码 = new TextDecoder("utf-8", { fatal: false });
          文本 = 解码.decode(new Uint8Array([...内容].map(c => c.charCodeAt(0))));
        } catch {
          // 解码失败则使用原始内容
        }
      }
      编辑器当前文件 = item;
      文本编辑区.value = 文本;
      // 以 textarea 归一化后的值（CRLF/CR -> LF）作为原始基线
      编辑器原始内容 = 文本编辑区.value;
      文本编辑区.readOnly = false;
      文本容器.classList.remove("hidden");
      保存按钮.classList.remove("hidden");
      标题.textContent = item.name;
      // 页脚显示字符数
      const 状态条 = document.getElementById("preview-text-status") as HTMLSpanElement | null;
      if (状态条) 状态条.textContent = 文本编辑区.value.length + " 字符";
      // 打开后光标定位到文件开头
      预览聚焦定时器 = window.setTimeout(() => {
        文本编辑区.focus();
        try { 文本编辑区.setSelectionRange(0, 0); } catch { /* 忽略 */ }
        文本编辑区.scrollTop = 0;
      }, 60);
    } else if (!是本地文件 || !原始数据) {
      添加消息("该内容没有可预览的本地文件", "error");
      对话框?.classList.add("hidden");
    } else if (类型结果.isImage) {
      // 图片：统一图片预览弹窗（元数据 / 动图 / 复制）
      const 文件路径 = 原始数据.path;
      const url = await (window.kugua as any).getFileUrl(文件路径);
      if (url) {
        const m = 取媒体编解码();
        const b = m ? m.base64转字节(原始数据.base64) : null;
        await 打开图片预览弹窗({
          源: url as string,
          名称: item.name,
          真实文件名: item.realName ?? undefined,
          路径: 原始数据.path,
          大小: 原始数据.size,
          字节: b || undefined,
          扩展名: item.extension,
        });
      } else {
        添加消息("无法获取图片路径，文件可能已被移动或删除", "error");
        对话框?.classList.add("hidden");
      }
    } else if (类型结果.isVideo) {
      const 视频元素 = document.getElementById("preview-video") as HTMLVideoElement;
      const url = await (window.kugua as any).getFileUrl(原始数据.path);
      if (url) {
        视频元素.src = url;
        视频容器.classList.remove("hidden");
        标题.textContent = item.name + "（视频）";
        视频元素.play().catch(() => {});
      } else {
        添加消息("无法获取视频路径，文件可能已被移动或删除", "error");
        对话框?.classList.add("hidden");
      }
    } else if (类型结果.isAudio) {
      const 音频元素 = document.getElementById("preview-audio") as HTMLAudioElement;
      const 音频标题 = document.getElementById("preview-audio-title") as HTMLDivElement;
      const url = await (window.kugua as any).getFileUrl(原始数据.path);
      if (url) {
        音频元素.src = url;
        音频标题.textContent = item.name;
        音频容器.classList.remove("hidden");
        标题.textContent = item.name + "（音乐）";
        音频元素.play().catch(() => {});
      } else {
        添加消息("无法获取音频路径，文件可能已被移动或删除", "error");
        对话框?.classList.add("hidden");
      }
    } else if (类型结果.isArchive) {
      压缩包容器.classList.remove("hidden");
      标题.textContent = item.name + "（压缩包）";
      document.getElementById("preview-archive-open")!.onclick = () => {
        void 系统默认打开(item);
        对话框?.classList.add("hidden");
      };
    } else {
      // 二进制文件：十六进制预览
      十六进制容器.classList.remove("hidden");
      标题.textContent = item.name + "（二进制）";
      const 十六进制容器元素 = document.getElementById("preview-hex") as HTMLDivElement;
      十六进制容器元素.innerHTML = "";
      const raw = atob(原始数据.base64);
      const bytes = new Uint8Array(raw.length);
      for (let i = 0; i < raw.length; i++) bytes[i] = raw.charCodeAt(i);
      const 行数 = Math.ceil(bytes.length / 16);
      for (let 行 = 0; 行 < 行数 && 行 < 500; 行++) {
        const 偏移 = 行 * 16;
        const 行数据 = bytes.slice(偏移, 偏移 + 16);
        const 十六进制 = Array.from(行数据).map(b => b.toString(16).padStart(2, "0")).join(" ");
        const ascii = Array.from(行数据).map(b => (b >= 32 && b <= 126) ? String.fromCharCode(b) : ".").join("");
        const 行元素 = document.createElement("div");
        行元素.className = "preview-hex-row";
        行元素.innerHTML = '<span class="preview-hex-offset">' + 偏移.toString(16).padStart(8, "0") + '</span><span class="preview-hex-bytes">' + 十六进制 + '</span><span class="preview-hex-ascii">' + ascii + '</span>';
        十六进制容器元素.appendChild(行元素);
      }
      if (行数 > 500) {
        const 提示 = document.createElement("div");
        提示.className = "preview-loading";
        提示.textContent = "仅显示前 500 行，剩余内容未显示";
        十六进制容器元素.appendChild(提示);
      }
    }
  } catch (err) {
    加载中?.classList.add("hidden");
    const 文本 = String(err);
    const 友好 = /ENOENT|no such file|EACCES|已移动|不存在/.test(文本)
      ? "打开失败：文件可能已被移动、删除或不可访问，请刷新列表后重试。"
      : "打开失败：" + 文本;
    添加消息(友好, "error");
    对话框?.classList.add("hidden");
  }
}

async function 保存编辑器内容(): Promise<void> {
  if (!编辑器当前文件) return;
  const 文本编辑区 = document.getElementById("preview-text") as HTMLTextAreaElement;
  const 新内容 = 文本编辑区.value;
  if (新内容 === 编辑器原始内容) {
    添加消息("内容未变更，无需保存", "system");
    return;
  }
  try {
    if (编辑器当前文件.resourceId == null) {
      // 片段/文本段：更新节点内容
      await window.kugua.request("mkg", "mkg.snippet.update", {
        id: 编辑器当前文件.id,
        patch: { content: 新内容 },
      });
    } else {
      const 编码内容 = btoa(unescape(encodeURIComponent(新内容)));
      await window.kugua.request("mkg", "mkg.file.write", {
        resourceId: 编辑器当前文件.resourceId,
        content: 编码内容,
        encoding: "base64",
      });
    }
    编辑器原始内容 = 新内容;
    添加消息("已保存：" + 编辑器当前文件.name, "system");
    if (编辑器当前文件.resourceId == null) await Explorer.加载所有内容();
  } catch (err) {
    添加消息("保存失败：" + String(err), "error");
  }
}

export async function 关闭内置编辑器(): Promise<void> {
  const 对话框 = document.getElementById("preview-dialog") as HTMLDivElement;
  const 文本编辑区 = document.getElementById("preview-text") as HTMLTextAreaElement;
  if (编辑器当前文件 && 文本编辑区.value !== 编辑器原始内容) {
    // 用应用内确认框替代原生 confirm：原生弹窗会把窗口键盘焦点夺走，
    // 关闭后会导致所有输入框无法输入
    const 放弃 = await new Promise<boolean>((resolve) => 显示确认对话框("内容已修改，是否放弃更改？", resolve));
    if (!放弃) return;
  }
  // 停止媒体播放
  const 视频元素 = document.getElementById("preview-video") as HTMLVideoElement | null;
  视频元素?.pause();
  if (视频元素) 视频元素.src = "";
  const 音频元素 = document.getElementById("preview-audio") as HTMLAudioElement | null;
  音频元素?.pause();
  if (音频元素) 音频元素.src = "";
  const 图片元素 = document.getElementById("preview-image") as HTMLImageElement | null;
  if (图片元素) 图片元素.src = "";
  清理图片预览();
  对话框.classList.add("hidden");
  // 取消未触发的延迟聚焦，避免焦点落在已隐藏的编辑区
  if (预览聚焦定时器 !== null) {
    clearTimeout(预览聚焦定时器);
    预览聚焦定时器 = null;
  }
  // 焦点归还页面主体，避免停留在已隐藏的编辑区导致后续无法输入
  (document.activeElement as HTMLElement | null)?.blur?.();
  编辑器当前文件 = null;
  编辑器原始内容 = "";
}

// ===== 新建片段（其他片段知识/文本段） =====
let 片段编辑标签ID = new Set<number>();

export function 打开新建片段对话框(): void {
  (document.getElementById("snippet-dialog-title") as HTMLDivElement).textContent = "新建片段";
  (document.getElementById("snippet-title") as HTMLInputElement).value = "";
  (document.getElementById("snippet-content") as HTMLTextAreaElement).value = "";
  const 标签输入 = document.getElementById("snippet-tag-input") as HTMLInputElement | null;
  if (标签输入) 标签输入.value = "";
  片段编辑标签ID.clear();
  渲染片段对话框标签();
  document.getElementById("snippet-dialog")?.classList.remove("hidden");
  (document.getElementById("snippet-title") as HTMLInputElement).focus();
}

function 渲染片段对话框标签(): void {
  渲染标签chips("snippet-tag-chips", 片段编辑标签ID, (id) => {
    片段编辑标签ID.delete(id);
    渲染片段对话框标签();
  });
}

async function 保存片段(): Promise<void> {
  const title = (document.getElementById("snippet-title") as HTMLInputElement).value.trim();
  const content = (document.getElementById("snippet-content") as HTMLTextAreaElement).value;
  const tagIds = Array.from(片段编辑标签ID);
  try {
    await window.kugua.request("mkg", "mkg.snippet.create", { title: title || "未命名", content, tagIds });
    添加消息("已新建片段", "system");
    document.getElementById("snippet-dialog")?.classList.add("hidden");
    await Explorer.加载所有内容();
  } catch (err) {
    添加消息("保存片段失败：" + String(err), "error");
  }
}


/** 绑定片段与内置编辑器相关事件（由 07-explorer 的 init 调用） */
export function 绑定编辑器事件(): void {
  document.getElementById("snippet-cancel")?.addEventListener("click", () => document.getElementById("snippet-dialog")?.classList.add("hidden"));
  document.getElementById("snippet-dialog")?.querySelector(".modal-backdrop")?.addEventListener("click", () => document.getElementById("snippet-dialog")?.classList.add("hidden"));
  document.getElementById("snippet-save")?.addEventListener("click", () => void 保存片段());
  const 片段标签输入 = document.getElementById("snippet-tag-input") as HTMLInputElement | null;
  if (片段标签输入) {
    绑定标签联想输入(片段标签输入, 片段编辑标签ID, () => 渲染片段对话框标签());
  }
  document.getElementById("preview-close")?.addEventListener("click", () => void 关闭内置编辑器());
  document.getElementById("preview-save")?.addEventListener("click", () => void 保存编辑器内容());
  document.getElementById("preview-open-system")?.addEventListener("click", () => {
    if (编辑器当前文件) {
      void 系统默认打开(编辑器当前文件);
      void 关闭内置编辑器();
    }
  });
  document.getElementById("preview-dialog")?.querySelector(".modal-backdrop")?.addEventListener("click", () => void 关闭内置编辑器());
  // Ctrl+S 保存
  document.getElementById("preview-text")?.addEventListener("keydown", (e) => {
    if ((e as KeyboardEvent).ctrlKey && (e as KeyboardEvent).key === "s") {
      e.preventDefault();
      void 保存编辑器内容();
    }
  });
}
