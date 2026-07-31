const fs = require('fs');
let content = fs.readFileSync('packages/gui/src/renderer/index.ts', 'utf8');

const explorerInit = `
  export async function init(): Promise<void> {
    搜索框.addEventListener("input", () => {
      搜索关键词 = 搜索框.value;
      if (搜索防抖) clearTimeout(搜索防抖);
      搜索防抖 = window.setTimeout(() => {
        渲染文件列表();
      }, 200);
    });

    document.querySelectorAll<HTMLButtonElement>(".ex-view-btn").forEach((btn) => {
      btn.addEventListener("click", () => {
        const mode = btn.dataset.viewmode as "large" | "list" | "details";
        if (mode) 切换视图(mode);
      });
    });

    document.getElementById("ex-nav-up")?.addEventListener("click", async () => {
      当前标签ID = "all";
      选中文件 = null;
      更新面包屑([{ name: "所有文件", id: "all" }]);
      文件信息面板.classList.add("hidden");
      await 加载文件列表();
      渲染标签树();
    });

    document.getElementById("ex-nav-refresh")?.addEventListener("click", async () => {
      await 加载标签树();
      await 加载文件列表();
    });

    document.addEventListener("click", () => 隐藏右键菜单());
    右键菜单.addEventListener("click", async (e) => {
      const action = (e.target as HTMLElement).dataset.action;
      if (!action || !选中文件) return;
      switch (action) {
        case "open":
          await 打开文件(选中文件);
          break;
        case "explorer":
          await 在资源管理器中显示(选中文件);
          break;
        case "copyPath":
          await 复制物理路径(选中文件);
          break;
        case "rename":
          显示重命名对话框(选中文件);
          break;
        case "openWith":
          await 加载打开方式列表(选中文件.extension);
          显示打开方式对话框(选中文件);
          break;
      }
      隐藏右键菜单();
    });

    document.getElementById("ex-btn-open")?.addEventListener("click", () => {
      if (选中文件) void 打开文件(选中文件);
    });
    document.getElementById("ex-btn-explorer")?.addEventListener("click", () => {
      if (选中文件) void 在资源管理器中显示(选中文件);
    });
    document.getElementById("ex-info-path")?.addEventListener("click", () => {
      if (选中文件) void 复制物理路径(选中文件);
    });

    const owDialog = document.getElementById("openwith-dialog") as HTMLDivElement;
    const owList = document.getElementById("ow-list") as HTMLDivElement;
    const owProgram = document.getElementById("ow-program") as HTMLInputElement;
    const owArgs = document.getElementById("ow-args") as HTMLInputElement;
    const owLabel = document.getElementById("ow-label") as HTMLInputElement;
    const owSetDefault = document.getElementById("ow-set-default") as HTMLInputElement;

    function 显示打开方式对话框(file: 资源详情): void {
      owList.innerHTML = "";
      for (const ow of 打开方式列表) {
        const item = document.createElement("div");
        item.className = "ow-item";
        item.innerHTML = "<strong>" + (ow.label || ow.programPath) + "</strong><br><span style=\"color:var(--text-dim);font-size:0.8rem\">" + ow.programPath + "</span>";
        item.addEventListener("click", async () => {
          await 打开文件(file, ow.programPath);
          owDialog.classList.add("hidden");
        });
        owList.appendChild(item);
      }
      owProgram.value = "";
      owArgs.value = '"{0}"';
      owLabel.value = "";
      owSetDefault.checked = false;
      owDialog.classList.remove("hidden");
    }

    document.getElementById("ow-cancel")?.addEventListener("click", () => {
      owDialog.classList.add("hidden");
    });
    document.getElementById("ow-confirm")?.addEventListener("click", async () => {
      if (!选中文件) return;
      const programPath = owProgram.value.trim();
      if (!programPath) {
        添加消息("请指定程序路径", "error");
        return;
      }
      await 打开文件(选中文件, programPath);
      if (owSetDefault.checked) {
        try {
          await window.kugua.request("mkg", "mkg.openwith.add", {
            extension: 选中文件.extension,
            programPath,
            arguments: owArgs.value,
            label: owLabel.value || null,
          });
          添加消息("已添加默认打开方式", "system");
        } catch (err) {
          添加消息("添加打开方式失败：" + String(err), "error");
        }
      }
      owDialog.classList.add("hidden");
    });
    owDialog.querySelector(".modal-backdrop")?.addEventListener("click", () => {
      owDialog.classList.add("hidden");
    });

    const renameDialog = document.getElementById("rename-dialog") as HTMLDivElement;
    const renameInput = document.getElementById("rename-input") as HTMLInputElement;
    const renameHint = document.getElementById("rename-hint") as HTMLDivElement;
    let 重命名目标: 资源详情 | null = null;

    function 显示重命名对话框(file: 资源详情): void {
      重命名目标 = file;
      renameHint.textContent = "原名称：" + 显示名(file) + "（" + file.name + "）";
      renameInput.value = file.alias || file.name;
      renameDialog.classList.remove("hidden");
      renameInput.focus();
      renameInput.select();
    }

    document.getElementById("rename-cancel")?.addEventListener("click", () => {
      renameDialog.classList.add("hidden");
      重命名目标 = null;
    });
    document.getElementById("rename-confirm")?.addEventListener("click", async () => {
      if (!重命名目标) return;
      const newName = renameInput.value.trim();
      if (!newName) {
        添加消息("名称不能为空", "error");
        return;
      }
      await 设置别名(重命名目标, newName);
      renameDialog.classList.add("hidden");
      重命名目标 = null;
    });
    renameDialog.querySelector(".modal-backdrop")?.addEventListener("click", () => {
      renameDialog.classList.add("hidden");
      重命名目标 = null;
    });
    renameInput.addEventListener("keydown", (e) => {
      if (e.key === "Enter") {
        document.getElementById("rename-confirm")?.click();
      }
    });

    document.querySelectorAll<HTMLButtonElement>(".tab-btn").forEach((btn) => {
      btn.addEventListener("click", () => {
        const view = btn.dataset.view;
        if (!view) return;
        document.querySelectorAll(".tab-btn").forEach((b) => b.classList.remove("active"));
        btn.classList.add("active");
        document.querySelectorAll(".view-panel").forEach((p) => p.classList.remove("active"));
        document.getElementById(view + "-view")?.classList.add("active");
      });
    });

    大图标容器.addEventListener("click", () => {
      选中文件 = null;
      文件信息面板.classList.add("hidden");
      渲染文件列表();
    });
    列表容器.addEventListener("click", () => {
      选中文件 = null;
      文件信息面板.classList.add("hidden");
      渲染文件列表();
    });
    详情容器.addEventListener("click", () => {
      选中文件 = null;
      文件信息面板.classList.add("hidden");
      渲染文件列表();
    });

    document.querySelectorAll<HTMLElement>(".ex-section-title").forEach((title) => {
      title.addEventListener("click", () => {
        const content = title.nextElementSibling as HTMLElement;
        const toggle = title.querySelector(".ex-toggle") as HTMLElement;
        if (content) {
          content.classList.toggle("hidden");
          if (toggle) {
            toggle.textContent = content.classList.contains("hidden") ? "▶" : "▼";
          }
        }
      });
    });

    更新面包屑([{ name: "所有文件", id: "all" }]);
    await 加载标签树();
    await 加载文件列表();
    切换视图("large");
  }
}

`;

// Find the end of 切换视图 function and close namespace, add Explorer event bindings
const insertMarker = '  function 切换视图(mode: "large" | "list" | "details"): void {';
const idx = content.indexOf(insertMarker);
if (idx === -1) {
  console.log('ERROR: Could not find 切换视图');
  process.exit(1);
}

// Find closing brace of 切换视图
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

// Insert init and close namespace before 事件绑定
const eventBindingMarker = '// ===== 事件绑定 =====';
const eventIdx = content.indexOf(eventBindingMarker);
if (eventIdx === -1) {
  console.log('ERROR: Could not find 事件绑定');
  process.exit(1);
}

// First insert init code before 事件绑定, replacing everything between 切换视图 end and 事件绑定
content = content.slice(0, insertAfter) + explorerInit + content.slice(eventIdx);

// Now update onReady to call Explorer.init()
const oldOnReady = `window.kugua.onReady(() => {
  void 刷新模块列表();
  void 刷新统计();
});`;

const newOnReady = `window.kugua.onReady(() => {
  void 刷新模块列表();
  void 刷新统计();
  void Explorer.init();
});`;

if (content.includes(oldOnReady)) {
  content = content.replace(oldOnReady, newOnReady);
  console.log('Updated onReady to call Explorer.init()');
} else {
  console.log('WARNING: Could not find old onReady pattern');
  // Try with CRLF
  const oldOnReadyCRLF = oldOnReady.replace(/\n/g, '\r\n');
  if (content.includes(oldOnReadyCRLF)) {
    content = content.replace(oldOnReadyCRLF, newOnReady.replace(/\n/g, '\r\n'));
    console.log('Updated onReady with CRLF');
  }
}

console.log('Phase 3 complete');
fs.writeFileSync('packages/gui/src/renderer/index.ts', content, 'utf8');
