/**
 * 苦瓜工作室 Web UI 浏览器 shim（编译产物：dist/renderer/kugua-shim.js）
 *
 * 在浏览器中提供与旧 Electron preload 完全一致的 `window.kugua` 接口，
 * 使渲染层无需改动即可运行。所有能力经 HTTP API / WebSocket 转发到本地服务端。
 *
 * 必须早于 index.js 加载（index.html 中以普通 <script> 引入）。
 */
import { 设置后台连通, 创建基础接口, type 苦瓜接口 } from "./bridge";

/**
 * 是否为 Tauri 桌面壳环境。
 *
 * Tauri 注入 `window.__TAURI__`（本应用开启了 withGlobalTauri）。
 * 浏览器版与桌面版共用同一套渲染层，只有窗口控制等壳能力需要分支。
 */
function 是桌面壳(): boolean {
  return typeof (window as unknown as { __TAURI__?: unknown }).__TAURI__ !== "undefined";
}

/** 等 DOM 就绪后处理窗口控制按钮：桌面壳显示，浏览器隐藏 */
document.addEventListener("DOMContentLoaded", () => {
  const 控件 = document.querySelector<HTMLElement>(".window-controls");
  if (!控件) return;
  控件.style.display = 是桌面壳() ? "" : "none";
});

const 日志回调: Array<(entry: unknown) => void> = [];
const 就绪回调: Array<() => void> = [];
const 总线回调: Array<(action: string, params: unknown) => void> = [];
let 已就绪 = false;

/**
 * 断线提示横幅。
 *
 * 为什么需要：WebSocket 断开后页面**看起来还是好的**——按钮能点、输入框能打字，
 * 但所有请求都会失败。用户不知道是「后台挂了」还是「这个功能坏了」，
 * 只会反复点、反复失败，最后以为程序坏了。
 *
 * 所以断线必须让用户看见。连上后横幅自动消失，不需要用户手动关闭。
 */
let 横幅: HTMLDivElement | null = null;
let 断线次数 = 0;

function 显示断线横幅(文案: string): void {
  if (!横幅) {
    横幅 = document.createElement("div");
    横幅.id = "kugua-conn-banner";
    横幅.style.cssText = [
      "position:fixed", "top:0", "left:0", "right:0", "z-index:99999",
      "padding:6px 12px", "font-size:13px", "text-align:center",
      "color:#fff", "background:#b45309", "box-shadow:0 2px 6px rgba(0,0,0,.25)",
      "font-family:inherit", "pointer-events:none",
    ].join(";");
    document.body.appendChild(横幅);
    // 把页面整体下推，避免横幅盖住顶部工具栏
    document.body.style.paddingTop = "30px";
  }
  横幅.textContent = 文案;
  横幅.style.display = "";
}

function 隐藏断线横幅(): void {
  if (!横幅) return;
  横幅.style.display = "none";
  document.body.style.paddingTop = "";
}


/**
 * 重连成功后的「需要刷新」提示。
 *
 * 与断线横幅不同：这里是**黄色提醒**而不是红色告警，因为功能已经恢复，
 * 只是界面上的数据可能已经过期。用户可以选择现在刷新，也可以先把手头的
 * 事情做完再刷——自动刷新会丢掉正在编辑的内容，所以这个决定必须交给用户。
 */
function 显示待刷新提示(): void {
  window.setTimeout(() => {
    if (!横幅) return;
    // 只在真的重新连上之后才提示（避免和正在显示的断线横幅打架）
    if (断线次数 > 0) return;
    横幅.style.background = "#a16207";
    横幅.style.pointerEvents = "auto";
    横幅.style.cursor = "pointer";
    横幅.textContent = "已重新连接。断线期间后台数据可能已变化，点击此处刷新页面。";
    横幅.title = "刷新会丢失当前未保存的输入";
    横幅.onclick = () => window.location.reload();
    横幅.style.display = "";
    document.body.style.paddingTop = "30px";
    // 刻意**不自动收起**：数据过期的风险在用户刷新之前一直存在，
    // 自动消失会让他误以为"没事了"。横幅只有 30px 高且带点击刷新，
    // 一直留着比悄悄消失更有用。用户点一下刷新，横幅自然就没了。
  }, 300);
}

/**
 * 显示"平台已退出/正在重启"的提示。
 *
 * 与断线横幅的区别在于语气和后续行为：断线横幅说的是"可能出问题了，正在重连"，
 * 这里发生的是**用户自己要求的正常退出**，所以不该吓唬人，也不该暗示会恢复。
 *
 * @param 文案   显示的文字
 * @param 是终态  true = 平台真的没了（页面已失效）；false = 只是重启，会恢复
 */
function 显示退出提示(文案: string, 是终态: boolean): void {
  if (!横幅) return;
  横幅.style.pointerEvents = "none";
  横幅.style.cursor = "default";
  横幅.onclick = null;
  横幅.style.background = 是终态 ? "#475569" : "#a16207";
  横幅.style.color = "#fff";
  横幅.textContent = 文案;
  横幅.title = "";
  横幅.style.display = "";
  document.body.style.paddingTop = "30px";
}


/**
 * 桌面端：主动关掉本窗口（网页端无操作）。
 *
 * 用 `quit_app` 而不是 `window.close()`：WebView2 里 `window.close()` 只在
 * 由脚本打开时才被允许，普通窗口调它会被静默忽略。`quit_app` 是本应用自己的
 * invoke 命令，行为可控——且它的语义正是"只关 GUI，不动后端"，此刻后端
 * 已经自己退了，不会重复杀。
 */
function 关闭桌面窗口(): void {
  const 全局 = (window as unknown as { __TAURI__?: Tauri全局API }).__TAURI__;
  if (!全局?.core?.invoke) return; // 浏览器环境：什么都不做
  window.setTimeout(() => {
    void 全局.core.invoke("quit_app").catch(() => undefined);
  }, 1200);
}

/** 后端是否已主动通知退出（区分"正常退出"与"意外断线"） */
let 平台已退出 = false;

function 建立连接(): void {
  const proto = location.protocol === "https:" ? "wss:" : "ws:";
  const ws = new WebSocket(`${proto}//${location.host}/ws`);
  ws.onmessage = (事件) => {
    let 消息: { type?: string; entry?: unknown; action?: string; params?: unknown };
    try {
      消息 = JSON.parse(事件.data as string) as { type?: string; entry?: unknown; action?: string; params?: unknown };
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
    } else if (消息.type === "bus") {
      总线回调.forEach((回调) => {
        try {
          回调(String(消息.action ?? ""), 消息.params);
        } catch {
          /* 忽略单个回调异常 */
        }
      });
    } else if (消息.type === "platform_exit") {
      // 后端主动告知要退出（或重启）。这是**正常退出**，不是意外断线，
      // 所以不该走"断线横幅 + 无限重连"那套——那会让用户以为出错了。
      //
      // 收到后立刻停掉重连定时器，避免进程已经没了还在傻等、每 1.5 秒重试一次。
      const 是重启 = (消息 as { reason?: string }).reason === "restart";
      平台已退出 = true;
      if (是重启) {
        显示退出提示("平台正在重启，请稍候…（重启完成后页面会自动重连）", false);
      } else {
        显示退出提示("平台已退出。此页面已失效，关闭即可。", true);
        // 桌面端：后端既然已经退出，这扇窗就没有意义了，自己关掉。
        // 网页端没有这个能力（浏览器不允许标签自我关闭），所以只留提示。
        //
        // 留一点延迟让提示先渲染出来——否则窗口直接消失，用户会以为
        // "点了退出之后程序崩溃了"，而不是"它按我说的退出了"。
        关闭桌面窗口();
      }
    } else if (消息.type === "ready") {
      已就绪 = true;
      设置后台连通(true);
      if (断线次数 > 0) 隐藏断线横幅();
      断线次数 = 0;
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
    已就绪 = false;
    // 后端主动说了"我要退出"：这是预期内的事，不再重连，也不显示断线横幅
    if (平台已退出) return;
    // 关闸：断线期间不再发任何请求。后端已经没了，发出去只会在各自的超时里
    // 逐个失败，用户看到的是"点了没反应，过一会儿弹一堆错"。
    设置后台连通(false);
    断线次数 += 1;
    显示断线横幅(
      断线次数 === 1
        ? "已与后台断开，正在重连…（后台可能已关闭，请重新运行 start.bat）"
        : `仍在重连（第 ${断线次数} 次）…（后台可能已关闭，请重新运行 start.bat）`,
    );
    window.setTimeout(建立连接, 1500);
  };

  ws.onopen = () => {
    // 连接恢复（包括首次连接）：把闸门重新打开，让界面能继续工作。
    // 但**不自动刷新数据**——断线期间后台可能已经变了很多，界面上显示的还是
    // 旧的那一份。自动重载会丢掉用户正在写的内容；不刷新又会"看起来恢复了、
    // 实际数据对不上"。所以这里只恢复通路，并把"需要手动刷新"这件事明确告诉
    // 用户，由他自己决定什么时候刷。
    if (断线次数 > 0) 显示待刷新提示();
  };
}
建立连接();

/**
 * Tauri 全局 API 的最小类型（只声明用到的部分，避免引入 @tauri-apps/api 依赖）。
 *
 * 窗口控制走本应用自己的 invoke 命令（`minimize_window` / `toggle_maximize` / `is_maximized` / `quit_app`），
 * 而不是 Tauri 内置的 window API：内置 API 受 capability 的 remote URL 匹配约束，
 * 在 http://127.0.0.1:<port> 这种远程页面上容易被静默拒绝（表现为「调了没反应」）。
 */
interface Tauri全局API {
  core: { invoke: <T = unknown>(命令: string, 参数?: Record<string, unknown>) => Promise<T> };
  event?: { listen: (事件: string, 回调: () => void) => Promise<() => void> };
  window?: { getCurrentWindow: () => { onResized: (回调: () => void) => Promise<() => void> } };
}

/** 浏览器版：窗口控制无意义，做成空实现（按钮本就隐藏） */
function 浏览器窗口控制(): 苦瓜接口["window"] {
  return {
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
  };
}

/**
 * 桌面壳版：转发到 Tauri 原生窗口。
 *
 * 关窗走 `close()` 而非直接 `window.close()`，由 Rust 侧的退出钩子统一收走侧车，
 * 避免留下孤儿 node 进程。
 */
function 桌面窗口控制(): 苦瓜接口["window"] {
  const 取全局 = (): Tauri全局API | null =>
    (window as unknown as { __TAURI__?: Tauri全局API }).__TAURI__ ?? null;

  const 调用 = async <T>(命令: string, 兜底: T): Promise<T> => {
    const 全局 = 取全局();
    if (!全局?.core?.invoke) return 兜底;
    try {
      return await 全局.core.invoke<T>(命令);
    } catch {
      return 兜底;
    }
  };

  return {
    minimize: async () => {
      await 调用("minimize_window", null);
    },
    toggleMaximize: async () => 调用("toggle_maximize", false),
    close: async () => {
      // Rust 侧「关闭应用」会先收侧车再结束进程
      await 调用("quit_app", null);
      // 万一 invoke 不可用（比如在浏览器里），退回浏览器语义
      if (!取全局()?.core?.invoke) window.close();
    },
    isMaximized: async () => 调用("is_maximized", false),
    onMaximized: (回调) => {
      // 窗口尺寸变化（含最大化/还原）时回报真实状态
      const 全局 = 取全局();
      void 全局?.window
        ?.getCurrentWindow()
        .onResized(() => {
          void 调用("is_maximized", false).then(回调);
        })
        .catch(() => {
          /* 忽略 */
        });
    },
  };
}

const 接口: 苦瓜接口 = {
  ...创建基础接口(),
  onLog: (回调) => {
    日志回调.push(回调);
  },
  onBus: (回调) => {
    总线回调.push(回调);
  },
  onReady: (回调) => {
    就绪回调.push(回调);
    if (已就绪) 回调();
  },
  window: 是桌面壳() ? 桌面窗口控制() : 浏览器窗口控制(),
};

window.kugua = 接口;
