const WebSocket = require("ws");
const URL = "ws://127.0.0.1:9223/devtools/page/0139FC7E3AB3392528E862EA61890B5B";

function connect() {
  return new Promise((resolve, reject) => {
    const ws = new WebSocket(URL);
    ws.on("open", () => resolve(ws));
    ws.on("error", reject);
  });
}

let id = 0;
function send(ws, method, params = {}) {
  return new Promise((resolve) => {
    const mid = ++id;
    const handler = (data) => {
      const msg = JSON.parse(data.toString());
      if (msg.id === mid) {
        ws.off("message", handler);
        resolve(msg);
      }
    };
    ws.on("message", handler);
    ws.send(JSON.stringify({ id: mid, method, params }));
  });
}

async function evalJs(ws, expr) {
  const r = await send(ws, "Runtime.evaluate", { expression: expr, returnByValue: true, awaitPromise: true });
  return r.result?.result?.value;
}

(async () => {
  const ws = await connect();
  await send(ws, "Runtime.enable");

  // 1. 搜索框是否存在
  console.log("搜索框存在:", await evalJs(ws, `!!document.getElementById("chat-search")`));
  console.log("搜索清除按钮存在:", await evalJs(ws, `!!document.getElementById("chat-search-clear")`));

  // 2. 清空聊天日志，添加两条测试消息
  await evalJs(ws, `document.getElementById("chat-log").innerHTML=""`);
  await evalJs(ws, `添加消息("测试消息一 灰度", "user")`);
  await evalJs(ws, `添加消息("测试消息二 旋转", "system", "占卜结果")`);
  await evalJs(ws, `添加消息("测试消息三 反色", "user")`);
  const 消息数 = await evalJs(ws, `document.querySelectorAll("#chat-log .chat-msg").length`);
  console.log("消息数(期望3):", 消息数);
  const 时间 = await evalJs(ws, `document.querySelector("#chat-log .chat-msg .msg-time")?.textContent`);
  console.log("首条消息时间:", 时间);
  const 删除按钮 = await evalJs(ws, `document.querySelectorAll("#chat-log .chat-msg .msg-del").length`);
  console.log("删除按钮数(期望3):", 删除按钮);

  // 3. 搜索过滤
  await evalJs(ws, `const q=document.getElementById("chat-search"); q.value="灰度"`);
  await evalJs(ws, `document.getElementById("chat-search").dispatchEvent(new Event("input"))`);
  const 可见 = await evalJs(ws, `[...document.querySelectorAll("#chat-log .chat-msg")].filter(m=>m.style.display!=="none").length`);
  const 命中 = await evalJs(ws, `document.querySelectorAll("#chat-log .chat-msg.search-hit").length`);
  console.log("搜索'灰度'后可见消息数(期望1):", 可见, "命中高亮数(期望1):", 命中);
  // 清除搜索
  await evalJs(ws, `document.getElementById("chat-search-clear").click()`);
  const 清除后可见 = await evalJs(ws, `[...document.querySelectorAll("#chat-log .chat-msg")].filter(m=>m.style.display!=="none").length`);
  console.log("清除搜索后可见消息数(期望3):", 清除后可见);

  // 4. 删除一条消息
  await evalJs(ws, `document.querySelector("#chat-log .chat-msg .msg-del").click()`);
  const 删除后消息数 = await evalJs(ws, `document.querySelectorAll("#chat-log .chat-msg").length`);
  console.log("删除1条后消息数(期望2):", 删除后消息数);

  // 5. 检查控制台错误
  const errs = await evalJs(ws, `window.__errs ? window.__errs.length : "notracking"`);
  console.log("控制台错误跟踪:", errs);

  ws.close();
  process.exit(0);
})().catch((e) => { console.error("测试失败:", e); process.exit(1); });