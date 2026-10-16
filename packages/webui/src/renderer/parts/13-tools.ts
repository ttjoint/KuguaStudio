import { 添加消息 } from "./03-preview";

// ===== 工具页（音乐 / 媒体 / 模式 / 二维码）=====
export let 工具已初始化 = false;
export let 媒体文件列表: string[] = [];

export type 歌单条目 = { id: string; 名称: string; 歌手: string };
export function 读取歌单(): 歌单条目[] {
  try {
    const 原始 = localStorage.getItem("kugua_music_playlist");
    return 原始 ? (JSON.parse(原始) as 歌单条目[]) : [];
  } catch {
    return [];
  }
}
export function 保存歌单(列表: 歌单条目[]): void {
  try {
    localStorage.setItem("kugua_music_playlist", JSON.stringify(列表.slice(0, 100)));
  } catch {
    /* 忽略 */
  }
}
export function 加入歌单(歌: 歌单条目): void {
  const 列表 = 读取歌单().filter((x) => x.id !== 歌.id);
  列表.unshift(歌);
  保存歌单(列表);
  渲染歌单();
}
export function 渲染歌单(): void {
  const 容器 = document.getElementById("music-playlist");
  if (!容器) return;
  const 列表 = 读取歌单();
  容器.innerHTML = "";
  if (列表.length === 0) {
    容器.innerHTML = '<li class="oc-module-item" style="opacity:0.6">（空）</li>';
    return;
  }
  for (const 歌 of 列表) {
    const li = document.createElement("li");
    li.className = "oc-module-item job-item";
    const 名 = document.createElement("span");
    名.className = "job-title";
    名.textContent = `${歌.名称} - ${歌.歌手}`;
    li.appendChild(名);
    const 播 = document.createElement("button");
    播.className = "tb-btn small";
    播.textContent = "播放";
    播.addEventListener("click", () => void 音乐播放(歌.id, `${歌.名称} - ${歌.歌手}`));
    li.appendChild(播);
    容器.appendChild(li);
  }
}

export async function 初始化工具页(): Promise<void> {
  if (工具已初始化) return;
  工具已初始化 = true;
  void 刷新模式列表();
  渲染歌单();
}

export async function 刷新模式列表(): Promise<void> {
  const 框 = document.getElementById("mode-select") as HTMLSelectElement | null;
  if (!框) return;
  try {
    const 模式 = (await window.kugua.request("chatmode", "chatmode.list", {})) as string[];
    框.innerHTML = (模式 ?? []).map((m) => `<option value="${m}">${m}</option>`).join("");
  } catch {
    /* 忽略 */
  }
}

export async function 模式生成(): Promise<void> {
  const 框 = document.getElementById("mode-select") as HTMLSelectElement | null;
  const 出 = document.getElementById("mode-result");
  if (!框 || !出) return;
  出.textContent = "生成中…";
  try {
    const r = (await window.kugua.request("chatmode", "chatmode.say", { 模式: 框.value })) as { 结果: string };
    出.textContent = r.结果 || "（该模式无语料）";
  } catch (err) {
    出.textContent = "失败：" + String(err);
  }
}

export async function 音乐搜索(): Promise<void> {
  const 输入 = document.getElementById("music-q") as HTMLInputElement | null;
  const 列表 = document.getElementById("music-list");
  if (!输入 || !列表) return;
  const q = 输入.value.trim();
  if (!q) return;
  列表.innerHTML = '<li class="oc-module-item" style="opacity:0.6">搜索中…</li>';
  try {
    const r = (await window.kugua.request("music", "music.search", { 关键词: q, 来源: "wyy", 数量: 10 })) as {
      列表: Array<{ id: string; 名称: string; 歌手: string; 专辑: string; 可下载: boolean }>;
    };
    列表.innerHTML = "";
    if (!r.列表 || r.列表.length === 0) {
      列表.innerHTML = '<li class="oc-module-item" style="opacity:0.6">无结果</li>';
      return;
    }
    for (const 歌 of r.列表) {
      const li = document.createElement("li");
      li.className = "oc-module-item job-item";
      const 名 = document.createElement("span");
      名.className = "job-title";
      名.textContent = `${歌.名称} - ${歌.歌手}${歌.可下载 ? "" : "（不可下载）"}`;
      名.title = 歌.专辑;
      li.appendChild(名);
      const 播 = document.createElement("button");
      播.className = "tb-btn small";
      播.textContent = "播放";
      播.addEventListener("click", () => void 音乐播放(歌.id, `${歌.名称} - ${歌.歌手}`));
      li.appendChild(播);
      const 下 = document.createElement("button");
      下.className = "tb-btn small";
      下.textContent = "下载";
      下.addEventListener("click", async () => {
        try {
          const d = (await window.kugua.request("music", "music.download", { id: 歌.id, 来源: "wyy" }, 300000)) as { 路径: string };
          添加消息(`已下载：${d.路径}`, "system", "音乐");
        } catch (err) {
          添加消息("下载失败：" + String(err), "error");
        }
      });
      li.appendChild(下);
      列表.appendChild(li);
    }
  } catch (err) {
    列表.innerHTML = `<li class="oc-module-item" style="color:#e66">搜索失败：${String(err)}</li>`;
  }
}

export async function 音乐播放(id: string, 描述: string): Promise<void> {
  const 播放器 = document.getElementById("music-audio") as HTMLAudioElement | null;
  添加消息(`正在获取「${描述}」…`, "system", "音乐");
  try {
    const r = (await window.kugua.request("music", "music.play", { id, 来源: "wyy" }, 300000)) as { base64: string };
    if (播放器 && r.base64) {
      播放器.classList.remove("hidden");
      播放器.src = `data:audio/mp3;base64,${r.base64}`;
      void 播放器.play();
    }
    const 分隔 = 描述.split(" - ");
    加入歌单({ id, 名称: 分隔[0] ?? 描述, 歌手: 分隔[1] ?? "" });
    添加消息(`已播放：${描述}`, "system", "音乐");
  } catch (err) {
    添加消息("播放失败：" + String(err), "error");
  }
}

export async function 选择媒体(): Promise<void> {
  try {
    const 路径 = (await window.kugua.dialog.openFiles({ title: "选择音视频文件（可多选）", multi: true })) as string[];
    if (路径 && 路径.length > 0) {
      媒体文件列表 = 路径;
      const 显示 = document.getElementById("media-path");
      if (显示) 显示.textContent = `已选择 ${路径.length} 个文件：` + 路径.map((p) => p.split(/[\\/]/).pop()).join("、");
    }
  } catch (err) {
    添加消息("选择文件失败：" + String(err), "error");
  }
}

export async function 媒体处理(op: string): Promise<void> {
  const 结果框 = document.getElementById("media-result");
  if (!结果框) return;
  if (媒体文件列表.length === 0) {
    结果框.textContent = "请先选择媒体文件";
    return;
  }
  结果框.innerHTML = '<div style="opacity:0.6">处理中…（大文件可能较慢）</div>';
  const 输出: string[] = [];
  for (const 路径 of 媒体文件列表) {
    const 名 = (路径.split(/[\\/]/).pop() ?? 路径) + "";
    const 参数: Record<string, unknown> = { path: 路径 };
    let 动作 = "av." + op;
    if (op === "transcode") 参数.输出格式 = "mp4";
    else if (op === "mp3") 动作 = "av.toMp3";
    else if (op === "wav") 动作 = "av.toWav";
    else if (op === "amr") 动作 = "av.toAmr";
    else if (op === "extractAudio") {
      动作 = "av.extractAudio";
      参数.格式 = "mp3";
    } else if (op === "reverse") 动作 = "av.reverse";
    else if (op === "enhance") 动作 = "av.enhance";
    else if (op === "gif") {
      动作 = "av.videoToGif";
      参数.fps = 10;
      参数.宽度 = 480;
    } else if (op === "frames") {
      动作 = "av.frames";
      参数.数量 = 9;
    } else if (op === "probe") 动作 = "av.probe";
    try {
      const r = (await window.kugua.request("av", 动作, 参数, 300000)) as {
        base64?: string;
        format?: string;
        images?: string[];
        info?: unknown;
        message?: string;
      };
      let 块 = `<div class="media-item"><div class="media-item-name">${名}</div>`;
      if (动作 === "av.probe") 块 += `<pre>${JSON.stringify(r.info, null, 2)}</pre>`;
      else if (r.images && r.images.length > 0)
        块 += r.images.map((b) => `<img src="data:image/png;base64,${b}">`).join("");
      else if (r.base64) {
        const fmt = r.format ?? "bin";
        if (["mp3", "wav", "amr", "aac", "ogg"].includes(fmt))
          块 += `<audio controls src="data:audio/${fmt};base64,${r.base64}"></audio>`;
        else if (["mp4", "webm", "mkv", "mov"].includes(fmt))
          块 += `<video controls src="data:video/${fmt};base64,${r.base64}"></video>`;
        else if (fmt === "gif") 块 += `<img src="data:image/gif;base64,${r.base64}">`;
        else 块 += `<a download="out.${fmt}" href="data:application/octet-stream;base64,${r.base64}">下载结果（${fmt}）</a>`;
      } else 块 += r.message ?? "（无输出）";
      块 += "</div>";
      输出.push(块);
    } catch (err) {
      输出.push(`<div class="media-item" style="color:#e66">${名}：失败 ${String(err)}</div>`);
    }
  }
  结果框.innerHTML = 输出.join("");
}

export async function 生成二维码工具(): Promise<void> {
  const 输入 = document.getElementById("qr-input") as HTMLInputElement | null;
  const 出 = document.getElementById("qr-result");
  if (!输入 || !出) return;
  const 文本 = 输入.value.trim();
  if (!文本) return;
  出.innerHTML = '<div style="opacity:0.6">生成中…</div>';
  try {
    const r = (await window.kugua.request("qrcode", "qrcode.generate", { 文本, 尺寸: 240 })) as { base64: string; format: string };
    出.innerHTML = `<img src="data:image/${r.format};base64,${r.base64}">`;
  } catch (err) {
    出.innerHTML = `<div style="color:#e66">失败：${String(err)}</div>`;
  }
}

// 工具页事件绑定
export const 音乐搜索按钮 = document.getElementById("music-search-btn");
音乐搜索按钮?.addEventListener("click", () => void 音乐搜索());
document.getElementById("music-q")?.addEventListener("keydown", (e) => {
  if ((e as KeyboardEvent).key === "Enter") void 音乐搜索();
});
document.getElementById("media-pick")?.addEventListener("click", () => void 选择媒体());
document.querySelectorAll("[data-media]").forEach((btn) => {
  btn.addEventListener("click", () => void 媒体处理((btn as HTMLElement).dataset.media ?? ""));
});
document.getElementById("mode-say-btn")?.addEventListener("click", () => void 模式生成());
document.getElementById("qr-btn")?.addEventListener("click", () => void 生成二维码工具());
document.getElementById("music-clear")?.addEventListener("click", () => {
  保存歌单([]);
  渲染歌单();
});

