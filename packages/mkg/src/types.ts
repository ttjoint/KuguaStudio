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
  /** 颜色 #RRGGBB（可选） */
  color?: string | null;
  /** 标签类型：plain | arrow | group | smart */
  kind?: string;
  /** 图标（可选） */
  icon?: string | null;
  /** 排序权重 */
  sort?: number;
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
  /** 可选卡片颜色（如 #f5c542；空表示默认） */
  color: string | null;
  /** 列内排序权重 */
  sort: number;
}

/** 卡片实体的可更新字段 */
export interface 卡片更新 {
  title?: string;
  content?: string;
  columnId?: number | null;
  tagIds?: number[];
  color?: string | null;
  sort?: number;
}

// ===== 工作区（workspace）：只引用库内资源，不存储资源数据 =====

/** 工作区实体（类似文件夹/视图窗） */
export interface 工作区 {
  id: number;
  /** 名称 */
  name: string;
  /** 排序权重 */
  sort: number;
  createdAt: number;
  updatedAt: number;
}

/** 工作区放置项实体：引用一个库内节点，记录画布位置与尺寸 */
export interface 工作区放置项 {
  id: number;
  workspaceId: number;
  /** 引用的节点 id（文件/点子/素材/文本段/记事卡片等） */
  nodeId: number;
  /** 画布坐标与尺寸 */
  x: number;
  y: number;
  width: number;
  height: number;
  /** 可选颜色标记 */
  color: string | null;
  /** 可选备注 */
  note: string | null;
  createdAt: number;
}

/** 工作区放置项的可更新字段 */
export interface 放置项更新 {
  x?: number;
  y?: number;
  width?: number;
  height?: number;
  color?: string | null;
  note?: string | null;
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

// ===== 保存视图 / 受管位置 / 侧车（v0.4） =====

/** 保存视图（智能文件夹）：query 为组合查询条件 */
export interface 保存视图 {
  id: number;
  name: string;
  query: 查询条件;
  icon: string | null;
  sort: number;
  createdAt: number;
}

/** 组合查询条件 */
export interface 查询条件 {
  /** 命中的标签 id（AND） */
  tags?: number[];
  /** 排除的标签 id（NOT） */
  notTags?: number[];
  /** 内容分类或节点类型过滤 */
  type?: string;
  /** 文本关键词 */
  text?: string;
  /** 限定位置 id */
  locations?: number[];
  /** 排序：import | name | updated */
  sort?: "import" | "name" | "updated";
}

/** 受管位置（可索引根目录） */
export interface 位置 {
  id: number;
  path: string;
  name: string | null;
  /** watch=监听变更 | manual=手动扫描 */
  mode: "watch" | "manual";
  /** 排除规则（正则或 glob 字符串） */
  excludes: string[];
  createdAt: number;
}

/** 侧车中的关系引用 */
export interface 侧车关系 {
  type: string;
  /** 目标（相对路径或绝对路径） */
  target: string;
}

/** 侧车文件（<文件>.mkg.json）内容 */
export interface 侧车数据 {
  version: number;
  /** 源文件 sha256，用于判断文件是否被替换 */
  sha256?: string;
  /** 标签以名称/路径存储，跨库可移植 */
  tags?: string[];
  relations?: 侧车关系[];
  note?: string;
  updatedAt?: number;
}
