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

> SDK 的**公开 API 全部为英文**（`NiganeClient`、`register`、`on_event`、
> `request`、`broadcast`、`capability`），便于在任何项目里使用；
> 协议层的中文字段名（`托管`、`中文指令`…）由 SDK 内部处理，业务代码无需关心。

---

## 一、快速上手（Python，30 秒）

```bash
# 1. 确认平台已启动（托盘/控制台里能看到「苦音服务端已启动」）
pip install websockets

# 2. 运行示例
cd sdk/python
python example.py

# 3. 在平台对话里输入：pygreet
```

看到类似输出即成功：

```
[INFO] handshake ok, platform modules: PythonExampleModule、webui、mkg、...
[INFO] connected to ws://127.0.0.1:24601
[INFO] called: greet (name=world, from=kugua-main)
```

---

## 二、最小接入代码（10 行）

```python
import asyncio
from nigane import NiganeClient, capability

client = NiganeClient(
    name="my-tool",
    capabilities=[
        capability("my-tool.echo", "my-tool", commands=["echo", "回声"]),
    ],
)

# 声明「my-tool.echo」被调用时做什么
client.register("my-tool.echo", lambda p, m: {"text": p.get("text", "")})

asyncio.run(client.run())
```

就这样。平台侧现在已能：
- 在**指令面板**看到「回声」
- 在对话里输入「回声 xxx」调用你
- 让 AI 自动路由到你的能力

---

## 三、四种交互方式

### 3.1 被平台调用（平台 → 你）

```python
def handler(params, message):
    # params 是调用方传的参数；message 是完整信封（含 from、id 等）
    return {"result": params.get("x", 0) * 2}

client.register("my-tool.double", handler)
```

- 返回值 → 自动封装成 `response` 发回
- 抛异常 → 自动回 `error(2000)`，`message` 是异常文本
- 支持 `async def` 处理器（内部会 await）

### 3.2 主动调用平台（你 → 平台）

```python
result = await client.request("kugua-main", "capability.list", {})
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
await client.broadcast("my-tool.heartbeat", {"n": 1})
```

平台和其它模块都能收到（发送者自己除外）。

### 3.4 订阅平台事件

```python
client.on_event("system.shutdown", lambda p, m: client.stop())
client.on_event("capability.changed", lambda p, m: print(p))
```

常用事件：

| action | 触发时机 |
|---|---|
| `system.startup` | **平台已就绪**（含 `版本` / `协议`） |
| `system.shutdown` | **平台即将退出**（重要，见第五节） |
| `capability.changed` | 能力注册表变化 |
| `registry.changed` | 模块上下线 |
| `registry.conflict` | 你的托管配置与平台已有配置冲突（见 4.1） |
| `module.rejected` | 某模块接入被拒绝（原因/详情） |
| `module.held` | 某模块暂下线等待人工确认 |
| `plugins.changed` | 插件目录变化 |

### 3.5 查询平台状态

```python
info = await client.platform_info()
print(info)   # {'在线': True, '平台': '苦瓜工作室', '版本': '0.9.0', '协议': '0.2', ...}

names = await client.list_modules()
print(names)  # ['webui', 'ai', 'mkc', ...]
```

---

## 四、能力声明：让平台「认识」你

`capabilities` 决定你的模块如何被平台暴露：

```python
capability(
    "my-tool.translate",       # 名称：全局唯一，建议 模块.动作
    module="my-tool",
    title="翻译",               # 人类可读
    description="中英互译",
    commands=["翻译", "译"],    # ← 出现在指令面板 / 可被 AI 命中
    params={                    # JSON Schema
        "type": "object",
        "properties": {"text": {"type": "string"}},
        "required": ["text"],
    },
    expose_command=True,        # 是否进指令面板
    expose_gui=True,            # 是否进 GUI 能力列表
)
```

**关键**：填了 `commands` 的能力，用户就能在对话里直接说「翻译 你好」触发你。

### 4.1 托管启动：要不要随平台一起启动

默认你只是「临时接入」：平台启动时不会拉起你，需要你手动运行。

如果你希望**下次跟随工作室一起启动**，在构造时声明：

```python
import sys, os

client = NiganeClient(
    name="my-tool",
    managed=True,                                        # 申请托管
    managed_entry=sys.executable,                        # 物理路径：解释器
    managed_args=[os.path.abspath(__file__), "--hosted"],# 启动参数
    # managed_cwd=r"D:\my-tool",                         # 可选：工作目录
)
```

平台会把它记到 `kugua.config.json` 的 `modules[]`，下次启动时按此拉起。

**首次 vs 之后（重要）**

| 场景 | 行为 |
|---|---|
| 平台里**没有**同名模块 | 用你上报的信息**新建**配置项 |
| 平台里**已有**同名模块 | **保留已有配置不动**，你的上报值不生效 |

也就是说：**用户在工作室内「设置 → 模块管理」里改过的值，永远不会被你的程序覆盖**。
发生差异时双方都会留痕 —— 平台控制台打印差异明细，你这边收到
`registry.conflict` 广播：

```python
client.on_event("registry.conflict", lambda p, m: print("配置冲突：", p))
```

模块的唯一标识是**模块名**（不是文件路径），所以换目录、改启动方式都不会
被当成新模块；反过来，如果两个模块名指向同一份程序，平台会记警告并广播冲突。

管理界面的可编辑项：**是否随平台启动**、**物理路径**、**启动参数**、说明。
修改后需重启对应模块生效。

托管启动时平台会注入环境变量供你取连接信息：

| 变量 | 说明 |
|---|---|
| `KUGUA_URL` | 主控 WebSocket 地址 |
| `KUGUA_PORT` | 主控端口 |
| `KUGUA_TOKEN` | 令牌 |
| `KUGUA_HOSTED` | 固定 `1`，表示「由平台拉起」 |

（Python SDK 默认就从这个端口/令牌读取，托管启动无需额外配置。）

### 4.2 版本与身份：让平台认得「还是你」

SDK 会在握手中自动上报身份三要素：

| 字段 | 来源 | 作用 |
|---|---|---|
| `name` | `NiganeClient(name=...)` | 身份主键 |
| `version` | `NiganeClient(version=...)` | 判定升级 / 回退 |
| `path` | 自动取 `sys.argv[0]` 的绝对路径（可 `path=` 覆盖） | 判定「原位」 |

平台根据这三者决定你的接入如何处理：

| 你的情况 | 平台反应 |
|---|---|
| 首次接入 | 直接上线 |
| 版本变高（路径不变） | **自动更新**（内置模块强制开；外部模块可在管理页关闭） |
| 版本变高但关了自动更新 | 上线并提示「有新版本」，管理页出现绿色「更新」按钮 |
| 版本相同但能力声明变了 | **暂下线**、标红、报错；需人手动点「替换」 |
| 版本变低（回退） | 同上，需手动点「替换」 |
| 路径变了（同名但不同位置） | **拒绝接入**；必须先移除旧注册 |

**所以升级时只需改 `version=`**：路径不变的情况下，改版本号重启就能自动生效。
迁移目录时要先在管理页移除旧模块。

SDK 已默认实现平台必需的 `module.query`（状态查询），无需业务代码关心。
平台首次让你上线后会探测一次并存下结果；以后「刷新」按钮与重连校验都靠它。

---

### 4.3 Configuration UI: let the platform build your settings page

You do **not** need to write any frontend code to get a settings page.
Declare your fields during the handshake and the platform renders the form for you.

```python
CONFIG_SCHEMA = {
    "说明": "My tool settings",
    "字段": [
        {"键": "host", "标题": "Service URL", "类型": "string",
         "提示": "http://127.0.0.1:9000"},
        {"键": "enabled", "标题": "Enabled", "类型": "boolean", "默认值": True},
        {"键": "mode", "标题": "Mode", "类型": "select",
         "选项": ["fast", {"值": "quality", "标题": "High quality"}]},
        {"键": "token", "标题": "API key", "类型": "secret", "凭据": True},
    ],
}
```

Send it as `配置声明` in your `hello` params.

**Field types**: `string` / `text` / `number` / `boolean` / `select` / `path` / `secret` / `array`.

- Keys support dot notation for nesting: `engines.voxcpm.url` maps to
  `{ "engines": { "voxcpm": { "url": ... } } }`
- `number` accepts `最小` / `最大` / `步进` (min / max / step)
- `select` options may be plain strings or `{ 值, 标题 }` (value / label)
- `array` needs `数组: { 元素: "string" }` or `{ 元素: "object", 列: [...] }`
- **`凭据: true`** marks a field as a secret: the value is stored in
  `kugua.config.local.json` (gitignored) and **never returned in plaintext**
- `生效` (optional) — `立即` (default) / `重启模块` / `重启平台`; UI hint only

**Receiving updates.** The platform pushes a `module.config` event:

```json
{
  "模块": "my-tool",
  "配置": { "host": "http://127.0.0.1:9000", "enabled": true },
  "来源": "用户",
  "变更": ["host"]
}
```

`来源` (source) is one of `初始化` / `用户` / `模块` (init / user / module).
`配置` is the **fully merged configuration**, so you never deal with the
two-layer config files yourself. You receive an init push on every connect,
so you don't need to read the config file at startup.

**Reporting changes back.** If your module discovers new settings on its own:

```json
{ "type": "request", "action": "nigane.moduleConfig.report",
  "params": { "变更": { "models": ["a", "b"] } } }
```

The platform persists it and broadcasts the result to every module.
You may include a `声明` field to update your own schema at the same time.

**Platform actions:**

| Action | Purpose |
|---|---|
| `nigane.moduleConfig.declarations` | All modules' config schemas |
| `nigane.moduleConfig.get` | `{name}` → form model (secrets redacted) |
| `nigane.moduleConfig.set` | `{name, 变更}` → persist and push |
| `nigane.moduleConfig.report` | `{变更, 声明?}` → module-initiated update |

### 4.4 Custom UI page (when a declarative form is not enough)

If your settings need interactions a form cannot express, ship an HTML page:

```python
client = NiganeClient(
    name="my-tool",
    url="ws://127.0.0.1:24601",
    ui={"title": "My Tool", "entry": "ui/index.html"},  # key: 界面 in Python SDK
)
```

- `entry` is relative to the **module's entry file directory**. If your entry is
  `packages/modules/tts/dist/index.js`, then `ui/index.html` resolves to
  `packages/modules/tts/dist/ui/index.html`.
- The page is served at `GET /module-ui/<module-name>/<path>`.
- Inside the page, include `/plugin-sdk.js` to get `window.kugua`:

```html
<script src="/plugin-sdk.js"></script>
<script>
  const r = await window.kugua.request("my-tool", "my.action", {});
</script>
```

**Which to use:**

| Need | Declarative form (4.3) | Custom page (this section) |
|---|---|---|
| Toggles, URLs, paths, dropdowns | ✅ | overkill |
| Editable lists (voices, models) | ✅ | fine |
| Playback preview, progress bars | ❌ | ✅ |
| Complex table editing | ❌ | ✅ |

Both can coexist. The `tts` module uses the form for engine settings and a
custom page for voice audition and quick synthesis.

---

---

### 4.5 Live widgets (numbers, gauges, sparklines on the main screen)

A form is for settings. A widget is for **live data** the user wants to see
at a glance: CPU load, queue depth, today's token spend.

Declare them in your plugin manifest under `widgets`:

```json
{
  "name": "sysmon",
  "version": "0.1.0",
  "entry": "index.js",
  "widgets": [
    { "id": "cpu", "type": "gauge", "title": "CPU",
      "unit": "%", "max": 100, "prominence": "primary",
      "warn": 70, "danger": 90, "stale": 15 },
    { "id": "net.down", "type": "sparkline", "title": "Download",
      "unit": " MB/s", "decimals": 2, "points": 60, "prominence": "normal" }
  ]
}
```

Then push values from your own sampling loop:

```js
ctx.broadcast("widget.data", { id: "cpu", value: 42.5 });
```

Three types only: `number`, `gauge`, `sparkline`.

#### What you declare, and what you do not

| You decide | The platform decides |
|---|---|
| What is shown inside the block | Where it goes (top / side / status bar) |
| How often to sample | What shape it takes (card / bar / slim) |
| How important it is (`prominence`) | Size, how many per row, narrow-screen stacking |
| Which blocks belong together (`group`) | Drag-and-drop and persistence |

`prominence` is `primary` / `normal` / `secondary`, default `normal`.
It expresses relative importance, **not position** — your plugin may run
against a completely different frontend that has no idea what "top" means.
At most 2 `primary` widgets per plugin; extras are downgraded with a warning.

#### Rules that protect the user

- **Push, do not let the platform poll.** The sampling interval, retries and
  backoff are your business.
- **Rate limit is 20 pushes/sec per plugin.** Excess is **dropped, not queued** —
  stale data has no value and a queue only makes the display lag further.
- **`stale` (default 30s, min 5)** — after this long without a push the widget
  greys out and shows "no data". This is not optional decoration: if your plugin
  dies and the last frame keeps showing, the user believes it is live.
- **Declare nothing the platform cannot actually produce.** If you can read
  network counters on Linux but not on Windows, do not declare the widget on
  Windows. Showing a fake `0 MB/s` is worse than showing nothing.

Widgets are unregistered automatically when the plugin is uninstalled.

---

## 五、生命周期：平台退出时会发生什么

平台区分两类模块，**退出行为完全不同**：

| 类型 | 平台退出/重启时 |
|---|---|
| 配置在 `kugua.config.json` 的 `modules[]`（平台托管） | 平台**负责关闭**：先 `SIGTERM`，2 秒未退强制 kill |
| **运行中接入的外部程序（你）** | 平台**只广播 `system.shutdown`**，不发信号、不强杀，**由你自行决定是否退出** |

所以你应当订阅它：

```python
client.on_event("system.shutdown", lambda p, m: client.stop())
```

三种处理方式，任选：

```python
# A. 直接退出
client.on_event("system.shutdown", lambda p, m: client.stop())

# B. 继续运行（下次平台起来自动重连）
client.on_event("system.shutdown", lambda p, m: print("平台重启中…"))

# C. 收尾后退出
def cleanup(p, m):
    save_pending_work()
    client.stop()
client.on_event("system.shutdown", cleanup)
```

### 断线与重连

- 平台正常退出 → 你收到 `system.shutdown` → 按上面处理
- 平台被**强杀**（任务管理器结束 / `kill -9` / 崩溃）→ **收不到任何通知**
  （这是操作系统限制，任何程序都无法拦截）
- SDK 的应对：断线后指数退避重连，**连续失败 `max_retries`（默认 5）次后自动结束**，
  相当于替你判定「平台已经不在了」

想改这个行为：`NiganeClient(..., max_retries=20)` 或设为很大的值让它一直重试。

### 与单例无关

全局锁保证同一时刻只有一个平台在监听，所以你**不存在「连到错误的平台」**的问题。

---

## 六、用其它语言接入

不需要 Python SDK。任何语言只要能：

1. 建立 **WebSocket** 连接（`ws://127.0.0.1:24601`）
2. 收发 **JSON**
3. 发 `hello` 握手、回 `request`

就能接入。完整字段、错误码、握手时序见 [`../docs/接入协议.md`](../docs/接入协议.md)；
Node.js 的最小实现见 [`../examples/external-module/run.mjs`](../examples/external-module/run.mjs)。

---

## 七、常见问题

**Q：平台没启动，我的程序一直重连怎么办？**
正常。SDK 会在连续失败 `max_retries` 次后退出。想让它在平台启动后自动回来，
把 `max_retries` 调大，或自己写外层循环。

**Q：端口不是默认的 24601？**
设环境变量 `KUGUA_PORT` / `KUGUA_TOKEN`，或直接传 `port=` / `token=`。

**Q：控制台中文乱码？**
Windows 控制台编码问题，设 `PYTHONIOENCODING=utf-8` 即可。

**Q：我的能力没出现在指令面板？**
检查 `commands` 是否填了；`expose_command` 是否为 `True`；
再确认平台日志里有「模块上线：<你的模块名>」。

**Q：我不想被平台托管，只想临时注册？**
不传 `managed`（默认 `False`）即可，平台不会写入任何配置。

**Q：我在管理界面改了配置，为什么程序启动后又被改回去了？**
不会发生 —— 已有配置永远不会被外部上报覆盖。如果看到的仍是旧值，
确认改的是同名模块，且保存后平台日志有「配置已更新」。

## 写插件常见失败与诊断

插件加载失败时，`plugins.list` 里会有一条 `状态: "error"` 的记录，`错误` 字段会给出
**指向原因的**说明。三类最常见的失败：

| 现象 | 原因 | 改法 |
|---|---|---|
| `默认导出不是 BasePlugin 子类` + 「模块没有具名导出」 | 用了 CommonJS `module.exports` | 插件必须是 **ESM**：`export default class X extends BasePlugin {}` |
| `默认导出不是 BasePlugin 子类` + 「没有 default 导出」 | 只写了 `class X extends BasePlugin {}` | 加 `export default` |
| `定义插件 缺少必填字段：description` | `定义插件(类, {...})` 少字段 | `name` / `version` / `description` / `author` 四个都要非空字符串 |
| `插件目录 … 里的入口文件 import 不到依赖` | 插件目录**不在仓库内**，解析不到 `@kugua/plugin-sdk` | 放到仓库内的 `plugins/` 下，或自己安装该依赖 |

**注意**：`定义插件` 的四个字段缺任何一个都会直接抛错并点名缺哪个。
早期版本只校验 `name` / `version`（缺了抛 `reading 'trim'`，完全指不到字段），
`description` / `author` 缺了**静默写 undefined** —— 现在统一拦住了。
