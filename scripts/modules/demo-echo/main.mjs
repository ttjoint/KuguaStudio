/**
 * 示例脚本模块：最小 MCP（JSON Lines）服务。
 *
 * 宿主（@kugua/module-mcp-client）会以 `node main.mjs` 启动本进程，
 * 通过 stdin/stdout 逐行交换 JSON-RPC（MCP）消息。
 * 实现 initialize / tools/list / tools/call 三个方法即可。
 *
 * 任何语言都可以按此约定编写：读取一行 JSON-RPC 请求，写出一行 JSON-RPC 响应。
 */
let 缓冲 = "";

process.stdin.setEncoding("utf-8");
process.stdin.on("data", (块) => {
  缓冲 += 块;
  let 换行 = 缓冲.indexOf("\n");
  while (换行 >= 0) {
    const 行 = 缓冲.slice(0, 换行).trim();
    缓冲 = 缓冲.slice(换行 + 1);
    if (行) 处理(行);
    换行 = 缓冲.indexOf("\n");
  }
});

function 发送(消息) {
  process.stdout.write(JSON.stringify(消息) + "\n");
}

function 处理(行) {
  let 请求;
  try {
    请求 = JSON.parse(行);
  } catch {
    return;
  }
  const { id, method, params } = 请求;
  if (id === undefined) return; // 通知，无需响应

  if (method === "initialize") {
    return 发送({
      jsonrpc: "2.0",
      id,
      result: {
        protocolVersion: "2025-06-18",
        capabilities: { tools: {} },
        serverInfo: { name: "demo-echo", version: "0.1.0" },
      },
    });
  }
  if (method === "tools/list") {
    return 发送({
      jsonrpc: "2.0",
      id,
      result: {
        tools: [
          {
            name: "echo",
            description: "回显输入文本",
            inputSchema: {
              type: "object",
              properties: { text: { type: "string", description: "要回显的文本" } },
              required: ["text"],
            },
          },
        ],
      },
    });
  }
  if (method === "tools/call") {
    const 参数 = params?.arguments ?? {};
    return 发送({
      jsonrpc: "2.0",
      id,
      result: { content: [{ type: "text", text: String(参数.text ?? "") }] },
    });
  }
  发送({ jsonrpc: "2.0", id, error: { code: -32601, message: `不支持的方法：${method}` } });
}
