# KuguaStudio · 苦瓜工作室

本地个人自动化工作台：以**可插拔模块**承载功能，通过**统一信息总线**协同，提供**中文指令 + GUI**
双入口，并内置**本地知识库（MKG）**管理文件、图片、多媒体与学术资料。

> 本项目是原 .NET「Kugua」项目的重写与再定位。当前方向是"纯本地的自动化工作台"，
> **不是** AI 应用平台；AI 只是可选外部能力。

## 两种入口

平台有两种 GUI 形态，**后台服务完全相同**，区别只在于界面显示在哪：

| 形态 | 怎么进 | 特点 |
| --- | --- | --- |
| **桌面壳**（默认） | 双击 `start.bat`，或直接跑 `kugua-desktop.exe` | 自带窗口，不依赖浏览器；启动时先出一个发光球闪屏，后端就绪后淡入主界面 |
| **浏览器** | `npm start`，或设 `KUGUA_GUI=browser` | 用默认浏览器打开 `http://127.0.0.1:24600` |

用哪种由 `kugua.config.json` 的 `webui.gui` 决定（`desktop` / `browser`），
不填时：桌面壳已构建就用桌面壳，否则退回浏览器。

**关窗口 ≠ 退平台。** 点 ✕ 只是关掉当前 GUI，后台继续驻留（模块、定时任务、
知识库都不受影响），下次打开会接回同一个实例。真要退出只有两条路：设置页的
红色「退出平台」按钮，或托盘图标右键「退出」。

## 设计文档（权威）

| 文档 | 内容 |
| --- | --- |
| [docs/架构设计.md](docs/架构设计.md) | 定位、原则、分层、能力注册表、长任务、安全、路线 |
| [docs/接入协议.md](docs/接入协议.md) | 苦音协议细节、外部程序接入、托管注册、身份门禁 |
| [docs/知识库设计.md](docs/知识库设计.md) | MKG 数据模型、侧车标签、FTS5 检索、保存视图、位置 |
| [docs/互操作设计.md](docs/互操作设计.md) | MCP server/client、跨语言模块契约 |
| [docs/功能复刻准则.md](docs/功能复刻准则.md) | 从 .NET 原项目迁移功能模块的取舍与忠实度要求 |
| [docs/开发细则.md](docs/开发细则.md) | 技术选型、苦音协议、目录、编码规范、测试 |
| [docs/常驻与调度.md](docs/常驻与调度.md) | 常驻服务 / 登录自启 / 启动任务 / 日志 |
| [docs/语音合成设计.md](docs/语音合成设计.md) | TTS 引擎无关抽象、本地引擎选型 |
| [docs/杀软误报.md](docs/杀软误报.md) | 哪些写法会触发误报，为什么这么写 |
| [docs/改造清单.md](docs/改造清单.md) | 分阶段施工清单、明确不做的范围 |
| [docs/历史/](docs/历史/) | 历史存档（不指导当前开发） |

## 核心概念

- **能力注册表（Capability Registry）**：一个功能声明一次，自动派生
  **中文指令 / GUI / 定时任务 / 开机任务 / 外部接口（MCP）** 五种入口。
- **苦音协议（Nigane）**：主控为唯一 WebSocket 服务端，模块为独立进程客户端，星型拓扑，请求/响应/广播。
- **苦瓜知识图谱（MKG）**：SQLite 索引 + 标签图 + FTS5 全文；标签以**侧车文件**（`<文件>.mkg.json`）
  持久化，可随文件迁移；文件系统始终为真源。
- **长任务（Job）**：脚本 / 爬虫 / 安全测试等以 `job.*` 动作运行，流式日志、超时、取消、历史；WebUI「作业」面板可视化管理。
- **常驻与自启**：登录计划任务或 WinSW 服务；`scripts/service/` 提供安装脚本与模板；支持 `启动任务`（平台启动时执行一次）。
- **互操作（MCP）**：WebUI 提供 `POST /mcp`（Streamable HTTP）与独立 stdio 入口，把平台能力暴露给任意 MCP 客户端；
  `@kugua/module-mcp-client` 可把外部 MCP server 与 `scripts/modules` 下的本地脚本模块导入为平台能力。

## 目录结构

```
KuguaStudio/
├── start.bat                   # 双击入口（纯 ASCII + CRLF，勿改）
├── docs/                       # 设计文档（见上表）
│   └── 历史/                    # 历史存档，不指导当前开发
├── kugua.config.json           # 主控配置 + 模块注册表（由 sync-modules 生成）
├── data/                       # 运行时数据（DB / 日志 / 作业 / 受管资料，不入库）
├── packages/
│   ├── desktop/                # Tauri 桌面壳（Rust）
│   │   ├── splash.html         # 启动闪屏页（编进二进制）
│   │   └── src-tauri/          # Rust 源码、capabilities、permissions
│   ├── nigane/                 # 苦音协议 SDK
│   ├── capability/             # 能力注册表 @kugua/capability
│   ├── module-kit/             # 模块启动套件 @kugua/module-kit
│   ├── paths/                  # 路径与单实例锁工具 @kugua/paths
│   ├── logger/                 # 日志环形缓冲 @kugua/logger
│   ├── audit/                  # 审计日志 @kugua/audit
│   ├── random/                 # 统一随机源（CSPRNG）@kugua/random
│   ├── mcp/                    # MCP server/client @kugua/mcp
│   ├── onebot11/               # OneBot 11 协议库（可选桥接）
│   ├── plugin-sdk/             # 插件契约 SDK
│   ├── dscript/                # 模板文本引擎
│   ├── main/                   # 主控守护进程
│   ├── mkg/                    # 知识图谱核心库
│   ├── webui/                  # 本地 Web UI（浏览器，@kugua/webui）
│   └── modules/                # 功能模块（独立进程）
├── sdk/
│   ├── README.md               # 外部模块接入指南
│   └── python/                 # Python SDK + 示例
├── examples/
│   └── external-module/        # 裸协议示例（不依赖仓库任何包）
├── scripts/
│   ├── sync-modules.mjs        # 扫描 workspace 同步 kugua.config.json 与启动脚本
│   ├── service/                # 常驻服务 / 登录自启脚本与模板
│   └── modules/                # 本地脚本模块（示例 demo-echo）
├── templates/                  # 模块/插件模板
├── plugins/                    # 运行时插件目录（不入库）
├── tools/                      # 便携工具（ImageMagick 等，不入库）
└── 参考/                       # 前身 .NET 项目（资料，不参与构建，不入库）
```

## 快速开始

```bash
npm install          # 安装依赖（npm workspaces）
npm run build        # 按依赖拓扑序构建全部包
npm start            # 启动 WebUI：托管主控并打开浏览器
```

- 直接启动主控：`npm run main`（按 `kugua.config.json` 自动拉起 `autoStart` 模块）。
- 单独启动某模块：`npm run echo` / `npm run mkg` / `npm run calendar` 等。
- WebUI 默认监听 `http://127.0.0.1:24600`（`KUGUA_WEBUI_PORT` 或 `kugua.config.json` 的 `webui.port` 可改）。
- Windows 双击 `start.bat` —— 首选入口，自动选桌面壳或浏览器；首次运行会自动构建。

构建桌面壳（可选，仅想要原生窗口时）：

```bash
node packages/desktop/scripts/build.mjs     # 或：cargo build --release --manifest-path packages/desktop/src-tauri/Cargo.toml
```

首次编译 Rust 依赖约 2～5 分钟；之后增量编译秒级。

**单实例保护**：`%LOCALAPPDATA%\KuguaStudio\studio.lock`（与 cwd / 端口 / 配置无关）。
已有实例在跑时，重复启动会自动退出并唤起已有窗口，**不会结束既有实例**。

## 配置

主控与模块注册见 `kugua.config.json`：`host` / `port` / `token` 为监听与认证；
`modules[]` 为模块注册表（`process` 独立进程 / `library` 仅检测文件存在），`autoStart` 控制自动启动。

## 里程碑

采用阶段制（详见《改造清单.md》）：

0. 清理与规范化、设计文档、能力/MCP 包骨架、MKG 模型升级、**WebUI 落地** —— **已完成**
1. 能力注册表接入主控与各入口 —— **已完成**
2. 知识库升级（FTS5 / 侧车 / 保存视图 / 位置） —— **已完成**
3. MCP server/client + 跨语言脚本模块 —— **已完成**
4. Job 长任务运行时 —— **已完成**
5. 常驻与调度（服务化 / 开机任务） —— **已完成**
6. 功能模块按新约定重写 —— **进行中**（清单已批准；`calendar` 样板完成）
7. 外部程序动态接入（苦音协议 + 托管注册 + 身份门禁） —— **已完成**
8. Tauri 桌面壳（单例 / GUI 模式 / 断线提示 / 启动闪屏） —— **已完成**
9. 语音合成引擎无关抽象 —— **已完成**（本地引擎接入待做）

## 外部程序接入

任何语言的程序都可以作为「外部模块」接入平台，不需要编译进本仓库：

- 协议：`docs/接入协议.md`；指南：`sdk/README.md`
- Python SDK：`sdk/python/`；无依赖示例：`examples/external-module/`
- 开放面就是主控的 WebSocket 端口（默认 `24601`）

两种生命周期：**托管模块**由平台负责启动与关闭；**运行中接入**的外部程序
平台只广播 `system.shutdown`，不主动 kill。

## 说明

- 注释使用中文，标识符使用英文；新增能力名用 `模块.动作` 英文命名。
- 变更请同步更新《更新日志.md》，遵循语义化版本。
- 模块间禁止直连，一律经主控路由。
- **`sdk/` 公开 API 必须纯英文**（协议里的中文字段名只在 SDK 内部转换）。
- **凭据不落仓库**：密码/token 放 `kugua.config.local.json`（已 `.gitignore`）。
- **不要按进程名批量杀浏览器**，参见 `.pi/AGENTS` 或项目开发细则。
