// ===== 批量打标签 =====
//
// 为什么需要：多选内容后此前只能「删除」。想给 10 条内容统一打个标签，
// 只能一条条点开详情栏加——而 mkg.node.setTags 是覆盖式（先 DELETE 全部
// 再插入），单条操作也会冲掉原有标签。
//
// 本模块提供：多选 → 选标签 → 追加（保留原有）/ 移除（只去指定标签）。
import { Explorer } from "./07-explorer";
import { 添加消息 } from "./03-preview";
import { 标签节点 } from "./01-types";
import { 更新内容信息面板 } from "./07j-explorer-tags";

/** 批量操作后刷新列表与详情 */
async function 刷新后() {
  await Explorer.加载标签树();
  await Explorer.加载所有内容();
  更新内容信息面板();
}

/**
 * 打开批量打标签对话框。
 *
 * @param 模式 "add" 追加（保留原有标签） | "remove" 只移除勾选的标签
 */
export function 打开批量标签对话框(模式: "add" | "remove" = "add"): void {
  const ids = [...Explorer.选中节点ID];
  if (ids.length === 0) {
    添加消息("请先选中内容", "system");
    return;
  }

  const 遮罩 = document.createElement("div");
  遮罩.className = "rel-dialog-mask";

  const 框 = document.createElement("div");
  框.className = "rel-dialog";

  const 标题 = document.createElement("div");
  标题.className = "rel-dialog-title";
  标题.textContent =
    模式 === "add"
      ? `给选中的 ${ids.length} 项追加标签`
      : `从选中的 ${ids.length} 项移除标签`;
  框.appendChild(标题);

  const 提示 = document.createElement("div");
  提示.className = "batch-tag-hint";
  提示.textContent =
    模式 === "add"
      ? "原有标签会保留，只追加勾选的标签。"
      : "只移除勾选的标签，其它标签保留。";
  框.appendChild(提示);

  // 模式切换
  const 模式行 = document.createElement("div");
  模式行.className = "rel-dialog-types";
  let 当前模式 = 模式;
  const 建模式钮 = (值: "add" | "remove", 文案: string): HTMLButtonElement => {
    const b = document.createElement("button");
    b.className = "rel-dialog-type" + (值 === 当前模式 ? " active" : "");
    b.textContent = 文案;
    b.addEventListener("click", () => {
      当前模式 = 值;
      模式行.querySelectorAll(".rel-dialog-type").forEach((x) => x.classList.remove("active"));
      b.classList.add("active");
      标题.textContent =
        当前模式 === "add"
          ? `给选中的 ${ids.length} 项追加标签`
          : `从选中的 ${ids.length} 项移除标签`;
      提示.textContent =
        当前模式 === "add"
          ? "原有标签会保留，只追加勾选的标签。"
          : "只移除勾选的标签，其它标签保留。";
      确定.textContent = 当前模式 === "add" ? "追加标签" : "移除标签";
    });
    return b;
  };
  模式行.appendChild(建模式钮("add", "➕ 追加"));
  模式行.appendChild(建模式钮("remove", "➖ 移除"));
  框.appendChild(模式行);

  // 标签搜索
  const 搜索框 = document.createElement("input");
  搜索框.type = "text";
  搜索框.className = "rel-dialog-input";
  搜索框.placeholder = "搜索标签名…";
  框.appendChild(搜索框);

  // 标签树（可勾选）
  const 列表 = document.createElement("div");
  列表.className = "batch-tag-list";
  框.appendChild(列表);

  const 勾选 = new Set<number>();

  const 渲染标签 = (关键词: string): void => {
    列表.innerHTML = "";
    const 小写 = 关键词.trim().toLowerCase();
    const 扁平: Array<{ 节点: 标签节点; 深度: number }> = [];
    const 收集 = (节点: 标签节点, 深度: number): void => {
      if (!小写 || 节点.name.toLowerCase().includes(小写)) 扁平.push({ 节点, 深度 });
      for (const 子 of 节点.children) 收集(子, 深度 + 1);
    };
    for (const 根 of Explorer.标签树) 收集(根, 0);

    if (扁平.length === 0) {
      const 空 = document.createElement("div");
      空.className = "rel-dialog-empty";
      空.textContent = 关键词 ? "没有匹配的标签" : "还没有标签，先去左侧标签树新建";
      列表.appendChild(空);
      return;
    }

    for (const { 节点, 深度 } of 扁平) {
      const 行 = document.createElement("label");
      行.className = "batch-tag-row";
      行.style.paddingLeft = 0.5 + 深度 * 14 + "px";
      const 框选 = document.createElement("input");
      框选.type = "checkbox";
      框选.checked = 勾选.has(节点.id);
      框选.addEventListener("change", () => {
        if (框选.checked) 勾选.add(节点.id);
        else 勾选.delete(节点.id);
        确定.disabled = 勾选.size === 0;
        更新计数();
      });
      行.appendChild(框选);
      const 名 = document.createElement("span");
      名.textContent = 节点.name;
      行.appendChild(名);
      列表.appendChild(行);
    }
  };

  // 底部
  const 底部 = document.createElement("div");
  底部.className = "rel-dialog-actions";
  const 计数 = document.createElement("span");
  计数.className = "batch-tag-count";
  const 更新计数 = (): void => {
    计数.textContent = 勾选.size > 0 ? `已选 ${勾选.size} 个标签` : "请勾选标签";
  };
  更新计数();
  底部.appendChild(计数);

  const 取消 = document.createElement("button");
  取消.className = "btn";
  取消.textContent = "取消";
  取消.addEventListener("click", () => 遮罩.remove());
  底部.appendChild(取消);

  const 确定 = document.createElement("button");
  确定.className = "btn primary";
  确定.textContent = 模式 === "add" ? "追加标签" : "移除标签";
  确定.disabled = true;
  确定.addEventListener("click", async () => {
    if (勾选.size === 0) return;
    确定.disabled = true;
    确定.textContent = "处理中…";
    try {
      const 动作 = 当前模式 === "add" ? "mkg.node.addTags" : "mkg.node.removeTags";
      const 结果 = (await window.kugua.request("mkg", 动作, {
        nodeIds: ids,
        tagIds: [...勾选],
      })) as { 更新: number; 跳过: number };
      const 动词 = 当前模式 === "add" ? "追加" : "移除";
      let 文案 = `已为 ${结果.更新} 项${动词}标签（${勾选.size} 个）`;
      if (结果.跳过 > 0) 文案 += `，${结果.跳过} 项不存在已跳过`;
      添加消息(文案, "system", "批量标签");
      遮罩.remove();
      await 刷新后();
    } catch (err) {
      确定.disabled = false;
      确定.textContent = 当前模式 === "add" ? "追加标签" : "移除标签";
      添加消息("批量标签操作失败：" + String(err), "error");
    }
  });
  底部.appendChild(确定);
  框.appendChild(底部);

  遮罩.appendChild(框);
  document.body.appendChild(遮罩);
  遮罩.addEventListener("click", (e) => {
    if (e.target === 遮罩) 遮罩.remove();
  });

  搜索框.addEventListener("input", () => 渲染标签(搜索框.value));
  渲染标签("");
  搜索框.focus();
}

/** 更新批量标签按钮的可见性与计数（选中数变化时调用） */
export function 更新批量标签按钮(): void {
  const btn = document.getElementById("ex-btn-tag-selected") as HTMLButtonElement | null;
  if (!btn) return;
  const 计数 = document.getElementById("ex-tag-selected-count") as HTMLSpanElement | null;
  const n = Explorer.选中节点ID.size;
  btn.classList.toggle("hidden", n === 0);
  if (计数) {
    计数.textContent = String(n);
    计数.classList.toggle("hidden", n === 0);
  }
  btn.title = n > 0 ? `给选中的 ${n} 项批量打标签（保留原有标签）` : "批量打标签";
}

/** 绑定批量标签按钮（初始化时调用一次） */
export function 绑定批量标签事件(): void {
  document.getElementById("ex-btn-tag-selected")?.addEventListener("click", () => {
    打开批量标签对话框("add");
  });
}
