/**
 * 苦瓜知识图谱服务模块
 * 通过苦音协议向其他模块暴露 MKG 能力
 */

import { existsSync, readFileSync } from "node:fs";
import { resolve } from "node:path";
import { NiganeClient } from "@kugua/nigane";
import { MKG, type 资源关系类型, type 内容分类 } from "@kugua/mkg";

interface 模块配置 {
  host?: string;
  port?: number;
  token?: string;
  mkg?: {
    /** 数据库文件路径，默认 data/mkg.db */
    dbPath?: string;
  };
}

function 加载配置(): 模块配置 {
  const 路径 = resolve(process.cwd(), "kugua.config.json");
  if (!existsSync(路径)) return {};
  try {
    return JSON.parse(readFileSync(路径, "utf-8")) as 模块配置;
  } catch (err) {
    console.warn(`[mkg模块] 配置文件解析失败：${String(err)}`);
    return {};
  }
}

async function 启动(): Promise<void> {
  const 配置 = 加载配置();
  const host = 配置.host ?? "127.0.0.1";
  const port = 配置.port ?? 24601;
  const envURL = process.env.NIGANE_URL ?? process.argv[2];
  const envToken = process.env.NIGANE_TOKEN ?? process.argv[3];
  const dbPath = resolve(配置.mkg?.dbPath ?? "data/mkg.db");

  const mkg = new MKG(dbPath);

  const 客户端 = new NiganeClient({
    name: "mkg",
    url: envURL ?? `ws://${host}:${port}`,
    token: envToken ?? 配置.token ?? "",
    version: "0.3.0",
    capabilities: [
      "mkg.index",
      "mkg.tag.create",
      "mkg.tag.list",
      "mkg.tag.delete",
      "mkg.tag.attach",
      "mkg.tag.detach",
      "mkg.resource.create",
      "mkg.resource.delete",
      "mkg.resource.list",
      "mkg.resource.listByTag",
      "mkg.resource.import",
      "mkg.data.read",
      "mkg.stats",
      "mkg.resource.get",
      "mkg.resource.tags",
      "mkg.search",
      "mkg.relation.add",
      "mkg.relation.list",
      "mkg.alias.set",
      "mkg.alias.get",
      "mkg.resource.rename",
      "mkg.openwith.set",
      "mkg.openwith.list",
      "mkg.openwith.delete",
      "mkg.file.open",
      "mkg.file.openWith",
      "mkg.file.explorer",
      "mkg.file.physicalPath",
      "mkg.tag.tree",
      "mkg.tag.createTree",
      "mkg.tag.related",
      "mkg.resource.detail",
      "mkg.resource.listDetail",
      "mkg.resource.listByTagDetail",
      "mkg.resource.importFile",
      "mkg.resource.importFiles",
      "mkg.tag.setResourceTags",
      "mkg.tag.addResourceTags",
      "mkg.tag.removeResourceTags",
      "mkg.note.create",
      "mkg.note.get",
      "mkg.note.list",
      "mkg.note.update",
      "mkg.note.delete",
      "mkg.material.create",
      "mkg.material.get",
      "mkg.material.list",
      "mkg.material.update",
      "mkg.material.delete",
      "mkg.card.columnCreate",
      "mkg.card.columnList",
      "mkg.card.columnUpdate",
      "mkg.card.columnDelete",
      "mkg.card.create",
      "mkg.card.get",
      "mkg.card.list",
      "mkg.card.update",
      "mkg.card.delete",
      "mkg.node.list",
      "mkg.node.search",
      "mkg.node.setTags",
      "mkg.node.listAll",
      "mkg.snippet.create",
      "mkg.snippet.get",
      "mkg.snippet.list",
      "mkg.snippet.update",
      "mkg.snippet.delete",
      "mkg.node.remove",
      "mkg.node.removeMany",
      "mkg.node.trash",
      "mkg.node.renameTitle",
      "mkg.resource.renameFile",
    ],
  });

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
    const { title, content, columnId, tagIds } = (params ?? {}) as {
      title?: string; content?: string; columnId?: number | null; tagIds?: number[];
    };
    if (!title) throw new Error("缺少 title");
    return mkg.createCard({ title, content, columnId, tagIds });
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
      patch?: { title?: string; content?: string; columnId?: number | null; tagIds?: number[] };
    };
    if (id === undefined || !patch) throw new Error("缺少 id 或 patch");
    return mkg.updateCard(id, patch);
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

  await 客户端.connect();
  console.log(`[mkg模块] 已连接主控，数据库：${dbPath}`);

  const 关闭 = (): void => {
    console.log("[mkg模块] 正在关闭……");
    mkg.close();
    客户端.close();
    process.exit(0);
  };
  客户端.on("shutdown", 关闭);
  process.on("SIGINT", 关闭);
  process.on("SIGTERM", 关闭);
}

启动().catch((err: unknown) => {
  console.error("[mkg模块] 启动失败：", err);
  process.exit(1);
});
