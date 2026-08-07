const WebSocket = require("ws");
const URL = "ws://127.0.0.1:9223/devtools/page/BC60A02482E6055A7E1912115097CA2B";
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
  // 先看 listAll 返回结构
  const 形状 = await evalJs(ws, `(async()=>JSON.stringify(await window.kugua.request("mkg","mkg.node.listAll",{options:{limit:100}})))()`);
  let obj;
  try { obj = JSON.parse(形状); } catch { console.log("形状解析失败:", 形状); ws.close(); process.exit(1); }
  const 列表 = Array.isArray(obj) ? obj : (obj.items || obj.list || obj.data || []);
  const 待删 = 列表.filter(i => String(i.name || i.title || "").includes("拖拽测试")).map(i => i.id);
  console.log("待删除id:", JSON.stringify(待删));
  for (const id2 of 待删) {
    const r = await evalJs(ws, `(async()=>JSON.stringify(await window.kugua.request("mkg","mkg.resource.delete",{id:${id2}})))()`);
    console.log("删除", id2, ":", r);
  }
  ws.close();
  process.exit(0);
})().catch((e) => { console.error("失败:", e); process.exit(1); });