const WebSocket = require("ws");
const URL = "ws://127.0.0.1:9223/devtools/page/0139FC7E3AB3392528E862EA61890B5B";
let id = 0;
function connect() { return new Promise((res, rej) => { const ws = new WebSocket(URL); ws.on("open", () => res(ws)); ws.on("error", rej); }); }
function send(ws, method, params = {}) {
  return new Promise((resolve) => {
    const mid = ++id;
    const handler = (data) => { const m = JSON.parse(data.toString()); if (m.id === mid) { ws.off("message", handler); resolve(m); } };
    ws.on("message", handler);
    ws.send(JSON.stringify({ id: mid, method, params }));
  });
}
async function evalJs(ws, expr) {
  const r = await send(ws, "Runtime.evaluate", { expression: expr, returnByValue: true, awaitPromise: true });
  if (r.result?.exceptionDetails) return "EXC:" + JSON.stringify(r.result.exceptionDetails.exception?.description || r.result.exceptionDetails.text);
  return r.result?.result?.value;
}
(async () => {
  const ws = await connect();
  await send(ws, "Runtime.enable");
  const 路径 = await evalJs(ws, `(async()=>window.kugua.writeTempFile({base64:"iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg==", name:"拖拽测试.png"}))()`);
  console.log("临时路径:", 路径);
  const 路径JSON = JSON.stringify(路径);
  const 导入结果 = await evalJs(ws, `(async()=>JSON.stringify(await window.kugua.request("mkg","mkg.resource.importFile",{sourcePath:${路径JSON}, name:"拖拽测试.png"})))()`);
  console.log("importFile 结果:", 导入结果);
  const 列表 = await evalJs(ws, `(async()=>JSON.stringify((await window.kugua.request("mkg","mkg.node.listAll",{options:{limit:5}})).items.map(i=>i.name)))()`);
  console.log("知识库最近条目:", 列表);
  ws.close();
  process.exit(0);
})().catch((e) => { console.error("失败:", e); process.exit(1); });