/**
 * 苦瓜工作室 · 外部模块最小示例（裸协议实现）
 *
 * 本文件**刻意不依赖本仓库任何包**，只用 Node 内置能力 + 裸 WebSocket，
 * 用来证明「苦音协议可被任意第三方程序复刻」。
 * 协议说明见 docs/接入协议.md。
 *
 * 运行：
 *   node examples/external-module/run.mjs
 *
 * 环境变量：
 *   KUGUA_PORT      主控端口（默认 24601）
 *   KUGUA_TOKEN     主控令牌（主控配置了 token 时必填）
 */
import { randomUUID } from "node:crypto";

const 协议版本 = "0.2";
const 端口 = process.env.KUGUA_PORT || "24601";
const 令牌 = process.env.KUGUA_TOKEN || "";
const 地址 = `ws://127.0.0.1:${端口}`;
const 模块名 = "示例外部模块";

// ===== 信封工具 =====

function 信封(部分) {
  return {
    nigane: 协议版本,
    id: randomUUID(),
    time: Math.floor(Date.now() / 1000),
    ...部分,
  };
}

// ===== 客户端状态 =====

let ws = null;
/** 发出的请求 id → 等待中的 { resolve, reject, 定时器 } */
const 挂起 = new Map();
/** action → 处理器 */
const 请求表 = new Map();
/** action → 处理器（事件，无响应） */
const 事件表 = new Map();
let 已握手 = false;
/** 平台是否已通知退出 */
let 收到退出通知 = false;

// ===== 能力声明（决定平台如何暴露本模块） =====

const 能力声明 = [
  {
    名称: "示例外部模块.回声",
    模块: 模块名,
    动作: "示例外部模块.回声",
    标题: "回声",
    说明: "把输入原样返回，用于验证外部模块已接入",
    中文指令: ["回声"],
    参数: {
      type: "object",
      properties: { 文本: { type: "string", description: "要回显的文本" } },
    },
    暴露: { 指令: true, GUI: true },
  },
];

// ===== 发送 =====

function 发送(消息) {
  if (!ws || ws.readyState !== 1) throw new Error("尚未连接主控");
  ws.send(JSON.stringify(消息));
}

/** 调用平台能力（或转发给其它模块）：发 request，按 echo 等 response */
function 请求(目标, action, params, 超时毫秒 = 10000) {
  const 消息 = 信封({ type: "request", from: 模块名, to: 目标, action, params });
  return new Promise((resolve, reject) => {
    const 定时器 = setTimeout(() => {
      挂起.delete(消息.id);
      reject(new Error(`请求超时：${action}`));
    }, 超时毫秒);
    挂起.set(消息.id, { resolve, reject, 定时器 });
    发送(消息);
  });
}

/** 广播事件（发给除自己外的所有在线模块） */
function 广播(action, params) {
  发送(信封({ type: "event", from: 模块名, action, params }));
}

function 回复(原始, data) {
  发送(
    信封({
      type: "response",
      from: 模块名,
      to: 原始.from,
      echo: 原始.id,
      data,
    }),
  );
}

function 回复错误(原始, code, message) {
  发送(
    信封({
      type: "error",
      from: 模块名,
      to: 原始.from,
      echo: 原始.id,
      code,
      message,
    }),
  );
}

// ===== 注册本模块提供的动作 =====

请求表.set("示例外部模块.回声", async (params) => {
  return { 回声: String(params?.文本 ?? ""), 时间: new Date().toISOString() };
});

// 订阅平台广播
事件表.set("system.shutdown", (params) => {
  收到退出通知 = true;
  console.log("[示例] 收到 system.shutdown，平台正在退出。");
  // —— 关键：这里由外部程序自行决定是否退出 ——
  // 本示例选择退出；你也可以什么都不做，继续运行等下次平台起来后重连。
  setTimeout(() => 关闭并退出(0), 100);
});
事件表.set("capability.changed", (params) => {
  console.log(`[示例] 能力变更：模块 ${params?.模块}，现有 ${params?.数量} 项`);
});
事件表.set("registry.changed", () => {
  console.log("[示例] 模块注册表变化");
});

// ===== 收消息分发 =====

function 处理消息(原始文本) {
  let 消息;
  try {
    消息 = JSON.parse(原始文本);
  } catch {
    console.warn("[示例] 收到非 JSON 帧，忽略");
    return;
  }
  if (typeof 消息?.nigane !== "string") return;

  switch (消息.type) {
    case "hello_ack": {
      已握手 = true;
      console.log(`[示例] 握手成功，平台当前模块：${(消息.data?.modules ?? []).join("、")}`);
      break;
    }
    case "response":
    case "error": {
      const 项 = 消息.echo ? 挂起.get(消息.echo) : undefined;
      if (!项) break;
      挂起.delete(消息.echo);
      clearTimeout(项.定时器);
      if (消息.type === "error") 项.reject(new Error(`[${消息.code}] ${消息.message}`));
      else 项.resolve(消息.data);
      break;
    }
    case "request": {
      const 处理器 = 请求表.get(消息.action);
      if (!处理器) {
        回复错误(消息, 1003, `未实现的动作：${消息.action}`);
        break;
      }
      Promise.resolve()
        .then(() => 处理器(消息.params, 消息))
        .then((data) => 回复(消息, data))
        .catch((err) => 回复错误(消息, 2000, String(err?.message ?? err)));
      break;
    }
    case "event": {
      // 平台广播 system.shutdown 等
      事件表.get(消息.action)?.(消息.params, 消息);
      break;
    }
    case "ping": {
      发送(信封({ type: "pong", from: 模块名, echo: 消息.id }));
      break;
    }
    case "shutdown": {
      // 兼容个别版本的写法
     事件表.get("system.shutdown")?.(消息.params, 消息);
      break;
    }
    default:
      break;
  }
}

// ===== 连接 / 重连 =====

let 重连延迟 = 1000;
let 心跳定时器 = null;
/** 连续失败次数：用于判断「平台只是网络抖动」还是「平台已经不存在了」 */
let 连续失败 = 0;
/** 连续失败多少次后放弃（见 docs/接入协议.md 第六节） */
const 放弃阈值 = Number(process.env.KUGUA_RETRY_LIMIT || 5);

function 关闭并退出(码 = 0) {
  clearInterval(心跳定时器);
  try {
    ws?.close(1000, "示例退出");
  } catch {
    /* ignore */
  }
  process.exit(码);
}

function 连接() {
  ws = new WebSocket(地址);

  ws.addEventListener("open", () => {
    重连延迟 = 1000;
    连续失败 = 0;
    console.log(`[示例] 已连接 ${地址}，发送 hello…`);
    // 握手：name 必填；capabilityDefs 决定平台如何暴露本模块
    发送(
      信封({
        type: "hello",
        from: 模块名,
        params: {
          name: 模块名,
          version: "0.1.0",
          token: 令牌,
          capabilityDefs: 能力声明,
        },
      }),
    );

    心跳定时器 = setInterval(() => {
      try {
        发送(信封({ type: "ping", from: 模块名 }));
      } catch {
        /* 连接已断，close 事件会处理 */
      }
    }, 30000);
  });

  ws.addEventListener("message", (evt) => 处理消息(String(evt.data)));

  ws.addEventListener("close", (evt) => {
    clearInterval(心跳定时器);
    // 所有挂起请求失败，避免调用方永久等待
    for (const [, 项] of 挂起) {
      clearTimeout(项.定时器);
      项.reject(new Error("连接已断开"));
    }
    挂起.clear();
    已握手 = false;

    if (收到退出通知) {
      console.log("[示例] 收到 platform 退出通知，本进程退出。");
      process.exit(0);
    }

    连续失败 += 1;
    // —— 关键判断：平台被强杀（任务管理器结束 / kill -9 / 崩溃）时
    // 来不及广播 system.shutdown，外部程序只能看到「连接异常断开」。
    // 此时按你自己的策略决定：一直重连，还是连不上就退出。
    if (连续失败 >= 放弃阈值) {
      console.log(
        `[示例] 连续 ${连续失败} 次连不上平台，判定平台已退出，本进程退出。\n` +
          `        若不希望这样，调大 KUGUA_RETRY_LIMIT（当前 ${放弃阈值}）或去掉这个判断。`,
      );
      process.exit(0);
    }

    console.log(`[示例] 连接断开（code=${evt.code}，第 ${连续失败} 次），${重连延迟}ms 后重连…`);
    setTimeout(连接, 重连延迟);
    重连延迟 = Math.min(重连延迟 * 2, 30000);
  });

  ws.addEventListener("error", () => {
    // 具体原因由 close 事件体现，这里不重复打印
  });
}

// ===== 启动 =====

console.log("=== 苦瓜工作室 · 外部模块示例 ===");
console.log(`模块名：${模块名}`);
console.log(`目标：${地址}`);
console.log("接入后可在平台指令面板或对话输入「回声」验证。");
console.log("按 Ctrl+C 退出。\n");

连接();

// 演示：15 秒后主动调用一次平台能力（证明双向通信的另一半）
setTimeout(async () => {
  if (!已握手) return;
  try {
    const 结果 = await 请求("kugua-main", "nigane.modules.names", {});
    console.log(`[示例] 主动调用 nigane.modules.names 成功：${JSON.stringify(结果)}`);
  } catch (err) {
    console.log(`[示例] 主动调用失败（可能无权或无此动作）：${err.message}`);
  }
}, 15000);

process.on("SIGINT", () => 关闭并退出(0));
