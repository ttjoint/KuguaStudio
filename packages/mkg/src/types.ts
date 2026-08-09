/**
 * MKG 数据类型定义
 */

export interface 资源 {
  id: number;
  /** 绝对路径 */
  path: string;
  /** 文件名或目录名 */
  name: string;
  /** 字节大小，目录为 0 */
  size: number;
  /** 秒级 Unix 修改时间 */
  modifiedTime: number;
  /** sha256 十六进制摘要 */
  sha256: string;
  /** 资源类型 */
  kind: "file" | "directory";
  /** 索引时间 */
  indexedAt: number;
}

export interface 标签 {
  id: number;
  /** 标签名，唯一 */
  name: string;
  /** 父标签 id，顶层标签为空 */
  parentId: number | null;
  /** 描述 */
  description: string | null;
}

export type 资源关系类型 = "contains" | "references" | "similar";

export interface 资源关系 {
  fromResourceId: number;
  toResourceId: number;
  relationType: 资源关系类型;
}

export interface 索引选项 {
  /** 最大递归深度，默认不限制 */
  maxDepth?: number;
  /** 跳过的路径 glob 或正则字符串数组 */
  exclude?: string[];
  /** 是否索引文本文件内容 */
  indexTextContent?: boolean;
  /** 最大索引文本大小（字节），默认 10MB */
  maxTextSize?: number;
}

export interface 搜索选项 {
  /** 返回结果数量上限，默认 50 */
  limit?: number;
  /** 结果偏移，默认 0 */
  offset?: number;
}

export interface 搜索结果<T> {
  total: number;
  items: T[];
}

export interface 资源详情 extends 资源 {
  alias: string | null;
  extension: string;
  mimeType: string;
  tagPaths: string[][];
}

export interface 打开方式配置 {
  id: number;
  extension: string;
  programPath: string;
  arguments: string;
  label: string | null;
}

// ===== 统一内容节点（P0） =====

export type 节点类型 = "file" | "directory" | "note" | "material" | "card" | "snippet";

/** 统一内容节点：文件/目录/笔记/素材/文本段/看板卡片共用此实体 */
export interface 节点 {
  id: number;
  type: 节点类型;
  /** 统一展示标题 */
  title: string;
  createdAt: number;
  updatedAt: number;
  /** 扩展元数据 JSON（素材来源、看板列等） */
  meta: Record<string, unknown>;
}

/** 内容分类（统一浏览用）：按节点类型与文件扩展名归类 */
export type 内容分类 = "文件" | "图片" | "音乐" | "视频" | "文本" | "文本段" | "点子" | "素材" | "目录";

/** 统一内容条目（统一浏览窗口的同一对象模型：名称 + 内容 + 一系列标签） */
export interface 统一内容条目 {
  /** 节点 id */
  id: number;
  type: 节点类型;
  /** 展示分类（图片/音乐/视频/文本/文件/点子/素材/目录） */
  category: 内容分类;
  /** 展示名称 */
  name: string;
  /** 内容/简介（用于预览） */
  content: string;
  tagIds: number[];
  tagPaths: string[][];
  /** 导入顺序（创建时间，秒） */
  createdAt: number;
  updatedAt: number;
  /** 若为文件/目录，关联的资源 id */
  resourceId: number | null;
  path: string | null;
  size: number;
  modifiedTime: number;
  /** 入库时间（资源 indexed_at，秒） */
  indexedAt: number;
  /** 真实文件名（文件系统上的名称）；非文件内容为 null */
  realName: string | null;
  extension: string;
  meta: Record<string, unknown>;
}

/** 导入单个文件的结果：命中重复时返回去重信息，否则返回资源详情 */
export type 导入文件结果 =
  | { duplicate: true; existingId: number; existingPath: string; name: string }
  | 资源详情;

/** 节点详情（含标签与所属资源） */
export interface 节点详情 {
  id: number;
  type: 节点类型;
  title: string;
  createdAt: number;
  updatedAt: number;
  meta: Record<string, unknown>;
  /** 若为文件/目录，关联的资源 id */
  resourceId: number | null;
  tagPaths: string[][];
}

/** 笔记（点子）实体 */
export interface 笔记 {
  id: number;
  /** 标题 */
  title: string;
  /** 正文内容 */
  content: string;
  createdAt: number;
  updatedAt: number;
  tagIds: number[];
}

/** 素材（material）实体：艺术/学术资料收集 */
export interface 素材 {
  id: number;
  /** 标题 */
  title: string;
  /** 描述/说明 */
  content: string;
  /** 素材类型（图片/文章/视频/引用等） */
  kind: string;
  /** 来源 URL */
  sourceUrl: string;
  /** 图片路径/URL（预览用） */
  imageUrl: string;
  createdAt: number;
  updatedAt: number;
  tagIds: number[];
}

/** 素材实体的可更新字段 */
export interface 素材更新 {
  title?: string;
  content?: string;
  kind?: string;
  sourceUrl?: string;
  imageUrl?: string;
  tagIds?: number[];
}

// ===== 工作流看板（card）=====

/** 看板列实体 */
export interface 看板列 {
  id: number;
  /** 列名 */
  name: string;
  /** 排序权重 */
  sort: number;
  createdAt: number;
}

/** 看板列实体的可更新字段 */
export interface 看板列更新 {
  name?: string;
  sort?: number;
}

/** 看板卡片实体 */
export interface 卡片 {
  id: number;
  /** 标题 */
  title: string;
  /** 内容/说明 */
  content: string;
  /** 所属列 id，null 表示未分列 */
  columnId: number | null;
  createdAt: number;
  updatedAt: number;
  tagIds: number[];
}

/** 卡片实体的可更新字段 */
export interface 卡片更新 {
  title?: string;
  content?: string;
  columnId?: number | null;
  tagIds?: number[];
}

/** 文本段（snippet）实体：一段可独立管理的文本知识/片段 */
export interface 文本片段 {
  id: number;
  /** 标题 */
  title: string;
  /** 正文内容 */
  content: string;
  createdAt: number;
  updatedAt: number;
  tagIds: number[];
}

/** 文本段实体的可更新字段 */
export interface 文本片段更新 {
  title?: string;
  content?: string;
  tagIds?: number[];
}
