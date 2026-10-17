/**
 * 声明式配置表单渲染器
 *
 * 模块在握手上报 `配置声明`，平台据此自动生成表单——模块不必写任何前端代码。
 *
 * 支持类型：string / text / number / boolean / select / path / secret / array
 *  - array 支持「字符串列表」与「对象表格」两种编辑方式（含增删行）
 *  - secret 字段以密码框展示，值不回传明文，只显示「已设置」
 *
 * 交互约定：
 *  - 字段失焦或变更时立即提交（不设「保存」按钮，减少一次点击）
 *  - 提交后平台写盘并向模块推送 `module.config`，模块负责热重载
 */

import type { 配置字段声明, 配置列声明 } from "@kugua/nigane";

/** 平台返回的表单模型：字段声明 + 当前值 */
interface 表单字段 extends 配置字段声明 {
  值: unknown;
  已设置?: boolean;
}

interface 表单模型 {
  模块: string;
  说明?: string;
  字段: 表单字段[];
}

function 转义(文本: unknown): string {
  return String(文本 ?? "")
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;");
}

/** 把字段值与选项统一成 [{值, 标题}] */
function 归一选项(选项: 配置字段声明["选项"]): Array<{ 值: string; 标题: string }> {
  return (选项 ?? []).map((o) => (typeof o === "string" ? { 值: o, 标题: o } : o));
}

/** 渲染字符串列表编辑器 */
function 渲染字符串数组(字段: 表单字段): string {
  const 值 = Array.isArray(字段.值) ? (字段.值 as unknown[]).map((v) => String(v)) : [];
  const 行 = 值
    .map(
      (v, i) => `
      <div class="cfg-array-row" data-row="${i}">
        <input type="text" class="cfg-array-input" data-col="__value" value="${转义(v)}" placeholder="${转义(字段.提示 ?? "")}">
        <button class="cfg-array-del" type="button" title="删除此行">&#x2715;</button>
      </div>`,
    )
    .join("");
  return `
    <div class="cfg-array" data-kind="string">
      ${行}
      <button class="cfg-array-add" type="button">+ 添加一项</button>
    </div>`;
}

/** 渲染对象数组（表格）编辑器 */
function 渲染对象数组(字段: 表单字段): string {
  const 列: 配置列声明[] = 字段.数组?.列 ?? [];
  const 值 = Array.isArray(字段.值) ? (字段.值 as Array<Record<string, unknown>>) : [];
  const 表头 = 列.map((c) => `<th>${转义(c.标题)}${c.必填 ? ' <span class="cfg-req">*</span>' : ""}</th>`).join("");

  const 单元格 = (列声明: 配置列声明, 行数据: Record<string, unknown>): string => {
    const 原值 = 行数据[列声明.键];
    const 类 = 'class="cfg-cell-input"';
    if (列声明.类型 === "boolean") {
      return `<input type="checkbox" ${类} data-col="${转义(列声明.键)}" ${原值 ? "checked" : ""}>`;
    }
    if (列声明.类型 === "select") {
      const 选项 = 归一选项(列声明.选项)
        .map(
          (o) =>
            `<option value="${转义(o.值)}" ${String(原值 ?? "") === o.值 ? "selected" : ""}>${转义(o.标题)}</option>`,
        )
        .join("");
      return `<select ${类} data-col="${转义(列声明.键)}">${选项}</select>`;
    }
    const 类型 = 列声明.类型 === "number" ? "number" : 列声明.类型 === "secret" ? "password" : "text";
    return `<input type="${类型}" ${类} data-col="${转义(列声明.键)}" value="${转义(原值 ?? "")}" placeholder="${转义(列声明.提示 ?? "")}">`;
  };

  const 行 = 值
    .map(
      (行数据, i) => `
      <tr data-row="${i}">
        ${列.map((c) => `<td>${单元格(c, 行数据)}</td>`).join("")}
        <td><button class="cfg-array-del" type="button" title="删除此行">&#x2715;</button></td>
      </tr>`,
    )
    .join("");

  return `
    <div class="cfg-array" data-kind="object">
      <table class="cfg-table">
        <thead><tr>${表头}<th></th></tr></thead>
        <tbody>${行}</tbody>
      </table>
      <button class="cfg-array-add" type="button">+ 添加一行</button>
    </div>`;
}

/** 渲染单个字段 */
function 渲染字段(字段: 表单字段): string {
  const 类型 = 字段.类型 ?? "string";
  const id = `cfg-f-${字段.键.replace(/\./g, "-")}`;
  const 必填 = 字段.必填 ? '<span class="cfg-req">*</span>' : "";
  const 说明 = 字段.说明 ? `<div class="cfg-hint">${转义(字段.说明)}</div>` : "";
  const 生效 =
    字段.生效 && 字段.生效 !== "立即"
      ? `<span class="cfg-badge">${字段.生效 === "重启平台" ? "需重启平台" : "需重启模块"}</span>`
      : "";
  const 数据属性 = `data-key="${转义(字段.键)}" data-type="${类型}"`;

  let 控件 = "";
  switch (类型) {
    case "boolean": {
      const 勾 = 字段.值 === true ? "checked" : "";
      return `
        <div class="cfg-field cfg-field-bool">
          <label class="cfg-bool-label">
            <input type="checkbox" id="${id}" class="cfg-input" ${数据属性} ${勾}>
            <span>${转义(字段.标题)}${必填}</span>
          </label>
          ${生效}
          ${说明}
        </div>`;
    }
    case "select": {
      const 当前 = String(字段.值 ?? "");
      const 选项 = 归一选项(字段.选项)
        .map(
          (o) => `<option value="${转义(o.值)}" ${当前 === o.值 ? "selected" : ""}>${转义(o.标题)}</option>`,
        )
        .join("");
      const 空选项 = 字段.必填 ? "" : `<option value="" ${当前 === "" ? "selected" : ""}>（未设置）</option>`;
      控件 = `<select id="${id}" class="cfg-input" ${数据属性}>${空选项}${选项}</select>`;
      break;
    }
    case "text":
      控件 = `<textarea id="${id}" class="cfg-input" rows="3" ${数据属性} placeholder="${转义(字段.提示 ?? "")}">${转义(字段.值 ?? "")}</textarea>`;
      break;
    case "number": {
      const 步进 = 字段.步进 ?? "any";
      const 最小 = 字段.最小 !== undefined ? `min="${字段.最小}"` : "";
      const 最大 = 字段.最大 !== undefined ? `max="${字段.最大}"` : "";
      控件 = `<input type="number" id="${id}" class="cfg-input" ${数据属性} value="${转义(字段.值 ?? "")}" step="${步进}" ${最小} ${最大}>`;
      break;
    }
    case "secret": {
      // 凭据不回传明文：留空表示「不修改」，输入新值才覆盖
      const 占位 = 字段.已设置 ? "已设置（留空表示不修改）" : "未设置";
      控件 = `<input type="password" id="${id}" class="cfg-input" ${数据属性} value="" placeholder="${占位}" autocomplete="new-password">`;
      break;
    }
    case "path":
      控件 = `
        <div class="cfg-path-row">
          <input type="text" id="${id}" class="cfg-input" ${数据属性} value="${转义(字段.值 ?? "")}" placeholder="${转义(字段.提示 ?? "")}">
        </div>`;
      break;
    case "array":
      控件 = 渲染字符串数组(字段);
      if ((字段.数组?.元素 ?? "string") === "object") 控件 = 渲染对象数组(字段);
      // 数组没有主控件，把键写在字段盒上供增删时回查
      return `
        <div class="cfg-field" data-key="${转义(字段.键)}" data-type="array">
          <label class="cfg-label">${转义(字段.标题)}${必填}${生效}</label>
          ${控件}
          ${说明}
        </div>`;
    default:
      控件 = `<input type="text" id="${id}" class="cfg-input" ${数据属性} value="${转义(字段.值 ?? "")}" placeholder="${转义(字段.提示 ?? "")}">`;
  }

  return `
    <div class="cfg-field">
      <label class="cfg-label" for="${id}">${转义(字段.标题)}${必填}${生效}</label>
      ${控件}
      ${说明}
    </div>`;
}

/**
 * 挂载配置表单到容器。
 *
 * @param 容器      目标容器
 * @param 模型      平台返回的表单模型
 * @param 提交      提交回调：(变更的扁平键值) → Promise
 * @param 提示      局部提示回调
 */
export function 挂载配置表单(
  容器: HTMLElement,
  模型: 表单模型,
  提交: (变更: Record<string, unknown>) => Promise<void>,
  提示: (文本: string, 错?: boolean) => void,
): void {
  容器.innerHTML = `
    ${模型.说明 ? `<div class="cfg-desc">${转义(模型.说明)}</div>` : ""}
    <div class="cfg-form">${模型.字段.map(渲染字段).join("")}</div>
    <div class="cfg-footer"><span class="cfg-status"></span></div>`;

  const 状态 = 容器.querySelector<HTMLElement>(".cfg-status");
  const 提交单值 = async (键: string, 值: unknown): Promise<void> => {
    if (!状态) return;
    状态.textContent = "保存中…";
    状态.classList.remove("err", "ok");
    try {
      await 提交({ [键]: 值 });
      状态.textContent = "已保存";
      状态.classList.add("ok");
    } catch (err) {
      状态.textContent = `保存失败：${String(err)}`;
      状态.classList.add("err");
      提示(`保存失败：${String(err)}`, true);
    }
    setTimeout(() => {
      if (状态.textContent === "已保存" || 状态.classList.contains("err")) {
        状态.textContent = "";
        状态.classList.remove("ok", "err");
      }
    }, 3000);
  };

  // —— 普通控件：change 时提交 ——
  容器.addEventListener("change", (ev) => {
    const 目标 = ev.target as HTMLElement;
    if (!目标.classList.contains("cfg-input")) return;
    const 键 = 目标.dataset.key ?? "";
    const 类型 = 目标.dataset.type ?? "string";
    if (!键) return;
    let 值: unknown;
    if (类型 === "boolean") 值 = (目标 as HTMLInputElement).checked;
    else 值 = (目标 as HTMLInputElement | HTMLTextAreaElement | HTMLSelectElement).value;
    // 凭据留空表示不修改
    if (类型 === "secret" && 值 === "") return;
    void 提交单值(键, 值);
  });

  // —— 数组增删改 ——
  const 读取数组 = (字段键: string, 类型: string): unknown => {
    const 区 = 容器.querySelector<HTMLElement>(".cfg-array");
    if (!区) return [];
    if (类型 === "object") {
      const 列 = Array.from(容器.querySelectorAll<HTMLTableRowElement>(".cfg-table tbody tr"));
      return 列.map((tr) => {
        const 行: Record<string, unknown> = {};
        tr.querySelectorAll<HTMLInputElement | HTMLSelectElement>(".cfg-cell-input").forEach((el) => {
          const 列名 = el.dataset.col ?? "";
          if (!列名) return;
          行[列名] = el instanceof HTMLInputElement && el.type === "checkbox" ? el.checked : el.value;
        });
        return 行;
      });
    }
    return Array.from(容器.querySelectorAll<HTMLInputElement>(".cfg-array-input")).map((el) => el.value);
  };

  容器.addEventListener("click", (ev) => {
    const 目标 = ev.target as HTMLElement;
    const 区 = 目标.closest<HTMLElement>(".cfg-array");
    if (!区) return;
    // 字段盒上记录着键与类型（数组字段没有主控件，故以字段盒为准）
    const 键 = 目标.closest<HTMLElement>(".cfg-field")?.dataset.key ?? "";
    if (!键) return;
    const 增 = 目标.classList.contains("cfg-array-add");
    const 删 = 目标.classList.contains("cfg-array-del");
    if (!增 && !删) return;
    ev.preventDefault();

    if (删) {
      目标.closest<HTMLElement>("[data-row]")?.remove();
      void 提交单值(键, 读取数组(键, "array"));
      return;
    }

    // 新增：对象表格插空行等用户填完再提交；字符串数组插空行后由 input 防抖提交
    const 是对象 = 区.dataset.kind === "object";
    if (是对象) {
      const tbody = 区.querySelector("tbody");
      const 列数 = Math.max(1, (区.querySelectorAll(".cfg-table thead th").length || 1) - 1);
      if (tbody) {
        const tr = document.createElement("tr");
        tr.dataset.row = String(tbody.children.length);
        tr.innerHTML = `<td colspan="${列数}" class="cfg-row-empty">新行（请填写）</td><td><button class="cfg-array-del" type="button" title="删除此行">&#x2715;</button></td>`;
        tbody.appendChild(tr);
      }
      return;
    }
    const 行 = document.createElement("div");
    行.className = "cfg-array-row";
    行.dataset.row = String(区.querySelectorAll(".cfg-array-row").length);
    行.innerHTML = `<input type="text" class="cfg-array-input" data-col="__value" value=""><button class="cfg-array-del" type="button" title="删除此行">&#x2715;</button>`;
    const 按钮 = 区.querySelector(".cfg-array-add");
    if (按钮) 区.insertBefore(行, 按钮);
    else 区.appendChild(行);
    行.querySelector<HTMLInputElement>("input")?.focus();
  });

  // —— 数组输入：防抖提交 ——
  容器.addEventListener("input", (ev) => {
    const 目标 = ev.target as HTMLElement;
    if (!目标.classList.contains("cfg-array-input") && !目标.classList.contains("cfg-cell-input")) return;
    const 键 = 目标.closest<HTMLElement>(".cfg-field")?.dataset.key ?? "";
    if (!键) return;
    window.clearTimeout(数组提交定时器.get(容器));
    数组提交定时器.set(
      容器,
      window.setTimeout(() => void 提交单值(键, 读取数组(键, "array")), 700),
    );
  });
}

/** 数组输入的防抖定时器（按容器区分） */
const 数组提交定时器 = new WeakMap<HTMLElement, number>();
