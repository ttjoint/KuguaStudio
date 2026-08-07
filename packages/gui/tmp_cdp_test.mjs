import WebSocket from "ws";

const 端口 = 9222;
async function 获取页面目标() {
  const res = await fetch(`http://127.0.0.1:${端口}/json`);
  const list = await res.json();
  // 选择加载了 index.html 的页面
  const page = list.find((t) => t.type === "page" && /index\.html/.test(t.url)) || list.find((t) => t.type === "page");
  if (!page) throw new Error("未找到页面目标");
  return page;
}

let seq = 0;
function 发送(client, method, params = {}) {
  return new Promise((resolve, reject) => {
    const id = ++seq;
    const onMsg = (data) => {
      const msg = JSON.parse(data.toString());
      if (msg.id === id) {
        client.off("message", onMsg);
        if (msg.error) reject(new Error(JSON.stringify(msg.error)));
        else resolve(msg.result);
      }
    };
    client.on("message", onMsg);
    client.send(JSON.stringify({ id, method, params }));
  });
}

const page = await 获取页面目标();
const client = new WebSocket(page.webSocketDebuggerUrl);
await new Promise((r) => client.on("open", r));
await 发送(client, "Runtime.enable");

async function 求值(expression) {
  const r = await 发送(client, "Runtime.evaluate", { expression, returnByValue: true, awaitPromise: true });
  return r && r.result && r.result.value !== undefined ? r.result.value : undefined;
}

const 结果 = {};
// 1. 标题栏与窗口控制按钮
结果.窗口控制 = await 求值(`({
  有标题栏: !!document.getElementById("titlebar"),
  有最小化: !!document.getElementById("win-min"),
  有最大化: !!document.getElementById("win-max"),
  有关闭: !!document.getElementById("win-close"),
  有插件按钮: !!document.getElementById("btn-plugins"),
  有设置按钮: !!document.getElementById("btn-settings"),
  有主题按钮: !!document.getElementById("btn-theme"),
})`);

// 2. 知识库为主显示 + 聊天侧边栏
结果.布局 = await 求值(`({
  知识库存在: !!document.getElementById("explorer-area"),
  聊天侧边栏存在: !!document.getElementById("chat-sidebar"),
  聊天未折叠: !document.getElementById("chat-sidebar").classList.contains("chat-collapsed"),
})`);

// 3. 插件页切换
await 求值(`document.getElementById("btn-plugins").click()`);
await new Promise((r) => setTimeout(r, 300));
结果.插件页 = await 求值(`({
  打开: !document.getElementById("plugins-view").classList.contains("hidden"),
  模块列表容器: !!document.getElementById("plugins-module-list"),
  统计总数元素: !!document.getElementById("oc-stat-total"),
})`);
await 求值(`document.getElementById("plugins-close").click()`);

// 4. 设置页切换
await 求值(`document.getElementById("btn-settings").click()`);
await new Promise((r) => setTimeout(r, 200));
结果.设置页 = await 求值(`!document.getElementById("settings-view").classList.contains("hidden")`);
await 求值(`document.getElementById("settings-close").click()`);

// 5. 主题切换
const 主题前 = await 求值(`document.documentElement.dataset.theme`);
await 求值(`document.getElementById("btn-theme").click()`);
const 主题后 = await 求值(`document.documentElement.dataset.theme`);
结果.主题切换 = { 前: 主题前, 后: 主题后, 已切换: 主题前 !== 主题后 };

// 6. 聊天折叠
await 求值(`document.getElementById("chat-toggle").click()`);
await new Promise((r) => setTimeout(r, 250));
结果.聊天折叠 = await 求值(`({
  已折叠: document.getElementById("chat-sidebar").classList.contains("chat-collapsed"),
  面板隐藏: getComputedStyle(document.getElementById("chat-view")).display === "none",
})`);
await 求值(`document.getElementById("chat-toggle").click()`);

// 7. 知识库内容项可拖拽
结果.可拖拽 = await 求值(`(function(){
  const tile = document.querySelector(".ex-file-tile");
  return tile ? { 存在: true, 可拖拽: tile.draggable } : { 存在: false, 可拖拽: false };
})()`);

console.log(JSON.stringify(结果, null, 2));
client.close();
process.exit(0);