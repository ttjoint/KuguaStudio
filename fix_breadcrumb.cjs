const fs = require('fs');
let c = fs.readFileSync('packages/gui/src/renderer/index.ts', 'utf8');

// Find and fix the truncated 更新面包屑 function
const badStart = '  function 更新面包屑(path: { name: string; id: number | "all" }\n  function 更新文件信息面板(): void {';
const goodReplacement = `  function 更新面包屑(path: { name: string; id: number | "all" }[]): void {
    面包屑.innerHTML = "";
    path.forEach((p, i) => {
      if (i > 0) {
        const sep = document.createElement("span");
        sep.className = "ex-bc-sep";
        sep.textContent = "›";
        面包屑.appendChild(sep);
      }
      const item = document.createElement("span");
      item.className = "ex-bc-item";
      if (i === path.length - 1) item.classList.add("current");
      item.textContent = p.name;
      item.dataset.tagId = String(p.id);
      item.addEventListener("click", async () => {
        if (p.id === "all") {
          当前标签ID = "all";
        } else {
          当前标签ID = p.id as number;
        }
        选中文件 = null;
        文件信息面板.classList.add("hidden");
        更新面包屑(path.slice(0, i + 1));
        await 加载文件列表();
        渲染标签树();
      });
      面包屑.appendChild(item);
    });
  }

  function 更新文件信息面板(): void {`;

if (c.includes(badStart)) {
  c = c.replace(badStart, goodReplacement);
  console.log('Fixed truncated 更新面包屑 function');
} else {
  console.log('Looking for bad pattern...');
  const idx = c.indexOf('function 更新面包屑');
  if (idx !== -1) {
    console.log('Found at:', idx);
    console.log('Context:', JSON.stringify(c.substring(idx, idx + 300)));
  }
}

fs.writeFileSync('packages/gui/src/renderer/index.ts', c, 'utf8');
