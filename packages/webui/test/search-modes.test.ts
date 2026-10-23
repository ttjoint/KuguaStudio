/**
 * 分层检索：模式契约与筛选语义
 *
 * 背景：原来只有一个搜索框，走 mkg.query 的 LIKE '%词%'。
 * 标题里没这几个连续字就搜不到，但全文索引里明明有这段内容。
 * 现在分三种模式：全文（FTS5）/ 标题 / 标签。
 *
 * WebUI 测试跑在 Node 环境（无 DOM），所以这里检查源码契约 +
 * 独立验证「标签名筛选」的纯逻辑。
 */
import { describe, expect, it } from "vitest";
import { existsSync, readFileSync } from "node:fs";
import { resolve } from "node:path";

const 根 = resolve(process.cwd(), "packages/webui");
function 读(相对: string): string {
  const p = resolve(根, 相对);
  if (!existsSync(p)) throw new Error(`找不到：${p}`);
  return readFileSync(p, "utf-8");
}

const 探索器源 = () => 读("src/renderer/parts/07-explorer.ts");
const 页面源 = () => 读("src/renderer/index.html");

describe("分层检索：源码契约", () => {
  it("HTML 提供三个检索模式按钮", () => {
    const 源 = 页面源();
    expect(源).toContain('data-searchmode="full"');
    expect(源).toContain('data-searchmode="title"');
    expect(源).toContain('data-searchmode="tag"');
  });

  it("全文模式调用 mkg.fts.search（而不是 mkg.query）", () => {
    const 源 = 探索器源();
    const 全文段 = 源.slice(源.indexOf('检索模式 === "full" && 词'), 源.indexOf("const condition"));
    expect(全文段).toContain('"mkg.fts.search"');
    expect(全文段).not.toContain('"mkg.query"');
  });

  it("全文模式仍应用本地筛选（类型/标签/排序语义一致）", () => {
    const 源 = 探索器源();
    const 全文段 = 源.slice(源.indexOf('检索模式 === "full" && 词'), 源.indexOf("const condition"));
    expect(全文段).toContain("应用本地筛选(");
  });

  it("筛选内容() 在全文/标签模式下不再按关键词二次过滤", () => {
    const 源 = 探索器源();
    // 关键守卫：只有 title 模式才做 name/path 匹配
    expect(源).toContain('if (kw && 检索模式 === "title")');
  });

  it("筛选内容() 不再用 content 做二次匹配（FTS 已负责正文）", () => {
    const 源 = 探索器源();
    const 函数体 = 源.slice(源.indexOf("export function 筛选内容()"), 源.indexOf("export function 筛选内容()") + 900);
    expect(函数体).not.toContain("it.content.toLowerCase()");
  });

  it("切换模式会更新 placeholder（告诉用户在搜什么）", () => {
    const 源 = 探索器源();
    expect(源).toContain("搜索标题与正文...");
    expect(源).toContain("只搜标题...");
    expect(源).toContain("按标签名搜...");
  });
});

describe("标签名筛选逻辑", () => {
  /** 复刻 07-explorer.ts 里的 按标签名筛选 实现，独立验证 */
  interface 项 {
    id: number;
    tagPaths: string[][];
  }
  function 按标签名筛选(列表: 项[], 词: string): 项[] {
    const 小写 = 词.toLowerCase();
    return 列表.filter((项) =>
      (项.tagPaths ?? []).some((路径) => 路径.some((段) => 段.toLowerCase().includes(小写))),
    );
  }

  const 数据: 项[] = [
    { id: 1, tagPaths: [["种植", "番茄"]] },
    { id: 2, tagPaths: [["养殖", "鸡"]] },
    { id: 3, tagPaths: [] },
    { id: 4, tagPaths: [["种植"], ["内部资料"]] },
  ];

  it("匹配叶标签名", () => {
    expect(按标签名筛选(数据, "番茄").map((x) => x.id)).toEqual([1]);
  });

  it("匹配祖先标签名（路径任一段）", () => {
    expect(按标签名筛选(数据, "种植").map((x) => x.id)).toEqual([1, 4]);
  });

  it("大小写不敏感", () => {
    const 英: 项[] = [{ id: 9, tagPaths: [["Tomato"]] }];
    expect(按标签名筛选(英, "tomato").map((x) => x.id)).toEqual([9]);
  });

  it("无标签的内容不会被误命中", () => {
    expect(按标签名筛选(数据, "番茄").map((x) => x.id)).not.toContain(3);
  });

  it("空标签路径安全（不抛错）", () => {
    expect(() => 按标签名筛选(数据, "任意")).not.toThrow();
  });

  it("多路径内容任一命中即返回", () => {
    expect(按标签名筛选(数据, "内部资料").map((x) => x.id)).toEqual([4]);
  });
});
