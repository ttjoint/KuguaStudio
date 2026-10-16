# 苦瓜插件模板（plugin-template）

一个可直接 `Use this template` 派生的苦瓜插件仓库模板，对应插件生态的「SDK 与模板」层。

## 快速开始

1. 在 GitHub 上点击 **Use this template** 派生本仓库，或把本目录复制到本地。
2. 修改 `kugua-plugin.json` 中的 `name` / `version` / `description` / `author`。
3. 在 `src/index.ts` 中编写插件：实现 `on_load` / `on_enable` / `on_disable` / `on_unload` 生命周期钩子，
   并在 `on_load` 中调用 `this.注册命令({ 匹配, 处理, 说明 })` 挂载聊天命令。
4. 本地构建：`npm install && npm run build`（产物为 `dist/index.js`，运行时动态导入即此文件）。
5. 安装到苦瓜工作室：把仓库地址填入插件市场，或直接 `git clone` 到 `plugins/<name>`。

## 插件元数据（kugua-plugin.json）

```json
{
  "name": "template",
  "version": "0.1.0",
  "description": "模板插件：演示生命周期、命令与 Context",
  "author": "your-name"
}
```

- `name`：插件唯一名（小写），市场与运行时都以它为准。
- `version`：语义化版本，`plugins.update` 前后对比用。
- `entry`：可选，入口文件相对路径，缺省 `dist/index.js`（回退 `index.js`）。

## 发布到市场

1. 把插件仓库推到 GitHub。
2. 向官方索引仓库提交 PR，在 `plugins.json` 追加一条：

```json
{
  "name": "template",
  "author": "your-name",
  "repo": "https://github.com/your-name/kugua-plugin-template",
  "version": "0.1.0",
  "description": "……"
}
```

3. 合并后，任意苦瓜工作室用户在「插件市场」即可一键安装/更新。

## SDK 契约

- `BasePlugin`：生命周期钩子 `on_load(ctx)` / `on_enable()` / `on_disable()` / `on_unload()`。
- `Context`：宿主注入能力 —— `日志`、`请求(目标, 动作, 参数)`、`广播(动作, 参数)`、`订阅(动作, 处理)`。
- `命令定义`：`{ 匹配: RegExp, 处理: (消息上下文, 匹配) => 回复 }`，返回字符串/消息段数组即回复当前会话。
- 消息上下文：`类型/群号/用户号/机器人号/文本/at们/回复/转发/请求`。

详见 `docs/开发细则.md`「插件生态」一节。

## 自带 UI 页（可选）

插件可在 `kugua-plugin.json` 声明 `ui`，WebUI 顶栏即出现一个独立标签页（iframe 加载）：

```json
{
  "ui": { "title": "模板页", "entry": "ui/index.html" }
}
```

- 页面由 WebUI 从 `/plugin-ui/<插件名>/` 提供（默认入口 `index.html`，可用 `ui.entry` 指定）。
- 页面中引入平台 SDK 即可调用能力：`<script src="/plugin-sdk.js"></script>`，随后
  `await window.kugua.request(目标, 动作, 参数)`；另提供 `broadcast` / `getFileUrl` / `readMediaFile` / `dialog` 等。
- 示例见本模板 `ui/index.html`（点击按钮调用 `monitor.stats`）。
- 仅支持 HTTP（不建立 WebSocket），与主界面 shim 隔离。
