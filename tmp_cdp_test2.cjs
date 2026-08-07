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
  // 1. 测试 writeTempFile IPC：写入一张 1x1 PNG
  const png = "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg==";
  const 临时路径 = await evalJs(ws, `window.kugua.writeTempFile({base64:"${png}", name:"拖拽测试.png"})`);
  console.log("writeTempFile 返回路径:", 临时路径);
  // 2. 用时间编码命名（无文件名）
  const 临时路径2 = await evalJs(ws, `window.kugua.writeTempFile({base64:"${png}", name:"20260807_123456.png"})`);
  console.log("writeTempFile(时间编码名) 返回路径:", 临时路径2);
  // 3. 导入到知识库
  const 导入结果 = await evalJs(ws, `JSON.stringify(await window.kugua.request("mkg","mkg.resource.importFile",{sourcePath:"${临时路径}", name:"拖拽测试.png"}))`);
  console.log("importFile 结果:", 导入结果);
  ws.close();
  process.exit(0);
})().catch((e) => { console.error("失败:", e); process.exit(1); });