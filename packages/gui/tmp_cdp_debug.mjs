import WebSocket from "ws";
const 端口 = 9222;
const res = await fetch(`http://127.0.0.1:${端口}/json`);
const list = await res.json();
console.log("目标列表:", list.map((t) => ({ type: t.type, url: t.url })));
const page = list.find((t) => t.type === "page" && /index\.html/.test(t.url)) || list.find((t) => t.type === "page");
console.log("选中:", page && page.url);
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
const r = await 发送(client, "Runtime.evaluate", { expression: "document.title + '|' + location.href", returnByValue: true });
console.log("求值原始:", JSON.stringify(r));
const r2 = await 发送(client, "Runtime.evaluate", { expression: "document.getElementById('titlebar') ? 'TITLEBAR_OK' : 'NO_TITLEBAR'", returnByValue: true });
console.log("标题栏:", JSON.stringify(r2));
client.close();
process.exit(0);