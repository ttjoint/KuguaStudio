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
  // 生成一张 300x200 图片的 base64
  const b64 = await evalJs(ws, `(async()=>{const c=document.createElement("canvas");c.width=300;c.height=200;const x=c.getContext("2d");x.fillStyle="#4488ff";x.fillRect(0,0,300,200);x.fillStyle="#fff";x.font="40px sans-serif";x.fillText("做旧测试",40,110);return c.toDataURL("image/png").split(",")[1]})()`);
  console.log("b64 长度:", b64.length);
  // 调用 image.oldJpg（走渲染进程 request → main → nigane，验证 60s 超时）
  const t0 = Date.now();
  const 结果 = await evalJs(ws, `(async()=>JSON.stringify(await window.kugua.request("image","image.oldJpg",{base64:${JSON.stringify(b64)}})))()`);
  const 耗时 = Date.now() - t0;
  console.log("oldJpg 调用耗时(ms):", 耗时);
  console.log("oldJpg 结果(前120字符):", String(结果).slice(0, 120));
  ws.close();
  process.exit(0);
})().catch((e) => { console.error("失败:", e); process.exit(1); });