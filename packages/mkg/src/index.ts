import { 初始化数据库 } from "./db.js";
import { 索引目录, type 索引结果 } from "./indexer.js";
import type { 索引选项 } from "./types.js";
import type Database from "better-sqlite3";

// P2 结构化拆分：各领域方法见 domains/，以「原型安装 + declare module 声明合并」挂到主类上
import { 安装标签域 } from "./domains/tags.js";
import { 安装资源域 } from "./domains/resources.js";
import { 安装文件域 } from "./domains/files.js";
import { 安装节点域 } from "./domains/nodes.js";
import { 安装笔记域 } from "./domains/notes.js";
import { 安装素材域 } from "./domains/materials.js";
import { 安装片段域 } from "./domains/snippets.js";
import { 安装看板域 } from "./domains/board.js";
import { 安装AIGC域 } from "./domains/aigc.js";
import { 安装视图位置域 } from "./domains/views.js";
import { 安装工作区域 } from "./domains/workspace.js";

export * from "./types.js";
export * from "./sidecar.js";
export * from "./pure.js";
export { 索引目录, 初始化数据库, type 索引结果 };

/**
 * 苦瓜知识图谱主类
 *
 * 公开方法按领域拆分在 `src/domains/*.ts` 中，通过原型安装合并到本类；
 * 类型由各领域文件的 `declare module "../index.js"` 声明合并补全。
 */
export class MKG {
  private db: Database.Database;

  constructor(dbPath: string) {
    this.db = 初始化数据库(dbPath);
  }

  /**
   * 索引指定目录
   */
  async index(rootPath: string, options?: 索引选项): Promise<索引结果> {
    return 索引目录(this.db, rootPath, options);
  }

  /**
   * 关闭数据库
   */
  close(): void {
    this.db.close();
  }
}

// 把各领域方法安装到原型（顺序无关；类型由各领域 declare module 合并）
const 原型 = MKG.prototype as unknown as { [k: string]: unknown };
安装标签域(原型);
安装资源域(原型);
安装文件域(原型);
安装节点域(原型);
安装笔记域(原型);
安装素材域(原型);
安装片段域(原型);
安装看板域(原型);
安装AIGC域(原型);
安装视图位置域(原型);
安装工作区域(原型);
