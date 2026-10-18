/**
 * 苦瓜工作室浏览器桥接：`window.kugua` 的唯一类型定义与实现来源。
 *
 * 使用方：
 *  - 主界面：`kugua-shim.ts`（含 WebSocket 日志/就绪通道与窗口控制占位）
 *  - 插件页：`plugin-sdk.ts`（仅 HTTP，不建立 WebSocket）
 */

/**
 * 后台连通状态闸门。
 *
 * 问题的来由：WebSocket 断开后，**HTTP 请求照样会发出去**——日志/总线走 WS，
 * 但所有 `window.kugua.request` 走的是 `/api/request`（HTTP），两者完全独立。
 * 后端已经没了，请求会在各自的超时里逐个失败，界面上表现为"点了半天没反应
 * 然后突然弹一堆错误"。
 *
 * 所以断线期间直接拒发：让每个调用立刻拿到一个明确的错误，而不是排队等超时。
 * 这也符合"断线后各模块不再发消息"的约定——不发，比发了再失败干净。
 *
 * 注意：默认是「连通」，只有在明确收到断线信号后才关闭闸门。
 * 插件页（plugin-sdk）不建立 WebSocket，所以它永远保持连通状态。
 */
let 后台连通 = true;

/** 由 WebSocket 侧调用：报告与后台的连接状态 */
export function 设置后台连通(连通: boolean): void {
  后台连通 = 连通;
}

/** 查询当前是否连通（供 UI 决定要不要提示用户手动刷新） */
export function 是后台连通(): boolean {
  return 后台连通;
}

/** 通过 HTTP 调用平台 API（错误信息优先取响应体中的 error 字段） */
export async function 请求<T = unknown>(路径: string, 体?: unknown): Promise<T> {
  if (!后台连通) {
    // 快速失败：不发请求，也就不会在断线期间堆积一堆注定失败的调用
    throw new Error("已与后台断开，请求未发送。请检查后台是否在运行，恢复后手动刷新页面。");
  }
  const 响应 = await fetch(路径, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(体 ?? {}),
  });
  const 文本 = await 响应.text();
  if (!响应.ok) {
    let 信息 = 文本;
    try {
      信息 = (JSON.parse(文本) as { error?: string }).error || 文本;
    } catch {
      /* 保留原文 */
    }
    throw new Error(信息 || `请求失败 ${响应.status}`);
  }

  // —— 业务失败：HTTP 200 + 明确的错误字段 ——
  //
  // 为什不直接用 4xx/5xx：浏览器会把**每一个**非 2xx 响应都记成控制台错误，
  // 而「某个模块没启动」「没配 OpenWebUI」这类事是**正常状态**，不是故障。
  // 用状态码表达它们，结果是用户一打开 AI 页就满屏红字，真正的问题反而看不见。
  //
  // 所以约定：传输层出错（路由错、读体失败、服务内部异常）才用 5xx；
  // 请求已到达平台、平台给出了否定答复的，用 200 + error 表示。
  // 对调用方而言两者行为一致：都是抛错。
  let 解析结果: unknown = null;
  try {
    解析结果 = 文本 ? JSON.parse(文本) : null;
  } catch {
    return (文本 as unknown) as T;
  }
  const 业务错误 = (解析结果 as { __kuguaError?: string } | null)?.__kuguaError;
  if (typeof 业务错误 === "string" && 业务错误) throw new Error(业务错误);
  return 解析结果 as T;
}

export interface 文件对话框选项 {
  title?: string;
  filters?: Array<{ name: string; extensions: string[] }>;
  multi?: boolean;
}

export interface 媒体文件读取结果 {
  base64: string;
  size: number;
  modified: number;
  tooLarge?: boolean;
}

/** 主界面与插件页共有的桥接能力 */
export interface 苦瓜基础接口 {
  request: (target: string, action: string, params?: unknown, timeoutMs?: number) => Promise<unknown>;
  broadcast: (action: string, params?: unknown) => Promise<unknown>;
  writeTempFile: (payload: { base64?: string; name?: string; ext?: string }) => Promise<string>;
  getFileUrl: (filePath: string) => Promise<string | null>;
  copyImage: (dataUrl: string) => Promise<boolean>;
  readMediaFile: (filePath: string) => Promise<媒体文件读取结果 | null>;
  dialog: {
    openFiles: (options?: 文件对话框选项) => Promise<string[]>;
    openImages: () => Promise<string[]>;
  };
}

/** 主界面完整桥接（在基础接口之上增加日志/就绪/总线事件通道与窗口控制） */
export interface 苦瓜接口 extends 苦瓜基础接口 {
  onLog: (callback: (entry: unknown) => void) => void;
  onReady: (callback: () => void) => void;
  /** 订阅主控广播的总线事件（如 capability.changed / registry.changed / plugins.changed） */
  onBus: (callback: (action: string, params: unknown) => void) => void;
  window: {
    minimize: () => Promise<void>;
    toggleMaximize: () => Promise<boolean>;
    close: () => Promise<void>;
    isMaximized: () => Promise<boolean>;
    onMaximized: (callback: (isMax: boolean) => void) => void;
  };
}

/** 构造共有能力（本地文件统一经 /api/file 提供，支持 Range） */
export function 创建基础接口(): 苦瓜基础接口 {
  return {
    request: (target, action, params, timeoutMs) => 请求("/api/request", { target, action, params, timeoutMs }),
    broadcast: (action, params) => 请求("/api/broadcast", { action, params }),
    writeTempFile: (payload) => 请求("/api/writeTempFile", payload),
    getFileUrl: (文件路径) => Promise.resolve(文件路径 ? `${location.origin}/api/file?path=${encodeURIComponent(文件路径)}` : null),
    copyImage: (dataUrl) => 请求("/api/clipboard/image", { dataUrl }),
    readMediaFile: (文件路径) => 请求("/api/media/read", { path: 文件路径 }),
    dialog: {
      openFiles: (选项) => 请求("/api/dialog/openFiles", 选项 ?? {}),
      openImages: () => 请求("/api/dialog/openImages", {}),
    },
  };
}
