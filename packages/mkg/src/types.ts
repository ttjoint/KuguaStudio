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
