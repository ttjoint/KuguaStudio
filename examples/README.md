# 示例

与苦瓜工作室交互的参照实现。前两个是**接入协议**，最后一个是**插件开发**：

| 示例 | 语言 | 依赖 | 适合谁 |
|---|---|---|---|
| `external-module/run.mjs` | Node.js | **无**（不用仓库任何包，裸 WebSocket） | 想确认「协议本身能被任意语言复刻」，或要把协议移植到自己环境 |
| `../sdk/python/example.py` | Python | `websockets` | 想直接用现成 SDK 快速接入 |
| `widget-demo/` | Node.js | `@kugua/plugin-sdk` | 想给主界面加实时展示块（CPU / 内存那种），见下一节 |

## 小组件示例

`widget-demo/` 演示插件如何向主界面注入实时数字——声明写在清单的 `widgets` 里，
运行时只负责推数据。

它和上面两个示例不是同类：那两个是**接入协议**的示例（怎么连上苦音总线），
这个是**插件开发**的示例（连上之后怎么往界面上放东西）。详见
`docs/小组件设计.md`。

用法：复制到 `plugins/sysmon` 后重启平台（`plugins/` 被 gitignore，
所以示例不直接放在那里）。

## 为什么要有一个「什么都不依赖」的版本

`external-module/run.mjs` 是刻意不用 SDK 的。它的价值在于：如果这个文件能跑通，
就证明苦音协议不依赖任何本仓库的实现细节——第三方程序用任何语言都能接进来。
它同时也是一份可执行的协议说明书，配合 `docs/接入协议.md` 阅读。

## 运行

```bash
# 无依赖版（需先启动平台）
node examples/external-module/run.mjs

# Python 版
cd ../../sdk/python && pip install websockets && python example.py
```

两者都认这几个环境变量：

- `KUGUA_PORT`：主控端口，默认 `24601`
- `KUGUA_TOKEN`：主控配了令牌时必填

平台启动方式见根目录 `README.md`。
