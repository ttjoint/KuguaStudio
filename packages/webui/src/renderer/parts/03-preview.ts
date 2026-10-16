import { 聊天日志 } from "./02-chat-core";
import { 媒体编解码实现 } from "../media-codec";
import type { 地理信息, 图片信息, GIF补丁, GIF解码结果, 媒体编解码 } from "../media-codec";

// ===== 图片预览：统一弹窗（文件列表 / 聊天共用）+ 元数据 + GIF 帧播放 + 复制 =====
// 类型与实现均来自 ../media-codec（单一来源），此处仅做转发导出保持既有引用可用
export type { 地理信息, 图片信息, GIF补丁, GIF解码结果, 媒体编解码 };
export function 取媒体编解码(): 媒体编解码 | null {
  return 媒体编解码实现;
}
export function 解析图片信息(bytes?: Uint8Array): 图片信息 {
  const m = 取媒体编解码();
  if (!m || !bytes) return { 格式: "unknown" };
  try { return m.解析图片信息(bytes); } catch { return { 格式: "unknown" }; }
}
export function 图片字节转文本大小(bytes?: Uint8Array, 已知大小?: number): string {
  const m = 取媒体编解码();
  if (!m) return "未知";
  if (已知大小 != null) return m.人类可读大小(已知大小);
  if (bytes) return m.人类可读大小(bytes.length);
  return "未知";
}
export function 扩展名提示(名称?: string, 路径?: string): string {
  const 源 = (名称 || 路径 || "").toLowerCase();
  const m = 源.match(/\.([a-z0-9]{1,10})$/);
  return m ? m[1] : "";
}
export function base64转字节(base64: string): Uint8Array | null {
  const m = 取媒体编解码();
  try { return m ? m.base64转字节(base64) : null; } catch { return null; }
}
export function dataURL转字节(src: string): Uint8Array | null {
  const m = src.match(/^data:image\/[^;]+;base64,(.+)$/);
  return m ? base64转字节(m[1]) : null;
}
export function 本地路径从URL(src: string): string | null {
  try {
    if (src.startsWith("kugua-file:///")) {
      return decodeURIComponent(src.slice("kugua-file:///".length)).replace(/\//g, "\\");
    }
    if (src.startsWith("file://")) {
      return decodeURIComponent(src.slice("file://".length).replace(/^\//, ""));
    }
    // WebUI：本地文件经 /api/file?path= 提供
    if (src.indexOf("/api/file?path=") >= 0) {
      const u = new URL(src, location.origin);
      const p = u.searchParams.get("path");
      if (p) return p;
    }
  } catch { return null; }
  return null;
}
export function 文件名从路径(路径: string): string {
  const 段 = 路径.split(/[\\/]/).filter(Boolean);
  return 段.length ? 段[段.length - 1] : 路径;
}

/** GIF 帧播放器：暂停/继续 + 进度条拖拽（自研 LZW 解码，帧级渲染） */
export interface GIF播放器 {
  播放: () => void;
  暂停: () => void;
  跳帧: (i: number) => void;
  停止: () => void;
  当前帧号: () => number;
  总帧数: () => number;
  是否暂停: () => boolean;
}
export function 创建GIF播放器(canvas: HTMLCanvasElement, gif: GIF解码结果, 状态回调: (帧号: number, 总数: number, 暂停: boolean) => void): GIF播放器 | null {
  const 画板 = canvas.getContext("2d");
  if (!画板) return null;
  const ctx: CanvasRenderingContext2D = 画板;
  canvas.width = gif.宽;
  canvas.height = gif.高;
  let 当前帧 = 0;
  let 定时: number | null = null;
  let 暂停状态 = false;
  let 已绘制到 = -1;
  let 已循环 = 0;
  const 快照 = new Map<number, ImageData>();
  function 清空(): void { ctx.clearRect(0, 0, gif.宽, gif.高); }
  function 应用处置(j: number): void {
    const f = gif.帧[j];
    if (f.处置方式 === 2) ctx.clearRect(f.左, f.顶, f.宽, f.高);
    else if (f.处置方式 === 3) {
      const 快 = 快照.get(j);
      if (快) ctx.putImageData(快, 0, 0);
    }
  }
  function 绘制到(i: number, 从头 = false): void {
    if (从头) { 清空(); 已绘制到 = -1; 快照.clear(); }
    while (已绘制到 < i) {
      const 下一 = 已绘制到 + 1;
      if (下一 > 0) 应用处置(下一 - 1);
      const f = gif.帧[下一];
      if (f.处置方式 === 3) 快照.set(下一, ctx.getImageData(0, 0, gif.宽, gif.高));
      const 图 = ctx.createImageData(f.宽, f.高);
      图.data.set(f.像素);
      ctx.putImageData(图, f.左, f.顶);
      已绘制到 = 下一;
    }
  }
  function 汇报(): void { 状态回调(当前帧, gif.帧.length, 暂停状态); }
  function 画并调度(): void {
    if (暂停状态) return;
    // 循环回到首帧时整段重绘，否则停留在上一轮末尾
    绘制到(当前帧, 当前帧 === 0 && 已绘制到 >= gif.帧.length - 1);
    汇报();
    const 延迟 = Math.max(20, gif.帧[当前帧].延迟毫秒 || 100);
    当前帧++;
    if (当前帧 >= gif.帧.length) {
      当前帧 = 0;
      已循环++;
      if (gif.循环次数 > 0 && 已循环 >= gif.循环次数) {
        当前帧 = gif.帧.length - 1;
        暂停();
        return;
      }
    }
    定时 = window.setTimeout(画并调度, 延迟);
  }
  function 播放(): void {
    if (!暂停状态 && 定时 != null) return;
    暂停状态 = false;
    当前帧 = Math.min(当前帧, gif.帧.length - 1);
    定时 = window.setTimeout(画并调度, 10);
    汇报();
  }
  function 暂停(): void {
    暂停状态 = true;
    if (定时 != null) { window.clearTimeout(定时); 定时 = null; }
    汇报();
  }
  function 跳帧(i: number): void {
    const n = Math.max(0, Math.min(gif.帧.length - 1, i));
    const 保持暂停 = 暂停状态;
    if (定时 != null) { window.clearTimeout(定时); 定时 = null; }
    当前帧 = n;
    绘制到(n, n < 已绘制到 || n === 0 ? true : false);
    已绘制到 = n;
    if (!保持暂停) { 定时 = window.setTimeout(画并调度, 40); }
    汇报();
  }
  function 停止(): void {
    暂停状态 = true;
    if (定时 != null) { window.clearTimeout(定时); 定时 = null; }
  }
  暂停(); // 初始停在首帧，由装载处决定是否播放
  绘制到(0, true);
  return { 播放, 暂停, 跳帧, 停止, 当前帧号: () => 当前帧, 总帧数: () => gif.帧.length, 是否暂停: () => 暂停状态 };
}

export interface 图片预览载荷 {
  源: string;
  名称: string;
  真实文件名?: string;
  路径?: string;
  大小?: number;
  字节?: Uint8Array;
  扩展名?: string;
}
export interface 图片预览运行时状态 {
  gif播放器?: GIF播放器 | null;
  本地路径?: string;
  字节?: Uint8Array;
}
export let 图片预览状态: 图片预览运行时状态 | null = null;
export let 图片缩放倍率 = 1;
export let 图片旋转角度 = 0;

/** 供其他模块（预览交互）更新变换状态——ESM 导入绑定只读 */
export function 设置图片缩放倍率(v: number): void {
  图片缩放倍率 = v;
}
export function 设置图片旋转角度(v: number): void {
  图片旋转角度 = v;
}

export function 当前预览元素(): HTMLElement | null {
  const img = document.getElementById("preview-image") as HTMLImageElement | null;
  const canvas = document.getElementById("preview-gif-canvas") as HTMLCanvasElement | null;
  if (canvas && !canvas.classList.contains("hidden")) return canvas;
  if (img && !img.classList.contains("hidden") && img.src) return img;
  return null;
}
export function 应用图片变换(): void {
  const el = 当前预览元素();
  if (!el) return;
  el.style.transform = "scale(" + 图片缩放倍率 + ") rotate(" + 图片旋转角度 + "deg)";
}
export function 重置图片变换(): void {
  图片缩放倍率 = 1;
  图片旋转角度 = 0;
  应用图片变换();
  const 级别 = document.getElementById("preview-img-zoom-level");
  if (级别) 级别.textContent = "100%";
}

/** 停止 GIF 播放并清理预览状态（弹窗关闭时调用，保留弹窗 DOM） */
export function 清理图片预览(): void {
  if (图片预览状态?.gif播放器) {
    try { 图片预览状态.gif播放器.停止(); } catch { /* 忽略 */ }
  }
  图片预览状态 = null;
  const canvas = document.getElementById("preview-gif-canvas") as HTMLCanvasElement | null;
  const img = document.getElementById("preview-image") as HTMLImageElement | null;
  if (canvas) { canvas.classList.add("hidden"); canvas.width = 0; canvas.height = 0; }
  if (img) img.src = "";
  图片缩放倍率 = 1;
  图片旋转角度 = 0;
}

export function 图片元素转PNG(img: HTMLImageElement): Promise<string | null> {
  return new Promise((resolve) => {
    try {
      const w = img.naturalWidth || img.width || 0;
      const h = img.naturalHeight || img.height || 0;
      if (!w || !h) { resolve(null); return; }
      const c = document.createElement("canvas");
      c.width = w; c.height = h;
      const ctx = c.getContext("2d");
      if (!ctx) { resolve(null); return; }
      ctx.drawImage(img, 0, 0, w, h);
      resolve(c.toDataURL("image/png"));
    } catch { resolve(null); }
  });
}

/** 复制图片到剪贴板：优先当前 GIF 帧画布；其次预览 <img> */
export async function 复制当前预览图片(): Promise<boolean> {
  const 状态 = 图片预览状态;
  if (状态?.gif播放器) {
    const canvas = document.getElementById("preview-gif-canvas") as HTMLCanvasElement | null;
    if (canvas) {
      const ok = await window.kugua.copyImage(canvas.toDataURL("image/png"));
      if (ok) return true;
    }
  }
  const img = document.getElementById("preview-image") as HTMLImageElement | null;
  if (img && img.src) {
    const png = await 图片元素转PNG(img);
    if (png && await window.kugua.copyImage(png)) return true;
  }
  return false;
}
export async function 复制图片元素(img: HTMLImageElement): Promise<boolean> {
  const png = await 图片元素转PNG(img);
  if (png) return window.kugua.copyImage(png);
  return false;
}
export async function 复制剪贴板文本(文本: string): Promise<void> {
  try {
    await navigator.clipboard.writeText(文本);
    添加提示("已复制：" + (文本.length > 30 ? 文本.slice(0, 30) + "…" : 文本));
  } catch (err) {
    添加提示("复制失败：" + String(err), true);
  }
}

export function 显示顶层右键菜单(x: number, y: number, items: Array<{ label: string; icon?: string; onClick: () => void } | null>): void {
  const 菜单 = document.getElementById("context-menu") as HTMLDivElement;
  菜单.innerHTML = "";
  for (const it of items) {
    if (it === null) {
      const sep = document.createElement("div");
      sep.className = "cm-sep";
      菜单.appendChild(sep);
      continue;
    }
    const div = document.createElement("div");
    div.className = "cm-item";
    div.textContent = (it.icon ? it.icon + " " : "") + it.label;
    div.addEventListener("click", () => {
      菜单.classList.add("hidden");
      it.onClick();
    });
    菜单.appendChild(div);
  }
  菜单.style.left = Math.max(4, Math.min(x, window.innerWidth - 250)) + "px";
  菜单.style.top = Math.max(4, Math.min(y, window.innerHeight - 50)) + "px";
  菜单.classList.remove("hidden");
}

/** 聊天图片信息收集：data / kugua-file / file / http 各异 */
export async function 收集聊天图片载荷(img: HTMLImageElement): Promise<图片预览载荷 | null> {
  const src = img.currentSrc || img.src || "";
  if (!src) return null;
  const 路径 = 本地路径从URL(src);
  const 名称 = (img.getAttribute("alt") || (img.dataset.name || "")).trim() || (路径 ? 文件名从路径(路径) : "聊天图片");
  let 字节: Uint8Array | undefined;
  let 大小: number | undefined;
  if (/^data:image\/[^;]+;base64,/.test(src)) {
    const b = dataURL转字节(src);
    if (b) { 字节 = b; 大小 = b.length; }
    return { 源: src, 名称, 真实文件名: 名称, 路径: "（消息内嵌数据）", 大小, 字节 };
  }
  if (路径) {
    try {
      const 读取 = await window.kugua.readMediaFile(路径);
      if (读取) {
        大小 = 读取.size;
        if (读取.base64 && !读取.tooLarge) {
          const b = base64转字节(读取.base64);
          if (b) 字节 = b;
        }
      }
      const url = await window.kugua.getFileUrl(路径);
      return { 源: url || src, 名称: 文件名从路径(路径), 真实文件名: 文件名从路径(路径), 路径, 大小, 字节 };
    } catch {
      return { 源: src, 名称: 文件名从路径(路径), 真实文件名: 文件名从路径(路径), 路径, 大小, 字节 };
    }
  }
  let 远程字节: Uint8Array | null = null;
  if (/^https?:\/\//i.test(src)) {
    try {
      const res = await fetch(src);
      if (res.ok) {
        const ab = await res.arrayBuffer();
        远程字节 = new Uint8Array(ab);
      }
    } catch { 远程字节 = null; }
  }
  const url名 = 文件名从路径(decodeURIComponent(src.replace(/[?#].*$/, "")));
  const 名 = url名 && url名 !== src ? url名 : 名称;
  return {
    源: src,
    名称: 名,
    真实文件名: 名,
    路径: /^https?:\/\//i.test(src) ? src : "（内存数据）",
    大小: 远程字节 ? 远程字节.length : undefined,
    字节: 远程字节 || undefined,
  };
}

/** 统一图片预览弹窗（文件列表与聊天共用） */
export async function 打开图片预览弹窗(payload: 图片预览载荷): Promise<void> {
  const 对话框 = document.getElementById("preview-dialog") as HTMLDivElement;
  const 标题 = document.getElementById("preview-title") as HTMLDivElement;
  const 文本容器 = document.getElementById("preview-text-wrap") as HTMLDivElement;
  const 十六进制容器 = document.getElementById("preview-hex-wrap") as HTMLDivElement;
  const 压缩包容器 = document.getElementById("preview-archive-wrap") as HTMLDivElement;
  const 图片容器 = document.getElementById("preview-image-wrap") as HTMLDivElement;
  const 视频容器 = document.getElementById("preview-video-wrap") as HTMLDivElement;
  const 音频容器 = document.getElementById("preview-audio-wrap") as HTMLDivElement;
  const 加载中 = document.getElementById("preview-loading") as HTMLDivElement;
  const 保存按钮 = document.getElementById("preview-save") as HTMLButtonElement;
  const img = document.getElementById("preview-image") as HTMLImageElement;
  const canvas = document.getElementById("preview-gif-canvas") as HTMLCanvasElement;
  const 动画条 = document.getElementById("preview-anim-bar") as HTMLDivElement;
  const 动画标签 = document.getElementById("preview-anim-label") as HTMLSpanElement;
  const 动画开关 = document.getElementById("preview-anim-toggle") as HTMLButtonElement;
  const 动画滑条 = document.getElementById("preview-anim-slider") as HTMLInputElement;
  const 动画状态 = document.getElementById("preview-anim-status") as HTMLSpanElement;

  清理图片预览();
  文本容器.classList.add("hidden");
  十六进制容器.classList.add("hidden");
  压缩包容器.classList.add("hidden");
  视频容器.classList.add("hidden");
  音频容器.classList.add("hidden");
  加载中.classList.add("hidden");
  保存按钮.classList.add("hidden");
  图片容器.classList.remove("hidden");
  图片容器.querySelector(".preview-image-nav")?.classList.add("hidden");
  document.getElementById("preview-img-thumbs")?.classList.add("hidden");
  对话框.classList.remove("hidden");
  标题.textContent = payload.名称 + "（图片）";
  const 信息 = 解析图片信息(payload.字节);
  const ext提示 = payload.扩展名 || 扩展名提示(payload.真实文件名 || payload.名称, payload.路径);
  const m = 取媒体编解码();
  const 格式文本 = m ? m.图片格式全名(信息.格式, 信息.动图, 信息.帧数, ext提示) : "图片";
  const 大小文本 = m ? 图片字节转文本大小(payload.字节, payload.大小) : "未知";
  const 地理文本 = m && 信息.地理 ? m.地理信息文本(信息.地理) : "";
  const meta面板 = document.getElementById("preview-image-meta") as HTMLDivElement;
  meta面板.classList.remove("hidden");
  document.getElementById("preview-meta-name")!.textContent = payload.真实文件名 || payload.名称 || "-";
  document.getElementById("preview-meta-path")!.textContent = payload.路径 || (payload.源.startsWith("data:") ? "（消息内嵌数据）" : payload.源);
  document.getElementById("preview-meta-size")!.textContent = 大小文本;
  document.getElementById("preview-meta-format")!.textContent = 格式文本 + (信息.宽度 ? "，" + 信息.宽度 + "×" + 信息.高度 : "");
  const geo行 = document.getElementById("preview-meta-geo-row") as HTMLDivElement;
  const geo值 = document.getElementById("preview-meta-geo") as HTMLSpanElement;
  geo行.classList.toggle("hidden", !地理文本);
  geo值.textContent = 地理文本 || "-";
  const info文本 = document.getElementById("preview-image-info");
  if (info文本) info文本.textContent = payload.真实文件名 || payload.名称 || "";
  const meta路径 = document.getElementById("preview-meta-path");
  meta路径!.title = "点击复制地址";
  meta路径!.onclick = () => { void 复制剪贴板文本(meta路径!.textContent || ""); };

  const isGif动图 = payload.字节 && 信息.格式 === "gif" && (信息.帧数 || 0) > 1;
  if (isGif动图 && payload.字节) {
    const m2 = 取媒体编解码();
    const gif = m2 ? m2.解码GIF(payload.字节) : null;
    if (gif && gif.帧.length > 1) {
      img.classList.add("hidden");
      img.removeAttribute("src");
      canvas.classList.remove("hidden");
      动画条.classList.remove("hidden");
      动画标签.textContent = "GIF 动图 · " + gif.帧.length + " 帧";
      动画滑条.min = "0";
      动画滑条.max = String(gif.帧.length - 1);
      动画滑条.value = "0";
      const 播放器 = 创建GIF播放器(canvas, gif, (帧号, 总数, 暂停) => {
        动画状态.textContent = (帧号 + 1) + " / " + 总数;
        动画滑条.value = String(帧号);
        动画开关.textContent = 暂停 ? "▶" : "⏸";
      });
      if (播放器) {
        图片预览状态 = { gif播放器: 播放器, 本地路径: payload.路径, 字节: payload.字节 };
        if (info文本) info文本.textContent = (payload.真实文件名 || payload.名称 || "") + " · GIF 动图";
        播放器.播放();
        应用图片变换();
        return;
      }
    }
  }
  canvas.classList.add("hidden");
  动画条.classList.add("hidden");
  img.classList.remove("hidden");
  img.src = payload.源;
  图片预览状态 = { gif播放器: null, 本地路径: payload.路径, 字节: payload.字节 };
  if (信息.动图 && (信息.格式 === "webp" || 信息.格式 === "png")) {
    if (info文本) info文本.textContent = (payload.真实文件名 || payload.名称 || "") + " · 动图（原生播放）";
  }
  应用图片变换();
}

/** 打开聊天图片（双击/右键菜单调用） */
export async function 打开聊天图片预览(img: HTMLImageElement): Promise<void> {
  try {
    const payload = await 收集聊天图片载荷(img);
    if (!payload) return;
    await 打开图片预览弹窗(payload);
  } catch (err) {
    添加提示("图片预览失败：" + String(err), true);
  }
}

export const 聊天搜索框 = document.getElementById("chat-search") as HTMLInputElement | null;

export function 本地时间(d: Date): string {
  const p = (n: number) => String(n).padStart(2, "0");
  return `${d.getFullYear()}-${p(d.getMonth() + 1)}-${p(d.getDate())} ${p(d.getHours())}:${p(d.getMinutes())}`;
}

export function 时间编码(d = new Date()): string {
  const p = (n: number) => String(n).padStart(2, "0");
  return `${d.getFullYear()}${p(d.getMonth() + 1)}${p(d.getDate())}_${p(d.getHours())}${p(d.getMinutes())}${p(d.getSeconds())}`;
}

export function 读文件DataURL(f: File): Promise<{ base64: string; mime: string; name: string }> {
  return new Promise((resolve, reject) => {
    const r = new FileReader();
    r.onload = () => {
      const 结果 = String(r.result ?? "");
      const 逗号 = 结果.indexOf(",");
      resolve({ base64: 逗号 >= 0 ? 结果.slice(逗号 + 1) : 结果, mime: f.type || "image/png", name: f.name || "" });
    };
    r.onerror = () => reject(new Error("读取文件失败"));
    r.readAsDataURL(f);
  });
}

export function 创建消息节点(类型: "user" | "system" | "error"): HTMLDivElement {
  const div = document.createElement("div");
  div.className = `chat-msg ${类型}`;
  const meta = document.createElement("div");
  meta.className = "msg-meta";
  meta.innerHTML = `<span class="msg-time">${本地时间(new Date())}</span>`;
  const content = document.createElement("div");
  content.className = "msg-content";
  div.appendChild(meta);
  div.appendChild(content);
  const del = document.createElement("button");
  del.className = "msg-del";
  del.title = "删除此条消息";
  del.textContent = "×";
  del.addEventListener("click", () => div.remove());
  div.appendChild(del);
  return div;
}

export function 筛选聊天消息(div: HTMLElement): void {
  const q = 聊天搜索框?.value.trim() ?? "";
  if (!q) {
    div.style.display = "";
    div.classList.remove("search-hit");
    return;
  }
  const 命中 = (div.dataset.text ?? "").includes(q);
  div.style.display = 命中 ? "" : "none";
  if (命中) div.classList.add("search-hit");
}

export function 添加消息(内容: string, 类型: "user" | "system" | "error" = "system", 发送者?: string): void {
  if (类型 === "user") {
    const div = 创建消息节点("user");
    const c = div.querySelector<HTMLDivElement>(".msg-content");
    if (c) c.textContent = 内容;
    div.dataset.text = 内容;
    div.dataset.原文 = 内容;
    绑定消息编辑(div);
    聊天日志.appendChild(div);
    筛选聊天消息(div);
    聊天日志.scrollTop = 聊天日志.scrollHeight;
    return;
  }
  if (发送者) {
    添加回应(内容, 发送者, 类型 === "error");
    return;
  }
  添加提示(内容, 类型 === "error");
}

/** 为一条用户消息绑定「左键点击就地编辑」行为：
 *  - 点击进入可编辑状态；
 *  - 点外部 / Enter 提交：内容未变则仅恢复；变了则重新执行并在原回复内刷新；
 *  - Esc 取消。*/
export function 绑定消息编辑(宿主: HTMLDivElement): void {
  const 内容块 = 宿主.querySelector<HTMLDivElement>(".msg-content");
  if (!内容块) return;
  内容块.addEventListener("click", () => {
    if (宿主.querySelector(".msg-edit")) return;
    进入编辑(宿主, 内容块);
  });
}

function 进入编辑(宿主: HTMLDivElement, 内容块: HTMLDivElement): void {
  const 原文 = 宿主.dataset.原文 ?? 内容块.textContent ?? "";
  const 输入 = document.createElement("textarea");
  输入.className = "msg-edit";
  输入.value = 原文;
  输入.rows = 1;
  内容块.textContent = "";
  内容块.appendChild(输入);
  自动增高(输入);
  输入.focus();
  输入.selectionStart = 输入.selectionEnd = 输入.value.length;

  let 已提交 = false;
  const 结束 = (提交: boolean) => {
    if (已提交) return;
    已提交 = true;
    const 新值 = 输入.value.trim();
    输入.remove();
    内容块.textContent = 原文;
    if (!提交 || !新值 || 新值 === 原文.trim()) return; // 未改动：仅恢复可点击状态
    // 已改动：更新原文并重新执行
    宿主.dataset.原文 = 新值;
   宿主.dataset.text = 新值;
    内容块.textContent = 新值;
    重发并刷新(宿主, 新值);
  };

  输入.addEventListener("keydown", (e) => {
    if (e.key === "Enter" && !e.shiftKey && !e.ctrlKey && !e.metaKey) {
      e.preventDefault();
      结束(true);
    } else if (e.key === "Escape") {
      e.preventDefault();
      结束(false);
    }
  });
  // 点外部提交
  输入.addEventListener("blur", () => 结束(true));
}

function 自动增高(输入: HTMLTextAreaElement): void {
  输入.style.height = "auto";
  输入.style.height = Math.min(输入.scrollHeight, 200) + "px";
}

/** 重新执行被编辑的指令，并将结果作为新版本追加到原回复栏 */
async function 重发并刷新(宿主: HTMLDivElement, 文本: string): Promise<void> {
  const { 处理输入重发 } = await import("./04-router");
  await 处理输入重发(文本, 宿主);
}

/** 找到最近一条用户消息（用于把指令回应连在其下） */
export function 最近用户消息(): HTMLDivElement | null {
  const 列表 = 聊天日志.querySelectorAll<HTMLDivElement>(".chat-msg.user");
  return 列表.length > 0 ? 列表[列表.length - 1] : null;
}

/** 取得（必要时创建）某个消息气泡下的回复容器 .msg-replies
 *  所有回复块都装进该容器，便于按「版本」整体替换与回切。*/
export function 取回复容器(宿主: HTMLElement): HTMLDivElement {
  let 容器 = 宿主.querySelector<HTMLDivElement>(":scope > .msg-replies");
  if (!容器) {
    容器 = document.createElement("div");
    容器.className = "msg-replies";
    宿主.appendChild(容器);
  }
  return 容器;
}

/** 当前正在接收回复的容器（由 开始回复组 设置） */
let 当前回复容器: HTMLDivElement | null = null;

/** 开始一次指令执行：新建一个回复容器作为本次回复的归宿，并记录旧版本 */
export function 开始回复组(宿主: HTMLElement): void {
  const 旧 = 宿主.querySelector<HTMLDivElement>(":scope > .msg-replies");
  if (旧) {
    // 已有回复：固化为其版本历史，然后移出（供后续作为历史版本合并）
    固化版本(旧);
    const 历史 = 读版本(旧);
    旧.remove();
    宿主.dataset.历史版本 = JSON.stringify(历史);
  }
  const 容器 = document.createElement("div");
  容器.className = "msg-replies";
  宿主.appendChild(容器);
  当前回复容器 = 容器;
}

/** 结束回复组：为本次回复生成版本导航条（并与已有历史版本合并） */
export function 结束回复组(): void {
  if (!当前回复容器) return;
  const 容器 = 当前回复容器;
  当前回复容器 = null;
  if (容器.children.length === 0) return;
  const 宿主 = 容器.parentElement;
  const 历史 = 宿主?.dataset.历史版本 ? (JSON.parse(宿主.dataset.历史版本) as string[]) : [];
  const 当前 = 容器.innerHTML;
  // 新回复置为最新版本（放在末尾），导航默认停在最新
  设定版本(容器, [...历史, 当前], 历史.length);
  if (宿主) {
    delete 宿主.dataset.历史版本;
    重算搜索文本(宿主);
  }
}

/** 固化一个已存在的容器（无导航条时补上） */
function 固化版本(容器: HTMLDivElement): void {
  if (!容器.dataset.versions) {
    设定版本(容器, [容器.innerHTML], 0);
  }
}

function 设定版本(容器: HTMLDivElement, 版本列表: string[], 当前: number): void {
  容器.dataset.versions = JSON.stringify(版本列表);
  容器.dataset.vindex = String(当前);
  容器.innerHTML = 版本列表[当前] ?? "";
  刷新版本导航(容器);
}

function 读版本(容器: HTMLDivElement): string[] {
  try {
    return JSON.parse(容器.dataset.versions ?? "[]") as string[];
  } catch {
    return [];
  }
}

/** 从 innerHTML 恢复后，重建所有回复容器的版本导航条（监听器不保留） */
export function 恢复回复交互(): void {
  for (const 容器 of 聊天日志.querySelectorAll<HTMLDivElement>(".msg-replies")) {
    if (!容器.dataset.versions) continue;
    刷新版本导航(容器);
    重算搜索文本(容器.parentElement);
  }
}

/** 刷新/创建版本导航条（左下角 ‹ n/N ›）*/
function 刷新版本导航(容器: HTMLDivElement): void {  容器.querySelector(":scope > .msg-reply-versions")?.remove();
  const 版本列表 = 读版本(容器);
  if (版本列表.length <= 1) return;
  const 条 = document.createElement("div");
  条.className = "msg-reply-versions";
  条.dataset.versionsBar = "1";
  const 当前 = Number(容器.dataset.vindex ?? "0");
  const 上一 = document.createElement("button");
  上一.className = "vbtn";
  上一.textContent = "‹";
  上一.title = "上一个版本";
  上一.disabled = 当前 <= 0;
  上一.addEventListener("click", (e) => {
    e.stopPropagation();
    切换版本(容器, 当前 - 1);
  });
  const 标 = document.createElement("span");
  标.className = "vlabel";
  标.textContent = `${当前 + 1}/${版本列表.length}`;
  const 下一 = document.createElement("button");
  下一.className = "vbtn";
  下一.textContent = "›";
  下一.title = "下一个版本";
  下一.disabled = 当前 >= 版本列表.length - 1;
  下一.addEventListener("click", (e) => {
    e.stopPropagation();
    切换版本(容器, 当前 + 1);
  });
  条.appendChild(上一);
  条.appendChild(标);
  条.appendChild(下一);
  容器.appendChild(条);
}

function 切换版本(容器: HTMLDivElement, 目标: number): void {
  const 版本列表 = 读版本(容器);
  if (目标 < 0 || 目标 >= 版本列表.length) return;
  容器.dataset.vindex = String(目标);
  // 保留导航条本身：先移除旧内容再回填（导航条会重新创建）
  容器.innerHTML = 版本列表[目标];
  刷新版本导航(容器);
  const 宿主 = 容器.parentElement;
  if (宿主) 重算搜索文本(宿主);
}

/** 向容器追加一条回复（供 添加回应 / 添加HTML 共用） */
function 追加到容器(容器: HTMLDivElement): HTMLDivElement {
  const 用户块 = 容器.parentElement;
  // 追加回复前先移除导航条（避免被覆盖）
  容器.querySelector(":scope > .msg-reply-versions")?.remove();
  const 块 = document.createElement("div");
  容器.appendChild(块);
  重算搜索文本(用户块);
  return 块;
}

/** 重算宿主的搜索文本（用于搜索过滤；排除版本导航条） */
function 重算搜索文本(宿主: HTMLElement | null): void {
  if (!宿主) return;
  const 容器 = 宿主.querySelector<HTMLDivElement>(":scope > .msg-replies");
  let 回复文本 = "";
  if (容器) {
    const 克隆 = 容器.cloneNode(true) as HTMLElement;
    克隆.querySelectorAll(".msg-reply-versions").forEach((n) => n.remove());
    回复文本 = 克隆.textContent ?? "";
  }
  宿主.dataset.text = (宿主.querySelector(".msg-content")?.textContent ?? "") + "\n" + 回复文本;
}

/** 指令回应：追加到最近一条用户指令的回复容器内（连在一起，不另起气泡） */
export function 添加回应(内容: string, 发送者?: string, 错误 = false): void {
  const 用户 = 最近用户消息();
  let 容器: HTMLDivElement;
  if (用户) {
    容器 = 当前回复容器 && 当前回复容器.parentElement === 用户 ? 当前回复容器 : 取回复容器(用户);
  } else {
    const div = 创建消息节点("system");
    聊天日志.appendChild(div);
    容器 = 取回复容器(div);
  }
  const 块 = 追加到容器(容器);
  块.className = "msg-reply" + (错误 ? " error" : "");
  if (发送者) {
    const 标签 = document.createElement("div");
    标签.className = "msg-reply-sender";
    标签.textContent = 发送者;
    块.appendChild(标签);
  }
  const 内容块 = document.createElement("div");
  内容块.className = "msg-reply-content";
  内容块.textContent = 内容;
  块.appendChild(内容块);
  筛选聊天消息(容器.parentElement as HTMLElement);
  聊天日志.scrollTop = 聊天日志.scrollHeight;
}

/** 独立回应：自建一个 system 气泡承载回复（不吸附上一条 user 消息）。
 *  用于 AI 对话等：每条应答（含报错）都单独成对话框。
 *  返回可继续追加内容的回复块（msg-reply），便于以后扩展。*/
export function 添加独立回应(内容: string, 发送者?: string, 错误 = false): HTMLDivElement {
  const div = 创建消息节点("system");
  div.classList.add("chat-msg-independent");
  const 块 = document.createElement("div");
  块.className = "msg-reply" + (错误 ? " error" : "");
  if (发送者) {
    const 标签 = document.createElement("div");
    标签.className = "msg-reply-sender";
    标签.textContent = 发送者;
    块.appendChild(标签);
  }
  const 内容块 = document.createElement("div");
  内容块.className = "msg-reply-content";
  内容块.textContent = 内容;
  块.appendChild(内容块);
  div.appendChild(块);
  div.dataset.text = 内容;
  聊天日志.appendChild(div);
  筛选聊天消息(div);
  聊天日志.scrollTop = 聊天日志.scrollHeight;
  return 块;
}

/** 非指令回应的提示：不带气泡的小框（已导入/已上传等）
 *  若当前正处于某次指令回复中，则归入该回复容器（作为一个版本的一部分）。*/
export function 添加提示(内容: string, 错误 = false): void {
  const div = document.createElement("div");
  div.className = "chat-notice" + (错误 ? " error" : "");
  div.textContent = 内容;
  div.dataset.text = 内容;
  if (当前回复容器) {
    当前回复容器.querySelector(":scope > .msg-reply-versions")?.remove();
    当前回复容器.appendChild(div);
    重算搜索文本(当前回复容器.parentElement);
  } else {
    聊天日志.appendChild(div);
  }
  筛选聊天消息(div);
  聊天日志.scrollTop = 聊天日志.scrollHeight;
}

export function 添加HTML(html: string): void {
  const 用户 = 最近用户消息();
  let 容器: HTMLDivElement;
  if (用户) {
    容器 = 当前回复容器 && 当前回复容器.parentElement === 用户 ? 当前回复容器 : 取回复容器(用户);
  } else {
    const div = 创建消息节点("system");
    聊天日志.appendChild(div);
    容器 = 取回复容器(div);
  }
  const 块 = 追加到容器(容器);
  块.className = "msg-reply";
  块.innerHTML = html;
  筛选聊天消息(容器.parentElement as HTMLElement);
  聊天日志.scrollTop = 聊天日志.scrollHeight;
}

