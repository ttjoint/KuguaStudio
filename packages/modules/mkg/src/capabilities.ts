/**
 * mkg 能力声明（单一真相来源）。
 *
 * 每个「对外可见、可被统一调用、可被 GUI/MCP/AI 消费」的 mkg 操作，
 * 都在这里声明一次。声明是纯元数据，不实现逻辑——实现仍在 handlers（index.ts）。
 *
 * 设计约定（与 docs/知识库设计.md、docs/架构设计.md 对齐）：
 *
 * 1. **只读**：查询/列表/读取，`暴露.MCP = true`，供外部 agent 检索知识库。
 * 2. **写入**：创建/更新/打标，`暴露.MCP = false`（默认不对外），`危险` 按需。
 * 3. **破坏**：删除/移除/移动物理文件，`危险 = true`，绝不经 MCP 暴露。
 *
 * 风险分级不是摆设：能力注册表在 `暴露.MCP` 且 `危险` 时默认拒绝（见
 * `packages/capability/src/index.ts` 的 `能力暴露于`）。mkg 的删除类操作
 * 必须标 `危险 = true`，从机制上保证它们永不会通过 MCP 泄漏给外部 agent。
 *
 * 为什么不复用 handler 自动生成：104 个内部动作里，有大量「UI 专用」动作
 * （file.readRaw / file.pathInfo / file.explorer 等）不该作为一等能力暴露；
 * 还有不少动作的参数形状要规整成对外的 JSON Schema。手写声明能精确控制
 * 「哪些值得对外、对外长什么样」，是审慎的取舍而非偷懒。
 */

import type { 能力声明 } from "@kugua/capability";

/** 简短构造：只读查询（MCP 可见，供外部 agent 检索） */
function 只读(名: string, 标题: string, 说明: string, 参数: 能力声明["参数"], 中文指令?: string[]): 能力声明 {
  return {
    名称: 名,
    模块: "mkg",
    标题,
    说明,
    参数,
    中文指令,
    暴露: { 指令: false, GUI: true, 定时: false, MCP: true },
  };
}

/** 写入（创建/更新/打标）：GUI 可见，默认不对外暴露 MCP */
function 写入(名: string, 标题: string, 说明: string, 参数: 能力声明["参数"], 危险 = false): 能力声明 {
  return {
    名称: 名,
    模块: "mkg",
    标题,
    说明,
    参数,
    危险,
    暴露: { 指令: false, GUI: true, 定时: false, MCP: false },
  };
}

/** 破坏（删除/移除/移动物理文件）：危险，永不对外 */
function 破坏(名: string, 标题: string, 说明: string, 参数: 能力声明["参数"]): 能力声明 {
  return {
    名称: 名,
    模块: "mkg",
    标题,
    说明,
    参数,
    危险: true,
    暴露: { 指令: false, GUI: true, 定时: false, MCP: false },
  };
}

/** 简洁对象参数 Schema（properties 直传） */
function 参(props: Record<string, Record<string, unknown>>, required?: string[]): 能力声明["参数"] {
  return { type: "object", properties: props, required };
}

export const 能力清单: 能力声明[] = [
  // ===== 统一内容节点（粗粒度查询/浏览，核心对外能力）=====
  只读(
    "mkg.query",
    "知识库组合查询",
    "按标签/类型/文本/位置组合检索知识库",
    参({ condition: { type: "object" }, limit: { type: "number" } }),
  ),
  只读(
    "mkg.fts.search",
    "全文检索",
    "FTS5 全文检索知识库节点标题与正文",
    参({ keyword: { type: "string" }, limit: { type: "number" } }, ["keyword"]),
  ),
  只读(
    "mkg.node.listAll",
    "浏览知识库内容",
    "列出统一内容条目（可筛选）",
    参({ limit: { type: "number" } }),
  ),
  只读(
    "mkg.node.get",
    "读取知识库节点",
    "按节点 id 获取统一内容条目",
    参({ id: { type: "number" } }, ["id"]),
  ),
  只读(
    "mkg.node.list",
    "按类型列出节点",
    "按节点类型（file/directory/note/material/card）列出节点详情",
    参({ type: { type: "string" }, options: { type: "object" } }),
  ),
  只读(
    "mkg.node.search",
    "节点搜索",
    "按关键词搜索节点标题与正文（返回节点详情）",
    参({ keyword: { type: "string" }, options: { type: "object" } }, ["keyword"]),
  ),
  只读(
    "mkg.stats",
    "知识库统计",
    "资源/标签/关联/文本索引统计",
    参({}),
  ),

  // ===== 标签 =====
  只读(
    "mkg.tag.tree",
    "标签树",
    "获取动态标签树（含每节点对象计数）",
    参({}),
  ),
  只读(
    "mkg.tag.list",
    "标签列表",
    "列出全部标签或某父标签下的子标签",
    参({ parentId: { type: "number" } }),
  ),
  只读(
    "mkg.tag.related",
    "相关标签",
    "按共现计算与某标签相关的标签",
    参({ tagId: { type: "number" }, limit: { type: "number" } }, ["tagId"]),
  ),
  写入(
    "mkg.tag.create",
    "创建标签",
    "创建标签（可指定父标签与描述）",
    参({ name: { type: "string" }, parentId: { type: "number" }, description: { type: "string" } }, ["name"]),
  ),
  写入(
    "mkg.tag.createTree",
    "批量创建标签链",
    "按路径数组一次创建层级标签链",
    参({ names: { type: "array", items: { type: "string" } }, description: { type: "string" } }, ["names"]),
  ),
  破坏(
    "mkg.tag.delete",
    "删除标签",
    "删除标签（不删除其下对象）",
    参({ id: { type: "number" } }, ["id"]),
  ),

  // ===== 笔记（点子）=====
  只读(
    "mkg.note.list",
    "笔记列表",
    "列出全部笔记",
    参({}),
  ),
  只读(
    "mkg.note.get",
    "读取笔记",
    "按 id 读取笔记详情",
    参({ id: { type: "number" } }, ["id"]),
  ),
  写入(
    "mkg.note.create",
    "创建笔记",
    "创建笔记（可带标签）",
    参({ title: { type: "string" }, content: { type: "string" }, tagIds: { type: "array", items: { type: "number" } } }, ["title"]),
  ),
  写入(
    "mkg.note.update",
    "更新笔记",
    "更新笔记标题/内容/标签",
    参({ id: { type: "number" }, patch: { type: "object" } }, ["id", "patch"]),
  ),
  破坏(
    "mkg.note.delete",
    "删除笔记",
    "删除笔记及其内容",
    参({ id: { type: "number" } }, ["id"]),
  ),

  // ===== 素材 =====
  只读(
    "mkg.material.list",
    "素材列表",
    "列出全部素材",
    参({}),
  ),
  只读(
    "mkg.material.get",
    "读取素材",
    "按 id 读取素材详情",
    参({ id: { type: "number" } }, ["id"]),
  ),
  写入(
    "mkg.material.create",
    "创建素材",
    "创建素材（含来源 URL / 图片 URL / 类型）",
    参({
      title: { type: "string" },
      content: { type: "string" },
      kind: { type: "string" },
      sourceUrl: { type: "string" },
      imageUrl: { type: "string" },
      tagIds: { type: "array", items: { type: "number" } },
    }, ["title"]),
  ),
  写入(
    "mkg.material.update",
    "更新素材",
    "更新素材字段",
    参({ id: { type: "number" }, patch: { type: "object" } }, ["id", "patch"]),
  ),
  破坏(
    "mkg.material.delete",
    "删除素材",
    "删除素材及其内容",
    参({ id: { type: "number" } }, ["id"]),
  ),

  // ===== 文本段 =====
  只读(
    "mkg.snippet.list",
    "文本段列表",
    "列出全部文本段",
    参({}),
  ),
  只读(
    "mkg.snippet.get",
    "读取文本段",
    "按 id 读取文本段",
    参({ id: { type: "number" } }, ["id"]),
  ),
  写入(
    "mkg.snippet.create",
    "创建文本段",
    "创建文本段（可带标签）",
    参({ title: { type: "string" }, content: { type: "string" }, tagIds: { type: "array", items: { type: "number" } } }, ["title"]),
  ),
  写入(
    "mkg.snippet.update",
    "更新文本段",
    "更新文本段标题/内容/标签",
    参({ id: { type: "number" }, patch: { type: "object" } }, ["id", "patch"]),
  ),
  破坏(
    "mkg.snippet.delete",
    "删除文本段",
    "删除文本段及其内容",
    参({ id: { type: "number" } }, ["id"]),
  ),

  // ===== 看板 =====
  只读(
    "mkg.card.columnList",
    "看板列列表",
    "列出全部看板列",
    参({}),
  ),
  只读(
    "mkg.card.list",
    "看板卡片列表",
    "列出卡片（可按列筛选）",
    参({ columnId: { type: "number" } }),
  ),
  只读(
    "mkg.card.get",
    "读取卡片",
    "按 id 读取卡片详情",
    参({ id: { type: "number" } }, ["id"]),
  ),
  写入(
    "mkg.card.columnCreate",
    "创建看板列",
    "创建看板列",
    参({ name: { type: "string" } }, ["name"]),
  ),
  写入(
    "mkg.card.columnUpdate",
    "更新看板列",
    "更新看板列名称/排序",
    参({ id: { type: "number" }, patch: { type: "object" } }, ["id", "patch"]),
  ),
  破坏(
    "mkg.card.columnDelete",
    "删除看板列",
    "删除看板列（其下卡片移到相邻列）",
    参({ id: { type: "number" } }, ["id"]),
  ),
  写入(
    "mkg.card.create",
    "创建卡片",
    "创建看板卡片",
    参({
      title: { type: "string" },
      content: { type: "string" },
      columnId: { type: "number" },
      tagIds: { type: "array", items: { type: "number" } },
      color: { type: "string" },
    }, ["title"]),
  ),
  写入(
    "mkg.card.update",
    "更新卡片",
    "更新卡片字段",
    参({ id: { type: "number" }, patch: { type: "object" } }, ["id", "patch"]),
  ),
  破坏(
    "mkg.card.delete",
    "删除卡片",
    "删除看板卡片",
    参({ id: { type: "number" } }, ["id"]),
  ),

  // ===== 视图 / 位置 =====
  只读(
    "mkg.view.list",
    "列出智能视图",
    "列出已保存的智能视图",
    参({}),
  ),
  只读(
    "mkg.view.get",
    "读取智能视图",
    "按 id 读取智能视图定义",
    参({ id: { type: "number" } }, ["id"]),
  ),
  只读(
    "mkg.view.run",
    "运行智能视图",
    "执行智能视图并返回内容",
    参({ id: { type: "number" }, limit: { type: "number" } }, ["id"]),
  ),
  写入(
    "mkg.view.save",
    "保存智能视图",
    "保存智能视图定义",
    参({ name: { type: "string" }, query: { type: "object" }, icon: { type: "string" }, sort: { type: "number" } }, ["name"]),
  ),
  破坏(
    "mkg.view.delete",
    "删除智能视图",
    "删除智能视图",
    参({ id: { type: "number" } }, ["id"]),
  ),
  只读(
    "mkg.location.list",
    "列出受管位置",
    "列出全部受管目录",
    参({}),
  ),
  写入(
    "mkg.location.add",
    "添加受管位置",
    "添加受管目录",
    参({ path: { type: "string" }, name: { type: "string" }, mode: { type: "string" }, excludes: { type: "array", items: { type: "string" } } }, ["path"]),
  ),
  破坏(
    "mkg.location.remove",
    "移除受管位置",
    "移除受管目录",
    参({ id: { type: "number" } }, ["id"]),
  ),

  // ===== 资源（文件/目录）=====
  只读(
    "mkg.resource.list",
    "资源列表",
    "列出文件/目录资源",
    参({ options: { type: "object" } }),
  ),
  只读(
    "mkg.resource.get",
    "读取资源",
    "按 id 或路径读取资源",
    参({ id: { type: "number" }, path: { type: "string" } }),
  ),
  只读(
    "mkg.resource.detail",
    "资源详情",
    "读取资源详情（含别名/扩展名/标签路径）",
    参({ id: { type: "number" }, path: { type: "string" } }),
  ),

  // ===== 索引文本 =====
  只读(
    "mkg.data.read",
    "读取索引文本",
    "按 nodeId / resourceId / path 读取文件索引文本（优先级 nodeId > resourceId > path）",
    参({ nodeId: { type: "number" }, resourceId: { type: "number" }, path: { type: "string" } }),
  ),

  // ===== 工作区 =====
  只读(
    "mkg.workspace.list",
    "工作区列表",
    "列出全部工作区",
    参({}),
  ),
  只读(
    "mkg.workspace.items",
    "工作区放置项",
    "列出某工作区的放置项",
    参({ workspaceId: { type: "number" } }, ["workspaceId"]),
  ),
  写入(
    "mkg.workspace.create",
    "创建工作区",
    "创建工作区",
    参({ name: { type: "string" } }, ["name"]),
  ),
  写入(
    "mkg.workspace.update",
    "更新工作区",
    "更新工作区名称",
    参({ id: { type: "number" }, patch: { type: "object" } }, ["id", "patch"]),
  ),
  破坏(
    "mkg.workspace.delete",
    "删除工作区",
    "删除工作区及其放置项（不删除被引用节点）",
    参({ id: { type: "number" } }, ["id"]),
  ),
];
