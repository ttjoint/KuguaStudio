/**
 * 苦瓜插件 UI SDK（编译产物：dist/renderer/plugin-sdk.js，经 /plugin-sdk.js 提供）
 *
 * 供插件自带页面在 /plugin-ui/<插件>/ 内使用：
 *   <script src="/plugin-sdk.js"></script>
 * 之后即可用 `window.kugua.request(目标, 动作, 参数)` 调用平台能力（经苦音总线）。
 * 仅走 HTTP，不建立 WebSocket（区别于主界面 shim）；不含窗口控制。
 */
import { 创建基础接口, type 苦瓜基础接口 } from "./bridge";

/** 插件页可见的桥接面：基础能力 + 兼容性的空日志/就绪回调 */
const 接口 = {
  ...创建基础接口(),
  onLog: () => {
    /* 插件页不接收总线日志流 */
  },
  onReady: (回调: () => void) => {
    回调();
  },
} satisfies 苦瓜基础接口 & { onLog: () => void; onReady: (cb: () => void) => void };

// 插件页只获得基础能力，不含窗口控制，故此处按主界面类型做一次收窄赋值
(window as unknown as { kugua: typeof 接口 }).kugua = 接口;
