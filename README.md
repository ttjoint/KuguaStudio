# KuguaStudio · 苦瓜工作室

本地个人自动化工作台：以**可插拔模块**承载功能，通过**统一信息总线**协同，提供**中文指令 + GUI**
双入口，并内置**本地知识库（MKG）**管理文件、图片、多媒体与学术资料。

> 本项目是原 .NET「Kugua」项目的重写与再定位。当前方向是"纯本地的自动化工作台"，
> **不是** AI 应用平台；AI 只是可选外部能力。
> 本轮已清理全部临时知识库内容与历史测试脚本；功能模块将按新约定逐步重写。

## 设计文档（权威）

| 文档 | 内容 |
| --- | --- |
| [docs/架构设计.md](docs/架构设计.md) | 定位、原则、分层、能力注册表、长任务、安全、路线 |
| [docs/知识库设计.md](docs/知识库设计.md) | MKG 数据模型、侧车标签、FTS5 检索、保存视图、位置 |
| [docs/互操作设计.md](docs/互操作设计.md) | MCP server/client、跨语言模块契约 |
| [docs/功能复刻准则.md](docs/功能复刻准则.md) | 从 .NET 原项目迁移功能模块的取舍与忠实度要求 |
| [docs/开发细则.md](docs/开发细则.md) | 技术选型、苦音协议、目录、编码规范、测试 |
| [docs/常驻与调度.md](docs/常驻与调度.md) | 常驻服务 / 登录自启 / 启动任务 / 日志 |
| [docs/改造清单.md](docs/改造清单.md) | 分阶段施工清单与进度 |

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
├── docs/                       # 设计文档（见上表）
├── kugua.config.json           # 主控配置 + 模块注册表
├── data/generators/            # 生成类数据文件（确定性工具用）
├── data/library/               # 受管资料目录（运行时，不入库）
├── packages/
│   ├── nigane/                 # 苦音协议 SDK
│   ├── capability/             # 能力注册表 @kugua/capability
│   ├── mcp/                    # MCP server/client @kugua/mcp
│   ├── onebot11/               # OneBot 11 协议库（可选桥接）
│   ├── plugin-sdk/             # 插件契约 SDK
│   ├── dscript/                # 模板文本引擎
│   ├── main/                   # 主控守护进程
│   ├── mkg/                    # 知识图谱核心库
│   ├── webui/                  # 本地 Web UI（浏览器，@kugua/webui）
│   └── modules/                # 功能模块（独立进程）
├── plugins/                    # 运行时插件目录
├── templates/                  # 模块/插件模板
└── 参考/                       # 前身 .NET 项目（资料，不参与构建）
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
- Windows 双击 `start.bat` 后台启动 WebUI 并自动打开浏览器。

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

## 说明

- 注释使用中文，标识符使用英文；新增能力名用 `模块.动作` 英文命名。
- 变更请同步更新《更新日志.md》，遵循语义化版本。
- 模块间禁止直连，一律经主控路由。
