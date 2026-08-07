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
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
(async () => {
  const ws = await connect();
  await send(ws, "Runtime.enable");
  // 清空附件与日志
  await evalJs(ws, `当前附件.length=0;刷新附件区()`);
  await evalJs(ws, `document.getElementById("chat-log").innerHTML=""`);
  const b64res = await evalJs(ws, `(async()=>{const c=document.createElement("canvas");c.width=200;c.height=150;const x=c.getContext("2d");x.fillStyle="#ff8800";x.fillRect(0,0,200,150);x.fillStyle="#000";x.font="30px sans-serif";x.fillText("照片",60,80);return c.toDataURL("image/png").split(",")[1]})()`);
  await evalJs(ws, `当前附件.push({base64:${JSON.stringify(b64res)}, name:"照片.png", type:"image/png"});刷新附件区()`);
  const 附件数 = await evalJs(ws, `当前附件.length`);
  const 附件UI = await evalJs(ws, `document.querySelectorAll("#chat-attachments .chat-attach").length`);
  console.log("附件推入:", 附件数, "附件UI块数:", 附件UI);
  // 输入指令并发送
  await evalJs(ws, `输入框.value="做旧";发送当前输入()`);
  await sleep(4000);
  const 图片渲染 = await evalJs(ws, `document.querySelectorAll("#chat-log .msg-image").length`);
  const 最后消息 = await evalJs(ws, `[...document.querySelectorAll("#chat-log .chat-msg")].map(m=>m.textContent).join(" | ")`);
  console.log("渲染图片数(期望1):", 图片渲染);
  console.log("聊天消息:", 最后消息);
  ws.close();
  process.exit(0);
})().catch((e) => { console.error("失败:", e); process.exit(1); });