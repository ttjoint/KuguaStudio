# KuguaStudio · 苦瓜工作室

本地知识库管理及模块化自动操作平台。

苦瓜工作室（KuguaStudio，KS）是一个运行在宿主后台的本地平台：以**苦音（Nigane）协议**连接一组独立进程的模块，以**苦瓜知识图谱（MKG）**管理本地知识库，并经过本地 GUI 提供统一浏览、检索与指令操作。本仓库的前身位于 `参考/Kugua`（一套仍在运行的 .Net 项目备份），大多数模块能力正逐步复刻迁移到本仓库。

## 架构

- **星型拓扑**：主控进程 `@kugua/main` 是唯一 WebSocket 服务端（默认 `ws://127.0.0.1:24601`），所有模块作为客户端接入，模块间通信一律经主控路由，禁止模块间直连。
- **进程模型**：每个模块是独立进程，崩溃不影响主控与其他模块。
- **苦音协议 Nigane**：request/response/echo 语义对齐 OneBot 11，便于 Napcat 适配。
- **苦瓜知识图谱 MKG**：基于 SQLite 的本地索引 + 标签树 + 检索，接管宿主文件系统中的指定路径。

## 技术栈

Node.js LTS + TypeScript（ESM/NodeNext）、npm workspaces 单仓库、`ws` WebSocket、better-sqlite3、Electron GUI、Vitest。部分模块（图片处理）底层使用 Python + Pillow。

## 目录结构

```
KuguaStudio/
├── docs/开发细则.md          # 技术选型、协议规范、里程碑
├── 开发计划.txt              # 原始需求计划
├── 更新日志.md               # 版本变更记录
├── kugua.config.json         # 主控配置 + 模块注册表
├── data/generators/          # 生成类模块数据文件（占卜/吃什么/解梦/文本等）
├── data/library/             # 本地知识库资源目录（运行时，不入库）
├── packages/
│   ├── nigane/               # 苦音协议 SDK（@kugua/nigane）
│   ├── onebot11/             # OneBot 11 协议库（Napcat 适配，@kugua/onebot11）
│   ├── dscript/              # DScript 模板文本引擎（@kugua/dscript）
│   ├── main/                 # 主控守护进程（@kugua/main）
│   ├── mkg/                  # 苦瓜知识图谱核心库（@kugua/mkg）
│   ├── gui/                  # Electron 本地 GUI（@kugua/gui）
│   └── modules/              # 功能模块（独立进程）
│       ├── echo            ── 示例回声
│       ├── mkg             ── MKG 服务：索引/标签/检索/统计
│       ├── divination      ── 周易蓍草占卜 + 每日运势
│       ├── food            ── 今天吃什么
│       ├── dream           ── 解梦
│       ├── scheduler       ── 定时任务调度（cron 触发模块请求/事件/命令）
│       ├── monitor         ── 系统监控（CPU/内存/磁盘）
│       ├── ai              ── AI 接入（OpenAI 兼容对话/图像生成）
│       ├── tts             ── 语音合成（sherpa-onnx/ChatTTS/SAPI）
│       ├── bank            ── 积分系统（签到/转账/充值/排行榜）
│       ├── image           ── 图片处理（Python+Pillow：编辑/网格/做旧/抠图/像素字/验证码/幻影坦克/拼接/GIF/抖动等）
│       ├── dice            ── 掷骰（r3d6）
│       ├── text            ── 文本功能综合（反转/大小写/乱序/攻受/讽刺/营销号/狗屁不通/火星文/随机汉字/历史上的今天）
│       ├── proof           ── 数字论证
│       ├── calendar        ── 万年历（公历/农历/回历/四柱/节气/生肖/星座/月相/芸历）
│       ├── translate       ── 翻译（Google 接口，单语 + 译N次接力）
│       ├── infotool        ── 信息工具（查IP/计算器/URL编解码/字节进制/体脂率）
│       └── napcat          ── Napcat QQ 桥接（需外部 napcat 服务，默认不自动启动）
├── tests/                    # Vitest 集成测试
└── scripts/                  # 一次性数据提取脚本
```

## 快速开始

```bash
npm install          # 安装依赖（npm workspaces）
npm run build        # 按依赖拓扑序构建全部包
npm test             # 运行 Vitest 集成测试
npm start            # 启动 GUI（首次会自动构建）
```

- 直接启动主控：`npm run main`（会按 `kugua.config.json` 自动拉起 autoStart 的模块）。
- 单独启动某模块：`npm run echo` / `npm run mkg` / `npm run calendar` 等。
- Windows 双击 `start.bat` 可直接以后台方式启动 GUI（隐藏黑框）。

## 配置

主控与模块注册见 `kugua.config.json`：

- `host` / `port` / `token`：主控监听地址与认证令牌。
- `modules[]`：模块注册表，`type` 分 `process`（独立进程）与 `library`（仅检测文件存在性）；`autoStart` 控制主控启动时是否自动拉起。

### AI 与语音配置（环境变量）

- `KUGUA_AI_BASE_URL`：OpenAI 兼容端点，如本地 Ollama `http://127.0.0.1:11434/v1`（默认官方端点）。
- `KUGUA_AI_API_KEY` / `KUGUA_AI_CHAT_MODEL` / `KUGUA_AI_IMAGE_MODEL`：认证与模型。
- `KUGUA_TTS_SHERP_ROOT`：sherpa-onnx 离线 TTS 根目录（默认 `D:\Downloads\sherpa-onnx-v1.12.14-win-x64-cuda`）。
- `KUGUA_TTS_URL`：ChatTTS 本地 UI 服务地址（配置后可作为 TTS 提供方）。

## 里程碑状态

| 里程碑 | 内容 | 状态 |
| --- | --- | --- |
| M1 | 苦音 SDK + 主控 + echo | ✅ |
| M3 | MKG 知识图谱（索引/标签/检索） | ✅ |
| M5 | 本地 GUI（统一内容浏览 + 聊天 + 插件/设置） | ✅ |
| 扩展 | 本地工具模块群（占卜/吃什么/解梦/图片/掷骰/文本/论证/万年历/翻译/信息工具） | ✅ |
| M2 | Napcat 接入（OneBot 11 解析） | ✅（桥接已就绪，默认不自动启动） |
| M4 | 定时任务调度 + 系统监控模块 | ✅ |
| M6 | AI 接入（LLM）与语音合成 | ✅ |
| P3 | 图片超分（Real-ESRGAN）+ 积分系统 | ✅ |

> 后续开发以**本地能力**为主，IM（Napcat/QQ）接入已具备桥接能力，暂不再前推。

## 说明

- 注释使用中文，标识符使用英文。
- 变更请同步更新《更新日志.md》，遵循语义化版本。
- 构建必须按拓扑序执行，根 `npm run build` 已显式排好顺序。
