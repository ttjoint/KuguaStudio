/**
 * 苦瓜工作室 GUI 渲染器
 * 对话式 Agent 终端：用户输入 → 命令路由 → 模块调用 → 结果展示
 */

// ===== 类型定义 =====

export type 模块类型 = "process" | "library";

export interface 模块信息 {
  name: string;
  version?: string;
  capabilities?: string[];
}

export interface 模块详情 extends 模块信息 {
  type?: 模块类型;
  online?: boolean;
  pid?: number;
  fileExists?: boolean;
  autoStart?: boolean;
  description?: string;
  entry?: string;
  file?: string;
}

export interface 插件记录 {
  name: string;
  version: string;
  description?: string;
  author?: string;
  homepage?: string;
  状态: "loaded" | "enabled" | "disabled" | "error";
  命令: Array<{ 匹配: string; 说明?: string }>;
  错误?: string;
  加载时间?: number;
}

export interface 市场条目 {
  name: string;
  repo: string;
  author?: string;
  version?: string;
  description?: string;
  homepage?: string;
  installed?: boolean;
  localVersion?: string;
}

export interface 定时任务动作 {
  kind: "request" | "event" | "command";
  to?: string;
  action?: string;
  command?: string;
}

export interface 定时任务 {
  id: string;
  name: string;
  cron: string;
  enabled: boolean;
  action: 定时任务动作;
  createdAt: number;
  nextRunAt?: number | null;
  lastRunAt?: number | null;
  lastResult?: { ok: boolean; message: string; time: number } | null;
}

export interface 系统快照 {
  time: number;
  cpu: { usagePct: number; cores: number; model: string };
  memory: { total: number; free: number; used: number; usagePct: number };
  disk: Array<{ name: string; total: number; free: number; used: number; usagePct: number }>;
}

export interface 知识库统计 {
  资源总数: number;
  文件数: number;
  目录数: number;
  标签数: number;
  关联数: number;
  文本内容数: number;
  数据库大小: number;
}

export interface 资源 {
  id: number;
  path: string;
  name: string;
  size: number;
  kind: "file" | "directory";
  modifiedTime: number;
  snippet?: string;
}

export interface 资源详情 {
  id: number;
  path: string;
  name: string;
  size: number;
  kind: "file" | "directory";
  modifiedTime: number;
  alias: string | null;
  extension: string;
  mimeType: string;
  tagPaths: string[][];
}

export interface 标签节点 {
  id: number;
  name: string;
  parentId: number | null;
  description?: string;
  children: 标签节点[];
}

export interface 打开方式配置 {
  id: number;
  extension: string;
  programPath: string;
  arguments: string;
  label: string | null;
}

export interface 笔记 {
  id: number;
  title: string;
  content: string;
  createdAt: number;
  updatedAt: number;
  tagIds: number[];
}

export interface 素材 {
  id: number;
  title: string;
  content: string;
  kind: string;
  sourceUrl: string;
  imageUrl: string;
  createdAt: number;
  updatedAt: number;
  tagIds: number[];
}

export interface 看板列 {
  id: number;
  name: string;
  sort: number;
  createdAt: number;
}

export interface 卡片 {
  id: number;
  title: string;
  content: string;
  columnId: number | null;
  color: string | null;
  sort: number;
  createdAt: number;
  updatedAt: number;
  tagIds: number[];
}

declare global {
  interface Window {
    kugua: import("../bridge").苦瓜接口;
  }
}

