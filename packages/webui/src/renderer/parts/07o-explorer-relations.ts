// ===== 内容关联（引用/包含/相似）=====
//
// 为什么需要：知识库的核心价值不只是「找得到」，更是「连得上」。
// 后端 mkg.relation.add / mkg.relation.list 早已实现（三种语义关系），
// 但界面一直没有入口——这条能力完全被浪费。
//
// 本模块在详情栏提供：
// - 按类型分组展示当前内容的关联（引用/包含/相似）
// - 点击关联项跳转到该内容
// - 「＋」建立新关联（选目标 + 选类型）
import { Explorer } from "./07-explorer";
import { 添加消息 } from "./03-preview";
import { 更新内容信息面板 } from "./07j-explorer-tags";

type 关系类型 = "contains" | "references" | "similar";

/** 关系类型的中文名与图标 */
const 关系元信息: Record<关系类型, { 名称: string; 图标: string; 说明: string }> = {
  contains: { 名称: "包含", 图标: "📦", 说明: "本条内容包含对方" },
  references: { 名称: "引用", 图标: "🔗", 说明: "本条内容引用了对方" },
  similar: { 名称: "相似", 图标: "≈", 说明: "与本条内容相似" },
};

interface 关联项 {
  toNodeId: number;
  relationType: 关系类型;
}

/** 当前内容 id（避免异步渲染错位） */
let 渲染中的节点ID: number | null = null;

/** 清空关联区（无选中内容时） */
export function 清空关联(): void {
  const 容器 = document.getElementById("ex-info-relations");
  if (容器) 容器.innerHTML = "";
  const 加号 = document.getElementById("ex-info-relation-add") as HTMLButtonElement | null;
  if (加号) 加号.disabled = true;
}

/**
 * 渲染当前内容的关联列表。
 *
 * 按关系类型分组，每组可折叠；点击条目跳转到目标内容。
 */
export async function 渲染关联(nodeId: number): Promise<void> {
  const 容器 = document.getElementById("ex-info-relations");
  const 加号 = document.getElementById("ex-info-relation-add") as HTMLButtonElement | null;
  if (!容器) return;
  if (加号) 加号.disabled = false;

  渲染中的节点ID = nodeId;
  容器.innerHTML = "";
  const 加载中 = document.createElement("div");
  加载中.className = "ex-info-relation-empty";
  加载中.textContent = "加载中…";
  容器.appendChild(加载中);

  let 列表: 关联项[] = [];
  try {
    列表 = (await window.kugua.request("mkg", "mkg.relation.list", { nodeId })) as 关联项[];
  } catch (err) {
    // 异步返回时用户可能已切到别的条目，此时静默丢弃
    if (渲染中的节点ID !== nodeId) return;
    容器.innerHTML = "";
    const 失败 = document.createElement("div");
    失败.className = "ex-info-relation-empty";
    失败.textContent = "关联加载失败";
    容器.appendChild(失败);
    void err;
    return;
  }
  // 关键：请求期间用户可能已切换内容，不能把旧结果画到新条目上
  if (渲染中的节点ID !== nodeId) return;

  容器.innerHTML = "";

  if (列表.length === 0) {
    const 空 = document.createElement("div");
    空.className = "ex-info-relation-empty";
    空.textContent = "暂无关联。点右上角 ＋ 建立引用/包含/相似关系。";
    容器.appendChild(空);
    return;
  }

  // 按类型分组
  const 分组 = new Map<关系类型, number[]>();
  for (const r of 列表) {
    const 组 = 分组.get(r.relationType);
    if (组) 组.push(r.toNodeId);
    else 分组.set(r.relationType, [r.toNodeId]);
  }

  for (const [类型, 目标列表] of 分组) {
    const 元 = 关系元信息[类型] ?? { 名称: 类型, 图标: "•", 说明: "" };
    const 组盒 = document.createElement("div");
    组盒.className = "ex-info-relation-group";

    const 组头 = document.createElement("div");
    组头.className = "ex-info-relation-head";
    组头.title = 元.说明;
    const 折叠 = document.createElement("span");
    折叠.className = "ex-toggle";
    折叠.textContent = "▼";
    组头.appendChild(折叠);
    const 组名 = document.createElement("span");
    组名.textContent = `${元.图标} ${元.名称} (${目标列表.length})`;
    组头.appendChild(组名);
    组盒.appendChild(组头);

    const 组体 = document.createElement("div");
    组体.className = "ex-info-relation-body";
    for (const 目标ID of 目标列表) {
      const 项 = document.createElement("div");
      项.className = "ex-info-relation-item";
      项.dataset.nodeId = String(目标ID);
      项.textContent = `#${目标ID}`;
      项.title = "点击跳转到该内容";
      项.addEventListener("click", () => void 跳转并选中(目标ID));
      组体.appendChild(项);
      // 名称异步补（批量接口没有，逐条取；数量通常很小）
      void 补名称(项, 目标ID, nodeId);
    }
    组盒.appendChild(组体);

    // 折叠/展开
    组头.addEventListener("click", () => {
      const 收起 = 组体.classList.toggle("hidden");
      折叠.textContent = 收起 ? "▶" : "▼";
    });

    容器.appendChild(组盒);
  }
}

/** 给关联项补上内容名称（失败就保留 #id） */
async function 补名称(元素: HTMLElement, 目标ID: number, 当前ID: number): Promise<void> {
  try {
    const 节点 = (await window.kugua.request("mkg", "mkg.node.get", { id: 目标ID })) as {
      name?: string;
      title?: string;
    } | null;
    if (渲染中的节点ID !== 当前ID) return;
    const 名 = 节点?.name ?? 节点?.title ?? "";
    if (名) 元素.textContent = 名;
  } catch {
    /* 取不到名称就保留 #id */
  }
}

/** 跳转到某条内容并选中它 */
async function 跳转并选中(nodeId: number): Promise<void> {
  try {
    // 用 node.get（返回完整内容条目），而不是 mkg.query——
    // 查询条件的 查询条件 接口没有 nodeIds 字段，用它取不到。
    const 命中 = (await window.kugua.request("mkg", "mkg.node.get", { id: nodeId })) as Explorer.内容条目 | null;
    if (!命中) {
      添加消息(`未找到内容 #${nodeId}（可能已被删除）`, "error");
      return;
    }
    // 切换到全部标签，确保目标可见
    Explorer.当前标签ID = "all";
    Explorer.选中内容 = 命中;
    Explorer.所有内容 = [命中, ...Explorer.所有内容.filter((x) => x.id !== nodeId)];
    Explorer.渲染内容列表();
    更新内容信息面板();
  } catch (err) {
    添加消息("跳转失败：" + String(err), "error");
  }
}

/** 打开「建立关联」对话框 */
export async function 打开建立关联对话框(): Promise<void> {
  const 当前 = Explorer.选中内容;
  if (!当前) return;

  // 用轻量内联对话框（复用 #context-menu 的样式思路，但不依赖它）
  const 遮罩 = document.createElement("div");
  遮罩.className = "rel-dialog-mask";
  遮罩.innerHTML = "";

  const 框 = document.createElement("div");
  框.className = "rel-dialog";

  const 标题 = document.createElement("div");
  标题.className = "rel-dialog-title";
  标题.textContent = `为「${当前.name}」建立关联`;
  框.appendChild(标题);

  // 目标选择
  const 目标标签 = document.createElement("div");
  目标标签.className = "rel-dialog-label";
  目标标签.textContent = "关联到哪条内容？";
  框.appendChild(目标标签);

  const 搜索框 = document.createElement("input");
  搜索框.type = "text";
  搜索框.className = "rel-dialog-input";
  搜索框.placeholder = "输入标题搜索…（留空列出最近内容）";
  框.appendChild(搜索框);

  const 候选框 = document.createElement("div");
  候选框.className = "rel-dialog-candidates";
  框.appendChild(候选框);

  // 关系类型选择
  const 类型标签 = document.createElement("div");
  类型标签.className = "rel-dialog-label";
  类型标签.textContent = "关系类型";
  框.appendChild(类型标签);

  const 类型行 = document.createElement("div");
  类型行.className = "rel-dialog-types";
  let 选中类型: 关系类型 = "references";
  const 类型按钮: HTMLButtonElement[] = [];
  for (const [键, 元] of Object.entries(关系元信息) as Array<[关系类型, typeof 关系元信息.references]>) {
    const 钮 = document.createElement("button");
    钮.className = "rel-dialog-type" + (键 === 选中类型 ? " active" : "");
    钮.textContent = `${元.图标} ${元.名称}`;
    钮.title = 元.说明;
    钮.addEventListener("click", () => {
      选中类型 = 键;
      类型按钮.forEach((b) => b.classList.toggle("active", b === 钮));
    });
    类型按钮.push(钮);
    类型行.appendChild(钮);
  }
  框.appendChild(类型行);

  // 底部按钮
  const 底部 = document.createElement("div");
  底部.className = "rel-dialog-actions";
  const 取消 = document.createElement("button");
  取消.className = "btn";
  取消.textContent = "取消";
  取消.addEventListener("click", () => 遮罩.remove());
  const 确定 = document.createElement("button");
  确定.className = "btn primary";
  确定.textContent = "建立关联";
  确定.disabled = true;
  底部.appendChild(取消);
  底部.appendChild(确定);
  框.appendChild(底部);

  遮罩.appendChild(框);
  document.body.appendChild(遮罩);

  // 点遮罩关闭
  遮罩.addEventListener("click", (e) => {
    if (e.target === 遮罩) 遮罩.remove();
  });

  let 选中目标: number | null = null;

  const 渲染候选 = (列表: Explorer.内容条目[]): void => {
    候选框.innerHTML = "";
    const 可选 = 列表.filter((x) => x.id !== 当前.id).slice(0, 30);
    if (可选.length === 0) {
      const 空 = document.createElement("div");
      空.className = "rel-dialog-empty";
      空.textContent = "没有可关联的内容";
      候选框.appendChild(空);
      return;
    }
    for (const 项 of 可选) {
      const 行 = document.createElement("div");
      行.className = "rel-dialog-candidate" + (选中目标 === 项.id ? " active" : "");
      行.textContent = `${项.name}　（${项.category}）`;
      行.title = (项.tagPaths ?? []).map((p) => p.join("/")).join(" · ") || "无标签";
      行.addEventListener("click", () => {
        选中目标 = 项.id;
        确定.disabled = false;
        候选框.querySelectorAll(".rel-dialog-candidate").forEach((el) => el.classList.remove("active"));
        行.classList.add("active");
      });
      候选框.appendChild(行);
    }
  };

  const 搜索 = async (关键词: string): Promise<void> => {
    try {
      const 列表 = (await window.kugua.request("mkg", "mkg.query", {
        condition: { text: 关键词 || undefined },
        limit: 50,
      })) as Explorer.内容条目[];
      渲染候选(列表 ?? []);
    } catch {
      渲染候选([]);
    }
  };

  搜索框.addEventListener("input", () => {
    if (搜索防抖) clearTimeout(搜索防抖);
    搜索防抖 = window.setTimeout(() => void 搜索(搜索框.value.trim()), 250);
  });

  确定.addEventListener("click", async () => {
    if (选中目标 === null) return;
    确定.disabled = true;
    try {
      await window.kugua.request("mkg", "mkg.relation.add", {
        fromNodeId: 当前.id,
        toNodeId: 选中目标,
        relationType: 选中类型,
      });
      遮罩.remove();
      添加消息(`已建立「${关系元信息[选中类型].名称}」关联`);
      void 渲染关联(当前.id);
    } catch (err) {
      确定.disabled = false;
      添加消息("建立关联失败：" + String(err), "error");
    }
  });

  // 初始列出最近内容
  void 搜索("");
  搜索框.focus();
}

/** 防抖句柄（模块级，避免多次输入堆叠） */
let 搜索防抖: number | null = null;

/** 绑定详情栏的「＋」按钮（初始化时调用一次） */
export function 绑定关联事件(): void {
  document.getElementById("ex-info-relation-add")?.addEventListener("click", () => {
    void 打开建立关联对话框();
  });
}
