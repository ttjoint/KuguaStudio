const fs = require('fs');
let content = fs.readFileSync('packages/gui/src/renderer/index.ts', 'utf8');

const moreExplorer = `
  function 更新文件信息面板(): void {
    if (!选中文件) {
      文件信息面板.classList.add("hidden");
      return;
    }
    文件信息面板.classList.remove("hidden");

    const f = 选中文件;
    const iconEl = document.getElementById("ex-info-icon") as HTMLDivElement;
    iconEl.className = "ex-info-icon " + 获取文件图标类(f.name, f.kind);
    if (f.kind === "directory") {
      iconEl.textContent = "📁";
      iconEl.style.background = "";
      iconEl.style.fontSize = "2rem";
    } else {
      iconEl.textContent = 获取扩展名(f.name).slice(0, 3);
    }

    document.getElementById("ex-info-name")!.textContent = 显示名(f);
    const aliasEl = document.getElementById("ex-info-alias")!;
    aliasEl.textContent = f.alias || "(无)";
    document.getElementById("ex-info-type")!.textContent = 获取文件类型描述(f.name, f.kind);
    document.getElementById("ex-info-size")!.textContent = f.kind === "directory" ? "-" : 格式化大小(f.size);
    const pathEl = document.getElementById("ex-info-path") as HTMLSpanElement;
    pathEl.textContent = f.path;
    pathEl.title = "点击复制路径: " + f.path;
    document.getElementById("ex-info-modified")!.textContent = 格式化时间(f.modifiedTime);

    const tagsEl = document.getElementById("ex-info-tags") as HTMLDivElement;
    tagsEl.innerHTML = "";
    if (f.tagPaths.length === 0) {
      tagsEl.innerHTML = '<span style="color:var(--text-dim);font-size:0.7rem">(无标签)</span>';
    } else {
      for (const tp of f.tagPaths) {
        const pathDiv = document.createElement("div");
        pathDiv.className = "ex-info-tag-path";
        pathDiv.innerHTML = tp.map((name, i) => (i > 0 ? '<span class="sep">/</span>' : "") + name).join("");
        tagsEl.appendChild(pathDiv);
      }
    }
  }

  async function 打开文件(file: 资源详情, programPath?: string): Promise<void> {
    try {
      if (programPath) {
        await window.kugua.request("mkg", "mkg.file.openWith", { resourceId: file.id, programPath });
      } else {
        await window.kugua.request("mkg", "mkg.file.open", { resourceId: file.id });
      }
    } catch (err) {
      添加消息("打开文件失败：" + String(err), "error");
    }
  }

  async function 在资源管理器中显示(file: 资源详情): Promise<void> {
    try {
      await window.kugua.request("mkg", "mkg.file.explorer", { resourceId: file.id });
    } catch (err) {
      添加消息("打开资源管理器失败：" + String(err), "error");
    }
  }

  async function 复制物理路径(file: 资源详情): Promise<void> {
    try {
      const result = (await window.kugua.request("mkg", "mkg.file.physicalPath", { resourceId: file.id })) as { path: string };
      await navigator.clipboard.writeText(result.path);
      状态栏计数.textContent = "已复制路径：" + result.path;
      setTimeout(() => { 状态栏计数.textContent = 筛选后的文件().length + " 个项目"; }, 2000);
    } catch (err) {
      添加消息("复制路径失败：" + String(err), "error");
    }
  }

  async function 设置别名(file: 资源详情, alias: string): Promise<void> {
    try {
      await window.kugua.request("mkg", "mkg.alias.set", { resourceId: file.id, alias });
      await 加载文件列表();
      添加消息("已设置别名：" + alias, "system");
    } catch (err) {
      添加消息("设置别名失败：" + String(err), "error");
    }
  }

  async function 加载打开方式列表(extension?: string): Promise<void> {
    try {
      打开方式列表 = (await window.kugua.request("mkg", "mkg.openwith.list", { extension })) as 打开方式配置[];
    } catch {
      打开方式列表 = [];
    }
  }

  async function 加载文件列表(): Promise<void> {
    try {
      let result: { items: 资源详情[]; total: number };
      if (当前标签ID === "all") {
        result = (await window.kugua.request("mkg", "mkg.resource.listDetail", { options: { limit: 1000 } })) as { items: 资源详情[]; total: number };
      } else {
        result = (await window.kugua.request("mkg", "mkg.resource.listByTagDetail", { tagId: 当前标签ID, options: { limit: 1000 } })) as { items: 资源详情[]; total: number };
      }
      所有文件 = result.items;
      渲染文件列表();
    } catch {
      所有文件 = [];
      渲染文件列表();
    }
  }

  async function 加载标签树(): Promise<void> {
    try {
      标签树 = (await window.kugua.request("mkg", "mkg.tag.tree", {})) as 标签节点[];
      渲染标签树();
    } catch {
      标签树 = [];
      渲染标签树();
    }
  }

  function 显示右键菜单(x: number, y: number): void {
    右键菜单.style.left = x + "px";
    右键菜单.style.top = y + "px";
    右键菜单.classList.remove("hidden");
  }

  function 隐藏右键菜单(): void {
    右键菜单.classList.add("hidden");
  }

  function 切换视图(mode: "large" | "list" | "details"): void {
    当前视图模式 = mode;
    大图标容器.classList.toggle("hidden", mode !== "large");
    列表容器.classList.toggle("hidden", mode !== "list");
    document.getElementById("ex-items-details")!.classList.toggle("hidden", mode !== "details");
    document.querySelectorAll(".ex-view-btn").forEach((btn) => {
      btn.classList.toggle("active", (btn as HTMLElement).dataset.viewmode === mode);
    });
  }
`;

// Find where to insert - after 更新面包屑 function
const insertMarker = '  function 更新面包屑(path: { name: string; id: number | "all" }[]): void {';
const idx = content.indexOf(insertMarker);
if (idx === -1) {
  console.log('ERROR: Could not find 更新面包屑');
  // Try finding after 筛选后的文件 closing
  const searchEnd = content.indexOf('  return files;\n  }');
  if (searchEnd !== -1) {
    console.log('Found 筛选后的文件 end');
  }
  process.exit(1);
}

// Find the closing brace of 更新面包屑
let braceCount = 0;
let funcStart = content.indexOf('{', idx);
let insertAfter = funcStart;
for (let i = funcStart; i < content.length; i++) {
  if (content[i] === '{') braceCount++;
  if (content[i] === '}') braceCount--;
  if (braceCount === 0) {
    insertAfter = i + 1;
    break;
  }
}

content = content.slice(0, insertAfter) + moreExplorer + content.slice(insertAfter);

console.log('Phase 2 complete');
fs.writeFileSync('packages/gui/src/renderer/index.ts', content, 'utf8');
