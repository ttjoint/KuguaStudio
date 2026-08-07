import WebSocket from "ws";
const 端口 = 9222;
const res = await fetch(`http://127.0.0.1:${端口}/json`);
const list = await res.json();
const page = list.find((t) => t.type === "page" && /index\.html/.test(t.url)) || list.find((t) => t.type === "page");
let seq = 0;
function 发送(client, method, params = {}) {
  return new Promise((resolve, reject) => {
    const id = ++seq;
    const onMsg = (data) => {
      const msg = JSON.parse(data.toString());
      if (msg.id === id) { client.off("message", onMsg); msg.error ? reject(new Error(JSON.stringify(msg.error))) : resolve(msg.result); }
    };
    client.on("message", onMsg);
    client.send(JSON.stringify({ id, method, params }));
  });
}
const client = new WebSocket(page.webSocketDebuggerUrl);
await new Promise((r) => client.on("open", r));
await 发送(client, "Runtime.enable");
async function 求值(expression) {
  const r = await 发送(client, "Runtime.evaluate", { expression, returnByValue: true, awaitPromise: true });
  return r && r.result && r.result.value !== undefined ? r.result.value : undefined;
}
console.log("window对象:", await 求值(`typeof window.kugua`));
console.log("window.kugua.window:", await 求值(`typeof (window.kugua && window.kugua.window)`));
console.log("window.kugua.dialog:", await 求值(`typeof (window.kugua && window.kugua.dialog)`));
console.log("data-theme:", await 求值(`document.documentElement.dataset.theme`));
console.log("勾选树容器:", await 求值(`!!document.getElementById('plugins-view')`));
client.close();
process.exit(0);