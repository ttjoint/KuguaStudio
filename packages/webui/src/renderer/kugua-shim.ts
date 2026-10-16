/**
 * 苦瓜工作室 Web UI 浏览器 shim（编译产物：dist/renderer/kugua-shim.js）
 *
 * 在浏览器中提供与旧 Electron preload 完全一致的 `window.kugua` 接口，
 * 使渲染层无需改动即可运行。所有能力经 HTTP API / WebSocket 转发到本地服务端。
 *
 * 必须早于 index.js 加载（index.html 中以普通 <script> 引入）。
 */
import { 创建基础接口, type 苦瓜接口 } from "./bridge";

/** 等待 DOM 就绪后隐藏 Electron 专有的窗口控制按钮 */
document.addEventListener("DOMContentLoaded", () => {
  const 控件 = document.querySelector<HTMLElement>(".window-controls");
  if (控件) 控件.style.display = "none";
});

const 日志回调: Array<(entry: unknown) => void> = [];
const 就绪回调: Array<() => void> = [];
let 已就绪 = false;

function 建立连接(): void {
  const proto = location.protocol === "https:" ? "wss:" : "ws:";
  const ws = new WebSocket(`${proto}//${location.host}/ws`);
  ws.onmessage = (事件) => {
    let 消息: { type?: string; entry?: unknown };
    try {
      消息 = JSON.parse(事件.data as string) as { type?: string; entry?: unknown };
    } catch {
      return;
    }
    if (消息.type === "log") {
      日志回调.forEach((回调) => {
        try {
          回调(消息.entry);
        } catch {
          /* 忽略单个回调异常 */
        }
      });
    } else if (消息.type === "ready") {
      已就绪 = true;
      就绪回调.forEach((回调) => {
        try {
          回调();
        } catch {
          /* 忽略单个回调异常 */
        }
      });
    }
  };
  ws.onclose = () => {
    window.setTimeout(建立连接, 1500);
  };
}
建立连接();

const 接口: 苦瓜接口 = {
  ...创建基础接口(),
  onLog: (回调) => {
    日志回调.push(回调);
  },
  onReady: (回调) => {
    就绪回调.push(回调);
    if (已就绪) 回调();
  },
  window: {
    minimize: () => Promise.resolve(),
    toggleMaximize: () => Promise.resolve(false),
    close: () => {
      window.close();
      return Promise.resolve();
    },
    isMaximized: () => Promise.resolve(false),
    onMaximized: () => {
      /* 浏览器无窗口最大化事件 */
    },
  },
};

window.kugua = 接口;
