# 示例

外部程序接入苦瓜工作室的两种参照实现。两者定位不同，不重复：

| 示例 | 语言 | 依赖 | 适合谁 |
|---|---|---|---|
| `external-module/run.mjs` | Node.js | **无**（不用仓库任何包，裸 WebSocket） | 想确认「协议本身能被任意语言复刻」，或要把协议移植到自己环境 |
| `../sdk/python/example.py` | Python | `websockets` | 想直接用现成 SDK 快速接入 |

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
