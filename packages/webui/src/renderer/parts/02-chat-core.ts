// ===== 对话终端 =====

export const 聊天日志 = document.getElementById("chat-log") as HTMLDivElement;
export const 输入框 = document.getElementById("chat-input") as HTMLInputElement;
// ===== 指令输入提示 =====
/** 已注册的模块指令库：命令前缀 + 说明，用于输入斜杠或指令前缀时给出提示 */
export interface 指令提示项 { 命令: string; 说明: string }
export const 指令库: 指令提示项[] = [
  { 命令: "帮助", 说明: "查看可用指令" },
  { 命令: "占卜", 说明: "周易占卜" },
  { 命令: "头像", 说明: "查询 QQ 头像（如 10001的头像）" },
  { 命令: "群头像", 说明: "查询群历史头像（如 群1005625206的头像）" },
  { 命令: "二维码", 说明: "生成二维码" },
  { 命令: "点歌", 说明: "搜索并播放歌曲（网易云）" },
  { 命令: "搜歌", 说明: "搜索歌曲" },
  { 命令: "吃什么", 说明: "推荐吃什么" },
  { 命令: "搜索", 说明: "按路径/文件名搜索资源" },
  { 命令: "搜索内容", 说明: "按内容搜索资源" },
  { 命令: "导入", 说明: "导入路径到知识库" },
  { 命令: "资源列表", 说明: "列出知识库资源" },
  { 命令: "标签列表", 说明: "列出所有标签" },
  { 命令: "统计", 说明: "知识库统计" },
  { 命令: "模块列表", 说明: "查看模块注册详情" },
  { 命令: "启动", 说明: "启动模块" },
  { 命令: "停止", 说明: "停止模块" },
  { 命令: "定时任务", 说明: "查看定时任务" },
  { 命令: "任务动作", 说明: "列出可定时的能力动作" },
  { 命令: "添加定时任务", 说明: "添加定时任务" },
  { 命令: "添加启动任务", 说明: "添加启动（登录）时执行一次的任务" },
  { 命令: "暂停定时任务", 说明: "暂停定时任务" },
  { 命令: "恢复定时任务", 说明: "恢复定时任务" },
  { 命令: "删除定时任务", 说明: "删除定时任务" },
  { 命令: "立即执行定时任务", 说明: "立即执行定时任务" },
  { 命令: "监控", 说明: "系统状态监控" },
  { 命令: "问AI", 说明: "AI 问答" },
  { 命令: "AI图片", 说明: "AI 生成图片" },
  { 命令: "清空AI", 说明: "清空 AI 记忆" },
  { 命令: "说话", 说明: "语音合成朗读" },
  { 命令: "灰度", 说明: "图片灰度" },
  { 命令: "反色", 说明: "图片反色/负片" },
  { 命令: "水平翻转", 说明: "图片水平翻转" },
  { 命令: "垂直翻转", 说明: "图片垂直翻转" },
  { 命令: "镜像", 说明: "图片镜像" },
  { 命令: "旋转", 说明: "图片旋转 N 度" },
  { 命令: "缩放", 说明: "图片缩放" },
  { 命令: "放大", 说明: "图片放大" },
  { 命令: "缩小", 说明: "图片缩小" },
  { 命令: "高清", 说明: "图片高清放大" },
  { 命令: "切", 说明: "图片上下左右切割" },
  { 命令: "切边", 说明: "图片四边等切" },
  { 命令: "抖", 说明: "图片抖动" },
  { 命令: "内抖", 说明: "图片内抖" },
  { 命令: "滚动", 说明: "图片滚动" },
  { 命令: "网格化", 说明: "图片网格化" },
  { 命令: "抠图", 说明: "图片抠图去背景" },
  { 命令: "做旧", 说明: "图片做旧" },
  { 命令: "取色", 说明: "图片取色" },
  { 命令: "竖拼", 说明: "图片纵向拼接" },
  { 命令: "横拼", 说明: "图片横向拼接" },
  { 命令: "摸摸", 说明: "图片摸摸" },
  { 命令: "幻影", 说明: "幻影坦克" },
  { 命令: "拆", 说明: "拆帧拆格" },
  { 命令: "拆帧", 说明: "拆帧平铺" },
  { 命令: "删", 说明: "删帧" },
  { 命令: "合", 说明: "合成 GIF" },
  { 命令: "乱序", 说明: "打乱 GIF 帧序" },
  { 命令: "gif", 说明: "webp 转 GIF PNG" },
  { 命令: "倍速", 说明: "GIF 倍速" },
  { 命令: "像素字", 说明: "像素字生成" },
  { 命令: "扭曲", 说明: "扭曲文字 GIF" },
  { 命令: "噪声", 说明: "随机像素图" },
  { 命令: "验证码", 说明: "验证码图片" },
  { 命令: "色块", 说明: "纯色色块" },
  { 命令: "遗像", 说明: "图片灰度遗像" },
  { 命令: "CIS", 说明: "CIS 色卡" },
  { 命令: "掷骰", 说明: "掷骰子" },
  { 命令: "d6", 说明: "掷骰 r3d6 式" },
  { 命令: "反转", 说明: "文本反转" },
  { 命令: "大写", 说明: "文本转大写" },
  { 命令: "小写", 说明: "文本转小写" },
  { 命令: "乱序", 说明: "文本乱序" },
  { 命令: "攻受", 说明: "攻受文生成" },
  { 命令: "讽刺", 说明: "苏联笑话讽刺" },
  { 命令: "什么是", 说明: "概念流水账" },
  { 命令: "狗屁不通", 说明: "狗屁不通文章" },
  { 命令: "云杰说道", 说明: "云杰说道文章" },
  { 命令: "营销号", 说明: "营销号短文" },
  { 命令: "火星文", 说明: "文本转火星文" },
  { 命令: "随机汉字", 说明: "随机汉字" },
  { 命令: "历史上的今天", 说明: "历史上的今天" },
  { 命令: "今天", 说明: "今夕是何年" },
  { 命令: "黄历", 说明: "今日黄历" },
  { 命令: "翻译", 说明: "翻译成英语" },
  { 命令: "翻译成", 说明: "翻译成指定语言" },
  { 命令: "译", 说明: "多轮翻译接力" },
  { 命令: "计算", 说明: "数学计算" },
  { 命令: "查IP", 说明: "查询 IP 属地" },
  { 命令: "url编码", 说明: "URL 编码" },
  { 命令: "url解码", 说明: "URL 解码" },
  { 命令: "字节", 说明: "字节大小换算" },
  { 命令: "转十六进制", 说明: "十进制转十六进制" },
  { 命令: "十六进制转", 说明: "十六进制转十进制" },
  { 命令: "体脂", 说明: "体脂估算" },
  { 命令: "论证", 说明: "数字论证" },
];
export const 指令提示框 = document.getElementById("chat-cmd-hint") as HTMLDivElement;
export let 提示过滤列表: string[] = [];
export let 提示选中索引 = 0;

/** 供其他模块（键盘提示导航）更新选中索引——ESM 导入绑定只读 */
export function 设置提示选中索引(v: number): void {
  提示选中索引 = v;
}

/**
 * 从能力注册表同步中文指令到提示库（阶段 1：注册表驱动命令面板）。
 * 内置指令库作为回退保留；注册表声明的 中文指令 与之合并。
 */
export async function 同步能力指令库(): Promise<void> {
  try {
    const 列表 = (await window.kugua.request("nigane", "capability.list", { 入口: "指令" })) as Array<{
      名称: string;
      模块: string;
      标题?: string;
      说明?: string;
      中文指令?: string[];
    }>;
    for (const 能力 of 列表 ?? []) {
      for (const 命令 of 能力.中文指令 ?? []) {
        if (指令库.some((c) => c.命令 === 命令)) continue;
        指令库.push({ 命令, 说明: 能力.说明 ?? 能力.标题 ?? 能力.名称 });
      }
    }
  } catch (err) {
    console.warn("[webui] 能力指令同步失败：", err);
  }
}

export function 隐藏指令提示(): void {
  指令提示框.classList.add("hidden");
  指令提示框.innerHTML = "";
  提示过滤列表 = [];
  提示选中索引 = 0;
}

export function 渲染指令提示(): void {
  if (提示过滤列表.length === 0) { 隐藏指令提示(); return; }
  指令提示框.innerHTML = "";
  提示过滤列表.forEach((命令, i) => {
    const 项 = document.createElement("div");
    项.className = "cmd-hint-item" + (i === 提示选中索引 ? " active" : "");
    项.textContent = 命令;
    项.addEventListener("mousedown", (e) => {
      e.preventDefault();
      输入框.value = 命令;
      输入框.focus();
      隐藏指令提示();
    });
    指令提示框.appendChild(项);
  });
  指令提示框.classList.remove("hidden");
}

export function 更新指令提示(): void {
  const v = 输入框.value;
  if (v === "") { 隐藏指令提示(); return; }
  const 以斜杠 = v.startsWith("/");
  const q = (以斜杠 ? v.slice(1) : v).trim();
  if (!q) { 隐藏指令提示(); return; }
  const 匹配 = 指令库.filter((c) => c.命令.startsWith(q));
  if (匹配.length === 0) { 隐藏指令提示(); return; }
  提示过滤列表 = 匹配.map((c) => c.命令);
  提示选中索引 = 0;
  渲染指令提示();
}


/** 多模态附件：拖拽图片到聊天时暂存，发送时随指令传给模块 */
export interface 附件 {
  base64?: string;
  path?: string;
  name: string;
  type: string;
}
export const 附件区 = document.getElementById("chat-attachments") as HTMLDivElement;
export const 当前附件: 附件[] = [];

export function 文件URL(路径: string | null | undefined): string {
  if (!路径) return "";
  let p = 路径.replace(/\\/g, "/");
  if (!p.startsWith("/")) p = "/" + p;
  return "file://" + encodeURI(p);
}

/** 把片段内的本地/相对资源路径转成可显示的 URL */
export function 内容媒体URL(u: string): string {
  if (/^(https?:|data:|file:)/i.test(u)) return u;
  let p = u.replace(/\\/g, "/");
  if (!p.startsWith("/")) p = "/" + p;
  return "file://" + encodeURI(p);
}

/** 简易 Markdown 渲染：先转义 HTML，再支持图片/链接/加粗/行内代码（供多媒体片段预览） */
export function 渲染Markdown(文本: string): string {
  const esc = (s: string): string =>
    s.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;");
  let html = esc(文本);
  // 图片 ![alt](url)
  html = html.replace(/!\[([^\]]*)\]\(([^)]+)\)/g, (_, alt: string, url: string) => {
    return `<img src="${内容媒体URL(url.trim())}" alt="${alt}" class="md-img">`;
  });
  // 链接 [text](url)
  html = html.replace(/\[([^\]]+)\]\(([^)]+)\)/g, (_, text: string, url: string) => {
    return `<a href="${内容媒体URL(url.trim())}" target="_blank" rel="noopener" class="md-link">${text}</a>`;
  });
  // 加粗 **text**
  html = html.replace(/\*\*([^*]+)\*\*/g, "<strong>$1</strong>");
  // 行内代码 `code`
  html = html.replace(/`([^`]+)`/g, "<code>$1</code>");
  return html;
}

export function 是图片路径(p: string | null | undefined): boolean {
  if (!p) return false;
  return /\.(png|jpe?g|gif|bmp|webp|svg)$/i.test(p);
}

export function 刷新附件区(): void {
  if (当前附件.length === 0) {
    附件区.classList.add("hidden");
    附件区.innerHTML = "";
    return;
  }
  附件区.classList.remove("hidden");
  附件区.innerHTML = "";
  当前附件.forEach((att, i) => {
    const chip = document.createElement("div");
    chip.className = "chat-attach";
    if (att.type.startsWith("image/")) {
      const img = document.createElement("img");
      img.className = "att-preview";
      img.src = att.base64 ? `data:${att.type.startsWith("image/") ? att.type : "image/png"};base64,${att.base64}` : 文件URL(att.path);
      chip.appendChild(img);
    } else {
      const span = document.createElement("span");
      span.className = "att-type";
      span.textContent = att.name;
      chip.appendChild(span);
    }
    const rm = document.createElement("button");
    rm.className = "att-remove";
    rm.textContent = "×";
    rm.title = "移除附件";
    rm.addEventListener("click", () => {
      当前附件.splice(i, 1);
      刷新附件区();
    });
    chip.appendChild(rm);
    附件区.appendChild(chip);
  });
}

export function 取首个图片附件(): 附件 | undefined {
  return 当前附件.find((a) => a.type.startsWith("image/"));
}

