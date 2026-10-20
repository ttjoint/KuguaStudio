/**
 * 知识库域方法：命名 / 打开方式 / 资源详情 / 统计 / 文件导入
 *
 * 从原单体 MKG 类拆出（P2 结构化改造），以原型安装方式挂到 MKG.prototype。
 */
import { existsSync, statSync, mkdirSync, copyFileSync, readFileSync, writeFileSync, mkdtempSync, unlinkSync, rmdirSync } from "node:fs";
import { basename, extname, join, resolve } from "node:path";
import { tmpdir } from "node:os";
import { createHash } from "node:crypto";
import { exec, spawn } from "node:child_process";
import type Database from "better-sqlite3";
import { 索引目录 } from "../indexer.js";
import type { 资源, 资源详情, 搜索选项, 搜索结果, 打开方式配置, 导入文件结果 } from "../types.js";

declare module "../index.js" {
  interface MKG {
    setAlias(resourceId: number, alias: string): void;
    getAlias(resourceId: number): string | null;
    getAliasByPath(path: string): string | null;
    getDisplayName(resourceId: number): string;
    renameResource(resourceId: number, newAlias: string): void;
    setOpenWith(extension: string, programPath: string, args?: string, label?: string): 打开方式配置;
    getOpenWith(extension: string): 打开方式配置 | null;
    listOpenWith(): 打开方式配置[];
    deleteOpenWith(id: number): void;
    getPhysicalPath(resourceId: number): string | null;
    /** 计算磁盘文件当前 sha256；文件不存在返回 null */
    磁盘哈希(resourceId: number): string | null;
    /** 校验磁盘文件哈希是否等于期望值，不等则抛错（防止覆盖外部改动） */
    校验磁盘未变更(resourceId: number, expectedSha256: string): void;
    openInExplorer(resourceId: number): boolean;
    openWithProgram(resourceId: number, programPath?: string): boolean;
    getResourceDetail(idOrPath: number | string): 资源详情 | undefined;
    listResourcesDetail(options?: 搜索选项): 搜索结果<资源详情>;
    listResourcesByTagDetail(tagId: number, options?: 搜索选项): 搜索结果<资源详情>;
    getStats(): {
      资源总数: number;
      文件数: number;
      目录数: number;
      标签数: number;
      关联数: number;
      文本内容数: number;
      数据库大小: number;
    };
    计算目标路径(源路径: string, 目标目录: string, 指定名称?: string): { 目标路径: string; 物理文件名: string };
    importFile(params: {
      sourcePath: string;
      destDir?: string;
      name?: string;
      alias?: string;
      tagIds?: number[];
    }): Promise<导入文件结果>;
    importFiles(params: {
      items: Array<{ sourcePath: string; name?: string; alias?: string; tagIds?: number[] }>;
      destDir?: string;
    }): Promise<导入文件结果[]>;
    /** 直接将 base64 字节写入知识库（收藏聊天多媒体回复用） */
    saveBase64(params: {
      base64: string;
      name: string;
      destDir?: string;
      alias?: string;
      tagIds?: number[];
    }): Promise<导入文件结果>;
  }
}

interface 上下文 {
  db: Database.Database;
  getResource(idOrPath: number | string): 资源 | undefined;
  getResourceTags(resourceId: number): import("../types.js").标签[];
  getResourceTagPaths(resourceId: number): string[][];
  getOpenWith(extension: string): 打开方式配置 | null;
  listResources(options?: 搜索选项): 搜索结果<资源>;
  listResourcesByTag(tagId: number, options?: 搜索选项): 搜索结果<资源>;
  获取扩展名(name: string): string;
  推断MimeType(extension: string): string;
  资源转详情(resource: 资源): 资源详情;
  计算目标路径(源路径: string, 目标目录: string, 指定名称?: string): { 目标路径: string; 物理文件名: string };
  查询重复文件(hash: string, 排除路径?: string): 资源 | undefined;
  setAlias(resourceId: number, alias: string): void;
  tagResource(resourceId: number, tagId: number): void;
  getPhysicalPath(resourceId: number): string | null;
  磁盘哈希(resourceId: number): string | null;
  校验磁盘未变更(resourceId: number, expectedSha256: string): void;
  getResourceDetail(idOrPath: number | string): 资源详情 | undefined;
  getAlias(resourceId: number): string | null;
  importFile(params: {
    sourcePath: string;
    destDir?: string;
    name?: string;
    alias?: string;
    tagIds?: number[];
  }): Promise<导入文件结果>;

  /** 将 base64 字节直接写入知识库（用于收藏聊天里的图片/音频等二进制回复） */
  saveBase64(params: {
    base64: string;
    name: string;
    destDir?: string;
    alias?: string;
    tagIds?: number[];
  }): Promise<导入文件结果>;
}

export function 安装文件域(proto: { [k: string]: unknown }): void {
  proto.setAlias = function (this: 上下文, resourceId: number, alias: string): void {
    this.db
      .prepare(`
        INSERT INTO resource_aliases (resource_id, alias)
        VALUES (?, ?)
        ON CONFLICT(resource_id) DO UPDATE SET alias = excluded.alias
      `)
      .run(resourceId, alias);
    // 知识库内命名：同步到统一内容节点的展示标题
    const 节点ID = this.db.prepare("SELECT node_id FROM resources WHERE id = ?").get(resourceId) as
      | { node_id: number | null }
      | undefined;
    if (节点ID?.node_id != null) {
      this.db
        .prepare("UPDATE nodes SET title = ?, updated_at = ? WHERE id = ?")
        .run(alias, Math.floor(Date.now() / 1000), 节点ID.node_id);
    }
  };

  proto.getAlias = function (this: 上下文, resourceId: number): string | null {
    const row = this.db
      .prepare("SELECT alias FROM resource_aliases WHERE resource_id = ?")
      .get(resourceId) as { alias: string } | undefined;
    return row?.alias ?? null;
  };

  proto.getAliasByPath = function (this: 上下文, path: string): string | null {
    const row = this.db
      .prepare(`
        SELECT ra.alias
        FROM resource_aliases ra
        JOIN resources r ON r.id = ra.resource_id
        WHERE r.path = ?
      `)
      .get(path) as { alias: string } | undefined;
    return row?.alias ?? null;
  };

  proto.getDisplayName = function (this: 上下文, resourceId: number): string {
    const alias = this.getAlias(resourceId);
    if (alias !== null) return alias;
    const resource = this.getResource(resourceId);
    return resource?.name ?? "";
  };

  proto.renameResource = function (this: 上下文, resourceId: number, newAlias: string): void {
    this.setAlias(resourceId, newAlias);
  };

  proto.setOpenWith = function (
    this: 上下文,
    extension: string,
    programPath: string,
    args?: string,
    label?: string,
  ): 打开方式配置 {
    const ext = extension.startsWith(".") ? extension.toLowerCase() : `.${extension.toLowerCase()}`;
    const argumentsStr = args ?? '"{0}"';
    const stmt = this.db.prepare(`
      INSERT INTO open_with_config (extension, program_path, arguments, label)
      VALUES (?, ?, ?, ?)
      ON CONFLICT(extension) DO UPDATE SET
        program_path = excluded.program_path,
        arguments = excluded.arguments,
        label = excluded.label
      RETURNING id, extension, program_path as programPath, arguments, label
    `);
    return stmt.get(ext, programPath, argumentsStr, label ?? null) as 打开方式配置;
  };

  proto.getOpenWith = function (this: 上下文, extension: string): 打开方式配置 | null {
    const ext = extension.startsWith(".") ? extension.toLowerCase() : `.${extension.toLowerCase()}`;
    const row = this.db
      .prepare("SELECT id, extension, program_path as programPath, arguments, label FROM open_with_config WHERE extension = ?")
      .get(ext) as 打开方式配置 | undefined;
    return row ?? null;
  };

  proto.listOpenWith = function (this: 上下文): 打开方式配置[] {
    return this.db
      .prepare("SELECT id, extension, program_path as programPath, arguments, label FROM open_with_config ORDER BY extension")
      .all() as 打开方式配置[];
  };

  proto.deleteOpenWith = function (this: 上下文, id: number): void {
    this.db.prepare("DELETE FROM open_with_config WHERE id = ?").run(id);
  };

  proto.getPhysicalPath = function (this: 上下文, resourceId: number): string | null {
    const row = this.db
      .prepare("SELECT path FROM resources WHERE id = ?")
      .get(resourceId) as { path: string } | undefined;
    return row?.path ?? null;
  };

  proto.磁盘哈希 = function (this: 上下文, resourceId: number): string | null {
    const path = this.getPhysicalPath(resourceId);
    if (!path || !existsSync(path)) return null;
    return createHash("sha256").update(readFileSync(path)).digest("hex");
  };

  proto.校验磁盘未变更 = function (this: 上下文, resourceId: number, expectedSha256: string): void {
    if (!expectedSha256) return; // 调用方未提供期望值（旧前端），退化为不校验
    const 当前 = this.磁盘哈希(resourceId);
    if (当前 === null) {
      throw new Error("磁盘文件不存在或已移动：可能已被外部删除");
    }
    if (当前 !== expectedSha256) {
      throw new Error("磁盘内容已在外部被修改，为避免覆盖你的改动，保存已取消。请重新打开该文件后再编辑。");
    }
  };

  proto.openInExplorer = function (this: 上下文, resourceId: number): boolean {
    const path = this.getPhysicalPath(resourceId);
    if (!path) return false;
    try {
      exec(`explorer.exe /select,"${path}"`);
      return true;
    } catch {
      return false;
    }
  };

  proto.openWithProgram = function (this: 上下文, resourceId: number, programPath?: string): boolean {
    const filePath = this.getPhysicalPath(resourceId);
    if (!filePath) return false;
    try {
      if (programPath) {
        const ext = this.获取扩展名(basename(filePath));
        const config = this.getOpenWith(ext);
        const args = config?.arguments ?? '"{0}"';
        const formattedArgs = args.replace("{0}", filePath);
        const argParts = formattedArgs.match(/(?:[^\s"]+|"[^"]*")+/g) ?? [filePath];
        const processedArgs = argParts.map((a) => (a.startsWith('"') && a.endsWith('"') ? a.slice(1, -1) : a));
        spawn(programPath, processedArgs, { detached: true, stdio: "ignore" });
        return true;
      } else {
        const ext = this.获取扩展名(basename(filePath));
        const config = this.getOpenWith(ext);
        if (config) {
          const formattedArgs = config.arguments.replace("{0}", filePath);
          const argParts = formattedArgs.match(/(?:[^\s"]+|"[^"]*")+/g) ?? [filePath];
          const processedArgs = argParts.map((a) => (a.startsWith('"') && a.endsWith('"') ? a.slice(1, -1) : a));
          spawn(config.programPath, processedArgs, { detached: true, stdio: "ignore" });
        } else {
          spawn("cmd.exe", ["/c", "start", "", filePath], { detached: true, stdio: "ignore" });
        }
        return true;
      }
    } catch {
      return false;
    }
  };

  proto.getResourceDetail = function (this: 上下文, idOrPath: number | string): 资源详情 | undefined {
    const resource = this.getResource(idOrPath as never);
    if (!resource) return undefined;

    const alias = this.getAlias(resource.id);
    const extension = this.获取扩展名(resource.name);
    const mimeType = this.推断MimeType(extension);
    const tagPaths = this.getResourceTagPaths(resource.id);

    return {
      ...resource,
      alias,
      extension,
      mimeType,
      tagPaths,
    };
  };

  proto.资源转详情 = function (this: 上下文, resource: 资源): 资源详情 {
    const alias = this.getAlias(resource.id);
    const extension = this.获取扩展名(resource.name);
    const mimeType = this.推断MimeType(extension);
    const tagPaths = this.getResourceTagPaths(resource.id);
    return {
      ...resource,
      alias,
      extension,
      mimeType,
      tagPaths,
    };
  };

  proto.listResourcesDetail = function (this: 上下文, options: 搜索选项 = {}): 搜索结果<资源详情> {
    const result = this.listResources(options);
    return {
      total: result.total,
      items: result.items.map((r) => this.资源转详情(r)),
    };
  };

  proto.listResourcesByTagDetail = function (
    this: 上下文,
    tagId: number,
    options: 搜索选项 = {},
  ): 搜索结果<资源详情> {
    const result = this.listResourcesByTag(tagId, options);
    return {
      total: result.total,
      items: result.items.map((r) => this.资源转详情(r)),
    };
  };

  proto.getStats = function (this: 上下文): {
    资源总数: number;
    文件数: number;
    目录数: number;
    标签数: number;
    关联数: number;
    文本内容数: number;
    数据库大小: number;
  } {
    const 资源总数 = (this.db.prepare("SELECT COUNT(*) as c FROM resources").get() as { c: number }).c;
    const 文件数 = (this.db.prepare("SELECT COUNT(*) as c FROM resources WHERE kind = 'file'").get() as { c: number }).c;
    const 目录数 = (this.db.prepare("SELECT COUNT(*) as c FROM resources WHERE kind = 'directory'").get() as { c: number }).c;
    const 标签数 = (this.db.prepare("SELECT COUNT(*) as c FROM tags").get() as { c: number }).c;
    // 关联数查 node_relations（节点关系表）。关系层已迁移：addRelation/getRelations
    // 现写 node_relations，resource_relations 仅保留兼容（见 docs/技术债.md）。
    const 关联数 = (this.db.prepare("SELECT COUNT(*) as c FROM node_relations").get() as { c: number }).c;
    const 文本内容数 = (this.db.prepare("SELECT COUNT(*) as c FROM text_contents").get() as { c: number }).c;
    // 数据库大小：page_count × page_size，比「扫描文件字节」便宜且准确（含索引/空闲页）。
    const 页 = this.db.prepare("PRAGMA page_count").get() as { page_count: number };
    const 页大小 = this.db.prepare("PRAGMA page_size").get() as { page_size: number };
    const 数据库大小 = (页.page_count ?? 0) * (页大小.page_size ?? 0);
    return { 资源总数, 文件数, 目录数, 标签数, 关联数, 文本内容数, 数据库大小 };
  };

  proto.计算目标路径 = function (
    this: 上下文,
    源路径: string,
    目标目录: string,
    指定名称?: string,
  ): { 目标路径: string; 物理文件名: string } {
    const 源扩展名 = extname(源路径);
    const 源无扩展名 = basename(源路径, 源扩展名);
    let 使用基础名 = 指定名称?.trim() || 源无扩展名;
    // 如果指定名称已包含源扩展名，去掉重复后缀
    if (指定名称 && 使用基础名.endsWith(源扩展名)) {
      使用基础名 = 使用基础名.slice(0, -源扩展名.length);
    }
    let 候选名 = 使用基础名 + 源扩展名;
    let 索引 = 1;
    let 目标路径 = resolve(join(目标目录, 候选名));
    while (existsSync(目标路径)) {
      候选名 = `${使用基础名} (${索引})${源扩展名}`;
      目标路径 = resolve(join(目标目录, 候选名));
      索引++;
    }
    return { 目标路径, 物理文件名: 候选名 };
  };

  proto.importFile = async function (
    this: 上下文,
    params: {
      sourcePath: string;
      destDir?: string;
      name?: string;
      alias?: string;
      tagIds?: number[];
    },
  ): Promise<导入文件结果> {
    const { sourcePath, destDir, name, alias, tagIds = [] } = params;
    if (!existsSync(sourcePath)) throw new Error(`源文件不存在：${sourcePath}`);
    const stat = statSync(sourcePath);
    if (!stat.isFile()) throw new Error(`源路径不是文件：${sourcePath}`);

    // 导入去重：按 sha256 比对资料库已有文件，完全一致则不再复制导入
    const hash = createHash("sha256").update(readFileSync(sourcePath)).digest("hex");
    const 重复 = this.查询重复文件(hash);
    if (重复) {
      return { duplicate: true, existingId: 重复.id, existingPath: 重复.path, name: 重复.name };
    }

    // 默认知识库根目录：db 所在目录下的 library 文件夹
    let 目标目录 = destDir;
    if (!目标目录) {
      const 默认库目录 = resolve(process.cwd(), "data/library");
      目标目录 = 默认库目录;
    }
    mkdirSync(目标目录, { recursive: true });

    const { 目标路径 } = this.计算目标路径(sourcePath, 目标目录, name);
    copyFileSync(sourcePath, 目标路径);

    // 索引单个文件
    await 索引目录(this.db, 目标路径, { maxDepth: 0 });

    const 资源 = this.getResource(目标路径);
    if (!资源) throw new Error(`索引失败：${目标路径}`);

    // 设置别名
    if (alias && alias.trim()) {
      this.setAlias(资源.id, alias.trim());
    }

    // 打标签
    for (const tagId of tagIds) {
      this.tagResource(资源.id, tagId);
    }

    const 详情 = this.getResourceDetail(资源.id);
    if (!详情) throw new Error(`获取资源详情失败：${资源.id}`);
    return 详情;
  };

  /** 写入 base64 字节到知识库（收藏聊天多媒体回复用）
   *  实现：先落临时文件，再复用 importFile 的索引/去重/标注能力。*/
  proto.saveBase64 = async function (
    this: 上下文,
    params: {
      base64: string;
      name: string;
      destDir?: string;
      alias?: string;
      tagIds?: number[];
    },
  ): Promise<导入文件结果> {
    const { base64, name, destDir, alias, tagIds = [] } = params;
    if (!base64) throw new Error("缺少 base64");
    if (!name) throw new Error("缺少 name");
    const 临时目录 = mkdtempSync(join(tmpdir(), "kugua-fav-"));
    const 临时文件 = join(临时目录, basename(name));
    try {
      writeFileSync(临时文件, Buffer.from(base64, "base64"));
      return await this.importFile({ sourcePath: 临时文件, destDir, name, alias, tagIds });
    } finally {
      try {
        unlinkSync(临时文件);
        rmdirSync(临时目录);
      } catch {
        /* 清理失败忽略 */
      }
    }
  };

  proto.importFiles = async function (
    this: 上下文,
    params: {
      items: Array<{ sourcePath: string; name?: string; alias?: string; tagIds?: number[] }>;
      destDir?: string;
    },
  ): Promise<导入文件结果[]> {
    const 结果: 导入文件结果[] = [];
    for (const item of params.items) {
      结果.push(await this.importFile({ ...item, destDir: params.destDir }));
    }
    return 结果;
  };
}
