/**
 * AI 模块的配置声明。
 *
 * 声明一次，平台就自动生成设置界面——不需要写任何前端代码。
 * 字段键用点号表达嵌套，最终落到 `kugua.config.json` 的 `ai` 节：
 *
 *   { "ai": { "default": "...", "providers": [...], "openwebui": {...} } }
 *
 * 两类字段要区别对待：
 *  - `凭据: true` 的（apiKey / password / token）写进
 *    `kugua.config.local.json`，不进版本库，表单里也只显示「已设置」
 *  - 其余写进 `kugua.config.json`，可以随仓库走
 */

import type { 配置声明 } from "@kugua/nigane";

/**
 * 提供方列表的列声明。
 *
 * 用对象表格而非字符串数组——一个提供方有 5 个字段，
 * 让人在配置里手写 JSON 是最容易出错的地方，这正是要消灭的。
 */
const 提供方列 = [
  { 键: "name", 标题: "名称", 类型: "string" as const, 必填: true, 提示: "如 lmstudio / ollama" },
  { 键: "baseUrl", 标题: "地址", 类型: "string" as const, 必填: true, 提示: "http://127.0.0.1:1234/v1" },
  { 键: "apiKey", 标题: "密钥", 类型: "secret" as const, 凭据: true, 提示: "本地端点通常留空" },
  { 键: "chatModel", 标题: "对话模型", 类型: "string" as const, 提示: "留空则由提供方默认" },
  { 键: "imageModel", 标题: "图像模型", 类型: "string" as const },
  { 键: "embedModel", 标题: "向量模型", 类型: "string" as const },
];

export const AI配置声明: 配置声明 = {
  说明:
    "模型提供方与默认模型。改动后立即生效，无需重启模块——AI 模块每次调用都会重新读取配置。",
  字段: [
    {
      键: "default",
      标题: "默认提供方",
      类型: "string",
      提示: "留空则用列表第一项；也可写 OpenWebUI 里的模型名",
      说明: "普通对话默认走这里。想用某个具体模型时可直接填 `提供方.模型名`。",
    },
    {
      键: "providers",
      标题: "模型提供方",
      类型: "array",
      数组: { 元素: "object", 列: 提供方列 },
      说明:
        "任何 OpenAI 兼容端点都可以加进来（LM Studio、Ollama、vLLM、各类云服务）。" +
        "密钥自动存到本地文件，不会进版本库。",
    },
    {
      键: "openwebui.enabled",
      标题: "启用 OpenWebUI 网关",
      类型: "boolean",
      默认值: false,
      说明: "OpenWebUI 提供统一的模型目录，适合同时接多个上游时使用。",
    },
    {
      键: "openwebui.baseUrl",
      标题: "OpenWebUI 地址",
      类型: "string",
      提示: "http://127.0.0.1:8090",
      说明: "服务根地址，不要带 /api。",
    },
    {
      键: "openwebui.email",
      标题: "登录邮箱",
      类型: "string",
      说明: "用于自动获取访问令牌；若下面直接填了令牌则可留空。",
    },
    {
      键: "openwebui.password",
      标题: "登录密码",
      类型: "secret",
      凭据: true,
    },
    {
      键: "openwebui.token",
      标题: "访问令牌",
      类型: "secret",
      凭据: true,
      说明: "优先于账号密码登录。令牌过期时清空此项即可重新登录。",
    },
    {
      键: "openwebui.defaultModel",
      标题: "默认模型",
      类型: "string",
      提示: "硅基流动.Qwen/Qwen3-8B",
      说明: "形如「提供方.模型名」，与 OpenWebUI 里的显示一致。",
    },
    {
      键: "openwebui.embedModel",
      标题: "向量模型",
      类型: "string",
      说明: "知识库语义检索用，留空则不启用向量检索。",
    },
    {
      键: "openwebui.imageModel",
      标题: "图像模型",
      类型: "string",
    },
  ],
};
