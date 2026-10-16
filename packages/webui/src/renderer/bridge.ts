/**
 * 苦瓜工作室浏览器桥接：`window.kugua` 的唯一类型定义与实现来源。
 *
 * 使用方：
 *  - 主界面：`kugua-shim.ts`（含 WebSocket 日志/就绪通道与窗口控制占位）
 *  - 插件页：`plugin-sdk.ts`（仅 HTTP，不建立 WebSocket）
 */

/** 通过 HTTP 调用平台 API（错误信息优先取响应体中的 error 字段） */
export async function 请求<T = unknown>(路径: string, 体?: unknown): Promise<T> {
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
  return (文本 ? JSON.parse(文本) : null) as T;
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
