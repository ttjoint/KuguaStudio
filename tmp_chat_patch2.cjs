const fs = require("fs");
const 文件 = "d:/Projects/KuguaStudio/packages/gui/src/renderer/index.ts";
let s = fs.readFileSync(文件, "utf8");
let 计数 = 0;

function 替换(旧, 新) {
  if (!s.includes(旧)) {
    console.error("未找到锚点:\n" + 旧.slice(0, 80).replace(/\n/g, "\\n"));
    process.exit(1);
  }
  s = s.split(旧).join(新);
  计数++;
}

// ===== 1. Window 接口加 writeTempFile =====
替换(
  `    broadcast: (action: string, params?: unknown) => Promise<unknown>;
    onLog: (callback: (entry: unknown) => void) => void;`,
  `    broadcast: (action: string, params?: unknown) => Promise<unknown>;
    writeTempFile: (payload: { base64?: string; name?: string; ext?: string }) => Promise<string>;
    onLog: (callback: (entry: unknown) => void) => void;`
);

// ===== 2. 刷新附件区 base64 显示成 DataURL =====
替换(
  `      img.src = att.base64 || 文件URL(att.path);`,
  `      img.src = att.base64 ? \`data:\${att.type.startsWith("image/") ? att.type : "image/png"};base64,\${att.base64}\` : 文件URL(att.path);`
);

// ===== 3. 添加消息 / 添加HTML 重构：加日期、搜索、删除 =====
替换(
  `function 添加消息(内容: string, 类型: "user" | "system" | "error" = "system", 发送者?: string): void {
  const div = document.createElement("div");
  div.className = \`chat-msg \${类型}\`;
  if (发送者) {
    div.innerHTML = \`<div class="msg-sender">\${发送者}</div><div class="msg-content">\${内容}</div>\`;
  } else {
    div.innerHTML = \`<div class="msg-content">\${内容}</div>\`;
  }
  聊天日志.appendChild(div);
  聊天日志.scrollTop = 聊天日志.scrollHeight;
}

function 添加HTML(html: string, 类型: "system" | "error" = "system"): void {
  const div = document.createElement("div");
  div.className = \`chat-msg \${类型}\`;
  div.innerHTML = html;
  聊天日志.appendChild(div);
  聊天日志.scrollTop = 聊天日志.scrollHeight;
}`,
  `const 聊天搜索框 = document.getElementById("chat-search") as HTMLInputElement | null;

function 本地时间(d: Date): string {
  const p = (n: number) => String(n).padStart(2, "0");
  return \`\${d.getFullYear()}-\${p(d.getMonth() + 1)}-\${p(d.getDate())} \${p(d.getHours())}:\${p(d.getMinutes())}\`;
}

function 时间编码(d = new Date()): string {
  const p = (n: number) => String(n).padStart(2, "0");
  return \`\${d.getFullYear()}\${p(d.getMonth() + 1)}\${p(d.getDate())}_\${p(d.getHours())}\${p(d.getMinutes())}\${p(d.getSeconds())}\`;
}

function 读文件DataURL(f: File): Promise<{ base64: string; mime: string; name: string }> {
  return new Promise((resolve, reject) => {
    const r = new FileReader();
    r.onload = () => {
      const 结果 = String(r.result ?? "");
      const 逗号 = 结果.indexOf(",");
      resolve({ base64: 逗号 >= 0 ? 结果.slice(逗号 + 1) : 结果, mime: f.type || "image/png", name: f.name || "" });
    };
    r.onerror = () => reject(new Error("读取文件失败"));
    r.readAsDataURL(f);
  });
}

function 创建消息节点(类型: "user" | "system" | "error"): HTMLDivElement {
  const div = document.createElement("div");
  div.className = \`chat-msg \${类型}\`;
  const meta = document.createElement("div");
  meta.className = "msg-meta";
  meta.innerHTML = \`<span class="msg-time">\${本地时间(new Date())}</span>\`;
  const content = document.createElement("div");
  content.className = "msg-content";
  div.appendChild(meta);
  div.appendChild(content);
  const del = document.createElement("button");
  del.className = "msg-del";
  del.title = "删除此条消息";
  del.textContent = "×";
  del.addEventListener("click", () => div.remove());
  div.appendChild(del);
  return div;
}

function 筛选聊天消息(div: HTMLElement): void {
  const q = 聊天搜索框?.value.trim() ?? "";
  if (!q) {
    div.style.display = "";
    div.classList.remove("search-hit");
    return;
  }
  const 命中 = (div.dataset.text ?? "").includes(q);
  div.style.display = 命中 ? "" : "none";
  if (命中) div.classList.add("search-hit");
}

function 添加消息(内容: string, 类型: "user" | "system" | "error" = "system", 发送者?: string): void {
  const div = 创建消息节点(类型);
  if (发送者) {
    div.querySelector<HTMLDivElement>(".msg-meta")?.insertAdjacentHTML("beforeend", \`<span class="msg-sender">\${发送者}</span>\`);
  }
  const c = div.querySelector<HTMLDivElement>(".msg-content");
  if (c) c.textContent = 内容;
  div.dataset.text = 内容;
  聊天日志.appendChild(div);
  筛选聊天消息(div);
  聊天日志.scrollTop = 聊天日志.scrollHeight;
}

function 添加HTML(html: string, 类型: "system" | "error" = "system"): void {
  const div = 创建消息节点(类型);
  const c = div.querySelector<HTMLDivElement>(".msg-content");
  if (c) c.innerHTML = html;
  div.dataset.text = c?.textContent ?? "";
  聊天日志.appendChild(div);
  筛选聊天消息(div);
  聊天日志.scrollTop = 聊天日志.scrollHeight;
}`
);

// ===== 4. 聊天侧边栏 drop：外部无路径图片读成 base64 附件 =====
替换(
  `  const files = e.dataTransfer?.files;
  if (files && files.length > 0) {
    const f = files[0] as File & { path?: string };
    if (是图片路径(f.path)) {
      当前附件.push({ path: f.path, name: f.name, type: "image/" });
      刷新附件区();
      添加消息("已将图片「" + f.name + "」加入，请输入处理指令（如：灰度、旋转90度、反色）。", "system");
    } else if (f.path) {
      输入框.value = (输入框.value ? 输入框.value + " " : "") + "[文件:" + f.path + "]";
      添加消息("已将文件「" + f.name + "」加入，请告诉我如何处理它。", "system");
    }
    输入框.focus();
  }
});`,
  `  const files = e.dataTransfer?.files;
  if (files && files.length > 0) {
    const f = files[0] as File & { path?: string };
    if (是图片路径(f.path) || /^image\\//.test(f.type)) {
      if (f.path) {
        当前附件.push({ path: f.path, name: f.name || "图片", type: f.type || "image/" });
      } else if (f.type) {
        // 无本地路径（如从浏览器拖入）：读取为 base64 附件
        try {
          const 读 = await 读文件DataURL(f);
          当前附件.push({ base64: 读.base64, name: 读.name || "图片", type: 读.mime });
        } catch (err) {
          添加消息("读取图片失败：" + String(err), "error");
          return;
        }
      }
      刷新附件区();
      添加消息("已将图片「" + (f.name || "图片") + "」加入，请输入处理指令（如：灰度、旋转90度、反色）。", "system");
    } else if (f.path) {
      输入框.value = (输入框.value ? 输入框.value + " " : "") + "[文件:" + f.path + "]";
      添加消息("已将文件「" + f.name + "」加入，请告诉我如何处理它。", "system");
    } else if (f.type) {
      try {
        const 读 = await 读文件DataURL(f);
        当前附件.push({ base64: 读.base64, name: 读.name || "附件", type: 读.mime });
        刷新附件区();
        添加消息("已将文件「" + (f.name || "附件") + "」加入。", "system");
      } catch (err) {
        添加消息("读取文件失败：" + String(err), "error");
      }
    }
    输入框.focus();
  }
});`
);

// ===== 5. 知识库 drop：无路径外部文件写入临时文件后按原名/时间编码导入 =====
替换(
  `  const 聊天文件 = e.dataTransfer?.getData("text/kugua-file");
  const files = e.dataTransfer?.files;
  const 外部路径 = files && files.length > 0 ? (files[0] as File & { path?: string }).path : null;
  const 目标 = 资源路径 || 聊天文件 || 外部路径;
  if (!目标) return;
  添加消息("正在把「" + 目标 + "」导入知识库…", "system");
  try {
    await window.kugua.request("mkg", "mkg.resource.import", { path: 目标 });
    添加消息("已导入知识库：" + 目标, "system");
    void Explorer.刷新();
    void 刷新统计();
  } catch (err) {
    添加消息("导入失败：" + String(err), "error");
  }
});`,
  `  const 聊天文件 = e.dataTransfer?.getData("text/kugua-file");
  const files = e.dataTransfer?.files;
  const f = files && files.length > 0 ? (files[0] as File & { path?: string }) : null;
  const 外部路径 = f?.path ?? null;
  const 有路径目标 = 资源路径 || 聊天文件 || 外部路径;
  if (有路径目标) {
    添加消息("正在把「" + 有路径目标 + "」导入知识库…", "system");
    try {
      await window.kugua.request("mkg", "mkg.resource.import", { path: 有路径目标 });
      添加消息("已导入知识库：" + 有路径目标, "system");
      void Explorer.刷新();
      void 刷新统计();
    } catch (err) {
      添加消息("导入失败：" + String(err), "error");
    }
    return;
  }
  // 无本地路径（如从浏览器拖入）：写入临时文件后按原名（无文件名则用时间编码）导入
  if (f && f.type) {
    try {
      const 读 = await 读文件DataURL(f);
      const ext = (读.mime.split("/")[1] || "bin").replace(/\\+.*$/, "").toLowerCase();
      const 原名 = 读.name || "";
      const 最终名 = 原名 || (时间编码() + "." + ext);
      添加消息("正在把外部内容「" + 最终名 + "」导入知识库…", "system");
      const 临时路径 = await window.kugua.writeTempFile({ base64: 读.base64, name: 最终名 });
      await window.kugua.request("mkg", "mkg.resource.importFile", { sourcePath: 临时路径, name: 最终名 });
      添加消息("已导入知识库：" + 最终名, "system");
      void Explorer.刷新();
      void 刷新统计();
    } catch (err) {
      添加消息("导入失败：" + String(err), "error");
    }
  }
});`
);

// ===== 6. 聊天搜索监听 =====
替换(
  `document.getElementById("refresh-modules")?.addEventListener("click", () => void 刷新模块列表());`,
  `// ===== 聊天搜索与清除 =====
const 聊天搜索清除 = document.getElementById("chat-search-clear") as HTMLButtonElement | null;
function 应用聊天搜索(): void {
  const q = 聊天搜索框?.value.trim() ?? "";
  if (聊天搜索清除) 聊天搜索清除.classList.toggle("hidden", !q);
  聊天日志.querySelectorAll<HTMLElement>(".chat-msg").forEach((m) => 筛选聊天消息(m));
}
聊天搜索框?.addEventListener("input", 应用聊天搜索);
聊天搜索清除?.addEventListener("click", () => {
  if (聊天搜索框) 聊天搜索框.value = "";
  应用聊天搜索();
});

document.getElementById("refresh-modules")?.addEventListener("click", () => void 刷新模块列表());`
);

fs.writeFileSync(文件, s);
console.log("补丁完成，替换 " + 计数 + " 处");