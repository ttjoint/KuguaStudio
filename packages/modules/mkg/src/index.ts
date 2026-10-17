/**
 * 苦瓜知识图谱服务模块
 * 通过苦音协议向其他模块暴露 MKG 能力
 */

import { readFileSync, writeFileSync } from "node:fs";
import { resolve } from "node:path";
import { 启动模块 } from "@kugua/module-kit";
import { MKG, type 资源关系类型, type 内容分类, type 查询条件, type 侧车数据 } from "@kugua/mkg";
import type { 能力声明 } from "@kugua/capability";

/**
 * 只读能力声明：MCP/GUI 可见，供外部 agent 检索知识库（不允许写操作）。
 * 其余 mkg 动作仍由主控自动合成基础能力（GUI 可见）。
 */
const 能力清单: 能力声明[] = [
  {
    名称: "mkg.query",
    模块: "mkg",
    标题: "知识库组合查询",
    说明: "按标签/类型/文本/位置组合检索知识库",
    参数: {
      type: "object",
      properties: { condition: { type: "object" }, limit: { type: "number" } },
    },
    暴露: { 指令: false, GUI: true, 定时: false, MCP: true },
  },
  {
    名称: "mkg.fts.search",
    模块: "mkg",
    标题: "全文检索",
    说明: "FTS5 全文检索知识库节点标题与正文",
    参数: {
      type: "object",
      properties: { keyword: { type: "string" }, limit: { type: "number" } },
      required: ["keyword"],
    },
    暴露: { 指令: false, GUI: true, 定时: false, MCP: true },
  },
  {
    名称: "mkg.node.listAll",
    模块: "mkg",
    标题: "浏览知识库内容",
    说明: "列出统一内容条目（可筛选）",
    参数: { type: "object", properties: { limit: { type: "number" } } },
    暴露: { 指令: false, GUI: true, 定时: false, MCP: true },
  },
  {
    名称: "mkg.node.get",
    模块: "mkg",
    标题: "读取知识库节点",
    说明: "按节点 id 获取统一内容条目",
    参数: { type: "object", properties: { id: { type: "number" } }, required: ["id"] },
    暴露: { 指令: false, GUI: true, 定时: false, MCP: true },
  },
  {
    名称: "mkg.view.list",
    模块: "mkg",
    标题: "列出智能视图",
    说明: "列出已保存的智能视图",
    参数: { type: "object", properties: {} },
    暴露: { 指令: false, GUI: true, 定时: false, MCP: true },
  },
  {
    名称: "mkg.view.run",
    模块: "mkg",
    标题: "运行智能视图",
    说明: "执行智能视图并返回内容",
    参数: { type: "object", properties: { id: { type: "number" }, limit: { type: "number" } }, required: ["id"] },
    暴露: { 指令: false, GUI: true, 定时: false, MCP: true },
  },
  {
    名称: "mkg.location.list",
    模块: "mkg",
    标题: "列出受管位置",
    说明: "列出全部受管目录",
    参数: { type: "object", properties: {} },
    暴露: { 指令: false, GUI: true, 定时: false, MCP: true },
  },
  {
    名称: "mkg.stats",
    模块: "mkg",
    标题: "知识库统计",
    说明: "资源/标签/关联/文本索引统计",
    参数: { type: "object", properties: {} },
    暴露: { 指令: false, GUI: true, 定时: false, MCP: true },
  },
  {
    名称: "mkg.tag.tree",
    模块: "mkg",
    标题: "标签树",
    说明: "获取动态标签树",
    参数: { type: "object", properties: {} },
    暴露: { 指令: false, GUI: true, 定时: false, MCP: true },
  },
];

/** 运行时注入的数据库路径与实例（读配置阶段无法创建客户端与数据库） */
let 数据库路径: string | null = null;
let 数据库实例: MKG | null = null;

void 启动模块({
  name: "mkg",
  version: "0.3.0",
  能力: 能力清单,
  读配置: (文件配置) => {
    const m = (文件配置.mkg ?? {}) as { dbPath?: string };
    数据库路径 = resolve(m.dbPath ?? "data/mkg.db");
    return {};
  },
  注册: (客户端) => {
    const mkg = new MKG(数据库路径!);
    数据库实例 = mkg;

    客户端.onRequest("mkg.index", async (params) => {
    const { path, options } = (params ?? {}) as { path?: string; options?: Record<string, unknown> };
    if (!path) throw new Error("缺少 path 参数");
    return mkg.index(path, options);
  });

  客户端.onRequest("mkg.tag.create", (params) => {
    const { name, parentId, description } = (params ?? {}) as {
      name?: string;
      parentId?: number | null;
      description?: string;
    };
    if (!name) throw new Error("缺少 name 参数");
    return mkg.createTag(name, parentId, description);
  });

  客户端.onRequest("mkg.tag.list", (params) => {
    const { parentId } = (params ?? {}) as { parentId?: number | null };
    return mkg.listTags(parentId);
  });

  客户端.onRequest("mkg.tag.delete", (params) => {
    const { id } = (params ?? {}) as { id?: number };
    if (id === undefined) throw new Error("缺少 id 参数");
    mkg.deleteTag(id);
    return { success: true };
  });

  客户端.onRequest("mkg.tag.attach", (params) => {
    const { resourceId, tagId } = (params ?? {}) as { resourceId?: number; tagId?: number };
    if (resourceId === undefined || tagId === undefined) throw new Error("缺少 resourceId 或 tagId");
    mkg.tagResource(resourceId, tagId);
    return { success: true };
  });

  客户端.onRequest("mkg.tag.detach", (params) => {
    const { resourceId, tagId } = (params ?? {}) as { resourceId?: number; tagId?: number };
    if (resourceId === undefined || tagId === undefined) throw new Error("缺少 resourceId 或 tagId");
    mkg.untagResource(resourceId, tagId);
    return { success: true };
  });

  客户端.onRequest("mkg.resource.get", (params) => {
    const { id, path } = (params ?? {}) as { id?: number; path?: string };
    if (id === undefined && path === undefined) throw new Error("缺少 id 或 path");
    return id !== undefined ? mkg.getResource(id) : mkg.getResource(path as string);
  });

  客户端.onRequest("mkg.resource.tags", (params) => {
    const { resourceId } = (params ?? {}) as { resourceId?: number };
    if (resourceId === undefined) throw new Error("缺少 resourceId");
    return mkg.getResourceTags(resourceId);
  });

  客户端.onRequest("mkg.resource.create", (params) => {
    const { path, name, kind, options } = (params ?? {}) as {
      path?: string;
      name?: string;
      kind?: "file" | "directory";
      options?: Record<string, unknown>;
    };
    if (!path || !name || !kind) throw new Error("缺少 path、name 或 kind");
    return mkg.createResource(path, name, kind, {
      size: typeof options?.size === "number" ? options.size : undefined,
      modifiedTime: typeof options?.modifiedTime === "number" ? options.modifiedTime : undefined,
      sha256: typeof options?.sha256 === "string" ? options.sha256 : undefined,
    });
  });

 客户端.onRequest("mkg.resource.delete", (params) => {
    const { id } = (params ?? {}) as { id?: number };
    if (id === undefined) throw new Error("缺少 id");
    mkg.deleteResource(id);
    return { success: true };
  });

  // 从知识库移除（节点及其资源一起删除，不影响物理文件）
  客户端.onRequest("mkg.node.remove", (params) => {
    const { nodeId } = (params ?? {}) as { nodeId?: number };
    if (nodeId === undefined) throw new Error("缺少 nodeId");
    mkg.deleteNode(nodeId);
    return { success: true };
  });

  // 批量从知识库移除
  客户端.onRequest("mkg.node.removeMany", (params) => {
    const { nodeIds } = (params ?? {}) as { nodeIds?: number[] };
    if (!Array.isArray(nodeIds) || nodeIds.length === 0) throw new Error("缺少 nodeIds（非空数组）");
    for (const id of nodeIds) mkg.deleteNode(Number(id));
    return { success: true, removed: nodeIds.length };
  });

  // 从知识库移除并删除到系统回收站（仅文件/目录）
  客户端.onRequest("mkg.node.trash", async (params) => {
    const { nodeId } = (params ?? {}) as { nodeId?: number };
    if (nodeId === undefined) throw new Error("缺少 nodeId");
    const 资源行 = mkg.getResourceByNode(nodeId);
    if (!资源行) {
      // 非文件内容（文本段/点子等）：仅从知识库移除
      mkg.deleteNode(nodeId);
      return { success: true, trashed: false, path: null, note: "非文件内容仅从知识库移除" };
    }
    return mkg.trashResource(资源行.id);
  });

  // 重命名真实物理文件（仅文件）
  客户端.onRequest("mkg.resource.renameFile", (params) => {
    const { resourceId, newName } = (params ?? {}) as { resourceId?: number; newName?: string };
    if (resourceId === undefined || typeof newName !== "string") throw new Error("缺少 resourceId 或 newName");
    return mkg.renameResourceFile(resourceId, newName);
  });

  // 重命名知识库内名称（统一节点标题；资源节点同时写入别名）
  客户端.onRequest("mkg.node.renameTitle", (params) => {
    const { nodeId, title } = (params ?? {}) as { nodeId?: number; title?: string };
    if (nodeId === undefined || typeof title !== "string" || !title.trim()) {
      throw new Error("缺少 nodeId 或 title");
    }
    const 资源行 = mkg.getResourceByNode(nodeId);
    if (资源行) {
      mkg.setAlias(资源行.id, title.trim());
      return { success: true, title: title.trim() };
    }
    mkg.renameNodeTitle(nodeId, title.trim());
    return { success: true, title: title.trim() };
  });

  客户端.onRequest("mkg.resource.list", (params) => {
    const { options } = (params ?? {}) as { options?: Record<string, unknown> };
    return mkg.listResources({
      limit: typeof options?.limit === "number" ? options.limit : undefined,
      offset: typeof options?.offset === "number" ? options.offset : undefined,
    });
  });

  客户端.onRequest("mkg.resource.listByTag", (params) => {
    const { tagId, options } = (params ?? {}) as { tagId?: number; options?: Record<string, unknown> };
    if (tagId === undefined) throw new Error("缺少 tagId");
    return mkg.listResourcesByTag(tagId, {
      limit: typeof options?.limit === "number" ? options.limit : undefined,
      offset: typeof options?.offset === "number" ? options.offset : undefined,
    });
  });

  客户端.onRequest("mkg.resource.import", async (params) => {
    const { path, options } = (params ?? {}) as { path?: string; options?: Record<string, unknown> };
    if (!path) throw new Error("缺少 path 参数");
    return mkg.importPath(path, options);
  });

  客户端.onRequest("mkg.data.read", (params) => {
    const { path } = (params ?? {}) as { path?: string };
    if (!path) throw new Error("缺少 path 参数");
    const content = mkg.readContent(path);
    if (content === null) throw new Error(`未找到路径对应的文本内容：${path}`);
    return { path, content };
  });

  客户端.onRequest("mkg.stats", () => {
    return mkg.getStats();
  });

  客户端.onRequest("mkg.search", (params) => {
    const { type, query, options } = (params ?? {}) as {
      type?: "tag" | "path" | "content";
      query?: unknown;
      options?: Record<string, unknown>;
    };
    if (!type) throw new Error("缺少 type 参数");
    if (type === "tag") {
      return mkg.searchByTags(query as number[], options);
    }
    if (type === "path") {
      return mkg.searchByPath(query as string, options);
    }
    if (type === "content") {
      return mkg.searchByContent(query as string, options);
    }
    throw new Error(`不支持的搜索类型：${type}`);
  });

  客户端.onRequest("mkg.relation.add", (params) => {
    const { fromResourceId, toResourceId, relationType } = (params ?? {}) as {
      fromResourceId?: number;
      toResourceId?: number;
      relationType?: 资源关系类型;
    };
    if (fromResourceId === undefined || toResourceId === undefined || !relationType) {
      throw new Error("缺少 fromResourceId、toResourceId 或 relationType");
    }
    mkg.addRelation(fromResourceId, toResourceId, relationType);
    return { success: true };
  });

  客户端.onRequest("mkg.relation.list", (params) => {
    const { resourceId, relationType } = (params ?? {}) as {
      resourceId?: number;
      relationType?: 资源关系类型;
    };
    if (resourceId === undefined) throw new Error("缺少 resourceId");
    return mkg.getRelations(resourceId, relationType);
  });

  客户端.onRequest("mkg.alias.set", (params) => {
    const { resourceId, alias } = (params ?? {}) as { resourceId?: number; alias?: string };
    if (resourceId === undefined || alias === undefined) throw new Error("缺少 resourceId 或 alias");
    mkg.setAlias(resourceId, alias);
    return { success: true };
  });

  客户端.onRequest("mkg.alias.get", (params) => {
    const { resourceId, path } = (params ?? {}) as { resourceId?: number; path?: string };
    if (resourceId !== undefined) return mkg.getAlias(resourceId);
    if (path !== undefined) return mkg.getAliasByPath(path);
    throw new Error("缺少 resourceId 或 path");
  });

  客户端.onRequest("mkg.resource.rename", (params) => {
    const { resourceId, newAlias } = (params ?? {}) as { resourceId?: number; newAlias?: string };
    if (resourceId === undefined || newAlias === undefined) throw new Error("缺少 resourceId 或 newAlias");
    mkg.renameResource(resourceId, newAlias);
    return { success: true };
  });

  客户端.onRequest("mkg.openwith.set", (params) => {
    const { extension, programPath, arguments: openArgs, label } = (params ?? {}) as {
      extension?: string;
      programPath?: string;
      arguments?: string;
      label?: string;
    };
    if (!extension || !programPath) throw new Error("缺少 extension 或 programPath");
    return mkg.setOpenWith(extension, programPath, openArgs, label);
  });

  客户端.onRequest("mkg.openwith.list", () => {
    return mkg.listOpenWith();
  });

  客户端.onRequest("mkg.openwith.delete", (params) => {
    const { id } = (params ?? {}) as { id?: number };
    if (id === undefined) throw new Error("缺少 id");
    mkg.deleteOpenWith(id);
    return { success: true };
  });

  客户端.onRequest("mkg.file.open", (params) => {
    const { resourceId } = (params ?? {}) as { resourceId?: number };
    if (resourceId === undefined) throw new Error("缺少 resourceId");
    const success = mkg.openWithProgram(resourceId);
    return { success };
  });

  客户端.onRequest("mkg.file.openWith", (params) => {
    const { resourceId, programPath } = (params ?? {}) as { resourceId?: number; programPath?: string };
    if (resourceId === undefined) throw new Error("缺少 resourceId");
    const success = mkg.openWithProgram(resourceId, programPath);
    return { success };
  });

  客户端.onRequest("mkg.file.explorer", (params) => {
    const { resourceId } = (params ?? {}) as { resourceId?: number };
    if (resourceId === undefined) throw new Error("缺少 resourceId");
    const success = mkg.openInExplorer(resourceId);
    return { success };
  });

  客户端.onRequest("mkg.file.physicalPath", (params) => {
    const { resourceId } = (params ?? {}) as { resourceId?: number };
    if (resourceId === undefined) throw new Error("缺少 resourceId");
    return mkg.getPhysicalPath(resourceId);
  });

  /** 读取文件原始内容，返回 base64（用于二进制预览） */
  客户端.onRequest("mkg.file.readRaw", (params) => {
    const { resourceId } = (params ?? {}) as { resourceId?: number };
    if (resourceId === undefined) throw new Error("缺少 resourceId");
    const path = mkg.getPhysicalPath(resourceId);
    if (!path) throw new Error(`资源不存在：${resourceId}`);
    const buf = readFileSync(path);
    return { base64: buf.toString("base64"), size: buf.length, path };
  });

  /** 写入文件内容（用于内置编辑器保存） */
  客户端.onRequest("mkg.file.write", (params) => {
    const { resourceId, content, encoding } = (params ?? {}) as {
      resourceId?: number;
      content?: string;
      encoding?: "utf8" | "base64";
    };
    if (resourceId === undefined) throw new Error("缺少 resourceId");
    if (content === undefined) throw new Error("缺少 content");
    const path = mkg.getPhysicalPath(resourceId);
    if (!path) throw new Error(`资源不存在：${resourceId}`);
    const enc: BufferEncoding = encoding === "base64" ? "base64" : "utf8";
    writeFileSync(path, content, enc);
    return { success: true };
  });

  /** 判断文件是否为文本类型（按扩展名） */
  客户端.onRequest("mkg.file.isText", (params) => {
    const { resourceId } = (params ?? {}) as { resourceId?: number };
    if (resourceId === undefined) throw new Error("缺少 resourceId");
    const path = mkg.getPhysicalPath(resourceId);
    if (!path) throw new Error(`资源不存在：${resourceId}`);
    const ext = path.split(".").pop()?.toLowerCase() ?? "";
    const 文本扩展名 = new Set([
      "txt", "md", "markdown", "json", "js", "mjs", "cjs", "ts", "tsx", "jsx",
      "py", "cs", "java", "c", "cpp", "h", "hpp", "go", "rs", "rb", "php",
      "swift", "kt", "scala", "r", "lua", "dart", "sql", "sh", "bash", "zsh",
      "bat", "cmd", "ps1", "vbs", "html", "htm", "css", "scss", "sass", "less",
      "xml", "svg", "yaml", "yml", "toml", "ini", "cfg", "conf", "log",
      "env", "gitignore", "editorconfig", "dockerfile", "makefile",
    ]);
    const 压缩包扩展名 = new Set(["zip", "rar", "7z", "tar", "gz", "bz2", "xz", "tgz", "tbz2"]);
    const 图片扩展名 = new Set(["jpg", "jpeg", "png", "gif", "webp", "bmp", "ico", "svg", "tiff", "tif", "avif", "heic", "heif"]);
    const 视频扩展名 = new Set(["mp4", "webm", "ogg", "ogv", "mov", "avi", "mkv", "flv", "wmv", "m4v", "mpg", "mpeg", "3gp"]);
    const 音乐扩展名 = new Set(["mp3", "wav", "flac", "ogg", "oga", "aac", "m4a", "wma", "opus", "aiff", "ape"]);
    return {
      isText: 文本扩展名.has(ext),
      isArchive: 压缩包扩展名.has(ext),
      isImage: 图片扩展名.has(ext),
      isVideo: 视频扩展名.has(ext),
      isAudio: 音乐扩展名.has(ext),
      extension: ext,
    };
  });

  客户端.onRequest("mkg.tag.tree", () => {
    return mkg.获取动态标签树();
  });

  客户端.onRequest("mkg.tag.createTree", (params) => {
    const { names, description } = (params ?? {}) as { names?: string[]; description?: string };
    if (!names || !Array.isArray(names) || names.length === 0) throw new Error("缺少 names 参数（非空数组）");
    return mkg.createTagTree(names, description);
  });

  客户端.onRequest("mkg.tag.related", (params) => {
    const { tagId, limit } = (params ?? {}) as { tagId?: number; limit?: number };
    if (tagId === undefined) throw new Error("缺少 tagId");
    return mkg.getRelatedTags(tagId, typeof limit === "number" ? limit : 12);
  });

  客户端.onRequest("mkg.resource.detail", (params) => {
    const { id, path } = (params ?? {}) as { id?: number; path?: string };
    if (id === undefined && path === undefined) throw new Error("缺少 id 或 path");
    return id !== undefined ? mkg.getResourceDetail(id) : mkg.getResourceDetail(path as string);
  });

  客户端.onRequest("mkg.resource.listDetail", (params) => {
    const { options } = (params ?? {}) as { options?: Record<string, unknown> };
    return mkg.listResourcesDetail({
      limit: typeof options?.limit === "number" ? options.limit : undefined,
      offset: typeof options?.offset === "number" ? options.offset : undefined,
    });
  });

  客户端.onRequest("mkg.resource.listByTagDetail", (params) => {
    const { tagId, options } = (params ?? {}) as { tagId?: number; options?: Record<string, unknown> };
    if (tagId === undefined) throw new Error("缺少 tagId");
    return mkg.listResourcesByTagDetail(tagId, {
      limit: typeof options?.limit === "number" ? options.limit : undefined,
      offset: typeof options?.offset === "number" ? options.offset : undefined,
    });
  });

  客户端.onRequest("mkg.resource.importFile", async (params) => {
    const p = (params ?? {}) as {
      sourcePath?: string; destDir?: string; name?: string; alias?: string; tagIds?: number[];
    };
    if (!p.sourcePath) throw new Error("缺少 sourcePath");
    return mkg.importFile({
      sourcePath: p.sourcePath, destDir: p.destDir, name: p.name, alias: p.alias,
      tagIds: Array.isArray(p.tagIds) ? p.tagIds : [],
    });
  });

  客户端.onRequest("mkg.resource.importFiles", async (params) => {
    const p = (params ?? {}) as {
      items?: Array<{ sourcePath: string; name?: string; alias?: string; tagIds?: number[] }>;
      destDir?: string;
    };
    if (!Array.isArray(p.items)) throw new Error("缺少 items（数组）");
    return mkg.importFiles({ items: p.items, destDir: p.destDir });
  });

  /** 将 base64 字节直接存入知识库（收藏聊天多媒体回复时使用） */
  客户端.onRequest("mkg.resource.saveBase64", async (params) => {
    const p = (params ?? {}) as {
      base64?: string; name?: string; destDir?: string; alias?: string; tagIds?: number[];
    };
    if (!p.base64) throw new Error("缺少 base64");
    if (!p.name) throw new Error("缺少 name");
    return mkg.saveBase64({
      base64: p.base64, name: p.name, destDir: p.destDir, alias: p.alias,
      tagIds: Array.isArray(p.tagIds) ? p.tagIds : [],
    });
  });

  客户端.onRequest("mkg.tag.setResourceTags", (params) => {
    const { resourceId, tagIds } = (params ?? {}) as { resourceId?: number; tagIds?: number[] };
    if (resourceId === undefined || !Array.isArray(tagIds)) throw new Error("缺少 resourceId 或 tagIds（数组）");
    return mkg.setResourceTags(resourceId, tagIds);
  });

  客户端.onRequest("mkg.tag.addResourceTags", (params) => {
    const { resourceId, tagIds } = (params ?? {}) as { resourceId?: number; tagIds?: number[] };
    if (resourceId === undefined || !Array.isArray(tagIds)) throw new Error("缺少 resourceId 或 tagIds（数组）");
    return mkg.addResourceTags(resourceId, tagIds);
  });

  客户端.onRequest("mkg.tag.removeResourceTags", (params) => {
    const { resourceId, tagIds } = (params ?? {}) as { resourceId?: number; tagIds?: number[] };
    if (resourceId === undefined || !Array.isArray(tagIds)) throw new Error("缺少 resourceId 或 tagIds（数组）");
    return mkg.removeResourceTags(resourceId, tagIds);
  });

  // ===== 统一内容节点 & 笔记（P0）=====
  客户端.onRequest("mkg.note.create", (params) => {
    const { title, content, tagIds } = (params ?? {}) as { title?: string; content?: string; tagIds?: number[] };
    if (!title) throw new Error("缺少 title");
    return mkg.createNote(title, content ?? "", tagIds ?? []);
  });

  客户端.onRequest("mkg.note.get", (params) => {
    const { id } = (params ?? {}) as { id?: number };
    if (id === undefined) throw new Error("缺少 id");
    return mkg.getNote(id);
  });

  客户端.onRequest("mkg.note.list", () => mkg.listNotes());

  客户端.onRequest("mkg.note.update", (params) => {
    const { id, patch } = (params ?? {}) as { id?: number; patch?: { title?: string; content?: string; tagIds?: number[] } };
    if (id === undefined || !patch) throw new Error("缺少 id 或 patch");
    return mkg.updateNote(id, patch);
  });

  客户端.onRequest("mkg.note.delete", (params) => {
    const { id } = (params ?? {}) as { id?: number };
    if (id === undefined) throw new Error("缺少 id");
    mkg.deleteNote(id);
    return { success: true };
  });

  客户端.onRequest("mkg.material.create", (params) => {
    const { title, content, kind, sourceUrl, imageUrl, tagIds } = (params ?? {}) as {
      title?: string; content?: string; kind?: string; sourceUrl?: string; imageUrl?: string; tagIds?: number[];
    };
    if (!title) throw new Error("缺少 title");
    return mkg.createMaterial({ title, content, kind, sourceUrl, imageUrl, tagIds });
  });

  客户端.onRequest("mkg.material.get", (params) => {
    const { id } = (params ?? {}) as { id?: number };
    if (id === undefined) throw new Error("缺少 id");
    return mkg.getMaterial(id);
  });

  客户端.onRequest("mkg.material.list", () => mkg.listMaterials());

  客户端.onRequest("mkg.material.update", (params) => {
    const { id, patch } = (params ?? {}) as {
      id?: number;
      patch?: { title?: string; content?: string; kind?: string; sourceUrl?: string; imageUrl?: string; tagIds?: number[] };
    };
    if (id === undefined || !patch) throw new Error("缺少 id 或 patch");
    return mkg.updateMaterial(id, patch);
  });

  客户端.onRequest("mkg.material.delete", (params) => {
    const { id } = (params ?? {}) as { id?: number };
    if (id === undefined) throw new Error("缺少 id");
    mkg.deleteMaterial(id);
    return { success: true };
  });

  // ===== 工作流看板（card）=====
  客户端.onRequest("mkg.card.columnCreate", (params) => {
    const { name } = (params ?? {}) as { name?: string };
    if (!name) throw new Error("缺少 name");
    return mkg.createColumn(name);
  });

  客户端.onRequest("mkg.card.columnList", () => mkg.listColumns());

  客户端.onRequest("mkg.card.columnUpdate", (params) => {
    const { id, patch } = (params ?? {}) as { id?: number; patch?: { name?: string; sort?: number } };
    if (id === undefined || !patch) throw new Error("缺少 id 或 patch");
    return mkg.updateColumn(id, patch);
  });

  客户端.onRequest("mkg.card.columnDelete", (params) => {
    const { id } = (params ?? {}) as { id?: number };
    if (id === undefined) throw new Error("缺少 id");
    mkg.deleteColumn(id);
    return { success: true };
  });

  客户端.onRequest("mkg.card.create", (params) => {
    const { title, content, columnId, tagIds, color } = (params ?? {}) as {
      title?: string; content?: string; columnId?: number | null; tagIds?: number[]; color?: string | null;
    };
    if (!title) throw new Error("缺少 title");
    return mkg.createCard({ title, content, columnId, tagIds, color });
  });

  客户端.onRequest("mkg.card.get", (params) => {
    const { id } = (params ?? {}) as { id?: number };
    if (id === undefined) throw new Error("缺少 id");
    return mkg.getCard(id);
  });

  客户端.onRequest("mkg.card.list", (params) => {
    const { columnId } = (params ?? {}) as { columnId?: number | null };
    return mkg.listCards(columnId);
  });

  客户端.onRequest("mkg.card.update", (params) => {
    const { id, patch } = (params ?? {}) as {
      id?: number;
      patch?: { title?: string; content?: string; columnId?: number | null; tagIds?: number[]; color?: string | null; sort?: number };
    };
    if (id === undefined || !patch) throw new Error("缺少 id 或 patch");
    return mkg.updateCard(id, patch);
  });

  // ===== 工作区（workspace）：仅引用库内节点，不存资源数据 =====
  客户端.onRequest("mkg.workspace.list", () => mkg.列出工作区());

  客户端.onRequest("mkg.workspace.create", (params) => {
    const { name } = (params ?? {}) as { name?: string };
    if (!name) throw new Error("缺少 name");
    return mkg.创建工作区(name);
  });

  客户端.onRequest("mkg.workspace.update", (params) => {
    const { id, patch } = (params ?? {}) as { id?: number; patch?: { name?: string; sort?: number } };
    if (id === undefined || !patch) throw new Error("缺少 id 或 patch");
    return mkg.更新工作区(id, patch);
  });

  客户端.onRequest("mkg.workspace.delete", (params) => {
    const { id } = (params ?? {}) as { id?: number };
    if (id === undefined) throw new Error("缺少 id");
    mkg.删除工作区(id);
    return { success: true };
  });

  客户端.onRequest("mkg.workspace.items", (params) => {
    const { workspaceId } = (params ?? {}) as { workspaceId?: number };
    if (workspaceId === undefined) throw new Error("缺少 workspaceId");
    return mkg.列出放置项(workspaceId);
  });

  客户端.onRequest("mkg.workspace.itemAdd", (params) => {
    const { workspaceId, nodeId, x, y, width, height, color, note } = (params ?? {}) as {
      workspaceId?: number; nodeId?: number; x?: number; y?: number; width?: number; height?: number;
      color?: string | null; note?: string | null;
    };
    if (workspaceId === undefined || nodeId === undefined) throw new Error("缺少 workspaceId 或 nodeId");
    return mkg.添加放置项(workspaceId, nodeId, { x, y, width, height, color, note });
  });

  客户端.onRequest("mkg.workspace.itemUpdate", (params) => {
    const { id, patch } = (params ?? {}) as {
      id?: number;
      patch?: { x?: number; y?: number; width?: number; height?: number; color?: string | null; note?: string | null };
    };
    if (id === undefined || !patch) throw new Error("缺少 id 或 patch");
    return mkg.更新放置项(id, patch);
  });

  客户端.onRequest("mkg.workspace.itemRemove", (params) => {
    const { id } = (params ?? {}) as { id?: number };
    if (id === undefined) throw new Error("缺少 id");
    mkg.删除放置项(id);
    return { success: true };
  });

  客户端.onRequest("mkg.card.delete", (params) => {
    const { id } = (params ?? {}) as { id?: number };
    if (id === undefined) throw new Error("缺少 id");
    mkg.deleteCard(id);
    return { success: true };
  });

  客户端.onRequest("mkg.node.list", (params) => {
    const { type, options } = (params ?? {}) as { type?: "file" | "directory" | "note" | "material" | "card"; options?: { limit?: number; offset?: number } };
    return mkg.listNodes(type, options);
  });

  客户端.onRequest("mkg.node.search", (params) => {
    const { keyword, options } = (params ?? {}) as { keyword?: string; options?: { limit?: number; offset?: number } };
    if (!keyword) throw new Error("缺少 keyword");
    return mkg.searchNodes(keyword, options);
  });

  客户端.onRequest("mkg.node.setTags", (params) => {
    const { nodeId, tagIds } = (params ?? {}) as { nodeId?: number; tagIds?: number[] };
    if (nodeId === undefined || !Array.isArray(tagIds)) throw new Error("缺少 nodeId 或 tagIds（数组）");
    return mkg.setNodeTags(nodeId, tagIds);
  });

  客户端.onRequest("mkg.node.listAll", (params) => {
    const p = (params ?? {}) as {
      keyword?: string;
      categories?: string[];
      tagId?: number;
      noTag?: boolean;
      sort?: "import" | "name" | "updated";
      limit?: number;
    };
    return mkg.listAllContent({
      keyword: p.keyword,
      categories: p.categories as 内容分类[] | undefined,
      tagId: p.tagId,
      noTag: Boolean(p.noTag),
      sort: p.sort,
      limit: typeof p.limit === "number" ? p.limit : undefined,
    });
  });

  客户端.onRequest("mkg.node.get", (params) => {
    const { id } = (params ?? {}) as { id?: number };
    if (id === undefined) throw new Error("缺少 id");
    const 全部 = mkg.listAllContent({ limit: 100000 });
    return 全部.find((x) => x.id === id) ?? null;
  });

  客户端.onRequest("mkg.snippet.create", (params) => {
    const { title, content, tagIds } = (params ?? {}) as { title?: string; content?: string; tagIds?: number[] };
    if (!title) throw new Error("缺少 title");
    return mkg.createSnippet(title, content ?? "", tagIds ?? []);
  });

  客户端.onRequest("mkg.snippet.get", (params) => {
    const { id } = (params ?? {}) as { id?: number };
    if (id === undefined) throw new Error("缺少 id");
    return mkg.getSnippet(id);
  });

  客户端.onRequest("mkg.snippet.list", () => mkg.listSnippets());

  客户端.onRequest("mkg.snippet.update", (params) => {
    const { id, patch } = (params ?? {}) as { id?: number; patch?: { title?: string; content?: string; tagIds?: number[] } };
    if (id === undefined || !patch) throw new Error("缺少 id 或 patch");
    return mkg.updateSnippet(id, patch);
  });

  客户端.onRequest("mkg.snippet.delete", (params) => {
    const { id } = (params ?? {}) as { id?: number };
    if (id === undefined) throw new Error("缺少 id");
    mkg.deleteSnippet(id);
    return { success: true };
  });

  // ===== 保存视图 / 受管位置 / 侧车 / 全文检索（v0.4，见 docs/知识库设计.md）=====
  客户端.onRequest("mkg.view.save", (params) => {
    const { name, query, icon, sort } = (params ?? {}) as {
      name?: string;
      query?: 查询条件;
      icon?: string;
      sort?: number;
    };
    if (!name) throw new Error("缺少 name");
    return mkg.添加保存视图(name, query ?? {}, icon, sort);
  });

  客户端.onRequest("mkg.view.list", () => mkg.列出保存视图());

  客户端.onRequest("mkg.view.get", (params) => {
    const { id } = (params ?? {}) as { id?: number };
    if (id === undefined) throw new Error("缺少 id");
    const v = mkg.获取保存视图(id);
    if (!v) throw new Error("保存视图不存在");
    return v;
  });

  客户端.onRequest("mkg.view.delete", (params) => {
    const { id } = (params ?? {}) as { id?: number };
    if (id === undefined) throw new Error("缺少 id");
    mkg.删除保存视图(id);
    return { success: true };
  });

  客户端.onRequest("mkg.view.run", (params) => {
    const { id, limit } = (params ?? {}) as { id?: number; limit?: number };
    if (id === undefined) throw new Error("缺少 id");
    const v = mkg.获取保存视图(id);
    if (!v) throw new Error("保存视图不存在");
    return { view: v, items: mkg.执行查询(v.query, typeof limit === "number" ? limit : undefined) };
  });

  客户端.onRequest("mkg.query", (params) => {
    const { condition, limit } = (params ?? {}) as { condition?: 查询条件; limit?: number };
    return mkg.执行查询(condition ?? {}, typeof limit === "number" ? limit : undefined);
  });

  客户端.onRequest("mkg.location.add", (params) => {
    const { path, name, mode, excludes } = (params ?? {}) as {
      path?: string;
      name?: string;
      mode?: "watch" | "manual";
      excludes?: string[];
    };
    if (!path) throw new Error("缺少 path");
    return mkg.添加位置(path, name, mode ?? "watch", excludes ?? []);
  });

  客户端.onRequest("mkg.location.list", () => mkg.列出位置());

  客户端.onRequest("mkg.location.remove", (params) => {
    const { id } = (params ?? {}) as { id?: number };
    if (id === undefined) throw new Error("缺少 id");
    mkg.删除位置(id);
    return { success: true };
  });

  客户端.onRequest("mkg.location.scan", async (params) => {
    const { id } = (params ?? {}) as { id?: number };
    const 位置列表 = mkg.列出位置().filter((l) => id === undefined || l.id === id);
    const 结果: unknown[] = [];
    for (const loc of 位置列表) {
      const r = await mkg.index(loc.path, { exclude: loc.excludes });
      结果.push({ id: loc.id, path: loc.path, ...r });
    }
    mkg.重建全文索引();
    return 结果;
  });

  客户端.onRequest("mkg.sidecar.read", (params) => {
    const { path } = (params ?? {}) as { path?: string };
    if (!path) throw new Error("缺少 path");
    return mkg.读取侧车(path);
  });

  客户端.onRequest("mkg.sidecar.write", (params) => {
    const { path, data } = (params ?? {}) as { path?: string; data?: 侧车数据 };
    if (!path || !data) throw new Error("缺少 path 或 data");
    mkg.写入侧车(path, data);
    return { success: true };
  });

  客户端.onRequest("mkg.sidecar.info", (params) => {
    const { path } = (params ?? {}) as { path?: string };
    if (!path) throw new Error("缺少 path");
    return mkg.侧车信息(path);
  });

  客户端.onRequest("mkg.sidecar.export", (params) => {
    const { nodeId } = (params ?? {}) as { nodeId?: number };
    if (nodeId === undefined) throw new Error("缺少 nodeId");
    const 数据 = mkg.导出侧车(nodeId);
    if (!数据) throw new Error("该节点不是文件，无法导出侧车");
    return 数据;
  });

  客户端.onRequest("mkg.sidecar.import", (params) => {
    const { path } = (params ?? {}) as { path?: string };
    if (!path) throw new Error("缺少 path");
    return mkg.导入侧车(path);
  });

  客户端.onRequest("mkg.fts.rebuild", () => mkg.重建全文索引());

  客户端.onRequest("mkg.fts.search", (params) => {
    const { keyword, limit } = (params ?? {}) as { keyword?: string; limit?: number };
    if (!keyword) throw new Error("缺少 keyword");
    return mkg.全文检索(keyword, typeof limit === "number" ? limit : 50);
  });
  },
  关闭: () => {
    数据库实例?.close();
  },
  就绪: () => console.log("[mkg模块] 已接入主控"),
});
