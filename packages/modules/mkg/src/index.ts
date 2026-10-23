/**
 * 苦瓜知识图谱服务模块
 * 通过苦音协议向其他模块暴露 MKG 能力
 */

import { readFileSync, writeFileSync } from "node:fs";
import { resolve } from "node:path";
import { 启动模块 } from "@kugua/module-kit";
import { MKG配置声明 } from "./declaration.js";
import { MKG, type 节点关系类型, type 内容分类, type 查询条件, type 侧车数据 } from "@kugua/mkg";
import { 是否在目录下, 判定文件类型, 读取索引默认值, type 索引默认值 } from "./pure.js";
import { 能力清单 } from "./capabilities.js";

/** 运行时注入的数据库路径与实例（读配置阶段无法创建客户端与数据库） */
let 数据库路径: string | null = null;
let 数据库实例: MKG | null = null;

let 索引默认: 索引默认值 = {};

void 启动模块({
  name: "mkg",
  version: "0.4.0",
  能力: 能力清单,
  // 声明一次，平台自动生成配置页
  配置声明: MKG配置声明,
  读配置: (文件配置) => {
    const m = (文件配置.mkg ?? {}) as { dbPath?: string; database?: Record<string, unknown> };
    数据库路径 = resolve(m.dbPath ?? "data/mkg.db");
    索引默认 = 读取索引默认值(m.database ?? {});
    return {};
  },
  // 索引默认值可以热更新；dbPath 不行（数据库已打开），所以只刷默认值
  配置变更: (载荷) => {
    // 注意：载荷.配置 是「本模块的配置节」本身（即 mkg 的内容），
    // 不是整个配置文件——写成 载荷.配置.mkg 会取到 undefined，
    // 于是每次推送都把默认值刷成初始值，配置等于没生效。
    const 节 = 载荷.配置 as { database?: Record<string, unknown> };
    索引默认 = 读取索引默认值(节.database ?? {});
    const 需要重启 = 载荷.变更.includes("dbPath");
    console.log(
      `[知识库] 配置已更新（来源：${载荷.来源}，变更：${载荷.变更.join(", ") || "无"}）` +
        (需要重启 ? " —— 数据库路径改动需重启本模块才生效" : ""),
    );
  },
  注册: (客户端) => {
    const mkg = new MKG(数据库路径!);
    数据库实例 = mkg;

    客户端.onRequest("mkg.index", async (params) => {
    const { path, options } = (params ?? {}) as { path?: string; options?: Record<string, unknown> };
    if (!path) throw new Error("缺少 path 参数");
    // 单次调用显式传的选项优先，未传的项用配置里的默认值
    return mkg.index(path, { ...索引默认, ...(options ?? {}) });
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
    const { nodeId, resourceId, path } = (params ?? {}) as {
      nodeId?: number;
      resourceId?: number;
      path?: string;
    };
    // 优先级：nodeId > resourceId > path（对齐「统一内容节点」主模型）
    let content: string | null = null;
    if (nodeId !== undefined) {
      content = mkg.readContentByNode(nodeId);
    } else if (resourceId !== undefined) {
      content = mkg.readContent(resourceId);
    } else if (path) {
      content = mkg.readContent(path);
    } else {
      throw new Error("缺少 nodeId、resourceId 或 path 参数");
    }
    if (content === null) {
      throw new Error(
        nodeId !== undefined
          ? `未找到节点 ${nodeId} 对应的索引文本内容`
          : resourceId !== undefined
            ? `未找到资源 ${resourceId} 对应的索引文本内容`
            : `未找到路径对应的文本内容：${path}`,
      );
    }
    return { nodeId, resourceId, path, content };
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
    const { fromNodeId, toNodeId, relationType } = (params ?? {}) as {
      fromNodeId?: number;
      toNodeId?: number;
      relationType?: 节点关系类型;
    };
    if (fromNodeId === undefined || toNodeId === undefined || !relationType) {
      throw new Error("缺少 fromNodeId、toNodeId 或 relationType");
    }
    mkg.addRelation(fromNodeId, toNodeId, relationType);
    return { success: true };
  });

  客户端.onRequest("mkg.tag.move", (params) => {
    const { tagId, newParentId } = (params ?? {}) as { tagId?: number; newParentId?: number | null };
    if (tagId === undefined) throw new Error("缺少 tagId");
    // newParentId 显式允许 null（移到根），所以只校验 undefined
    if (newParentId === undefined) throw new Error("缺少 newParentId（移到根请传 null）");
    return mkg.moveTag(tagId, newParentId);
  });

  客户端.onRequest("mkg.relation.remove", (params) => {
    const { fromNodeId, toNodeId, relationType } = (params ?? {}) as {
      fromNodeId?: number;
      toNodeId?: number;
      relationType?: 节点关系类型;
    };
    if (fromNodeId === undefined || toNodeId === undefined || !relationType) {
      throw new Error("缺少 fromNodeId、toNodeId 或 relationType");
    }
    const 已删除 = mkg.removeRelation(fromNodeId, toNodeId, relationType);
    if (!已删除) throw new Error("该关联不存在（可能已被删除）");
    return { success: true };
  });

  客户端.onRequest("mkg.relation.list", (params) => {
    const { nodeId, relationType } = (params ?? {}) as {
      nodeId?: number;
      relationType?: 节点关系类型;
    };
    if (nodeId === undefined) throw new Error("缺少 nodeId");
    return mkg.getRelations(nodeId, relationType);
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
    // 返回当前磁盘哈希，让编辑器记住加载时的内容版本，
    // 保存时作为 expectedSha256 回传，用来检测加载后是否被外部改动。
    return { base64: buf.toString("base64"), size: buf.length, path, sha256: mkg.磁盘哈希(resourceId) };
  });

  /** 写入文件内容（用于内置编辑器保存） */
  客户端.onRequest("mkg.file.write", (params) => {
    const { resourceId, content, encoding, expectedSha256 } = (params ?? {}) as {
      resourceId?: number;
      content?: string;
      encoding?: "utf8" | "base64";
      expectedSha256?: string;
    };
    if (resourceId === undefined) throw new Error("缺少 resourceId");
    if (content === undefined) throw new Error("缺少 content");
    const path = mkg.getPhysicalPath(resourceId);
    if (!path) throw new Error(`资源不存在：${resourceId}`);
    // 外部改动防护：调用方带期望哈希时，写盘前比对磁盘当前哈希，
    // 不一致则拒绝（避免覆盖外部进程已改动的内容）。
    if (expectedSha256) mkg.校验磁盘未变更(resourceId, expectedSha256);
    const enc: BufferEncoding = encoding === "base64" ? "base64" : "utf8";
    writeFileSync(path, content, enc);
    return { success: true, path };
  });

  /** 文件路径与所属来源（用于保存前提示是否修改了原始文件） */
  客户端.onRequest("mkg.file.pathInfo", (params) => {
    const { resourceId } = (params ?? {}) as { resourceId?: number };
    if (resourceId === undefined) throw new Error("缺少 resourceId");
    const path = mkg.getPhysicalPath(resourceId);
    if (!path) throw new Error(`资源不存在：${resourceId}`);
    // 位于任一「已登记位置」目录下 = 原址扫描的原始文件，保存会直接修改源文件。
    // 导入/收藏的副本落在库目录，不属于任何登记位置。
    const 命中位置 = mkg.列出位置().find((l) => 是否在目录下(path, l.path));
    return {
      path,
      /** 是否为原址扫描（保存会改原始文件） */
      inPlace: !!命中位置,
      locationId: 命中位置?.id,
      locationPath: 命中位置?.path,
    };
  });

  /** 判断文件是否为文本类型（按扩展名） */
  客户端.onRequest("mkg.file.isText", (params) => {
    const { resourceId } = (params ?? {}) as { resourceId?: number };
    if (resourceId === undefined) throw new Error("缺少 resourceId");
    const path = mkg.getPhysicalPath(resourceId);
    if (!path) throw new Error(`资源不存在：${resourceId}`);
    return 判定文件类型(path);
  });

  客户端.onRequest("mkg.tag.tree", () => {
    return mkg.获取动态标签树();
  });

  // AI 读访问 opt-in：给标签打「AI 可读」标记
  客户端.onRequest("mkg.tag.setAiPublic", (params) => {
    const { tagId, aiPublic } = (params ?? {}) as { tagId?: number; aiPublic?: boolean };
    if (tagId === undefined) throw new Error("缺少 tagId");
    return mkg.setTagAiPublic(tagId, aiPublic !== false);
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

  // 按来源 URL 查素材（真列 + 索引，AI 检索素材来源用）
  客户端.onRequest("mkg.material.listBySourceUrl", (params) => {
    const { sourceUrl, limit } = (params ?? {}) as { sourceUrl?: string; limit?: number };
    if (!sourceUrl) throw new Error("缺少 sourceUrl");
    return mkg.listMaterialsBySourceUrl(sourceUrl, typeof limit === "number" ? limit : undefined);
  });

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

  // ===== mkg.ai.*：AI 专属能力族（沙箱：按 agent_id 隔离）=====

  // AI 写自己的 aigc 节点（create 或 update，按 agent_id 隔离）
  客户端.onRequest("mkg.ai.write", (params) => {
    const { agentId, id, title, content, tagIds } = (params ?? {}) as {
      agentId?: string;
      id?: number;
      title?: string;
      content?: string;
      tagIds?: number[];
    };
    if (!agentId) throw new Error("缺少 agentId（AI 会话隔离标识）");
    if (id !== undefined) {
      // update：只能改自己的
      const 更新 = mkg.updateAigc(agentId, id, {
        title,
        content,
        tagIds,
      });
      if (!更新) throw new Error(`未找到或无权修改 aigc 节点 ${id}（agentId=${agentId}）`);
      return { action: "update", ...更新 };
    }
    if (!title) throw new Error("缺少 title（新建 aigc 需标题）");
    const 新建 = mkg.createAigc(agentId, title, content ?? "", tagIds ?? []);
    return { action: "create", ...新建 };
  });

  // AI 列出自己的 aigc 节点
  客户端.onRequest("mkg.ai.listMine", (params) => {
    const { agentId } = (params ?? {}) as { agentId?: string };
    if (!agentId) throw new Error("缺少 agentId");
    return mkg.listAigcByAgent(agentId);
  });

  // AI 读可读内容（opt-in：仅 ai_public 标签下的内容）
  客户端.onRequest("mkg.ai.read", (params) => {
    const { keyword, id, limit } = (params ?? {}) as {
      keyword?: string;
      id?: number;
      limit?: number;
    };
    const 可读 = mkg.listAiReadable({
      keyword,
      limit: typeof limit === "number" ? limit : undefined,
    });
    if (id !== undefined) {
      const 命中 = 可读.find((x) => x.id === id);
      if (!命中) {
        throw new Error(`未找到可读内容 ${id}（该内容不存在或未标记 ai_public）`);
      }
      return 命中;
    }
    return {
      total: 可读.length,
      items: 可读,
      note: "仅返回带 ai_public 标签的内容；aigc 类型请用 mkg.ai.listMine",
    };
  });

  // AI 在可读范围内搜索
  客户端.onRequest("mkg.ai.search", (params) => {
    const { keyword, limit } = (params ?? {}) as { keyword?: string; limit?: number };
    if (!keyword) throw new Error("缺少 keyword");
    return {
      total: 0,
      items: mkg.listAiReadable({
        keyword,
        limit: typeof limit === "number" ? limit : 50,
      }),
    };
  });

  // ===== mkg.aigc.*：用户视角查看/管理 AI 生成内容（不按 agent_id 隔离）=====

  客户端.onRequest("mkg.aigc.get", (params) => {
    const { id } = (params ?? {}) as { id?: number };
    if (id === undefined) throw new Error("缺少 id");
    const 内容 = mkg.用户GetAigc(id);
    if (!内容) throw new Error(`未找到 aigc 节点 ${id}`);
    return 内容;
  });

  客户端.onRequest("mkg.aigc.list", (params) => {
    const { agentId, keyword, limit } = (params ?? {}) as {
      agentId?: string;
      keyword?: string;
      limit?: number;
    };
    const items = mkg.用户ListAigc({ agentId, keyword, limit });
    return { total: items.length, items };
  });

  客户端.onRequest("mkg.aigc.delete", (params) => {
    const { id } = (params ?? {}) as { id?: number };
    if (id === undefined) throw new Error("缺少 id");
    const 存在 = mkg.用户GetAigc(id);
    if (!存在) throw new Error(`未找到 aigc 节点 ${id}`);
    mkg.用户DeleteAigc(id);
    return { 删除: id };
  });

  客户端.onRequest("mkg.aigc.agents", () => mkg.列表AigcAgent());
  },
  关闭: () => {
    数据库实例?.close();
  },
  就绪: () => console.log("[mkg模块] 已接入主控"),
});
