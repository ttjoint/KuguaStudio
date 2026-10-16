// ===== 智能视图 / 受管位置 =====
// 由 07-explorer.ts 拆分而来。
import { Explorer } from "./07-explorer";
import { 渲染标签树 } from "./07j-explorer-tags";
import { 添加消息 } from "./03-preview";

// ===== 智能视图 / 受管位置（阶段 2）=====
export async function 加载保存视图(): Promise<void> {
  try {
    Explorer.保存视图列表 = (await window.kugua.request("mkg", "mkg.view.list", {})) as Explorer.保存视图[];
  } catch {
    Explorer.保存视图列表 = [];
  }
  渲染保存视图();
}

export function 渲染保存视图(): void {
  const 容器 = document.getElementById("ex-view-list");
  if (!容器) return;
  容器.innerHTML = "";
  if (Explorer.保存视图列表.length === 0) {
    const 空 = document.createElement("div");
    空.className = "ex-view-item";
    空.style.opacity = "0.5";
    空.textContent = "（无，点击 ＋ 保存当前筛选）";
    容器.appendChild(空);
    return;
  }
  for (const v of Explorer.保存视图列表) {
    const 行 = document.createElement("div");
    行.className = "ex-view-item" + (Explorer.当前视图ID === v.id ? " active" : "");
    const 名 = document.createElement("span");
    名.textContent = (v.icon ? v.icon + " " : "★ ") + v.name;
    名.title = JSON.stringify(v.query);
    名.style.flex = "1";
    名.style.overflow = "hidden";
    名.style.textOverflow = "ellipsis";
    行.appendChild(名);
    const 删 = document.createElement("button");
    删.className = "mini-btn";
    删.textContent = "×";
    删.title = "删除该智能视图";
    删.addEventListener("click", async (e) => {
      e.stopPropagation();
      if (!window.confirm(`删除智能视图「${v.name}」？`)) return;
      try {
        await window.kugua.request("mkg", "mkg.view.delete", { id: v.id });
      } catch {
        /* 忽略 */
      }
      if (Explorer.当前视图ID === v.id) Explorer.当前视图ID = null;
      await 加载保存视图();
    });
    行.appendChild(删);
    行.addEventListener("click", () => void 运行保存视图(v));
    容器.appendChild(行);
  }
}

async function 运行保存视图(v: Explorer.保存视图): Promise<void> {
  try {
    const r = (await window.kugua.request("mkg", "mkg.view.run", { id: v.id, limit: 1000 })) as {
      items: Explorer.内容条目[];
    };
    Explorer.当前视图ID = v.id;
    Explorer.当前标签ID = "all";
    Explorer.当前位置ID = null;
    Explorer.搜索关键词 = "";
    Explorer.类型筛选 = "all";
    Explorer.排序方式 = v.query.sort ?? "import";
    const 搜框 = document.getElementById("ex-search") as HTMLInputElement | null;
    if (搜框) 搜框.value = "";
    const 类框 = document.getElementById("ex-type-filter") as HTMLSelectElement | null;
    if (类框) 类框.value = "all";
    const 排框 = document.getElementById("ex-sort") as HTMLSelectElement | null;
    if (排框) 排框.value = Explorer.排序方式;
    Explorer.所有内容 = r.items ?? [];
    Explorer.渲染内容列表();
    渲染保存视图();
    渲染位置列表();
    渲染标签树();
  } catch (err) {
    添加消息("运行智能视图失败：" + String(err), "error");
  }
}

async function 保存当前筛选(): Promise<void> {
  const 名 = window.prompt("智能视图名称：", "");
  if (!名 || !名.trim()) return;
  const condition: Explorer.查询条件 = {
    tags: typeof Explorer.当前标签ID === "number" ? [Explorer.当前标签ID] : undefined,
    type: Explorer.类型筛选 === "all" ? undefined : Explorer.类型筛选,
    text: Explorer.搜索关键词 || undefined,
    locations: Explorer.当前位置ID != null ? [Explorer.当前位置ID] : undefined,
    sort: Explorer.排序方式,
  };
  try {
    await window.kugua.request("mkg", "mkg.view.save", { name: 名.trim(), query: condition });
    await 加载保存视图();
    添加消息(`已保存智能视图「${名.trim()}」`, "system", "智能视图");
  } catch (err) {
    添加消息("保存智能视图失败：" + String(err), "error");
  }
}

export async function 加载位置(): Promise<void> {
  try {
    Explorer.受管位置列表 = (await window.kugua.request("mkg", "mkg.location.list", {})) as Explorer.位置[];
  } catch {
    Explorer.受管位置列表 = [];
  }
  渲染位置列表();
}

export function 渲染位置列表(): void {
  const 容器 = document.getElementById("ex-location-list");
  if (!容器) return;
  容器.innerHTML = "";
  const 全部 = document.createElement("div");
  全部.className = "ex-location-item" + (Explorer.当前位置ID == null ? " active" : "");
  全部.textContent = "全部位置";
  全部.addEventListener("click", () => {
    Explorer.当前位置ID = null;
    void Explorer.加载所有内容();
    渲染位置列表();
  });
  容器.appendChild(全部);
  for (const loc of Explorer.受管位置列表) {
    const 行 = document.createElement("div");
    行.className = "ex-location-item" + (Explorer.当前位置ID === loc.id ? " active" : "");
    const 名 = document.createElement("span");
    名.textContent = loc.name || loc.path.split(/[\\/]/).pop() || loc.path;
    名.title = loc.path;
    名.style.flex = "1";
    名.style.overflow = "hidden";
    名.style.textOverflow = "ellipsis";
    行.appendChild(名);
    const 删 = document.createElement("button");
    删.className = "mini-btn";
    删.textContent = "×";
    删.title = "移除该位置（不影响文件）";
    删.addEventListener("click", async (e) => {
      e.stopPropagation();
      if (!window.confirm(`移除位置「${loc.path}」？`)) return;
      try {
        await window.kugua.request("mkg", "mkg.location.remove", { id: loc.id });
      } catch {
        /* 忽略 */
      }
      if (Explorer.当前位置ID === loc.id) Explorer.当前位置ID = null;
      await 加载位置();
      await Explorer.加载所有内容();
    });
    行.appendChild(删);
    行.addEventListener("click", () => {
      Explorer.当前位置ID = loc.id;
      void Explorer.加载所有内容();
      渲染位置列表();
    });
    容器.appendChild(行);
  }
}

async function 添加位置(): Promise<void> {
  const 路径 = window.prompt("受管目录绝对路径：", "");
  if (!路径 || !路径.trim()) return;
  try {
    await window.kugua.request("mkg", "mkg.location.add", { path: 路径.trim() });
    await 加载位置();
    添加消息(`已添加位置：${路径.trim()}`, "system", "位置");
  } catch (err) {
    添加消息("添加位置失败：" + String(err), "error");
  }
}

async function 扫描位置(): Promise<void> {
  添加消息("正在扫描全部位置…", "system", "位置");
  try {
    const r = (await window.kugua.request("mkg", "mkg.location.scan", {}, 600000)) as Array<{
      path: string;
      added?: number;
      updated?: number;
      removed?: number;
    }>;
    const 摘要 =
      (r ?? []).map((x) => `${x.path}：+${x.added ?? 0}/~${x.updated ?? 0}/-${x.removed ?? 0}`).join("\n") ||
      "（无位置）";
    添加消息(`扫描完成\n${摘要}`, "system", "位置");
    await Explorer.加载所有内容();
  } catch (err) {
    添加消息("扫描失败：" + String(err), "error");
  }
}

/** 导出侧车：把节点标签写入文件旁的 .mkg.json */
export async function 导出侧车(item: Explorer.内容条目): Promise<void> {
  try {
    const r = await window.kugua.request("mkg", "mkg.sidecar.export", { nodeId: item.id });
    添加消息(`已导出侧车：${JSON.stringify(r)}`, "system", "侧车");
  } catch (err) {
    添加消息("导出侧车失败：" + String(err), "error");
  }
}


export async function 绑定智能视图与位置事件(): Promise<void> {
  // ===== 智能视图 / 位置（阶段 2）=====
  document.getElementById("ex-view-save")?.addEventListener("click", () => void 保存当前筛选());
  document.getElementById("ex-location-add")?.addEventListener("click", () => void 添加位置());
  document.getElementById("ex-location-scan")?.addEventListener("click", () => void 扫描位置());
  document.getElementById("settings-fts-rebuild")?.addEventListener("click", async () => {
    try {
      const r = (await window.kugua.request("mkg", "mkg.fts.rebuild", {})) as { 节点数?: number };
      添加消息(`全文索引已重建（${r?.节点数 ?? 0} 个节点）`, "system", "知识库维护");
    } catch (err) {
      添加消息("重建索引失败：" + String(err), "error");
    }
  });

  // 首次加载智能视图与位置
  await 加载保存视图();
  await 加载位置();
}
