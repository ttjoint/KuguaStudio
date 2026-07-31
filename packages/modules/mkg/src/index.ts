/**
 * 苦瓜知识图谱服务模块
 * 通过苦音协议向其他模块暴露 MKG 能力
 */

import { existsSync, readFileSync } from "node:fs";
import { resolve } from "node:path";
import { NiganeClient } from "@kugua/nigane";
import { MKG, type 资源关系类型 } from "@kugua/mkg";

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
      "mkg.resource.detail",
      "mkg.resource.listDetail",
      "mkg.resource.listByTagDetail",
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
    return mkg.getTagTree();
  });

  客户端.onRequest("mkg.tag.createTree", (params) => {
    const { names, description } = (params ?? {}) as { names?: string[]; description?: string };
    if (!names || !Array.isArray(names) || names.length === 0) throw new Error("缺少 names 参数（非空数组）");
    return mkg.createTagTree(names, description);
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
