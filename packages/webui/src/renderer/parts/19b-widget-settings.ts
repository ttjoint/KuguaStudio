/**
 * 仪表盘布局设置页（19b）
 *
 * 对应 docs/小组件设计.md 第三步「用户自定义」。和渲染层（19-widgets）分开是因为
 * 两边关心的东西完全不同：那边只负责把已有布局画出来，这边只管**改**布局。
 * 合在一起会变成一个既画又改、既读又写的大文件。
 *
 * 三条约束：
 *  1. **只写用户改过的项**（`布局覆盖`）。全量写会把「插件新声明的默认值」
 *     也固化进配置，以后插件调整默认值对老用户失效。
 *  2. **孤儿项不自动删**（设计稿 6.5）。插件暂时卸载不等于永久消失，
 *     下次装回来布局还在。只在界面上提示并给一个手动清理入口。
 *  3. **每次改动都重新拉整份配置再写**。布局是整节覆盖保存的，
 *     只发增量会让并发改动（另一个窗口）被覆盖。
 */

import type { 布局覆盖, 布局方案, 小组件配置节 } from "./19-widgets";

/** 服务端 widgets 列表响应（只声明用到的字段） */
interface 列表响应 {
  小组件: Array<{
    id: string;
    类型: string;
    标题: string;
    显著度?: string;
    来源: string;
    在线: boolean;
    键: string;
  }>;
  配置: 小组件配置节;
}

const 外形选项: Array<NonNullable<布局覆盖["外形"]>> = ["大卡", "横条", "窄条"];
const 区域选项: Array<NonNullable<布局覆盖["区域"]>> = ["顶部", "侧栏", "状态栏"];
const 展示选项: Array<NonNullable<布局方案["展示"]>> = ["自动", "紧凑", "详细", "仅状态栏"];

let 最近配置: 小组件配置节 | null = null;
let 正在保存 = false;

function 取节(响应: { 配置?: 小组件配置节 }): 小组件配置节 {
  return (
    响应.配置 ?? {
      当前方案: "默认",
      方案: { 默认: { 展示: "自动", 覆盖: {} } },
    }
  );
}

/** 当前方案的覆盖表（永远是对象，避免处处判空） */
function 当前覆盖(节: 小组件配置节): Record<string, 布局覆盖> {
  return 节.方案[节.当前方案]?.覆盖 ?? {};
}

/** 当前方案的形态预设 */
function 当前展示(节: 小组件配置节): NonNullable<布局方案["展示"]> {
  return 节.方案[节.当前方案]?.展示 ?? "自动";
}

/**
 * 保存整份配置节。
 *
 * 保存期间禁用按钮：连点两下会让两次写交错，第二次带着旧的 `当前方案`
 * 覆盖掉第一次的切换结果，表现是「点了没反应」。
 */
async function 保存(节: 小组件配置节, 提示: (文本: string, 错?: boolean) => void): Promise<void> {
  if (正在保存) return;
  正在保存 = true;
  try {
    最近配置 = 节;
    await window.kugua.request("nigane", "nigane.widgets.config.set", { 配置: 节 });
    提示("已保存");
    await 重绘仪表盘();
  } catch (err) {
    提示(`保存失败：${String(err)}`, true);
  } finally {
    正在保存 = false;
  }
}

/** 建一行：一个小组件的可编辑项 */
function 建行(
  项: 列表响应["小组件"][number],
  覆盖: 布局覆盖,
  索引: number,
  总数: number,
): HTMLElement {
  const 行 = document.createElement("div");
  行.className = "wg-row";
  行.dataset.键 = 项.键;
  if (覆盖.隐藏) 行.classList.add("wg-row-hidden");

  // —— 标题与来源 ——
  const 名区 = document.createElement("div");
  名区.className = "wg-row-name";
  const 标题 = document.createElement("span");
  标题.className = "wg-row-title";
  // 标题来自插件：textContent，绝不 innerHTML
  标题.textContent = 项.标题;
  const 副 = document.createElement("span");
  副.className = "wg-row-src";
  副.textContent = `${项.来源}.${项.id} · ${项.类型}`;
  名区.appendChild(标题);
  名区.appendChild(副);
  if (!项.在线) {
    const 离线 = document.createElement("span");
    离线.className = "wg-row-offline";
    离线.textContent = "离线";
    名区.appendChild(离线);
  }
  行.appendChild(名区);

  // —— 外形 ——
  const 外形选 = document.createElement("select");
  外形选.className = "wg-row-select";
  外形选.dataset.字段 = "外形";
  const 自动外形 = document.createElement("option");
  自动外形.value = "";
  自动外形.textContent = "（自动）";
  外形选.appendChild(自动外形);
  for (const v of 外形选项) {
    const o = document.createElement("option");
    o.value = v;
    o.textContent = v;
    外形选.appendChild(o);
  }
  外形选.value = 覆盖.外形 ?? "";
  行.appendChild(外形选);

  // —— 区域 ——
  const 区域选 = document.createElement("select");
  区域选.className = "wg-row-select";
  区域选.dataset.字段 = "区域";
  const 自动区域 = document.createElement("option");
  自动区域.value = "";
  自动区域.textContent = "（自动）";
  区域选.appendChild(自动区域);
  for (const v of 区域选项) {
    const o = document.createElement("option");
    o.value = v;
    o.textContent = v;
    区域选.appendChild(o);
  }
  区域选.value = 覆盖.区域 ?? "";
  行.appendChild(区域选);

  // —— 顺序：上下移 ——
  const 序区 = document.createElement("div");
  序区.className = "wg-row-order";
  const 上 = document.createElement("button");
  上.className = "tb-btn small";
  上.dataset.动作 = "上移";
  上.textContent = "↑";
  上.title = "上移";
  上.disabled = 索引 === 0;
  const 下 = document.createElement("button");
  下.className = "tb-btn small";
  下.dataset.动作 = "下移";
  下.textContent = "↓";
  下.title = "下移";
  下.disabled = 索引 === 总数 - 1;
  序区.appendChild(上);
  序区.appendChild(下);
  行.appendChild(序区);

  // —— 显示/隐藏 ——
  const 隐 = document.createElement("button");
  隐.className = "tb-btn small";
  隐.dataset.动作 = "隐藏";
  隐.textContent = 覆盖.隐藏 ? "显示" : "隐藏";
  隐.title = 覆盖.隐藏 ? "重新显示这个小组件" : "隐藏这个小组件（布局保留）";
  行.appendChild(隐);

  return 行;
}

/** 画整个仪表盘设置区 */
async function 绘制仪表盘(): Promise<void> {
  const 容器 = document.getElementById("settings-widget-layout");
  if (!容器) return;

  let 响应: 列表响应;
  try {
    响应 = (await window.kugua.request("nigane", "nigane.widgets.list", {})) as 列表响应;
  } catch (err) {
    容器.textContent = "";
    const 空 = document.createElement("div");
    空.className = "mod-empty";
    空.textContent = `加载失败：${String(err)}`;
    容器.appendChild(空);
    return;
  }

  const 节 = 取节(响应);
  最近配置 = 节;
  const 覆盖 = 当前覆盖(节);

  容器.textContent = "";

  // —— 方案选择区 ——
  const 方案区 = document.createElement("div");
  方案区.className = "wg-layout-plans";

  const 方案选 = document.createElement("select");
  方案选.id = "wg-plan-select";
  方案选.className = "wg-row-select";
  for (const 名 of Object.keys(节.方案)) {
    const o = document.createElement("option");
    o.value = 名;
    o.textContent = 名;
    方案选.appendChild(o);
  }
  方案选.value = 节.当前方案;
  方案区.appendChild(方案选);

  const 新建 = document.createElement("button");
  新建.className = "tb-btn small";
  新建.id = "wg-plan-new";
  新建.textContent = "＋ 新建方案";
  方案区.appendChild(新建);

  const 删除 = document.createElement("button");
  删除.className = "tb-btn small";
  删除.id = "wg-plan-del";
  删除.textContent = "删除方案";
  // 只剩一套时不许删：删完就没有「当前方案」了，界面会退成空白
  删除.disabled = Object.keys(节.方案).length <= 1;
  删除.title = 删除.disabled ? "至少保留一套方案" : "删除当前方案";
  方案区.appendChild(删除);

  // 形态预设
  const 预设标签 = document.createElement("span");
  预设标签.className = "wg-layout-label";
  预设标签.textContent = "形态";
  方案区.appendChild(预设标签);

  const 预设选 = document.createElement("select");
  预设选.id = "wg-plan-preset";
  预设选.className = "wg-row-select";
  for (const v of 展示选项) {
    const o = document.createElement("option");
    o.value = v;
    o.textContent = v;
    预设选.appendChild(o);
  }
  预设选.value = 当前展示(节);
  方案区.appendChild(预设选);

  const 提示位 = document.createElement("span");
  提示位.className = "wg-layout-msg";
  方案区.appendChild(提示位);

  容器.appendChild(方案区);

  // —— 行列表 ——
  const 列表 = document.createElement("div");
  列表.className = "wg-rows";
  列表.id = "wg-rows";

  // 按当前方案的顺序展示；有顺序覆盖的排前面并按数值排，
  // 否则退回注册表顺序。和渲染层 `排序键` 保持一致，避免两处看到两种顺序。
  const 排序 = [...响应.小组件].sort((a, b) => {
    const ka = 覆盖[a.键]?.顺序;
    const kb = 覆盖[b.键]?.顺序;
    if (typeof ka === "number" && typeof kb === "number") return ka - kb;
    if (typeof ka === "number") return -1;
    if (typeof kb === "number") return 1;
    return 0;
  });

  if (排序.length === 0) {
    const 空 = document.createElement("div");
    空.className = "mod-empty";
    空.textContent = "当前没有插件声明小组件。";
    列表.appendChild(空);
  } else {
    排序.forEach((项, i) => {
      列表.appendChild(建行(项, 覆盖[项.键] ?? {}, i, 排序.length));
    });
  }
  容器.appendChild(列表);

  // —— 孤儿覆盖提示（不自动删）——
  const 存在键 = new Set(响应.小组件.map((x) => x.键));
  const 孤儿 = Object.keys(覆盖).filter((k) => !存在键.has(k));
  if (孤儿.length > 0) {
    const 区 = document.createElement("div");
    区.className = "wg-orphan";
    const 文 = document.createElement("span");
    // 插件卸载后布局被保留（装回来还在），所以要提示但**不自动清理**
    文.textContent = `${孤儿.length} 项布局对应的插件当前未安装（${孤儿.join("、")}）`;
    区.appendChild(文);
    const 清 = document.createElement("button");
    清.className = "tb-btn small";
    清.id = "wg-orphan-clean";
    清.textContent = "清理";
    清.title = "删掉这些布局项；装回插件后需要重新配置";
    区.appendChild(清);
    容器.appendChild(区);
  }
}

/** 对外入口：重画（切到设置页时也调用） */
export async function 重绘仪表盘(): Promise<void> {
  await 绘制仪表盘();
}

/** 绑定仪表盘交互（只绑一次） */
export function 初始化仪表盘设置(): void {
  const 容器 = document.getElementById("settings-widget-layout");
  if (!容器) return;

  window.addEventListener("kugua:settings-shown", () => void 绘制仪表盘());
  document.getElementById("settings-widget-refresh")?.addEventListener("click", () => {
    void 绘制仪表盘();
  });

  /** 取提示位 */
  const 提示 = (文本: string, 错 = false): void => {
    const 位 = 容器.querySelector<HTMLElement>(".wg-layout-msg");
    if (!位) return;
    位.textContent = 文本;
    位.classList.toggle("err", 错);
    setTimeout(() => {
      位.textContent = "";
      位.classList.remove("err");
    }, 3000);
  };

  /** 拿一份新的配置节（避免在闭包里长期持有过期的） */
  const 取新节 = (): 小组件配置节 | null => 最近配置;

  // —— 切换当前方案 ——
  容器.addEventListener("change", (ev) => {
    const 目标 = ev.target as HTMLSelectElement;
    const 节 = 取新节();
    if (!节) return;

    if (目标.id === "wg-plan-select") {
      const 名 = 目标.value;
      if (!节.方案[名]) return;
      void 保存({ ...节, 当前方案: 名 }, 提示);
      return;
    }

    if (目标.id === "wg-plan-preset") {
      const 值 = 目标.value as NonNullable<布局方案["展示"]>;
      const 方案 = 节.方案[节.当前方案] ?? { 覆盖: {} };
      void 保存(
        {
          ...节,
          方案: { ...节.方案, [节.当前方案]: { ...方案, 展示: 值 } },
        },
        提示,
      );
      return;
    }

    // 行内字段
    const 行 = 目标.closest<HTMLElement>(".wg-row");
    if (!行) return;
    const 键 = 行.dataset.键 ?? "";
    const 字段 = 目标.dataset.字段;
    if (!键 || !字段) return;

    const 方案 = 节.方案[节.当前方案] ?? { 覆盖: {} };
    const 旧覆盖 = 方案.覆盖 ?? {};
    const 新覆盖: 布局覆盖 = { ...(旧覆盖[键] ?? {}) };
    const 值 = 目标.value;
    if (!值) {
      // 选「（自动）」= 删掉这个覆盖项，恢复按显著度推算。
      // 留一个空字段会让「只存改过的项」失效。
      delete (新覆盖 as Record<string, unknown>)[字段];
    } else if (字段 === "外形") {
      新覆盖.外形 = 值 as 布局覆盖["外形"];
    } else if (字段 === "区域") {
      新覆盖.区域 = 值 as 布局覆盖["区域"];
    }

    const 全: Record<string, 布局覆盖> = { ...旧覆盖 };
    if (Object.keys(新覆盖).length === 0) delete 全[键];
    else 全[键] = 新覆盖;

    void 保存(
      { ...节, 方案: { ...节.方案, [节.当前方案]: { ...方案, 覆盖: 全 } } },
      提示,
    );
  });

  // —— 按钮：新建 / 删除 / 上移 / 下移 / 隐藏 / 清理孤儿 ——
  容器.addEventListener("click", (ev) => {
    const 目标 = ev.target as HTMLElement;
    if (目标.tagName !== "BUTTON") return;
    const 节 = 取新节();
    if (!节) return;
    const 方案 = 节.方案[节.当前方案] ?? { 覆盖: {} };
    const 旧覆盖 = 方案.覆盖 ?? {};

    if (目标.id === "wg-plan-new") {
      // 名字带序号并跳过已占用的，避免重名把旧方案覆盖掉
      let i = 1;
      let 名 = `方案 ${i}`;
      while (节.方案[名]) {
        i += 1;
        名 = `方案 ${i}`;
      }
      // 新方案从空布局开始：用户建新方案就是要一套干净的摆法
      void 保存(
        { ...节, 当前方案: 名, 方案: { ...节.方案, [名]: { 展示: "自动", 覆盖: {} } } },
        提示,
      );
      return;
    }

    if (目标.id === "wg-plan-del") {
      const 名 = 节.当前方案;
      if (Object.keys(节.方案).length <= 1) return;
      const 剩 = { ...节.方案 };
      delete 剩[名];
      const 新当前 = Object.keys(剩)[0];
      void 保存({ ...节, 当前方案: 新当前, 方案: 剩 }, 提示);
      return;
    }

    if (目标.id === "wg-orphan-clean") {
      const 存在键 = new Set(
        Array.from(容器.querySelectorAll<HTMLElement>(".wg-row")).map((el) => el.dataset.键 ?? ""),
      );
      const 新覆盖: Record<string, 布局覆盖> = {};
      for (const [k, v] of Object.entries(旧覆盖)) {
        if (存在键.has(k)) 新覆盖[k] = v;
      }
      void 保存(
        { ...节, 方案: { ...节.方案, [节.当前方案]: { ...方案, 覆盖: 新覆盖 } } },
        提示,
      );
      return;
    }

    const 行 = 目标.closest<HTMLElement>(".wg-row");
    if (!行) return;
    const 键 = 行.dataset.键 ?? "";
    if (!键) return;
    const 动作 = 目标.dataset.动作;

    if (动作 === "隐藏") {
      const 新覆盖 = { ...(旧覆盖[键] ?? {}) };
      新覆盖.隐藏 = !新覆盖.隐藏;
      const 全 = { ...旧覆盖, [键]: 新覆盖 };
      void 保存(
        { ...节, 方案: { ...节.方案, [节.当前方案]: { ...方案, 覆盖: 全 } } },
        提示,
      );
      return;
    }

    if (动作 === "上移" || 动作 === "下移") {
      // 顺序靠「给全部行写顺序字段」实现，而不是交换两个数字：
      // 只在两个数字都定义时交换，会遇到「一个有顺序一个没有」的情况。
      const 行们 = Array.from(容器.querySelectorAll<HTMLElement>(".wg-row"));
      const 现在 = 行们.findIndex((el) => el.dataset.键 === 键);
      if (现在 < 0) return;
      const 目标位 = 动作 === "上移" ? 现在 - 1 : 现在 + 1;
      if (目标位 < 0 || 目标位 >= 行们.length) return;

      const 键序 = 行们.map((el) => el.dataset.键 ?? "");
      const [移] = 键序.splice(现在, 1);
      键序.splice(目标位, 0, 移);

      const 全: Record<string, 布局覆盖> = { ...旧覆盖 };
      键序.forEach((k, i) => {
        全[k] = { ...(全[k] ?? {}), 顺序: i };
      });
      void 保存(
        { ...节, 方案: { ...节.方案, [节.当前方案]: { ...方案, 覆盖: 全 } } },
        提示,
      );
    }
  });
}
