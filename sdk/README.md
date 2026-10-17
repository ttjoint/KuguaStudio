# 外部模块接入 SDK

把你的**任意程序**（Python / Node / Go / C# / Rust…）接入苦瓜工作室，
成为平台的一个功能模块：声明能力后，它会出现在指令面板、可被 AI 路由、
可进 GUI，并与平台**双向通信**。

---

## 目录

| 文件 | 说明 |
|---|---|
| `README.md` | 本文件：接入方式总览与快速上手 |
| `python/nigane.py` | **Python SDK**（单文件，可整份复制到你自己的项目） |
| `python/example.py` | Python 完整示例（可直接运行） |
| `python/requirements.txt` | 依赖 |
| `../docs/接入协议.md` | **协议规范**（任何语言据此自行实现） |
| `../examples/external-module/run.mjs` | Node.js 裸协议示例（不依赖任何库） |

---

## 一、快速上手（Python，30 秒）

```bash
# 1. 确认平台已启动（托盘/控制台里能看到「苦音服务端已启动」）
pip install websockets

# 2. 运行示例
cd sdk/python
python example.py

# 3. 在平台对话里输入：打招呼
```

看到类似输出即成功：

```
[INFO] 握手成功，平台当前模块：Python示例模块、webui、mkg、...
[INFO] 已接入 ws://127.0.0.1:24601
[INFO] 被平台调用：打招呼（名字=世界，来自 kugua-main）
```

---

## 二、最小接入代码（10 行）

```python
import asyncio
from nigane import NiganeClient, 建能力

客户端 = NiganeClient(
    名称="我的工具",
    能力声明=[
        建能力("我的工具.回声", "我的工具", 中文指令=["回声"]),
    ],
)

# 声明「我的工具.回声」被调用时做什么
客户端.register("我的工具.回声", lambda p, m: {"文本": p.get("文本", "")})

asyncio.run(客户端.运行())
```

就这样。平台侧现在已能：
- 在**指令面板**看到「回声」
- 在对话里输入「回声 xxx」调用你
- 让 AI 自动路由到你的能力

---

## 三、四种交互方式

### 3.1 被平台调用（平台 → 你）

```python
def 处理(params, 消息):
    # params 是调用方传的参数；消息是完整信封（含 from、id 等）
    return {"结果": params.get("x", 0) * 2}

客户端.register("我的工具.翻倍", 处理)
```

- 返回值 → 自动封装成 `response` 发回
- 抛异常 → 自动回 `error(2000)`，`message` 是异常文本
- 支持 `async def` 处理器（内部会 await）

### 3.2 主动调用平台（你 → 平台）

```python
结果 = await 客户端.request("kugua-main", "capability.list", {})
```

`kugua-main` 是平台内置目标的固定名称。常用内置动作：

| action | 作用 |
|---|---|
| `capability.list` | 列出全部能力 |
| `capability.call` | 按能力名调用（转发到提供者模块） |
| `nigane.modules.names` | 模块名列表 |
| `nigane.modules.list` | 模块详情列表 |
| `mkg.note.create` | 新建知识库笔记 |
| `mkg.resource.saveBase64` | 保存文件到知识库 |

也可以把目标填成**另一个模块名**，让平台转发过去。

### 3.3 广播事件（不关心谁收）

```python
await 客户端.broadcast("我的工具.心跳", {"n": 1})
```

平台和其它模块都能收到（发送者自己除外）。

### 3.4 订阅平台事件

```python
客户端.on_event("system.shutdown", lambda p, m: 客户端.stop())
客户端.on_event("capability.changed", lambda p, m: print(p))
```

常用事件：

| action | 触发时机 |
|---|---|
| `system.shutdown` | **平台即将退出**（重要，见第五节） |
| `capability.changed` | 能力注册表变化 |
| `registry.changed` | 模块上下线 |
| `plugins.changed` | 插件目录变化 |

---

## 四、能力声明：让平台「认识」你

`能力声明` 决定你的模块如何被平台暴露：

```python
建能力(
    "我的工具.翻译",          # 名称：全局唯一，建议 模块.动作
    模块="我的工具",
    标题="翻译",              # 人类可读
    说明="中英互译",
    中文指令=["翻译", "译"],   # ← 出现在指令面板 / 可被 AI 命中
    参数={                     # JSON Schema
        "type": "object",
        "properties": {"文本": {"type": "string"}},
        "required": ["文本"],
    },
    暴露指令=True,            # 是否进指令面板
    暴露GUI=True,             # 是否进 GUI 能力列表
)
```

**关键**：填了 `中文指令` 的能力，用户就能在对话里直接说「翻译 你好」触发你。

---

## 五、生命周期：平台退出时会发生什么

平台区分两类模块，**退出行为完全不同**：

| 类型 | 平台退出/重启时 |
|---|---|
| 配置在 `kugua.config.json` 的 `modules[]`（平台托管） | 平台**负责关闭**：先 `SIGTERM`，2 秒未退强制 kill |
| **运行中接入的外部程序（你）** | 平台**只广播 `system.shutdown`**，不发信号、不强杀，**由你自行决定是否退出** |

所以你应当订阅它：

```python
客户端.on_event("system.shutdown", lambda p, m: 客户端.stop())
```

三种处理方式，任选：

```python
# A. 直接退出
客户端.on_event("system.shutdown", lambda p, m: 客户端.stop())

# B. 继续运行（下次平台起来自动重连）
客户端.on_event("system.shutdown", lambda p, m: print("平台重启中…"))

# C. 收尾后退出
def 收尾(p, m):
    保存未完成的数据()
    客户端.stop()
客户端.on_event("system.shutdown", 收尾)
```

### 断线与重连

- 平台正常退出 → 你收到 `system.shutdown` → 按上面处理
- 平台被**强杀**（任务管理器结束 / `kill -9` / 崩溃）→ **收不到任何通知**
  （这是操作系统限制，任何程序都无法拦截）
- SDK 的应对：断线后指数退避重连，**连续失败 `重连上限`（默认 5）次后自动结束**，
  相当于替你判定「平台已经不在了」

想改这个行为：`NiganeClient(..., 重连上限=20)` 或设为很大的值让它一直重试。

### 与单例无关

全局锁保证同一时刻只有一个平台在监听，所以你**不存在「连到错误的平台」**的问题。

---

## 六、用其它语言接入

不需要 Python SDK。任何语言只要能：

1. 开一个 WebSocket 连到 `ws://127.0.0.1:24601`
2. 收发 JSON 文本帧
3. 发送 `hello` 握手，处理 `hello_ack`
4. 维护「请求 id → 回调」映射（靠 `echo` 字段配对）
5. 维护「action → 处理器」映射
6. 订阅 `system.shutdown`

就完成了。完整信封格式、字段语义、错误码见
**[`docs/接入协议.md`](../docs/接入协议.md)**。

可对照 Node 裸实现（**不依赖任何库**，直接证明协议可被复刻）：
[`examples/external-module/run.mjs`](../examples/external-module/run.mjs)

---

## 七、常见问题

**Q：连不上，一直重连？**
- 确认平台已启动（主控日志有「苦音服务端已启动：ws://...」）
- 端口要对：默认 `24601`，若 `kugua.config.json` 里改过，用 `KUGUA_PORT` 指定
- 主控配置了 `token` 时必须传 `KUGUA_TOKEN`

**Q：握手失败 / 连接被立刻关闭？**
- 模块名重复会被「顶号」——同名旧连接被关闭，这是正常设计
- token 不匹配 → `error(1001)` 并断开

**Q：能力面板里看不到我的指令？**
- 确认 `能力声明` 里写了 `中文指令`，且 `暴露指令=True`
- 确认握手成功（日志里有「握手成功」）

**Q：我的进程会不会被平台杀掉？**
- 不会。平台对你**不发任何信号**，只广播 `system.shutdown`

**Q：平台重启后要手动重连吗？**
- 不用，SDK 会自动重连（指数退避），重连后自动重新注册
