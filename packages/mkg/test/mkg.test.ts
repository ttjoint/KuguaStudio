/**
 * 知识库（MKG）操作集成测试
 *
 * 覆盖 WebUI 资源管理器依赖的各类知识库操作，确保各 UI 界面（资源/标签/笔记/
 * 素材/看板/片段/视图/位置/侧车/检索）对应的后端行为正确。
 *
 * 直接测试 `@kugua/mkg` 的 MKG 类（不经 IPC），保证快速且确定。
 */
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { mkdtempSync, mkdirSync, writeFileSync, rmSync, readFileSync, existsSync, utimesSync } from "node:fs";
import { createHash } from "node:crypto";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { MKG } from "../src/index";

let 目录: string;
let mkg: MKG;

beforeEach(() => {
  目录 = mkdtempSync(join(tmpdir(), "mkg-test-"));
  mkg = new MKG(join(目录, "test.db"));
});

afterEach(() => {
  mkg.close();
  // 注：不在 close 后立即 rmSync 同一目录——本机 Node 24 + better-sqlite3 在
  // 关闭连接后立刻删除库文件可能触发原生断言（env != nullptr），与业务逻辑无关。
  // 临时目录由系统清理，测试本身只依赖 beforeEach 的新建。
  try {
    rmSync(目录, { recursive: true, force: true });
  } catch {
    // 忽略：目录可能仍被句柄占用
  }
});

/** 造一个真实文件，返回路径 */
function 造文件(相对: string, 内容 = "hello"): string {
  const 全路径 = join(目录, 相对);
  mkdirSync(join(全路径, ".."), { recursive: true });
  writeFileSync(全路径, 内容, "utf-8");
  return 全路径;
}

describe("标签：创建 / 树 / 树形批量 / 相关标签", () => {
  it("createTag 与 listTags（含父标签筛选）", () => {
    const 父 = mkg.createTag("技术");
    const 子 = mkg.createTag("前端", 父.id, "前端相关");
    const 全部 = mkg.listTags();
    expect(全部.map((t) => t.name).sort()).toEqual(["前端", "技术"]);
    const 子集 = mkg.listTags(父.id);
    expect(子集.map((t) => t.name)).toEqual(["前端"]);
    expect(子.description).toBe("前端相关");
  });

  it("setTagAiPublic 切换 AI 读访问 opt-in", () => {
    const 标签 = mkg.createTag("AI可读");
    expect(标签.aiPublic).toBe(false);
    const 开 = mkg.setTagAiPublic(标签.id, true);
    expect(开.aiPublic).toBe(true);
    const 关 = mkg.setTagAiPublic(标签.id, false);
    expect(关.aiPublic).toBe(false);
    // listTags 也带出 aiPublic
    expect(mkg.listTags().find((t) => t.id === 标签.id)?.aiPublic).toBe(false);
  });

  it("getTagTree 返回嵌套结构", () => {
    const 父 = mkg.createTag("技术");
    mkg.createTag("前端", 父.id);
    mkg.createTag("后端", 父.id);
    const 树 = mkg.getTagTree();
    expect(树).toHaveLength(1);
    expect(树[0].name).toBe("技术");
    expect(树[0].children.map((c) => c.name).sort()).toEqual(["前端", "后端"]);
  });

  it("createTagTree 用路径数组一次建链", () => {
    const 叶 = mkg.createTagTree(["技术", "前端", "React"]);
    expect(叶.name).toBe("React");
    const 链 = mkg.getTagTree()[0];
    expect(链.name).toBe("技术");
    expect(链.children[0].name).toBe("前端");
    expect(链.children[0].children[0].name).toBe("React");
  });

  it("deleteTag 删除标签", () => {
    const t = mkg.createTag("临时");
    mkg.deleteTag(t.id);
    expect(mkg.listTags()).toHaveLength(0);
  });

  it("getRelatedTags 依据共现计算相关度", () => {
    const a = mkg.createTag("A");
    const b = mkg.createTag("B");
    const c = mkg.createTag("C");
    const r1 = mkg.createResource("a.txt", "a.txt", "file");
    const r2 = mkg.createResource("b.txt", "b.txt", "file");
    mkg.setResourceTags(r1.id, [a.id, b.id]);
    mkg.setResourceTags(r2.id, [a.id, b.id, c.id]);
    const 相关 = mkg.getRelatedTags(a.id);
    expect(相关.map((x) => x.tag.name)).toContain("B");
    expect(相关[0].共现).toBeGreaterThanOrEqual(1);
  });
});

describe("资源：创建 / 列表 / 重命名 / 删除", () => {
  it("createResource + getResource（按 id 与路径）", () => {
    const r = mkg.createResource("docs/readme.md", "readme.md", "file", 128);
    expect(r.id).toBeGreaterThan(0);
    expect(mkg.getResource(r.id)?.path).toBe("docs/readme.md");
    expect(mkg.getResource("docs/readme.md")?.id).toBe(r.id);
  });

  it("listResources 分页", () => {
    for (let i = 0; i < 5; i++) mkg.createResource(`f${i}.txt`, `f${i}.txt`, "file");
    const 全 = mkg.listResources({ limit: 10 });
    expect(全.items).toHaveLength(5);
    const 首页 = mkg.listResources({ limit: 2 });
    expect(首页.items).toHaveLength(2);
    expect(首页.total).toBe(5);
  });

  it("renameResourceFile 改真实文件名（含扩展名）", () => {
    const 全路径 = 造文件("old.txt", "内容");
    const r = mkg.createResource(全路径, "old.txt", "file");
    const 详情 = mkg.renameResourceFile(r.id, "new.md");
    expect(详情.path.endsWith("new.md")).toBe(true);
    expect(existsSync(join(目录, "new.md"))).toBe(true);
    expect(existsSync(join(目录, "old.txt"))).toBe(false);
    expect(详情.name).toBe("new.md");
  });

  it("renameNodeTitle 改节点标题（不改磁盘）", async () => {
    const 全路径 = 造文件("t.txt", "x");
    await mkg.index(全路径, { maxDepth: 0 });
    const 节点 = mkg.listNodes("file").items[0];
    mkg.renameNodeTitle(节点.id, "新标题");
    expect(mkg.listNodes("file").items[0].title).toBe("新标题");
    // 磁盘文件名不应变化
    expect(existsSync(全路径)).toBe(true);
  });

  it("deleteResource 删除资源", () => {
    const r = mkg.createResource("x.txt", "x.txt", "file");
    mkg.deleteResource(r.id);
    expect(mkg.getResource(r.id)).toBeUndefined();
  });
});

describe("别名：set / get / getByPath / displayName", () => {
  it("设置与读取别名，displayName 优先别名", () => {
    const r = mkg.createResource("p.txt", "p.txt", "file");
    mkg.setAlias(r.id, "项目文档");
    expect(mkg.getAlias(r.id)).toBe("项目文档");
    expect(mkg.getAliasByPath("p.txt")).toBe("项目文档");
    expect(mkg.getDisplayName(r.id)).toBe("项目文档");
  });

  it("未设别名时 displayName 回退真实名", () => {
    const r = mkg.createResource("q.txt", "q.txt", "file");
    expect(mkg.getDisplayName(r.id)).toBe("q.txt");
  });
});

describe("标签关联：set / add / remove / query", () => {
  it("setResourceTags 覆盖式设置", () => {
    const a = mkg.createTag("A");
    const b = mkg.createTag("B");
    const r = mkg.createResource("r.txt", "r.txt", "file");
    mkg.setResourceTags(r.id, [a.id]);
    expect(mkg.getResourceTags(r.id).map((t) => t.name)).toEqual(["A"]);
    mkg.setResourceTags(r.id, [b.id]);
    expect(mkg.getResourceTags(r.id).map((t) => t.name)).toEqual(["B"]);
  });

  it("addResourceTags / removeResourceTags 增量修改", () => {
    const a = mkg.createTag("A");
    const b = mkg.createTag("B");
    const r = mkg.createResource("r2.txt", "r2.txt", "file");
    mkg.addResourceTags(r.id, [a.id]);
    mkg.addResourceTags(r.id, [b.id]);
    expect(mkg.getResourceTags(r.id)).toHaveLength(2);
    mkg.removeResourceTags(r.id, [a.id]);
    expect(mkg.getResourceTags(r.id).map((t) => t.name)).toEqual(["B"]);
  });

  it("searchByTags 需同时命中所有标签", () => {
    const 父 = mkg.createTag("技术");
    const 子 = mkg.createTag("前端", 父.id);
    const r1 = mkg.createResource("a1.txt", "a1.txt", "file");
    mkg.tagResource(r1.id, 子.id);
    // 只带子标签：命中
    expect(mkg.searchByTags([子.id]).items.map((x) => x.name)).toContain("a1.txt");
    // 父 + 子：AND 语义，资源只带子标签时不应命中
    expect(mkg.searchByTags([父.id, 子.id]).items).toHaveLength(0);
  });
});

describe("统一内容节点（listAllContent / listNodes / searchNodes）", () => {
  it("listAllContent 汇总各类内容并按分类筛选", () => {
    mkg.createNote("我的笔记", "正文");
    mkg.createMaterial({ title: "参考素材", content: "x" });
    const 全 = mkg.listAllContent();
    const 名 = 全.map((x) => x.name);
    expect(名).toContain("我的笔记");
    expect(名).toContain("参考素材");
    const 仅笔记 = mkg.listAllContent({ categories: ["点子"] });
    // 反假绿：先断言非空，否则 .every() 对空数组恒真，会掩盖过滤失效
    expect(仅笔记.length).toBeGreaterThan(0);
    expect(仅笔记.every((x) => x.category === "点子")).toBe(true);
  });

  it("listAllContent 关键词过滤", () => {
    mkg.createNote("番茄种植", "如何种番茄");
    mkg.createNote("黄瓜种植", "如何种黄瓜");
    const 结果 = mkg.listAllContent({ keyword: "番茄" });
    expect(结果.map((x) => x.name)).toEqual(["番茄种植"]);
  });

  it("listAllContent 按标签（含后代）过滤", () => {
    const 父 = mkg.createTag("植物");
    const 子 = mkg.createTag("蔬菜", 父.id);
    const n = mkg.createNote("番茄", "x");
    mkg.setNodeTags(n.id, [子.id]);
    const 结果 = mkg.listAllContent({ tagId: 父.id });
    expect(结果.map((x) => x.name)).toContain("番茄");
  });

  it("listAllContent 批量加载：tagPaths / 正文 / 资源字段与逐条查询等价", async () => {
    // 回归护栏：listAllContent 改用批量预加载（一次 JOIN 代替逐节点查询）后，
    // 必须与逐条接口（getNodeTags / 获取标签路径 / 获取节点内容）结果一致。
    const 根 = mkg.createTag("根");
    const 中 = mkg.createTag("中", 根.id);
    const 叶 = mkg.createTag("叶", 中.id);
    const 笔记 = mkg.createNote("多级标签笔记", "笔记正文", [叶.id]);
    const 片段 = mkg.createSnippet("片段标题", "片段正文", [根.id, 叶.id]);
    const 文件 = 造文件("资料.txt", "文件里的内容");
    await mkg.index(文件, { maxDepth: 0 });
    const 文件节点 = mkg.listNodes("file").items[0];

    const 全 = mkg.listAllContent({ limit: 1000 });
    const 按id = new Map(全.map((x) => [x.id, x]));

    // 标签路径：多级链必须完整且顺序正确
    expect(按id.get(笔记.id)!.tagPaths).toEqual([["根", "中", "叶"]]);
    // 多标签：两个标签各自一条路径
    expect(按id.get(片段.id)!.tagPaths).toHaveLength(2);
    expect(按id.get(片段.id)!.tagPaths).toContainEqual(["根"]);

    // 正文：来自各自的 content 表
    expect(按id.get(笔记.id)!.content).toBe("笔记正文");
    expect(按id.get(片段.id)!.content).toBe("片段正文");

    // 资源：resourceId / path / realName 都要对得上
    const 文件条目 = 全.find((x) => x.id === 文件节点.id)!;
    expect(文件条目).toBeDefined();
    expect(文件条目.resourceId).not.toBeNull();
    expect(文件条目.path).toBe(文件);
    expect(文件条目.realName).toBe("资料.txt");
    expect(文件条目.载体).toBe("外部文件");

    // 与逐条接口对账（防批量实现偏移）
    expect(按id.get(笔记.id)!.tagIds.sort()).toEqual(mkg.getNodeTags(笔记.id).map((t) => t.id).sort());
    expect(按id.get(笔记.id)!.tagPaths[0]).toEqual(mkg.获取标签路径(叶.id));
  });

  it("listAllContent 磁盘已变更只对返回集检查（limit 后）", async () => {
    const 文件 = 造文件("a.txt", "原始");
    await mkg.index(文件, { maxDepth: 0 });
    const 节点 = mkg.listNodes("file").items[0];
    // 未改动：不应标记变更
    let 条目 = mkg.listAllContent().find((x) => x.id === 节点.id)!;
    expect(条目.磁盘已变更).toBe(false);
    // 外部改动（mtime 前推）
    const now = new Date(Date.now() + 60000);
    utimesSync(文件, now, now);
    条目 = mkg.listAllContent().find((x) => x.id === 节点.id)!;
    expect(条目.磁盘已变更).toBe(true);
  });

  it("noTag 只返回无标签内容", () => {
    const a = mkg.createNote("有标签", "x");
    mkg.createNote("无标签", "y");
    const t = mkg.createTag("T");
    mkg.setNodeTags(a.id, [t.id]);
    const 结果 = mkg.listAllContent({ noTag: true });
    expect(结果.map((x) => x.name)).toEqual(["无标签"]);
  });

  it("searchNodes 搜索标题与正文（返回 title 字段）", () => {
    mkg.createNote("会议纪要", "讨论了预算问题");
    const 结果 = mkg.searchNodes("预算");
    expect(结果.items.map((x) => x.title)).toContain("会议纪要");
  });

  it("getNodeTags / setNodeTags / tagNode / untagNode", () => {
    const t1 = mkg.createTag("T1");
    const t2 = mkg.createTag("T2");
    const n = mkg.createNote("节点", "x");
    mkg.setNodeTags(n.id, [t1.id]);
    expect(mkg.getNodeTags(n.id).map((t) => t.name)).toEqual(["T1"]);
    mkg.tagNode(n.id, t2.id);
    expect(mkg.getNodeTags(n.id)).toHaveLength(2);
    mkg.untagNode(n.id, t1.id);
    expect(mkg.getNodeTags(n.id).map((t) => t.name)).toEqual(["T2"]);
  });
});

describe("笔记：CRUD", () => {
  it("创建 / 读取 / 列表 / 更新 / 删除", () => {
    const n = mkg.createNote("标题", "内容");
    expect(mkg.getNote(n.id)?.title).toBe("标题");
    expect(mkg.listNotes()).toHaveLength(1);
    const 更新 = mkg.updateNote(n.id, { title: "新标题", content: "新内容" });
    expect(更新?.title).toBe("新标题");
    expect(更新?.content).toBe("新内容");
    mkg.deleteNote(n.id);
    expect(mkg.getNote(n.id)).toBeUndefined();
    expect(mkg.listNotes()).toHaveLength(0);
  });

  it("创建时可带标签", () => {
    const t = mkg.createTag("标签");
    const n = mkg.createNote("带标签笔记", "x", [t.id]);
    expect(mkg.getNodeTags(n.id).map((x) => x.name)).toEqual(["标签"]);
  });
});

describe("素材：CRUD（含来源 / 图片 URL）", () => {
  it("真列化：字段落真列，可按 sourceUrl 检索", () => {
    const m = mkg.createMaterial({
      title: "真列A", content: "x", kind: "article",
      sourceUrl: "https://same.com/x", imageUrl: "https://same.com/a.png",
    });
    const 命中 = mkg.listMaterialsBySourceUrl("https://same.com/x");
    expect(命中.map((x) => x.id)).toEqual([m.id]);
    expect(命中[0].kind).toBe("article");
    expect(命中[0].imageUrl).toBe("https://same.com/a.png");
    expect(mkg.listMaterialsBySourceUrl("https://nope.com")).toEqual([]);
  });

  it("创建 / 读取 / 列表 / 更新 / 删除", () => {
    const m = mkg.createMaterial({ title: "素材", content: "描述", sourceUrl: "https://a.com" });
    expect(mkg.getMaterial(m.id)?.title).toBe("素材");
    expect(mkg.listMaterials()).toHaveLength(1);
    const 更新 = mkg.updateMaterial(m.id, { title: "新素材", sourceUrl: "https://b.com" });
    expect(更新?.title).toBe("新素材");
    expect(更新?.sourceUrl).toBe("https://b.com");
    mkg.deleteMaterial(m.id);
    expect(mkg.getMaterial(m.id)).toBeUndefined();
  });




});

describe("文本片段：CRUD", () => {
  it("创建 / 读取 / 列表 / 更新 / 删除", () => {
    const s = mkg.createSnippet("片段", "一段文本");
    expect(mkg.getSnippet(s.id)?.content).toBe("一段文本");
    expect(mkg.listSnippets()).toHaveLength(1);
    const 更新 = mkg.updateSnippet(s.id, { content: "改后文本" });
    expect(更新?.content).toBe("改后文本");
    mkg.deleteSnippet(s.id);
    expect(mkg.getSnippet(s.id)).toBeUndefined();
  });
});

describe("AIGC：AI 生成内容（agent_id 隔离）", () => {
  it("创建 / 读取 / 列表 / 更新 / 删除", () => {
    const a = mkg.createAigc("agent-1", "AI 笔记", "# 标题\n内容");
    expect(mkg.getAigc("agent-1", a.id)?.content).toBe("# 标题\n内容");
    expect(mkg.listAigcByAgent("agent-1")).toHaveLength(1);
    const 更新 = mkg.updateAigc("agent-1", a.id, { content: "改后" });
    expect(更新?.content).toBe("改后");
    mkg.deleteAigc("agent-1", a.id);
    expect(mkg.getAigc("agent-1", a.id)).toBeUndefined();
  });

  it("agent 隔离：A 读不到 B 的 aigc", () => {
    const a = mkg.createAigc("agent-A", "A 的笔记", "A 内容");
    expect(mkg.getAigc("agent-B", a.id)).toBeUndefined();
    expect(mkg.listAigcByAgent("agent-B")).toHaveLength(0);
  });

  it("agent 隔离：A 删不掉 B 的 aigc", () => {
    const a = mkg.createAigc("agent-A", "A 的笔记", "A 内容");
    mkg.deleteAigc("agent-B", a.id);
    expect(mkg.getAigc("agent-A", a.id)).toBeDefined();
  });

  it("aigc 参与统一内容浏览，分类为文本段", () => {
    mkg.createAigc("agent-1", "AI 生成", "正文");
    const 条目 = mkg.listAllContent().find((x) => x.name === "AI 生成");
    expect(条目).toBeDefined();
    expect(条目?.category).toBe("文本段");
    expect(条目?.载体).toBe("库内");
  });
});

describe("AI 可读内容：listAiReadable（opt-in）", () => {
  it("默认全不可读（无 ai_public 标签）", () => {
    mkg.createNote("私密笔记", "秘密内容");
    expect(mkg.listAiReadable()).toHaveLength(0);
  });

  it("打 ai_public 标签后可读，未打不可读", () => {
    const 公开 = mkg.createTag("AI公开");
    mkg.setTagAiPublic(公开.id, true);
    const 笔记 = mkg.createNote("可读笔记", "公开内容", [公开.id]);
    mkg.createNote("私密笔记", "秘密内容");
    const 结果 = mkg.listAiReadable();
    expect(结果.map((x) => x.name)).toEqual(["可读笔记"]);
    expect(结果[0].content).toBe("公开内容");
  });

  it("父标签 ai_public 时后代标签内容也可读", () => {
    const 父 = mkg.createTag("公开父");
    mkg.setTagAiPublic(父.id, true);
    const 子 = mkg.createTag("公开子", 父.id);
    mkg.createNote("子标签笔记", "内容", [子.id]);
    expect(mkg.listAiReadable().map((x) => x.name)).toEqual(["子标签笔记"]);
  });

  it("aigc 类型不进入 listAiReadable（走 listAigcByAgent）", () => {
    const 公开 = mkg.createTag("公开");
    mkg.setTagAiPublic(公开.id, true);
    mkg.createAigc("agent-1", "AI 写的东西", "内容", [公开.id]);
    expect(mkg.listAiReadable()).toHaveLength(0);
  });

  it("关键词过滤在可读范围内生效", () => {
    const 公开 = mkg.createTag("公开");
    mkg.setTagAiPublic(公开.id, true);
    mkg.createNote("番茄炒蛋", "食谱", [公开.id]);
    mkg.createNote("红烧肉", "食谱", [公开.id]);
    expect(mkg.listAiReadable({ keyword: "番茄" }).map((x) => x.name)).toEqual(["番茄炒蛋"]);
  });
});

describe("看板：列 + 卡片 CRUD", () => {
  it("列的创建 / 列表 / 更新 / 删除", () => {
    const c1 = mkg.createColumn("待办");
    const c2 = mkg.createColumn("进行中");
    expect(mkg.listColumns().map((c) => c.name)).toEqual(["待办", "进行中"]);
    const 更新 = mkg.updateColumn(c1.id, { name: "已排期" });
    expect(更新?.name).toBe("已排期");
    mkg.deleteColumn(c2.id);
    expect(mkg.listColumns()).toHaveLength(1);
  });

  it("卡片的创建 / 列表（可按列筛选）/ 更新 / 删除", () => {
    const 列 = mkg.createColumn("待办");
    const c1 = mkg.createCard({ title: "卡片1", columnId: 列.id });
    mkg.createCard({ title: "卡片2" });
    expect(mkg.listCards()).toHaveLength(2);
    expect(mkg.listCards(列.id).map((x) => x.title)).toEqual(["卡片1"]);
    const 更新 = mkg.updateCard(c1.id, { title: "卡片1改", columnId: null });
    expect(更新?.title).toBe("卡片1改");
    mkg.deleteCard(c1.id);
    expect(mkg.getCard(c1.id)).toBeUndefined();
  });

  it("看板卡片不参与统一内容浏览", () => {
    const 列 = mkg.createColumn("待办");
    mkg.createCard({ title: "卡片", columnId: 列.id });
    expect(mkg.listAllContent().map((x) => x.name)).not.toContain("卡片");
  });
});

describe("保存视图（智能文件夹）：save / list / get / run / delete", () => {
  it("保存 / 列出 / 读取 / 删除", () => {
    const v = mkg.添加保存视图("我的视图", { keyword: "x" }, "star");
    expect(mkg.列出保存视图().map((x) => x.name)).toEqual(["我的视图"]);
    expect(mkg.获取保存视图(v.id)?.icon).toBe("star");
    mkg.删除保存视图(v.id);
    expect(mkg.列出保存视图()).toHaveLength(0);
  });

  it("执行查询按条件返回内容（关键词字段为 text）", () => {
    mkg.createNote("番茄", "x");
    mkg.createNote("黄瓜", "y");
    const 结果 = mkg.执行查询({ text: "番茄" });
    expect(结果.map((x) => x.name)).toEqual(["番茄"]);
  });
});

describe("受管位置：add / list / remove", () => {
  it("添加 / 列出 / 删除", () => {
    const p = mkg.添加位置(join(目录, "watch"), "监视目录");
    expect(mkg.列出位置().map((x) => x.path)).toContain(p.path);
    mkg.删除位置(p.id);
    expect(mkg.列出位置()).toHaveLength(0);
  });
});

describe("打开方式：set / get / list / delete（WebUI 依赖）", () => {
  it("设置 / 读取 / 列出 / 删除", () => {
    const cfg = mkg.setOpenWith(".md", "C:/notepad.exe", "-n", "记事本");
    expect(cfg.extension).toBe(".md");
    expect(mkg.getOpenWith(".md")?.programPath).toBe("C:/notepad.exe");
    expect(mkg.listOpenWith()).toHaveLength(1);
    mkg.deleteOpenWith(cfg.id);
    expect(mkg.listOpenWith()).toHaveLength(0);
  });

  it("同扩展名重复设置应更新而非新增", () => {
    mkg.setOpenWith(".md", "C:/a.exe");
    mkg.setOpenWith(".md", "C:/b.exe");
    const 列表 = mkg.listOpenWith().filter((x) => x.extension === ".md");
    expect(列表).toHaveLength(1);
    expect(列表[0].programPath).toBe("C:/b.exe");
  });
});

describe("侧车（sidecar）：读 / 写 / 合并 / 信息 / 导出 / 导入", () => {
  it("写入 / 读取 / 合并 / 信息", () => {
    const 路径 = join(目录, "note.md");
    mkg.写入侧车(路径, { tags: ["A"], note: "第一条" });
    expect(mkg.读取侧车(路径)?.note).toBe("第一条");
    mkg.合并侧车(路径, { note: "改后" });
    expect(mkg.读取侧车(路径)?.note).toBe("改后");
    expect(mkg.侧车信息(路径).exists).toBe(true);
  });

  it("导出侧车（文件节点写入同目录侧车文件）", async () => {
    const t = mkg.createTag("导出标签");
    const 全路径 = 造文件("export.md", "正文");
    await mkg.index(全路径, { maxDepth: 0 });
    const 节点 = mkg.listNodes("file").items[0];
    mkg.setNodeTags(节点.id, [t.id]);
    const 数据 = mkg.导出侧车(节点.id);
    expect(数据?.tags).toContain("导出标签");
    // 侧车文件应真实落盘
    expect(mkg.侧车信息(全路径).exists).toBe(true);
  });
});

describe("全文检索（FTS）", () => {
  it("重建索引并检索", () => {
    mkg.createNote("深度学习笔记", "卷积神经网络的反向传播");
    const { 节点数 } = mkg.重建全文索引();
    expect(节点数).toBeGreaterThanOrEqual(1);
    const 结果 = mkg.全文检索("反向传播");
    expect(结果.map((x) => x.name)).toContain("深度学习笔记");
  });

  it("检索无结果时返回空数组", () => {
    mkg.createNote("无关", "内容");
    mkg.重建全文索引();
    expect(mkg.全文检索("不存在的关键词xyz")).toEqual([]);
  });
});

describe("统计：getStats", () => {
  it("返回各类计数", () => {
    mkg.createTag("T");
    mkg.createNote("N", "x");
    const s = mkg.getStats();
    expect(s.标签数).toBe(1);
    expect(typeof s.资源总数).toBe("number");
  });

  it("数据库大小按 page_count×page_size 计算（不再硬编码 0）", () => {
    mkg.createNote("大小", "内容");
    const s = mkg.getStats();
    expect(s.数据库大小).toBeGreaterThan(0);
  });

  it("关联数统计 node_relations（节点关系表）", () => {
    // 关系层已迁移到节点维度：addRelation 写 node_relations
    const a = mkg.createNote("关系A", "x");
    const b = mkg.createNote("关系B", "y");
    mkg.addRelation(a.id, b.id, "references");
    const s = mkg.getStats();
    expect(s.关联数).toBe(1);
  });
});

describe("节点关系：addRelation / getRelations（node 维度）", () => {
  it("建立关系并按节点 id 查询（含类型过滤）", () => {
    const a = mkg.createNote("源", "x");
    const b = mkg.createNote("目标", "y");
    mkg.addRelation(a.id, b.id, "references");
    // 无过滤：返回全部关系
    const 全部 = mkg.getRelations(a.id);
    expect(全部).toEqual([{ toNodeId: b.id, relationType: "references" }]);
    // 按类型过滤
    expect(mkg.getRelations(a.id, "references")).toHaveLength(1);
    expect(mkg.getRelations(a.id, "similar")).toHaveLength(0);
  });

  it("重复建立同关系去重（INSERT OR IGNORE）", () => {
    const a = mkg.createNote("重源", "x");
    const b = mkg.createNote("重目标", "y");
    mkg.addRelation(a.id, b.id, "contains");
    mkg.addRelation(a.id, b.id, "contains");
    expect(mkg.getRelations(a.id, "contains")).toHaveLength(1);
  });

  it("getRelations 对不存在的节点返回空数组", () => {
    expect(mkg.getRelations(999999)).toEqual([]);
  });
});

describe("资源详情：getResourceDetail / listResourcesDetail / listResourcesByTagDetail", () => {
  it("详情含标签路径与扩展名", () => {
    const 父 = mkg.createTag("技术");
    const 子 = mkg.createTag("前端", 父.id);
    const r = mkg.createResource("detail.ts", "detail.ts", "file");
    mkg.tagResource(r.id, 子.id);
    const 详情 = mkg.getResourceDetail(r.id);
    expect(详情?.extension).toBe(".ts");
    expect(详情?.tagPaths.some((p) => p.includes("前端"))).toBe(true);
  });

  it("列表详情与按标签列表详情", () => {
    const t = mkg.createTag("列表标签");
    const r = mkg.createResource("l.txt", "l.txt", "file");
    mkg.tagResource(r.id, t.id);
    expect(mkg.listResourcesDetail({ limit: 10 }).items).toHaveLength(1);
    expect(mkg.listResourcesByTagDetail(t.id).items).toHaveLength(1);
  });
});

/**
 * WebUI 消费的返回形状契约（数据级）
 *
 * 这里固化 WebUI 各界面从 `mkg.*` 请求拿到的返回结构，
 * 防止「后端改了返回形状、前端仍按旧形状解析」这类只能在运行时暴露的问题。
 * （历史缺陷：`mkg.file.physicalPath` 返回裸字符串，前端却按 `{ path }` 解构。）
 */
describe("记事（看板）：卡片颜色 / 排序 / 列表顺序", () => {
  it("卡片支持 color 与 sort，并在列表中按 sort 排序", () => {
    const 列 = mkg.createColumn("待办");
    const c1 = mkg.createCard({ title: "A", content: "a", columnId: 列.id, color: "#e05d5d", sort: 5 });
    const c2 = mkg.createCard({ title: "B", content: "b", columnId: 列.id, sort: 1 });
    expect(c1.color).toBe("#e05d5d");
    expect(c1.sort).toBe(5);
    const 列表 = mkg.listCards().filter((c) => c.columnId === 列.id);
    expect(列表.map((c) => c.title)).toEqual(["B", "A"]);
    expect(c2.sort).toBe(1);
  });

  it("updateCard 可改颜色与排序", () => {
    const c = mkg.createCard({ title: "C", content: "c" });
    const 改 = mkg.updateCard(c.id, { color: "#5aa9e6", sort: 9 });
    expect(改.color).toBe("#5aa9e6");
    expect(改.sort).toBe(9);
    const 读取 = mkg.getCard(c.id)!;
    expect(读取.color).toBe("#5aa9e6");
    expect(读取.sort).toBe(9);
  });
});

describe("工作区：只引用库内节点，不存资源数据", () => {
  it("创建工作区 / 列出 / 更新 / 删除", () => {
    const ws = mkg.创建工作区("分析画布");
    expect(ws.name).toBe("分析画布");
    expect(mkg.列出工作区().map((w) => w.id)).toContain(ws.id);
    const 改 = mkg.更新工作区(ws.id, { name: "分析画布 2" })!;
    expect(改.name).toBe("分析画布 2");
    mkg.删除工作区(ws.id);
    expect(mkg.列出工作区().map((w) => w.id)).not.toContain(ws.id);
  });

  it("添加 / 列出 / 更新 / 删除放置项", () => {
    const ws = mkg.创建工作区("摆放");
    const 笔记 = mkg.createNote("工作区引用", "内容");
    const it = mkg.添加放置项(ws.id, 笔记.id, { x: 30, y: 40, width: 200, height: 150 });
    expect(it.nodeId).toBe(笔记.id);
    expect(it.x).toBe(30);

    const 列出 = mkg.列出放置项(ws.id);
    expect(列出).toHaveLength(1);

    const 改 = mkg.更新放置项(it.id, { x: 99, color: "#6fbf73", note: "重点" })!;
    expect(改.x).toBe(99);
    expect(改.color).toBe("#6fbf73");
    expect(改.note).toBe("重点");

    mkg.删除放置项(it.id);
    expect(mkg.列出放置项(ws.id)).toHaveLength(0);
  });

  it("删除工作区不会删除被引用的节点", () => {
    const ws = mkg.创建工作区("临时");
    const 笔记 = mkg.createNote("不应被删", "内容");
    mkg.添加放置项(ws.id, 笔记.id, { x: 0, y: 0 });
    mkg.删除工作区(ws.id);
    expect(mkg.列出放置项(ws.id)).toHaveLength(0);
    // 笔记本身仍然存在
    const 全部 = mkg.listAllContent();
    expect(全部.map((x) => x.id)).toContain(笔记.id);
  });

  it("清空放置项保留工作区", () => {
    const ws = mkg.创建工作区("清空测试");
    const a = mkg.createNote("A", "a");
    const b = mkg.createNote("B", "b");
    mkg.添加放置项(ws.id, a.id, { x: 0, y: 0 });
    mkg.添加放置项(ws.id, b.id, { x: 10, y: 10 });
    expect(mkg.列出放置项(ws.id)).toHaveLength(2);
    mkg.清空放置项(ws.id);
    expect(mkg.列出放置项(ws.id)).toHaveLength(0);
    expect(mkg.列出工作区().map((w) => w.id)).toContain(ws.id);
  });
});

describe("WebUI 返回形状契约", () => {
  it("mkg.file.physicalPath 返回裸字符串路径（不是 {path}）", async () => {
    const p = 造文件("契约/a.txt");
    await mkg.index(p, { maxDepth: 0 });
    const r = mkg.getResource(p)!;
    const 路径 = mkg.getPhysicalPath(r.id);
    expect(typeof 路径).toBe("string");
    expect(路径).toBe(p);
  });

  it("mkg.tag.createTree 接受 names[] 并创建层级标签", () => {
    // UI 传 { names: ["工作","灵感"] }；对应 MKG.createTagTree(names)
    const 末级 = mkg.createTagTree(["工作", "灵感"]);
    expect(末级.name).toBe("灵感");
    const 根 = mkg.listTags().find((t) => t.name === "工作");
    expect(根).toBeDefined();
    expect(末级.parentId).toBe(根!.id);
  });

  it("mkg.tag.tree 每节点含 id/name/children/count", () => {
    const t = mkg.createTag("树契约");
    const r = mkg.createResource("契约/tree.txt", "tree.txt", "file");
    mkg.tagResource(r.id, t.id);
    const 树 = mkg.获取动态标签树();
    const 节点 = 树.find((n) => n.name === "树契约")!;
    expect(节点).toMatchObject({ id: t.id, name: "树契约" });
    expect(Array.isArray(节点.children)).toBe(true);
    expect(节点.count).toBe(1);
  });

  it("mkg.stats 返回中文字段名计数", () => {
    const s = mkg.getStats();
    for (const k of ["资源总数", "文件数", "目录数", "标签数", "关联数", "文本内容数"]) {
      expect(typeof (s as Record<string, unknown>)[k]).toBe("number");
    }
  });

  it("mkg.view.run 返回 { view, items }", () => {
    const t = mkg.createTag("视图契约");
    mkg.createNote("视图契约笔记", "内容");
    const 笔记 = mkg.listNotes()[0];
    mkg.setNodeTags(笔记.id, [t.id]);
    const v = mkg.添加保存视图("契约视图", { tags: [t.id] });
    const 运行 = { view: mkg.获取保存视图(v.id), items: mkg.执行查询(v.query) };
    expect(运行.view?.name).toBe("契约视图");
    expect(运行.items.map((x) => x.id)).toContain(笔记.id);
  });

  it("mkg.fts.rebuild 返回 { 节点数 }", () => {
    mkg.createNote("FTS契约", "内容");
    const r = mkg.重建全文索引();
    expect(typeof r.节点数).toBe("number");
  });

  it("mkg.file.isText 相关判定可用扩展名推断（后端契约）", async () => {
    const p = 造文件("契约/code.ts", "export const x = 1;");
    await mkg.index(p, { maxDepth: 0 });
    const r = mkg.getResource(p)!;
    expect(mkg.获取扩展名(r.name)).toBe(".ts");
    expect(mkg.推断MimeType(".ts")).toBe("text/javascript");
  });
});

describe("磁盘一致性：sha256 校验与载体标记", () => {
  function 哈希(p: string): string {
    return createHash("sha256").update(readFileSync(p)).digest("hex");
  }

  it("磁盘哈希返回当前文件哈希；文件不存在返回 null", async () => {
    const p = 造文件("一致/a.txt", "hello");
    await mkg.index(p, { maxDepth: 0 });
    const r = mkg.getResource(p)!;
    expect(mkg.磁盘哈希(r.id)).toBe(哈希(p));
    // 删除后返回 null
    rmSync(p);
    expect(mkg.磁盘哈希(r.id)).toBeNull();
  });

  it("校验磁盘未变更：哈希一致时不抛错，不一致时抛错", async () => {
    const p = 造文件("一致/b.txt", "原始内容");
    await mkg.index(p, { maxDepth: 0 });
    const r = mkg.getResource(p)!;
    const 原始哈希 = 哈希(p);
    // 一致：不抛错
    expect(() => mkg.校验磁盘未变更(r.id, 原始哈希)).not.toThrow();
    // 外部改动
    writeFileSync(p, "被外部改了", "utf-8");
    expect(() => mkg.校验磁盘未变更(r.id, 原始哈希)).toThrow(/外部/);
  });

  it("listAllContent 对外部文件标记载体=外部文件与磁盘已变更", async () => {
    const p = 造文件("一致/c.txt", "内容");
    await mkg.index(p, { maxDepth: 0 });
    const 条目 = mkg.listAllContent().find((x) => x.path === p)!;
    expect(条目.载体).toBe("外部文件");
    expect(条目.磁盘已变更).toBe(false);
    // 显式把文件 mtime 拨到未来，让「磁盘比索引后更新」确定可测，
    // 而非依赖真实写文件的秒级 mtime（同一秒内写入会被秒级截断吞掉）。
    const 未来 = new Date();
    未来.setSeconds(未来.getSeconds() + 30);
    utimesSync(p, 未来, 未来);
    const 条目2 = mkg.listAllContent().find((x) => x.path === p)!;
    expect(条目2.磁盘已变更).toBe(true);
  });

  it("库内内容载体=库内且磁盘已变更恒为 false", () => {
    mkg.createNote("库内笔记", "内容");
    const 条目 = mkg.listAllContent().find((x) => x.name === "库内笔记")!;
    expect(条目.载体).toBe("库内");
    expect(条目.磁盘已变更).toBe(false);
    expect(条目.同步时间).toBeNull();
  });
});

describe("索引文本读取：readContent / readContentByNode（node 维度统一）", () => {
  it("三种定位方式（nodeId/resourceId/path）读到同一份索引文本", async () => {
    // 关键 guard：node 与 resource 是两个独立自增序列，id 可能碰巧相同。
    // 若两者相等，按 node 查询误写成按 resource 查询会假绿。
    // 故先创建若干 note（只推 node 序列，不推 resource 序列），
    // 确保后续 file 节点的 node.id > resource.id，两者必然不同。
    for (let i = 0; i < 5; i++) mkg.createNote(`推进节点序列${i}`, "x");
    const p = 造文件("索引文本/a.txt", "这是一段被索引的文本");
    await mkg.index(p, { maxDepth: 0 });
    const 资源 = mkg.getResource(p)!;
    const 节点 = mkg.listNodes("file").items.find((n) => n.resourceId === 资源.id)!;
    expect(节点.id).not.toBe(资源.id);
    const 按路径 = mkg.readContent(p);
    const 按资源 = mkg.readContent(资源.id);
    const 按节点 = mkg.readContentByNode(节点.id);
    expect(按路径).toBe("这是一段被索引的文本");
    expect(按资源).toBe(按路径);
    expect(按节点).toBe(按路径);
  });

  it("readContentByNode 对不存在的节点返回 null", () => {
    expect(mkg.readContentByNode(999999)).toBeNull();
  });

  it("readContent 对无索引文本的资源返回 null", async () => {
    // 二进制文件（如图片）不会被 indexer 写 text_contents
    const p = 造文件("索引文本/bin.dat", "\x00\x01\x02");
    await mkg.index(p, { maxDepth: 0 });
    const 资源 = mkg.getResource(p)!;
    expect(mkg.readContent(资源.id)).toBeNull();
  });
});
