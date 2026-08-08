/**
 * 苦瓜工作室 GUI 渲染器
 * 对话式 Agent 终端：用户输入 → 命令路由 → 模块调用 → 结果展示
 */

// ===== 类型定义 =====

type 模块类型 = "process" | "library";

interface 模块信息 {
  name: string;
  version?: string;
  capabilities?: string[];
}

interface 模块详情 extends 模块信息 {
  type?: 模块类型;
  online?: boolean;
  pid?: number;
  fileExists?: boolean;
  autoStart?: boolean;
  description?: string;
  entry?: string;
  file?: string;
}

interface 定时任务动作 {
  kind: "request" | "event" | "command";
  to?: string;
  action?: string;
  command?: string;
}

interface 定时任务 {
  id: string;
  name: string;
  cron: string;
  enabled: boolean;
  action: 定时任务动作;
  createdAt: number;
  nextRunAt?: number | null;
  lastRunAt?: number | null;
  lastResult?: { ok: boolean; message: string; time: number } | null;
}

interface 系统快照 {
  time: number;
  cpu: { usagePct: number; cores: number; model: string };
  memory: { total: number; free: number; used: number; usagePct: number };
  disk: Array<{ name: string; total: number; free: number; used: number; usagePct: number }>;
}

interface 知识库统计 {
  资源总数: number;
  文件数: number;
  目录数: number;
  标签数: number;
  关联数: number;
  文本内容数: number;
  数据库大小: number;
}

interface 资源 {
  id: number;
  path: string;
  name: string;
  size: number;
  kind: "file" | "directory";
  modifiedTime: number;
  snippet?: string;
}

interface 资源详情 {
  id: number;
  path: string;
  name: string;
  size: number;
  kind: "file" | "directory";
  modifiedTime: number;
  alias: string | null;
  extension: string;
  mimeType: string;
  tagPaths: string[][];
}

interface 标签节点 {
  id: number;
  name: string;
  parentId: number | null;
  description?: string;
  children: 标签节点[];
}

interface 打开方式配置 {
  id: number;
  extension: string;
  programPath: string;
  arguments: string;
  label: string | null;
}

interface 笔记 {
  id: number;
  title: string;
  content: string;
  createdAt: number;
  updatedAt: number;
  tagIds: number[];
}

interface 素材 {
  id: number;
  title: string;
  content: string;
  kind: string;
  sourceUrl: string;
  imageUrl: string;
  createdAt: number;
  updatedAt: number;
  tagIds: number[];
}

interface 看板列 {
  id: number;
  name: string;
  sort: number;
  createdAt: number;
}

interface 卡片 {
  id: number;
  title: string;
  content: string;
  columnId: number | null;
  createdAt: number;
  updatedAt: number;
  tagIds: number[];
}

interface Window {
  kugua: {
    request: (target: string, action: string, params?: unknown) => Promise<unknown>;
    broadcast: (action: string, params?: unknown) => Promise<unknown>;
    writeTempFile: (payload: { base64?: string; name?: string; ext?: string }) => Promise<string>;
    onLog: (callback: (entry: unknown) => void) => void;
    onReady: (callback: () => void) => void;
    window: {
      minimize: () => Promise<void>;
      toggleMaximize: () => Promise<boolean>;
      close: () => Promise<void>;
      isMaximized: () => Promise<boolean>;
      onMaximized: (callback: (isMax: boolean) => void) => void;
    };
    dialog: {
      openFiles: (options?: {
        title?: string;
        filters?: Array<{ name: string; extensions: string[] }>;
        multi?: boolean;
      }) => Promise<string[]>;
      openImages: () => Promise<string[]>;
    };
  };
}

// ===== 对话终端 =====

const 聊天日志 = document.getElementById("chat-log") as HTMLDivElement;
const 输入框 = document.getElementById("chat-input") as HTMLInputElement;

/** 多模态附件：拖拽图片到聊天时暂存，发送时随指令传给模块 */
interface 附件 {
  base64?: string;
  path?: string;
  name: string;
  type: string;
}
const 附件区 = document.getElementById("chat-attachments") as HTMLDivElement;
const 当前附件: 附件[] = [];

function 文件URL(路径: string | null | undefined): string {
  if (!路径) return "";
  let p = 路径.replace(/\\/g, "/");
  if (!p.startsWith("/")) p = "/" + p;
  return "file://" + encodeURI(p);
}

function 是图片路径(p: string | null | undefined): boolean {
  if (!p) return false;
  return /\.(png|jpe?g|gif|bmp|webp|svg)$/i.test(p);
}

function 刷新附件区(): void {
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

function 取首个图片附件(): 附件 | undefined {
  return 当前附件.find((a) => a.type.startsWith("image/"));
}

const 聊天搜索框 = document.getElementById("chat-search") as HTMLInputElement | null;

function 本地时间(d: Date): string {
  const p = (n: number) => String(n).padStart(2, "0");
  return `${d.getFullYear()}-${p(d.getMonth() + 1)}-${p(d.getDate())} ${p(d.getHours())}:${p(d.getMinutes())}`;
}

function 时间编码(d = new Date()): string {
  const p = (n: number) => String(n).padStart(2, "0");
  return `${d.getFullYear()}${p(d.getMonth() + 1)}${p(d.getDate())}_${p(d.getHours())}${p(d.getMinutes())}${p(d.getSeconds())}`;
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
  div.className = `chat-msg ${类型}`;
  const meta = document.createElement("div");
  meta.className = "msg-meta";
  meta.innerHTML = `<span class="msg-time">${本地时间(new Date())}</span>`;
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
    div.querySelector<HTMLDivElement>(".msg-meta")?.insertAdjacentHTML("beforeend", `<span class="msg-sender">${发送者}</span>`);
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
}

// ===== 命令路由器 =====

/** 分析用户输入，路由到对应模块 */
async function 处理输入(原文: string, 附件?: 附件[]): Promise<void> {
  const 文本 = 原文.trim();
  if (!文本 && (!附件 || 附件.length === 0)) return;

  if (!文本 && 附件 && 附件.length > 0) {
    添加消息("已添加附件，请输入处理指令（如图片：灰度、旋转90度、反色）。", "system");
    return;
  }

  添加消息(文本, "user");

  try {
    const 路由 = 路由指令(文本, 附件);
    if (路由) {
      await 执行路由(路由);
    } else {
      添加消息(`未知指令：「${文本}」\n可用的指令：\n- 占卜 [问题]\n- 运势\n- 今天吃什么 / [时间]吃什么\n- 搜索 [关键词]\n- 搜索内容 [关键词]\n- 导入 [路径]\n- 资源列表\n- 标签列表\n- 统计\n- 模块列表\n- 帮助`, "system");
    }
  } catch (err) {
    添加消息(`执行失败：${String(err)}`, "error");
  }
}

interface 路由结果 {
  目标: string;
  动作: string;
  参数?: unknown;
  描述: string;
  /** 不需要调用模块，直接显示的提示 */
  本地提示?: string;
}

function 路由指令(文本: string, 附件?: 附件[]): 路由结果 | null {
  // 图片附件与"需图"辅助：图片类指令必须附带图片
  const 图 = 附件?.find((a) => a.type.startsWith("image/"));
  const 需图 = (动作: string, 参数: object, 描述: string): 路由结果 | null => {
    if (!图) return { 目标: "image", 动作, 描述, 本地提示: "请先拖拽一张图片到聊天框，再输入处理指令。" };
    return { 目标: "image", 动作, 参数: { ...参数, base64: 图.base64, path: 图.path }, 描述 };
  };

  // 占卜
  if (/^占卜/.test(文本)) {
    const 问题 = 文本.slice(2).trim() || undefined;
    return { 目标: "divination", 动作: "divination.zhouyi", 参数: { question: 问题 }, 描述: "周易占卜" };
  }

  // 运势
  if (文本 === "运势" || 文本 === "今日运势" || 文本 === "每日运势") {
    return { 目标: "divination", 动作: "divination.fortune", 描述: "每日运势" };
  }

  // 吃什么
  const 吃匹配 = 文本.match(/^(.+)?(.{1})什么$/);
  if (吃匹配 && (吃匹配[2] === "吃" || 吃匹配[2] === "喝" || 吃匹配[2] === "玩")) {
    const 时间 = 吃匹配[1] || "今天";
    const 动词 = 吃匹配[2];
    return { 目标: "food", 动作: "food.recommend", 参数: { time: 时间, verb: 动词 }, 描述: "今天吃什么" };
  }
  if (文本 === "吃什么" || 文本 === "今天吃什么") {
    return { 目标: "food", 动作: "food.recommend", 参数: { time: "今天", verb: "吃" }, 描述: "今天吃什么" };
  }

  // 搜索（路径/文件名）
  const 搜索匹配 = 文本.match(/^搜索\s+(.+)$/);
  if (搜索匹配) {
    return { 目标: "mkg", 动作: "mkg.search", 参数: { type: "path", query: 搜索匹配[1], options: { limit: 20 } }, 描述: `搜索：${搜索匹配[1]}` };
  }

  // 搜索内容
  const 内容匹配 = 文本.match(/^搜索内容\s+(.+)$/);
  if (内容匹配) {
    return { 目标: "mkg", 动作: "mkg.search", 参数: { type: "content", query: 内容匹配[1], options: { limit: 20 } }, 描述: `搜索内容：${内容匹配[1]}` };
  }

  // 导入
  const 导入匹配 = 文本.match(/^导入\s+(.+)$/);
  if (导入匹配) {
    return { 目标: "mkg", 动作: "mkg.resource.import", 参数: { path: 导入匹配[1] }, 描述: `导入路径` };
  }

  // 资源列表
  if (文本 === "资源列表" || 文本 === "列表") {
    return { 目标: "mkg", 动作: "mkg.resource.list", 参数: { options: { limit: 50 } }, 描述: "资源列表" };
  }

  // 标签列表
  if (文本 === "标签列表" || 文本 === "标签") {
    return { 目标: "mkg", 动作: "mkg.tag.list", 描述: "标签列表" };
  }

  // 统计
  if (文本 === "统计" || 文本 === "知识库统计") {
    return { 目标: "mkg", 动作: "mkg.stats", 描述: "知识库统计" };
  }

  // 模块列表/详情
  if (文本 === "模块列表" || 文本 === "模块" || 文本 === "节点" || 文本 === "模块详情") {
    return { 目标: "nigane", 动作: "nigane.registry.details", 描述: "模块详情" };
  }
  // 启动模块
  const 启动匹配 = 文本.match(/^启动\s+(.+)$/);
  if (启动匹配) {
    return { 目标: "nigane", 动作: "nigane.registry.start", 参数: { name: 启动匹配[1].trim() }, 描述: `启动模块 ${启动匹配[1].trim()}` };
  }
  // 停止模块
  const 停止匹配 = 文本.match(/^停止\s+(.+)$/);
  if (停止匹配) {
    return { 目标: "nigane", 动作: "nigane.registry.stop", 参数: { name: 停止匹配[1].trim() }, 描述: `停止模块 ${停止匹配[1].trim()}` };
  }

  // 定时任务调度（M4）
  if (文本 === "定时任务" || 文本 === "定时任务列表" || 文本 === "任务列表") {
    return { 目标: "scheduler", 动作: "scheduler.task.list", 描述: "定时任务" };
  }
  const 频率映射: Record<string, string> = {
    每秒: "* * * * * *",
    每分: "* * * * *",
    每5分: "*/5 * * * *",
    每10分: "*/10 * * * *",
    每30分: "*/30 * * * *",
    每小时: "0 * * * *",
    每天: "0 0 * * *",
    每周一: "0 0 * * 1",
    每月: "0 0 1 * *",
  };
  const 添加任务匹配 = 文本.match(/^添加定时任务\s+(\S+)\s+(\S+)\s+(\S+)\s+(\S+)\s*$/);
  if (添加任务匹配) {
    const [, 名称, 频率, 模块, 动作名] = 添加任务匹配;
    const cron = 频率映射[频率] ?? 频率;
    return {
      目标: "scheduler",
      动作: "scheduler.task.create",
      参数: { name: 名称, cron, action: { kind: "request", to: 模块, action: 动作名 } },
      描述: `添加定时任务 ${名称}`,
    };
  }
  const 查看任务匹配 = 文本.match(/^查看定时任务\s+(.+)$/);
  if (查看任务匹配) {
    return { 目标: "scheduler", 动作: "scheduler.task.get", 参数: { name: 查看任务匹配[1].trim() }, 描述: "查看定时任务" };
  }
  const 暂停任务匹配 = 文本.match(/^暂停定时任务\s+(.+)$/);
  if (暂停任务匹配) {
    return { 目标: "scheduler", 动作: "scheduler.task.enable", 参数: { name: 暂停任务匹配[1].trim(), enabled: false }, 描述: "暂停定时任务" };
  }
  const 恢复任务匹配 = 文本.match(/^恢复定时任务\s+(.+)$/);
  if (恢复任务匹配) {
    return { 目标: "scheduler", 动作: "scheduler.task.enable", 参数: { name: 恢复任务匹配[1].trim(), enabled: true }, 描述: "恢复定时任务" };
  }
  const 删除任务匹配 = 文本.match(/^删除定时任务\s+(.+)$/);
  if (删除任务匹配) {
    return { 目标: "scheduler", 动作: "scheduler.task.delete", 参数: { name: 删除任务匹配[1].trim() }, 描述: "删除定时任务" };
  }
  const 立即执行匹配 = 文本.match(/^立即执行定时任务\s+(.+)$/);
  if (立即执行匹配) {
    return { 目标: "scheduler", 动作: "scheduler.task.runNow", 参数: { name: 立即执行匹配[1].trim() }, 描述: "立即执行定时任务" };
  }

  // 系统监控
  if (文本 === "监控" || 文本 === "系统状态" || 文本 === "资源监控") {
    return { 目标: "monitor", 动作: "monitor.stats", 描述: "系统状态" };
  }

  // 帮助
  if (文本 === "帮助" || 文本 === "help" || 文本 === "?") {
    添加消息(帮助文本(), "system");
    return null;
  }

  // ===== 图片模块（严格按参考项目 ModImages 原指令输入方式复刻）=====
  // —— 反色（参考 ^反色$）——
  if (/^(反色|负片|取反|颜色反转)$/.test(文本)) return 需图("image.negate", {}, "图片反色");
  // —— 水平翻转（参考 ^水平翻转(.*)）——
  if (/^水平翻转/.test(文本)) return 需图("image.flipH", {}, "水平翻转");
  // —— 垂直翻转（参考 ^垂直翻转(.*)）——
  if (/^垂直翻转/.test(文本)) return 需图("image.flipV", {}, "垂直翻转");
  // —— 镜像1~4，缺省 1（参考 ^镜像(.*)，1/2/3/4 保留不同部分）——
  const 镜像匹配 = 文本.match(/^镜像([1-4])?$/);
  if (镜像匹配) return 需图("image.mirror", { mode: 镜像匹配[1] ? Number(镜像匹配[1]) : 1 }, "图片镜像");
  if (文本 === "镜子") return 需图("image.mirror", { mode: 1 }, "图片镜像");
  // —— 旋转N度，缺省 90（参考 ^旋转(.*)，缺省参则 90）——
  const 旋转匹配 = 文本.match(/^旋转\s*([\d.]+)?\s*度?$/);
  if (旋转匹配) return 需图("image.rotate", { degrees: 旋转匹配[1] ? Number(旋转匹配[1]) : 90 }, "图片旋转");
  // —— 缩放：横缩放N / 竖缩放N / 横竖缩放N / 缩放N（比例，参考 ^([横竖]*)缩放(.+)）——
  const 缩放匹配 = 文本.match(/^([横竖]*)缩放\s*([\d.]+)%?$/);
  if (缩放匹配) {
    const 方向 = 缩放匹配[1];
    let 倍率 = parseFloat(缩放匹配[2]);
    if (倍率 <= 0) 倍率 = 0.1;
    const 横 = 方向.includes("横") || 方向 === "";
    const 竖 = 方向.includes("竖") || 方向 === "";
    return 需图("image.resize", { scaleX: 横 ? 倍率 : 1, scaleY: 竖 ? 倍率 : 1 }, "图片缩放");
  }
  // 兼容保留：放大N / 缩小N（百分比）
  const 放缩匹配 = 文本.match(/^(放大|缩小|缩放)\s*(\d+)?\s*%?$/);
  if (放缩匹配) {
    const 词 = 放缩匹配[1];
    const 百分比 = 放缩匹配[2] ? Number(放缩匹配[2]) : (词 === "缩小" ? 50 : 词 === "放大" ? 150 : 100);
    return 需图("image.resize", { scaleX: 百分比 / 100, scaleY: 百分比 / 100 }, "图片缩放");
  }
  // —— 切：上下左右组合切 N / N%（参考 ^([上下左右]+)切(.+)）——
  const 切匹配 = 文本.match(/^([上下左右]+)切\s*([\d.]+)%?$/);
  if (切匹配) {
    const 方向 = 切匹配[1];
    const 数 = parseFloat(切匹配[2]);
    const 参: Record<string, number | boolean> = { percent: 切匹配[0].endsWith("%") };
    if (方向.includes("上")) 参.top = 数;
    if (方向.includes("下")) 参.bottom = 数;
    if (方向.includes("左")) 参.left = 数;
    if (方向.includes("右")) 参.right = 数;
    return 需图("image.cut", 参, "图片切割");
  }
  // 兼容保留：切边N（四边等切）
  const 切边匹配 = 文本.match(/^切边\s*(\d+)?$/);
  if (切边匹配) {
    const 边 = 切边匹配[1] ? Number(切边匹配[1]) : 10;
    return 需图("image.cut", { percent: false, top: 边, bottom: 边, left: 边, right: 边 }, "图片切边");
  }
  // —— 抖动：抖N / 内抖N（参考 ^(内?)抖(.*)，数字为震级 0~1 小数，支持逗号小数点）——
  if (/^(内?)抖/.test(文本)) {
    const 抖匹配 = 文本.match(/^(内?)抖\s*([\d.,]+)?$/);
    const 震级 = 抖匹配 && 抖匹配[2] ? parseFloat(抖匹配[2].replace(",", ".")) : 0.5;
    return 需图("image.shake", { degree: 震级 }, "图片抖动");
  }
  // —— 滚动N（参考 ^滚动(.*)，参数为方位角度）——
  if (/^滚动/.test(文本)) {
    const 滚匹配 = 文本.match(/^滚动\s*([\d.]+)?$/);
    const 角度 = 滚匹配 && 滚匹配[1] ? parseFloat(滚匹配[1]) : 0;
    return 需图("image.roll", { degree: 角度 }, "图片滚动");
  }
  // —— 网格化 / 网格化2（参考 ^网格化$ / ^网格化2$）——
  if (文本 === "网格化2") return 需图("image.gridHole", {}, "图片网格孔");
  if (文本 === "网格化") return 需图("image.grid", { scale: 2 }, "图片网格化");
  // 兼容保留：网格N / 网格孔
  const 网格匹配 = 文本.match(/^网格\s*(\d+)?$/);
  if (网格匹配) return 需图("image.grid", { scale: 网格匹配[1] ? Number(网格匹配[1]) : 2 }, "图片网格化");
  if (/^网格孔/.test(文本)) return 需图("image.gridHole", {}, "图片网格孔");
  // —— 抠图（参考 ^抠图）——
  if (/^抠图/.test(文本)) return 需图("image.removeBg", {}, "图片抠图");
  // —— 做旧（参考 ^做旧(.*)）——
  if (/^做旧/.test(文本)) return 需图("image.oldJpg", {}, "图片做旧");
  // —— 取色（参考 ^取色）——
  if (/^取色/.test(文本)) return 需图("image.colorExtract", {}, "图片取色");
  // —— 竖拼 / 横拼（参考 ^竖拼$ / ^横拼$）——
  if (文本 === "竖拼" || 文本 === "纵向拼接") return 需图("image.combineV", {}, "纵向拼接");
  if (文本 === "横拼" || 文本 === "横向拼接") return 需图("image.combineH", {}, "横向拼接");
  // 兼容保留：拼接（用横向拼接）
  const 拼接匹配 = 文本.match(/^(拼接)/);
  if (拼接匹配) return 需图("image.combineH", {}, "横向拼接");
  // —— 摸摸（参考 ^摸摸$）——
  if (文本 === "摸摸") return 需图("image.touchBall", {}, "图片摸摸");
  // —— 幻影坦克（参考 ^(彩色)?幻影(坦克)?$）——
  const 幻影匹配 = 文本.match(/^(彩色)?幻影(坦克)?$/);
  if (幻影匹配) return 需图("image.hytk", { colorful: !!幻影匹配[1] }, "幻影坦克");

  // —— GIF/图片序列系列（参考 ModImageGif.cs）——
  // 拆NxM：拆成 col x row 碎片（参考 ^拆(.+)x(.+)$，col=param[1], row=param[2]）
  const 拆格匹配 = 文本.match(/^拆\s*(\d+)\s*x\s*(\d+)$/);
  if (拆格匹配) return 需图("image.gifUnzipGrid", { col: Number(拆格匹配[1]), row: Number(拆格匹配[2]) }, "拆图");
  // 拆：拆成一组 PNG（参考 ^拆$）
  if (文本 === "拆") return 需图("image.gifUnzip", {}, "拆帧");
  // 拆帧：平铺成序列图（参考 ^拆帧(.*)$）
  if (文本 === "拆帧") return 需图("image.gifSprite", {}, "拆帧平铺");
  // 删N：删帧（参考 ^删(.+)），支持 "2"、"2,3"，第一个为起始帧、第二个为删除帧数
  const 删匹配 = 文本.match(/^删\s*([\-0-9]+)\s*(?:[,， ]+\s*([\-0-9]+))?$/);
  if (删匹配) {
    const 起始 = Number(删匹配[1]);
    const 数量 = 删匹配[2] ? Number(删匹配[2]) : 1;
    return 需图("image.gifRemoveFrame", { begin: 起始, count: 数量 }, "删帧");
  }
  // 合NxM：单图序列帧合成 gif（参考 ^合(\S*)$）
  const 合格匹配 = 文本.match(/^合\s*(\d+)\s*x\s*(\d+)$/);
  if (合格匹配) return 需图("image.gifZip", { row: Number(合格匹配[1]), col: Number(合格匹配[2]) }, "合成GIF");
  if (文本 === "合") return 需图("image.gifZip", { images: [] }, "合成GIF");
  // 乱序：打乱 gif 帧顺序（参考 ^乱序$）
  if (文本 === "乱序") return 需图("image.gifShuffle", {}, "乱序图");
  // gif：webp 转 gif/png（参考 ^gif$）
  if (文本 === "gif") return 需图("image.webpToGif", {}, "转GIF");
  // N倍速：调整 gif 播放速率，负数倒放（参考 ^(.+)倍速$）
  const 倍速匹配 = 文本.match(/^([\-0-9.]+)\s*倍速$/);
  if (倍速匹配) return 需图("image.gifSpeed", { speed: Number(倍速匹配[1]) }, "GIF倍速");

  // 图片生成类（无需附件）
  const 像素字匹配 = 文本.match(/^像素字\s*(.+)?$/);
  if (像素字匹配) return { 目标: "image", 动作: "image.pixelWords", 参数: { text: (像素字匹配[1] ?? "").trim() }, 描述: "像素字" };
  // 扭曲XX → 验证码风格 GIF（参考 ^扭曲(.+)）
  const 扭曲匹配 = 文本.match(/^扭曲\s*(.+)/);
  if (扭曲匹配) return { 目标: "image", 动作: "image.captcha", 参数: { text: 扭曲匹配[1].trim() }, 描述: "扭曲图片" };
  // 噪声N → 随机像素图（参考 ^噪声([0-9]*)）
  const 噪声匹配 = 文本.match(/^噪声\s*(\d*)?$/);
  if (噪声匹配) return { 目标: "image", 动作: "image.randomPixel", 参数: { size: 噪声匹配[1] ? Number(噪声匹配[1]) : 100 }, 描述: "随机像素图" };
  const 验证码匹配 = 文本.match(/^验证码\s*(.+)?$/);
  if (验证码匹配) return { 目标: "image", 动作: "image.captcha", 参数: { text: (验证码匹配[1] ?? "").trim() }, 描述: "验证码图片" };
  if (/^随机像素/.test(文本)) return { 目标: "image", 动作: "image.randomPixel", 参数: { size: 100 }, 描述: "随机像素图" };
  const 色块匹配 = 文本.match(/^色块\s*(#?[0-9a-fA-F]{3,8})?$/);
  if (色块匹配) return { 目标: "image", 动作: "image.colorSample", 参数: { color: 色块匹配[1] ?? "#000000", size: 80 }, 描述: "色块" };

  // —— 色卡：#RRGGBB 直接显示颜色（参考 ^#[0-9A-Fa-f]{6}$，showColor）——
  if (/^#[0-9A-Fa-f]{6}$/.test(文本)) return { 目标: "image", 动作: "image.colorSample", 参数: { color: 文本, size: 80 }, 描述: "色块" };
  // —— 遗像/遗照：灰度（参考 ^(遗像|遗照)$，getYixiang + Rec601Luminance）——
  if (文本 === "遗像" || 文本 === "遗照") return 需图("image.grayscale", {}, "遗像");
  // —— CIS 色卡：CIS x y Y（参考 ^CIS\s*(\S+)\s(\S+)\s(\S+)$，convertCIS + xyYtoRGB）——
  const CIS匹配 = 文本.match(/^CIS\s+([\d.]+)\s+([\d.]+)\s+([\d.]+)$/i);
  if (CIS匹配) return { 目标: "image", 动作: "image.cisColor", 参数: { x: Number(CIS匹配[1]), y: Number(CIS匹配[2]), Y: Number(CIS匹配[3]) }, 描述: "CIS色卡" };

  // ===== 骰子模块 =====
  const 骰匹配 = 文本.match(/^r?(\d*)d(\d+)$/i);
  if (骰匹配) {
    const 个数 = 骰匹配[1] ? Number(骰匹配[1]) : 1;
    const 面数 = Number(骰匹配[2]);
    return { 目标: "dice", 动作: "dice.roll", 参数: { 个数, 面数, 缘由: "掷骰" }, 描述: "掷骰" };
  }
  const 掷骰匹配 = 文本.match(/^掷骰(?:子)?(?:(\d+)个)?(?:(\d+)面)?(.*)$/);
  if (掷骰匹配 && 文本.includes("掷骰")) {
    const 个数 = 掷骰匹配[1] ? Number(掷骰匹配[1]) : 1;
    const 面数 = 掷骰匹配[2] ? Number(掷骰匹配[2]) : 6;
    const 缘由 = (掷骰匹配[3] ?? "").trim() || "掷骰";
    return { 目标: "dice", 动作: "dice.roll", 参数: { 个数, 面数, 缘由 }, 描述: "掷骰" };
  }

  // ===== 文本模块 =====
  if (/^(反转|倒过来|倒序|逆序)/.test(文本)) {
    return { 目标: "text", 动作: "text.reverse", 参数: { 文本: 文本.replace(/^(反转|倒过来|倒序|逆序)/, "").trim() }, 描述: "文本反转" };
  }
  if (/^大写/.test(文本)) return { 目标: "text", 动作: "text.toUpper", 参数: { 文本: 文本.replace(/^大写/, "").trim() }, 描述: "转大写" };
  if (/^小写/.test(文本)) return { 目标: "text", 动作: "text.toLower", 参数: { 文本: 文本.replace(/^小写/, "").trim() }, 描述: "转小写" };
  if (/^(乱序|打乱|洗牌)/.test(文本)) {
    return { 目标: "text", 动作: "text.shuffle", 参数: { 文本: 文本.replace(/^(乱序|打乱|洗牌)/, "").trim() }, 描述: "文本乱序" };
  }
  const 攻受匹配 = 文本.match(/^攻受\s*(\S+)\s*(\S+)$/);
  if (攻受匹配) return { 目标: "text", 动作: "text.gongshou", 参数: { 攻: 攻受匹配[1], 受: 攻受匹配[2] }, 描述: "攻受文" };
  if (/^(讽刺|苏联笑话)/.test(文本)) {
    return { 目标: "text", 动作: "text.joke", 参数: { 输入: 文本.replace(/^(讽刺|苏联笑话)/, "").trim() }, 描述: "讽刺生成" };
  }
  const 什么是匹配 = 文本.match(/^什么是\s*(.+)/);
  if (什么是匹配) return { 目标: "text", 动作: "text.salad", 参数: { 主题: 什么是匹配[1].trim() }, 描述: "概念流水账" };
  const 狗匹配 = 文本.match(/^狗屁不通\s*(.+)/);
  if (狗匹配) return { 目标: "text", 动作: "text.paper", 参数: { 主题: 狗匹配[1].trim() }, 描述: "狗屁不通" };
  const 云杰匹配 = 文本.match(/^云杰说道\s*(.+)/);
  if (云杰匹配) return { 目标: "text", 动作: "text.paper2", 参数: { 主题: 云杰匹配[1].trim() }, 描述: "云杰说道" };
  const 营销匹配 = 文本.match(/^营销号\s*(.+)/);
  if (营销匹配) return { 目标: "text", 动作: "text.paper3", 参数: { 主题: 营销匹配[1].trim() }, 描述: "营销号短文" };
  if (/^火星文/.test(文本)) {
    return { 目标: "text", 动作: "text.hx", 参数: { 文本: 文本.replace(/^火星文/, "").trim() }, 描述: "火星文" };
  }
  const 汉字匹配 = 文本.match(/^随机汉字\s*(\d+)?\s*(?:行)?(\d+)?$/);
  if (汉字匹配) {
    return { 目标: "text", 动作: "text.randomHans", 参数: { 行数: 汉字匹配[1] ? Number(汉字匹配[1]) : 1, 列数: 汉字匹配[2] ? Number(汉字匹配[2]) : 1 }, 描述: "随机汉字" };
  }
  if (/^历史上的今天/.test(文本)) return { 目标: "text", 动作: "text.historyToday", 参数: { 日期: "今天" }, 描述: "历史上的今天" };

  // ===== 万年历模块 =====
  if (/^(今天|今夕|今日黄历|黄历)$/.test(文本)) return { 目标: "calendar", 动作: "calendar.today", 描述: "今夕是何年" };
  const 日期匹配 = 文本.match(/^(\d{4}年\d{1,2}月\d{1,2}日)(?:\s*(\d{1,2})时?)?$/);
  if (日期匹配) {
    return { 目标: "calendar", 动作: "calendar.query", 参数: { 日期: 日期匹配[1], 时: 日期匹配[2] ? Number(日期匹配[2]) : undefined }, 描述: "万年历查询" };
  }
  const 芸历匹配 = 文本.match(/^(蒸汽|创世)(\d+)年$/);
  if (芸历匹配) return { 目标: "calendar", 动作: "calendar.yunhua", 参数: { 模式: 芸历匹配[1], 年: Number(芸历匹配[2]) }, 描述: "芸历换算" };

  // ===== 翻译模块 =====
  const 译N匹配 = 文本.match(/^(?:译|翻译)(\d+)(?:次|轮)/);
  if (译N匹配) {
    const 文字 = 文本.replace(/^(?:译|翻译)\d+(?:次|轮)/, "").trim();
    return { 目标: "translate", 动作: "translate.rounds", 参数: { 次数: Number(译N匹配[1]), 文字 }, 描述: "多轮翻译" };
  }
  const 翻译成匹配 = 文本.match(/^翻译成\s*(\S+)\s*[，,:：\s]+(.+)$/);
  if (翻译成匹配 && 文本.includes("翻译")) {
    return { 目标: "translate", 动作: "translate.translate", 参数: { 目标: 翻译成匹配[1], 文字: 翻译成匹配[2].trim() }, 描述: "翻译" };
  }
  const 翻译匹配 = 文本.match(/^翻译\s*(.+)$/);
  if (翻译匹配) {
    return { 目标: "translate", 动作: "translate.translate", 参数: { 目标: "英语", 文字: 翻译匹配[1].trim() }, 描述: "翻译" };
  }

  // ===== 信息工具模块 =====
  const 计算匹配 = 文本.match(/^计算\s*(.+)$/);
  if (计算匹配) return { 目标: "infotool", 动作: "infotool.calc", 参数: { 表达式: 计算匹配[1].trim() }, 描述: "计算" };
  const IP匹配 = 文本.match(/^查IP\s*(\S+)?$/i);
  if (IP匹配) return { 目标: "infotool", 动作: "infotool.ip", 参数: { ip: (IP匹配[1] ?? "").trim() }, 描述: "查IP" };
  if (/^url编码/i.test(文本)) return { 目标: "infotool", 动作: "infotool.urlEncode", 参数: { 数据: 文本.replace(/^url编码/i, "").trim() }, 描述: "URL编码" };
  if (/^url解码/i.test(文本)) return { 目标: "infotool", 动作: "infotool.urlDecode", 参数: { 数据: 文本.replace(/^url解码/i, "").trim() }, 描述: "URL解码" };
  if (/^字节/.test(文本)) return { 目标: "infotool", 动作: "infotool.byteSize", 参数: { 数据: 文本.replace(/^字节/, "").trim() }, 描述: "字节换算" };
  if (/^转十六进制/.test(文本)) return { 目标: "infotool", 动作: "infotool.toHex", 参数: { 数字: 文本.replace(/^转十六进制/, "").trim() }, 描述: "转十六进制" };
  if (/^十六进制转/.test(文本)) return { 目标: "infotool", 动作: "infotool.fromHex", 参数: { 十六进制: 文本.replace(/^十六进制转/, "").trim() }, 描述: "十六进制转十进制" };
  if (/^体脂/.test(文本)) return { 目标: "infotool", 动作: "infotool.bodyFat", 参数: { 参数: 文本.replace(/^体脂/, "").trim() }, 描述: "体脂估算" };

  // ===== 数字论证模块 =====
  const 论证匹配 = 文本.match(/^(论证|证明|数字论证)\s*(.+)/);
  if (论证匹配) return { 目标: "proof", 动作: "proof.demonstrate", 参数: { 输入: 论证匹配[2].trim() }, 描述: "数字论证" };

  return null;
}

async function 执行路由(路由: 路由结果): Promise<void> {
  if (路由.本地提示) {
    添加消息(路由.本地提示, "system", 路由.描述);
    return;
  }
  try {
    const 结果 = await window.kugua.request(路由.目标, 路由.动作, 路由.参数);
    格式化输出(路由, 结果);
  } catch (err) {
    添加消息(`【${路由.描述}】失败：${String(err)}`, "error");
  }
}

// ===== 结果格式化 =====

function 模块结果文本(r: Record<string, unknown>): string {
  const 输入字段 = ["原因", "输入", "主题", "日期", "攻", "受"];
  const 表现 = 输入字段.map((k) => (typeof r[k] === "string" && r[k] ? r[k] : "")).filter(Boolean).join(" ");
  const 结果 = typeof r.结果 === "string" ? r.结果 : "";
  return 表现 ? `${表现} —— ${结果}` : 结果;
}

function 格式化输出(路由: 路由结果, 结果: unknown): void {
  const r = 结果 as Record<string, unknown>;

  // 图片结果：渲染 base64 图片（图文并茂）
  if (r && typeof r === "object" && typeof r.base64 === "string" && r.base64) {
    const fmt = String(r.format || "png").replace(/^image\//, "");
    添加HTML(`<div class="msg-sender">${路由.描述}</div><img class="msg-image" src="data:image/${fmt};base64,${r.base64}" alt="${路由.描述}">`);
    return;
  }

  // 通用文本模块结果：{ 结果, 原因/输入/主题/日期 }
  if (r && typeof r === "object" && typeof r.结果 === "string") {
    添加消息(模块结果文本(r), "system", 路由.描述);
    return;
  }

  switch (路由.动作) {
    case "divination.zhouyi": {
      const 解读 = r.解读 as string;
      添加消息(解读, "system", "占卜结果");
      break;
    }
    case "divination.fortune": {
      添加消息(`今日运势：${r.等级}\n${r.内容}`, "system", "运势");
      break;
    }
    case "food.recommend": {
      添加消息(r.推荐 as string, "system", "推荐");
      break;
    }
    case "mkg.search": {
      const total = r.total as number;
      const items = r.items as 资源[];
      if (items.length === 0) {
        添加消息("未找到匹配结果", "system", "搜索结果");
        return;
      }
      let html = `<div class="msg-sender">搜索结果（共 ${total} 条，显示 ${items.length} 条）</div>`;
      for (const item of items) {
        const 摘要 = item.snippet ? `：<br>&nbsp;&nbsp;${item.snippet.slice(0, 100)}…` : "";
        html += `<div class="resource-link">${item.path}${摘要}</div>`;
      }
      添加HTML(html);
      break;
    }
    case "mkg.resource.import": {
      添加消息(`导入完成：新增 ${r.added}，更新 ${r.updated}，移除 ${r.removed}`, "system", "导入结果");
      void 刷新统计();
      break;
    }
    case "mkg.resource.list": {
      const items = r.items as 资源[];
      if (items.length === 0) {
        添加消息("知识库为空", "system");
        return;
      }
      let html = `<div class="msg-sender">资源列表（共 ${r.total} 条）</div>`;
      for (const item of items.slice(0, 20)) {
        html += `<div>${item.kind === "file" ? "📄" : "📁"} ${item.path} <span style="color:var(--text-dim)">(${item.size}B)</span></div>`;
      }
      if (items.length > 20) html += `<div style="color:var(--text-dim)">…还有 ${items.length - 20} 条</div>`;
      添加HTML(html);
      break;
    }
    case "mkg.tag.list": {
      const tags = 结果 as { id: number; name: string }[];
      if (tags.length === 0) {
        添加消息("暂无标签", "system");
        return;
      }
      const 列表 = tags.map((t) => `[${t.id}] ${t.name}`).join("、");
      添加消息(`标签（${tags.length} 个）：${列表}`, "system");
      break;
    }
    case "mkg.stats": {
      const s = 结果 as 知识库统计;
      添加消息(
        `资源总数：${s.资源总数}（文件 ${s.文件数} / 目录 ${s.目录数}）\n标签：${s.标签数}\n关联：${s.关联数}\n文本索引：${s.文本内容数}`,
        "system",
        "知识库统计",
      );
      void 刷新统计();
      break;
    }
    case "nigane.registry.details": {
      const modules = 结果 as 模块详情[];
      if (modules.length === 0) {
        添加消息("当前无模块注册", "system");
        return;
      }
      let html = `<div class="msg-sender">模块注册（${modules.length} 个）</div>`;
      for (const m of modules) {
        const caps = (m.capabilities ?? []).join("、") || "无能力";
        const online = Boolean(m.online);
        const 类型 = m.type === "library" ? "库" : m.type === "process" ? "进程" : "未知";
        const 状态 = online
          ? m.type === "process"
            ? `运行中 (pid=${m.pid ?? "?"})`
            : "就绪"
          : m.type === "library" && m.fileExists === false
            ? "文件缺失"
            : "离线";
        const autoText = m.autoStart ? " · <span style=\"color:var(--accent)\">[自启]</span>" : "";
        const descText = m.description ? `<div style="color:var(--text-dim);font-size:0.85rem;padding-left:1.2rem">${m.description}</div>` : "";
        html += `<div><span style="color:${online ? "var(--green)" : "var(--text-dim)"}">●</span> <b>${m.name}</b> v${m.version ?? "?"} · [${类型}] ${状态}${autoText}<br><span style="color:var(--text-dim);padding-left:1.2rem">${caps}</span>${descText}</div>`;
      }
      添加HTML(html);
      void 刷新模块列表();
      break;
    }
    case "nigane.registry.start": {
      const r = 结果 as { started: boolean; reason?: string; pid?: number | null };
      if (r.started || r.reason === "already") {
        添加消息(r.reason === "already" ? "模块已在运行" : `启动成功，pid=${r.pid ?? "?"}`, "system", "启动结果");
      } else {
        添加消息(`启动失败：${r.reason ?? "未知"}`, "error");
      }
      void 刷新模块列表();
      break;
    }
    case "nigane.registry.stop": {
      const r = 结果 as { stopped: boolean; reason?: string };
      if (r.stopped || r.reason === "not_running") {
        添加消息(r.reason === "not_running" ? "模块本就未运行" : "已停止", "system", "停止结果");
      } else {
        添加消息(`停止失败：${r.reason ?? "未知"}`, "error");
      }
      void 刷新模块列表();
      break;
    }
    case "monitor.stats": {
      const s = 结果 as 系统快照;
      const 字节 = (n: number): string =>
        n >= 1 << 30 ? `${(n / (1 << 30)).toFixed(1)} GB` : n >= 1 << 20 ? `${(n / (1 << 20)).toFixed(1)} MB` : `${(n / 1024).toFixed(0)} KB`;
      let 文本 = `CPU：${s.cpu.usagePct.toFixed(1)}%（${s.cpu.cores} 核）\n内存：${字节(s.memory.used)} / ${字节(s.memory.total)}（${s.memory.usagePct.toFixed(1)}%）`;
      if (s.disk.length > 0) {
        文本 += "\n磁盘：\n" + s.disk.map((d) => `  ${d.name} ${字节(d.used)} / ${字节(d.total)}（${d.usagePct.toFixed(1)}%）`).join("\n");
      }
      添加消息(文本, "system", "系统状态");
      break;
    }
    case "scheduler.task.list": {
      const tasks = 结果 as 定时任务[];
      if (tasks.length === 0) {
        添加消息('暂无定时任务，可用「添加定时任务 <名称> <频率> <模块> <动作>」创建。', "system");
        return;
      }
      let html = `<div class="msg-sender">定时任务（${tasks.length} 个）</div>`;
      for (const t of tasks) {
        const 动作文本 = 任务动作描述(t.action);
        const 下次 = t.nextRunAt ? new Date(t.nextRunAt).toLocaleString() : "—";
        html += `<div>${t.enabled ? "🟢" : "⚪"} <b>${t.name}</b> · ${t.cron} → ${动作文本}<br><span style="color:var(--text-dim);padding-left:1.2rem">下次：${下次}${t.lastResult ? ` · 上次：${t.lastResult.ok ? "成功" : "失败"}` : ""}</span></div>`;
      }
      添加HTML(html);
      break;
    }
    case "scheduler.task.get": {
      const t = 结果 as 定时任务;
      添加消息(
        `定时任务「${t.name}」（${t.enabled ? "启用" : "停用"}）\ncron：${t.cron}\n动作：${任务动作描述(t.action)}\n下次运行：${t.nextRunAt ? new Date(t.nextRunAt).toLocaleString() : "—"}\n上次结果：${t.lastResult ? (t.lastResult.ok ? "成功：" + t.lastResult.message : "失败：" + t.lastResult.message) : "尚未执行"}`,
        "system",
        "查看定时任务",
      );
      break;
    }
    case "scheduler.task.create": {
      const t = 结果 as 定时任务;
      添加消息(
        `已创建定时任务「${t.name}」（${t.enabled ? "启用" : "停用"}）\ncron：${t.cron}\n下次运行：${t.nextRunAt ? new Date(t.nextRunAt).toLocaleString() : "—"}`,
        "system",
        "添加定时任务",
      );
      break;
    }
    case "scheduler.task.update":
    case "scheduler.task.enable": {
      const t = 结果 as 定时任务;
      添加消息(`定时任务「${t.name}」已${t.enabled ? "启用" : "停用"}`, "system");
      break;
    }
    case "scheduler.task.delete": {
      const r = 结果 as { removed: boolean };
      添加消息(r.removed ? "已删除定时任务" : "定时任务不存在", "system");
      break;
    }
    case "scheduler.task.runNow": {
      const r = 结果 as { ok: boolean; message: string };
      添加消息(r.ok ? `执行成功：${r.message}` : `执行失败：${r.message}`, r.ok ? "system" : "error", "立即执行");
      break;
    }
    case "dice.roll": {
      const d = 结果 as { 文本?: string; 描述?: string; 总和?: number };
      添加消息(d.文本 ?? `掷骰结果：${d.描述 ?? ""}`, "system", "掷骰");
      break;
    }
    default:
      添加消息(JSON.stringify(结果, null, 2), "system");
  }
}

function 任务动作描述(a: 定时任务动作): string {
  if (a.kind === "request") return `${a.to}/${a.action}`;
  if (a.kind === "event") return `广播 ${a.action}`;
  return `命令 ${a.command ?? ""}`;
}

function 帮助文本(): string {
  return `可用指令：
【图片】先拖拽图片到聊天框，再输入：
  灰度 / 反色 / 水平翻转 / 垂直翻转 / 镜像
  旋转90度 / 放大 / 缩小 / 网格 / 切边 / 抠图 / 做旧 / 取色
  像素字 [文字] / 验证码 [文字] / 随机像素 / 色块 [颜色]

【生成类】
  占卜 [问题]      — 周易蓍草占卜
  运势             — 每日运势
  今天吃什么       — 随机推荐食物
  [时间][动词]什么  — 如"晚上喝什么"

【掷骰】
  r3d6 / 掷骰 / 掷骰3个6面 [缘由]

【文本】
  反转/大写/小写/乱序/火星文 [内容]
  攻受 [攻] [受] / 讽刺 [话题] / 什么是 [概念]
  狗屁不通 [主题] / 云杰说道 [主题] / 营销号 [主题]
  随机汉字 [行] [列] / 历史上的今天

【万年历】
  今天 / 2012年5月20日 / 蒸汽2024年

【翻译】
  翻译 [文字] / 翻译成日语 [文字] / 译3次 [文字]

【信息工具】
  计算 1+2*3 / 查IP 1.2.3.4 / url编码 / url解码 / 字节 / 转十六进制 / 十六进制转 / 体脂

【数字论证】
  论证 [词语]

【知识库】
  搜索 [关键词]     — 按路径/文件名搜索
  搜索内容 [关键词] — 按文本内容搜索
  导入 [路径]       — 导入文件或目录
  资源列表          — 列出已索引资源
  标签列表          — 列出所有标签
  统计              — 知识库统计信息

【系统】
  模块列表 / 模块详情 — 查看所有模块（含运行状态、类型、PID）
  启动 <模块名>       — 手动启动进程型模块
  停止 <模块名>       — 手动停止进程型模块
  监控 / 系统状态     — 查看 CPU/内存/磁盘实时状态
  定时任务列表        — 查看全部定时任务
  添加定时任务 <名称> <频率> <模块> <动作>  — 频率：每秒/每分/每5分/每10分/每30分/每小时/每天/每周一/每月
  查看/暂停/恢复/删除/立即执行定时任务 <名称>
  帮助                — 显示本帮助`;
}

// ===== 侧边栏 =====

async function 启动模块(名: string): Promise<boolean> {
  try {
    const r = (await window.kugua.request("nigane", "nigane.registry.start", { name: 名 })) as {
      started: boolean;
      pid?: number | null;
      reason?: string;
    };
    if (!r.started && r.reason === "already") return true;
    if (r.started) return true;
    添加消息(`启动模块 ${名} 失败：${r.reason ?? "未知"}`, "error");
    return false;
  } catch (err) {
    添加消息(`启动模块 ${名} 失败：${String(err)}`, "error");
    return false;
  }
}

async function 停止模块(名: string): Promise<boolean> {
  try {
    const r = (await window.kugua.request("nigane", "nigane.registry.stop", { name: 名 })) as {
      stopped: boolean;
      reason?: string;
    };
    if (r.stopped || r.reason === "not_running") return true;
    添加消息(`停止模块 ${名} 失败：${r.reason ?? "未知"}`, "error");
    return false;
  } catch (err) {
    添加消息(`停止模块 ${名} 失败：${String(err)}`, "error");
    return false;
  }
}

async function 刷新模块列表(): Promise<void> {
  const list = document.getElementById("plugins-module-list") as HTMLUListElement;
  try {
    const modules = (await window.kugua.request("nigane", "nigane.registry.details", {})) as 模块详情[];
    list.innerHTML = "";
    if (modules.length === 0) {
      list.innerHTML = '<li style="color:var(--text-dim)">暂无节点注册</li>';
      return;
    }
    for (const m of modules) {
      const li = document.createElement("li");
      const caps = (m.capabilities ?? []).join("、") || "无能力";
      const online = Boolean(m.online);
      const dotColor = online ? "var(--green)" : "var(--text-dim)";
      const 类型标签 = m.type === "library" ? "库" : m.type === "process" ? "进程" : "?";
      const 状态 = online
        ? m.type === "process"
          ? `运行中 (pid=${m.pid ?? "?"})`
          : m.type === "library"
            ? "就绪"
            : "在线"
        : m.type === "library" && m.fileExists === false
          ? "文件缺失"
          : "离线";
      const autoBadge = m.autoStart ? '<span class="badge" style="background:var(--accent);margin-left:4px">自启</span>' : "";
      const desc = m.description ? `<div class="module-desc" style="margin-top:2px">${m.description}</div>` : "";
      // 启停按钮：仅 process 型支持
      const can启停 = m.type === "process";
      const startBtn = can启停
        ? `<button class="mini-btn start-btn" data-name="${m.name}" title="启动" ${online ? "disabled" : ""}>▶</button>`
        : "";
      const stopBtn = can启停
        ? `<button class="mini-btn stop-btn" data-name="${m.name}" title="停止" ${online ? "" : "disabled"}>■</button>`
        : "";
      li.innerHTML = `
        <span class="module-dot" style="background:${dotColor}"></span>
        <div class="module-info" style="flex:1">
          <div class="module-name">
            ${m.name}${autoBadge}
            <span style="font-weight:normal;color:var(--text-dim);font-size:0.75rem;margin-left:6px">[${类型标签}] ${状态}</span>
          </div>
          <div class="module-desc">v${m.version ?? "?"} · ${caps}</div>
          ${desc}
        </div>
        <div style="display:flex;gap:4px">${startBtn}${stopBtn}</div>
      `;
      list.appendChild(li);
    }
    // 绑定按钮
    list.querySelectorAll<HTMLButtonElement>(".start-btn").forEach((btn) => {
      btn.addEventListener("click", () => {
        const name = btn.getAttribute("data-name")!;
        void (async () => {
          if (await 启动模块(name)) setTimeout(() => void 刷新模块列表(), 600);
        })();
      });
    });
    list.querySelectorAll<HTMLButtonElement>(".stop-btn").forEach((btn) => {
      btn.addEventListener("click", () => {
        const name = btn.getAttribute("data-name")!;
        void (async () => {
          if (await 停止模块(name)) setTimeout(() => void 刷新模块列表(), 600);
        })();
      });
    });
  } catch (err) {
    list.innerHTML = `<li style="color:var(--red)">加载失败：${String(err)}</li>`;
  }
}

async function 刷新统计(): Promise<void> {
  try {
    const s = (await window.kugua.request("mkg", "mkg.stats", {})) as 知识库统计;
    document.getElementById("oc-stat-total")!.textContent = String(s.资源总数);
    document.getElementById("oc-stat-files")!.textContent = String(s.文件数);
    document.getElementById("oc-stat-dirs")!.textContent = String(s.目录数);
    document.getElementById("oc-stat-tags")!.textContent = String(s.标签数);
    document.getElementById("oc-stat-links")!.textContent = String(s.关联数);
    document.getElementById("oc-stat-texts")!.textContent = String(s.文本内容数);
  } catch {
    // 统计不可用时静默
  }
}


// ===== 资源管理器 =====

namespace Explorer {
  /** 统一内容对象：名称 + 内容 + 一系列标签 */
  interface 内容条目 {
    id: number;
    type: string;
    category: string;
    name: string;
    content: string;
    tagIds: number[];
    tagPaths: string[][];
    createdAt: number;
    updatedAt: number;
    resourceId: number | null;
    path: string | null;
    size: number;
    modifiedTime: number;
    extension: string;
    meta: Record<string, unknown>;
  }

  let 当前视图模式: "large" | "list" | "details" = "large";
  let 当前标签ID: number | "all" = "all";
  let 搜索关键词 = "";
  let 类型筛选: string = "all";
  let 排序方式: "import" | "name" | "updated" = "import";
  let 无分类筛选 = false;
  let 所有内容: 内容条目[] = [];
  let 标签树: 标签节点[] = [];
  let 选中内容: 内容条目 | null = null;
  let 打开方式列表: 打开方式配置[] = [];
  let 搜索防抖: number | null = null;
  let 大图标列数 = 6;
  // 内联标签编辑（详情栏）
  let 内联标签编辑ID = new Set<number>();
  // ===== 点子视图状态 =====
  let 所有笔记: 笔记[] = [];
  let 选中笔记: 笔记 | null = null;
  let 笔记搜索关键词 = "";
  let 笔记编辑标签ID = new Set<number>();
  let 笔记编辑目标: 笔记 | null = null;
  let 所有素材: 素材[] = [];
  let 选中素材: 素材 | null = null;
  let 素材搜索关键词 = "";
  let 素材编辑标签ID = new Set<number>();
  let 素材编辑目标: 素材 | null = null;
  // ===== 看板视图状态 =====
  let 所有列: 看板列[] = [];
  let 所有卡片: 卡片[] = [];
  let 编辑中的列: 看板列 | null = null;
  let 编辑中的卡片: 卡片 | null = null;
  let 卡片编辑标签ID = new Set<number>();

  const 大图标容器 = document.getElementById("ex-items-large") as HTMLDivElement;
  const 列表容器 = document.getElementById("ex-items-list") as HTMLDivElement;
  const 详情容器 = document.getElementById("ex-details-body") as HTMLDivElement;
  const 标签树容器 = document.getElementById("ex-tag-tree") as HTMLDivElement;
  const 文件信息面板 = document.getElementById("ex-file-info") as HTMLDivElement;
  const 右键菜单 = document.getElementById("context-menu") as HTMLDivElement;
  const 状态栏计数 = document.getElementById("ex-status-count") as HTMLSpanElement;
  const 面包屑 = document.getElementById("ex-breadcrumb") as HTMLDivElement;
  const 搜索框 = document.getElementById("ex-search") as HTMLInputElement;

  function 获取文件图标类(name: string, kind: string): string {
    if (kind === "directory") return "fi-folder";
    const ext = name.includes(".") ? name.slice(name.lastIndexOf(".") + 1).toLowerCase() : "";
    if (["txt", "md", "rtf", "log", "csv"].includes(ext)) return "fi-text";
    if (["jpg", "jpeg", "png", "gif", "bmp", "webp", "svg", "ico"].includes(ext)) return "fi-image";
    if (["ts", "tsx", "js", "jsx", "py", "java", "c", "cpp", "cs", "go", "rs", "rb", "php", "html", "css", "json", "xml", "yaml", "yml", "sh", "bat", "ps1", "sql"].includes(ext)) return "fi-code";
    if (["db", "sqlite", "sqlite3", "dat", "bin"].includes(ext)) return "fi-data";
    if (["exe", "msi", "dll", "com", "bat", "cmd"].includes(ext)) return "fi-exec";
    if (["zip", "rar", "7z", "tar", "gz", "bz2"].includes(ext)) return "fi-archive";
    if (["pdf", "doc", "docx", "xls", "xlsx", "ppt", "pptx", "odt"].includes(ext)) return "fi-doc";
    return "fi-other";
  }

  function 获取文件类型描述(name: string, kind: string): string {
    if (kind === "directory") return "文件夹";
    const ext = name.includes(".") ? name.slice(name.lastIndexOf(".") + 1).toLowerCase() : "";
    const 映射: Record<string, string> = {
      txt: "文本文件", md: "Markdown文档", json: "JSON数据", js: "JavaScript脚本", ts: "TypeScript脚本",
      py: "Python脚本", html: "HTML文档", css: "CSS样式表", png: "PNG图片", jpg: "JPEG图片",
      jpeg: "JPEG图片", gif: "GIF图片", svg: "SVG矢量图", pdf: "PDF文档", exe: "可执行文件",
      zip: "ZIP压缩包", rar: "RAR压缩包", "7z": "7z压缩包", bat: "批处理文件", ps1: "PowerShell脚本",
      csv: "CSV表格", xml: "XML文档", yaml: "YAML配置", yml: "YAML配置", log: "日志文件",
      c: "C源码", cpp: "C++源码", cs: "C#源码", java: "Java源码", go: "Go源码", rs: "Rust源码",
      db: "数据库文件", sqlite: "SQLite数据库",
    };
    return 映射[ext] || (ext ? ext.toUpperCase() + " 文件" : "文件");
  }

  function 获取扩展名(name: string): string {
    if (!name.includes(".")) return "";
    return name.slice(name.lastIndexOf(".") + 1).toLowerCase();
  }

  function 格式化大小(bytes: number): string {
    if (bytes === 0) return "0 B";
    const units = ["B", "KB", "MB", "GB"];
    let i = 0;
    let size = bytes;
    while (size >= 1024 && i < units.length - 1) { size /= 1024; i++; }
    return size.toFixed(i === 0 ? 0 : 1) + " " + units[i];
  }

  function 中文字符数(str: string): number {
    if (!str) return 0;
    let n = 0;
    for (const ch of str) if (/[\u4e00-\u9fff]/.test(ch)) n++;
    return n;
  }

  /** 内容大小文本：目录为空；文本类包含文件大小与中文字数 */
  function 内容大小文本(file: 内容条目): string {
    if (file.category === "目录") return "";
    const 字节 = file.size ? 格式化大小(file.size) : "";
    const 文本类 = file.category === "文本" || file.category === "文本段" || file.category === "点子" || file.category === "素材";
    if (!文本类) return 字节;
    const 字数 = 中文字符数(file.content);
    return [字节, 字数 > 0 ? 字数 + " 字" : ""].filter(Boolean).join(" · ");
  }

  function 格式化时间(秒: number): string {
    if (!秒) return "-";
    const d = new Date(秒 * 1000);
    return d.getFullYear() + "/" + String(d.getMonth() + 1).padStart(2, "0") + "/" + String(d.getDate()).padStart(2, "0") + " " + String(d.getHours()).padStart(2, "0") + ":" + String(d.getMinutes()).padStart(2, "0");
  }

  function 显示名(r: 内容条目): string {
    return r.name;
  }

  /** 节点底层形式（resource/snippet/note/material/directory）的中文名 */
  function 节点形式名(type: string): string {
    switch (type) {
      case "resource": return "资源";
      case "snippet": return "文本段";
      case "note": return "点子";
      case "material": return "素材";
      case "directory": return "目录";
      case "card": return "卡片";
      default: return type || "-";
    }
  }

  /** 根据内容分类返回图标类 */
  function 获取内容图标类(category: string): string {
    if (category === "目录") return "fi-folder";
    if (category === "图片") return "fi-image";
    if (category === "音乐") return "fi-audio";
    if (category === "视频") return "fi-video";
    if (category === "文本") return "fi-text";
    if (category === "文本段") return "fi-snippet";
    if (category === "点子") return "fi-note";
    if (category === "素材") return "fi-material";
    return "fi-file";
  }

  function 创建文件图标(item: 内容条目, size: "large" | "small" = "large"): HTMLDivElement {
    const icon = document.createElement("div");
    const cls = 获取内容图标类(item.category);
    icon.className = "ex-file-icon " + cls;
    if (item.category === "目录") {
      icon.textContent = "📁";
      icon.style.fontSize = size === "large" ? "2rem" : "0.8rem";
      icon.style.background = "";
    } else if (item.category === "点子") {
      icon.textContent = "💡";
      icon.style.fontSize = size === "large" ? "2rem" : "0.8rem";
      icon.style.background = "";
    } else if (item.category === "素材") {
      icon.textContent = "🖼️";
      icon.style.fontSize = size === "large" ? "2rem" : "0.8rem";
      icon.style.background = "";
    } else if (item.category === "文本段") {
      icon.textContent = "📝";
      icon.style.fontSize = size === "large" ? "2rem" : "0.8rem";
      icon.style.background = "";
    } else {
      const ext = item.extension || 获取扩展名(item.name);
      icon.textContent = ext ? ext.slice(0, 3) : "…";
      if (size === "small") {
        icon.style.fontSize = "0.55rem";
      }
      const extBadge = document.createElement("span");
      extBadge.className = "fi-ext";
      extBadge.textContent = (ext || "文件").toUpperCase();
      if (size === "small") extBadge.style.display = "none";
      icon.appendChild(extBadge);
    }
    return icon;
  }


  /** 把本地物理路径转成 file:// URL */
  function 转文件URL(路径: string | null | undefined): string {
    if (!路径) return "";
    let p = 路径.replace(/\\/g, "/");
    if (!p.startsWith("/")) p = "/" + p;
    return "file://" + encodeURI(p);
  }

  /** 大图标(缩略图)视图的内容呈现：图片/视频显示缩略图，文本/文本段/点子/素材显示开头一段，其余用图标 */
  function 创建大图标内容(item: 内容条目): HTMLElement {
    const wrap = document.createElement("div");
    wrap.className = "ex-thumb";
    if (item.category === "图片" && item.path) {
      const img = document.createElement("img");
      img.className = "ex-thumb-img";
      img.src = 转文件URL(item.path);
      img.alt = item.name;
      img.draggable = false;
      img.onerror = () => {
        // 缩略图加载失败时回退为图标
        wrap.replaceWith(创建文件图标(item, "large"));
      };
      wrap.appendChild(img);
      return wrap;
    }
    if (item.category === "视频" && item.path) {
      const video = document.createElement("video");
      video.className = "ex-thumb-video";
      video.muted = true;
      video.playsInline = true;
      video.preload = "metadata";
      video.src = 转文件URL(item.path);
      video.addEventListener("loadedmetadata", () => {
        try {
          // 跳到视频前段附近，展示较可能是有效画面的帧
          video.currentTime = Math.min(1, (video.duration || 0) * 0.1);
        } catch { /* 忽略 */ }
      });
      video.addEventListener("error", () => {
        wrap.replaceWith(创建文件图标(item, "large"));
      });
      wrap.appendChild(video);
      return wrap;
    }
    if (["文本", "文本段", "点子", "素材"].includes(item.category)) {
      const 片段 = (item.content || "").trim().replace(/\s+/g, " ") || "（无内容）";
      const pre = document.createElement("div");
      pre.className = "ex-thumb-text";
      pre.textContent = 片段.slice(0, 60);
      wrap.appendChild(pre);
      return wrap;
    }
    // 目录/文件/音乐等：保留原有图标
    return 创建文件图标(item, "large");
  }

  function 筛选内容(): 内容条目[] {
    let items = [...所有内容];
    const kw = 搜索关键词.trim().toLowerCase();
    if (kw) {
      items = items.filter((it) =>
        it.name.toLowerCase().includes(kw) ||
        it.content.toLowerCase().includes(kw) ||
        (it.path ? it.path.toLowerCase().includes(kw) : false),
      );
    }
    if (类型筛选 !== "all") {
      items = items.filter((it) => it.category === 类型筛选);
    }
    const 标签筛选ID = 当前标签ID;
    if (标签筛选ID === "all" && 无分类筛选) {
      items = items.filter((it) => it.tagIds.length === 0);
    }
    // 按具体标签筛选已在服务端（含后代标签展开）完成，此处无需再次精确过滤
    if (排序方式 === "name") {
      items.sort((a, b) => a.name.localeCompare(b.name, "zh"));
    } else if (排序方式 === "updated") {
      items.sort((a, b) => b.updatedAt - a.updatedAt);
    } else {
      items.sort((a, b) => a.createdAt - b.createdAt); // 导入顺序（旧→新）
    }
    return items;
  }

  function 渲染内容列表(): void {
    const files = 筛选内容();
    状态栏计数.textContent = files.length + " 个项目";

    大图标容器.innerHTML = "";
    for (const file of files) {
      const tile = document.createElement("div");
      tile.className = "ex-file-tile";
      if (选中内容?.id === file.id) tile.classList.add("selected");
      tile.dataset.id = String(file.id);
      const icon = 创建大图标内容(file);
      const name = document.createElement("div");
      name.className = "ex-file-name";
      name.textContent = 显示名(file);
      tile.appendChild(icon);
      tile.appendChild(name);
      绑定内容项事件(tile, file);
      大图标容器.appendChild(tile);
    }

    列表容器.innerHTML = "";
    for (const file of files) {
      const item = document.createElement("div");
      item.className = "ex-list-item";
      if (选中内容?.id === file.id) item.classList.add("selected");
      item.dataset.id = String(file.id);
      const icon = 创建文件图标(file, "small");
      const name = document.createElement("div");
      name.className = "ex-file-name";
      name.textContent = 显示名(file);
      item.appendChild(icon);
      item.appendChild(name);
      绑定内容项事件(item, file);
      列表容器.appendChild(item);
    }

    详情容器.innerHTML = "";
    for (const file of files) {
      const row = document.createElement("div");
      row.className = "ex-detail-row";
      if (选中内容?.id === file.id) row.classList.add("selected");
      row.dataset.id = String(file.id);
      const nameCell = document.createElement("div");
      nameCell.className = "dr-name";
      const icon = 创建文件图标(file, "small");
      const nameText = document.createElement("span");
      nameText.textContent = 显示名(file);
      nameCell.appendChild(icon);
      nameCell.appendChild(nameText);
      const typeCell = document.createElement("div");
      typeCell.className = "dr-type";
      typeCell.textContent = file.category;
      const sizeCell = document.createElement("div");
      sizeCell.className = "dr-size";
      sizeCell.textContent = 内容大小文本(file);
      const pathCell = document.createElement("div");
      pathCell.className = "dr-path";
      pathCell.textContent = file.path || "";
      pathCell.title = file.path || "";
      row.appendChild(nameCell);
      row.appendChild(typeCell);
      row.appendChild(sizeCell);
      row.appendChild(pathCell);
      绑定内容项事件(row, file);
      详情容器.appendChild(row);
    }
  }

  function 绑定内容项事件(el: HTMLElement, item: 内容条目): void {
    // 知识库条目可拖拽到聊天侧边栏（附资源路径引用）
    el.draggable = true;
    el.addEventListener("dragstart", (e) => {
      e.dataTransfer?.setData("text/kugua-resource", JSON.stringify({ id: item.id, name: item.name, path: item.path ?? null }));
      if (e.dataTransfer) e.dataTransfer.effectAllowed = "copy";
    });
    el.addEventListener("click", (e) => {
      e.stopPropagation();
      选中内容 = item;
      更新内容信息面板();
      渲染内容列表();
      隐藏右键菜单();
    });
    el.addEventListener("dblclick", (e) => {
      e.stopPropagation();
      void 打开内容(item);
    });
    el.addEventListener("contextmenu", (e) => {
      e.preventDefault();
      e.stopPropagation();
      选中内容 = item;
      更新内容信息面板();
      渲染内容列表();
      显示右键菜单(e.clientX, e.clientY);
    });
  }

  // ===== 标签导航与关联标签 =====
  function 找到标签名(tagId: number): string {
    const stack: 标签节点[] = [...标签树];
    while (stack.length) {
      const n = stack.pop()!;
      if (n.id === tagId) return n.name;
      if (n.children) stack.push(...n.children);
    }
    return "标签";
  }

  /** 在标签树中按名称模糊查找标签 */
  function 搜索标签节点(keyword: string): 标签节点[] {
    const kw = keyword.trim().toLowerCase();
    if (!kw) return [];
    const 命中: 标签节点[] = [];
    const stack: 标签节点[] = [...标签树];
    while (stack.length) {
      const n = stack.pop()!;
      if (n.name.toLowerCase().includes(kw)) 命中.push(n);
      if (n.children) stack.push(...n.children);
    }
    return 命中;
  }

  /** 导航到某个标签：更新当前标签、面包屑路径、刷新内容列表与标签树 */
  function 导航到标签(tagId: number): void {
    当前标签ID = tagId;
    // 无分类与具体标签互斥：点击具体标签时清除「无分类」过滤，否则服务端按 noTag 会把带标签资源全部过滤掉
    无分类筛选 = false;
    const 无分类框 = document.getElementById("ex-notag") as HTMLInputElement;
    if (无分类框) 无分类框.checked = false;
    选中内容 = null;
    文件信息面板.classList.add("hidden");
    const path: { name: string; id: number | "all" }[] = [{ name: "所有内容", id: "all" }];
    const buildPath = (nodes: 标签节点[], targetId: number, crumbs: { name: string; id: number }[]): boolean => {
      for (const n of nodes) {
        if (n.id === targetId) { crumbs.push({ name: n.name, id: n.id }); return true; }
        if (buildPath(n.children, targetId, crumbs)) { crumbs.unshift({ name: n.name, id: n.id }); return true; }
      }
      return false;
    };
    const crumbs: { name: string; id: number }[] = [];
    buildPath(标签树, tagId, crumbs);
    path.push(...crumbs.map((c) => ({ name: c.name, id: c.id as number | "all" })));
    更新面包屑(path);
    void 加载所有内容();
    void 渲染关联标签();
    渲染标签树();
  }

  /** 在面包屑路径下方渲染本标签及一串关联标签（基于共现频率） */
  async function 渲染关联标签(): Promise<void> {
    const 容器 = document.getElementById("ex-related-tags") as HTMLDivElement | null;
    if (!容器) return;
    容器.innerHTML = "";
    // 搜索时：若关键词匹配到标签，展示匹配标签供跳转
    if (当前标签ID === "all") {
      const 匹配 = 搜索标签节点(搜索关键词);
      if (匹配.length === 0) { 容器.classList.add("hidden"); return; }
      容器.classList.remove("hidden");
      const 标签 = document.createElement("span");
      标签.className = "ex-rel-label";
      标签.textContent = "匹配的标签";
      容器.appendChild(标签);
      for (const m of 匹配.slice(0, 12)) {
        const chip = document.createElement("button");
        chip.className = "ex-rel-tag";
        chip.textContent = m.name;
        chip.addEventListener("click", () => 导航到标签(m.id));
        容器.appendChild(chip);
      }
      return;
    }
    try {
      const 结果 = (await window.kugua.request("mkg", "mkg.tag.related", { tagId: 当前标签ID, limit: 12 })) as Array<{
        tag: { id: number; name: string }; 共现: number;
      }>;
      容器.classList.remove("hidden");
      容器.innerHTML = "";
      const 标签 = document.createElement("span");
      标签.className = "ex-rel-label";
      标签.textContent = "关联标签";
      容器.appendChild(标签);
      const 当前chip = document.createElement("button");
      当前chip.className = "ex-rel-tag current";
      当前chip.textContent = 找到标签名(当前标签ID as number);
      容器.appendChild(当前chip);
      for (const r of 结果) {
        const chip = document.createElement("button");
        chip.className = "ex-rel-tag";
        chip.title = "与当前标签共现 " + r.共现 + " 次";
        chip.innerHTML = `<span>${r.tag.name}</span><span class="ex-rel-co">${r.共现}</span>`;
        chip.addEventListener("click", () => 导航到标签(r.tag.id));
        容器.appendChild(chip);
      }
    } catch {
      容器.classList.add("hidden");
    }
  }

  function 渲染标签树(): void {
    标签树容器.innerHTML = "";

    const allItem = document.createElement("div");
    allItem.className = "ex-tag-all";
    if (当前标签ID === "all" && !无分类筛选) allItem.classList.add("active");
    allItem.innerHTML = '<span class="ex-tag-icon">🗂️</span> 所有内容';
    allItem.addEventListener("click", () => {
      当前标签ID = "all";
      无分类筛选 = false;
      const 无分类框 = document.getElementById("ex-notag") as HTMLInputElement;
      if (无分类框) 无分类框.checked = false;
      选中内容 = null;
      更新面包屑([{ name: "所有内容", id: "all" }]);
      文件信息面板.classList.add("hidden");
      void 渲染关联标签();
      void 加载所有内容();
      渲染标签树();
    });
    标签树容器.appendChild(allItem);

    // “未分类”恒为最外层分类，不参与父子嵌套
    const 未分类项 = document.createElement("div");
    未分类项.className = "ex-tag-item ex-tag-untagged" + (当前标签ID === "all" && 无分类筛选 ? " active" : "");
    未分类项.style.paddingLeft = "0.5px";
    未分类项.innerHTML = '<span class="ex-tag-expand empty">▶</span><span class="ex-tag-icon">📂</span> 未分类';
    未分类项.title = "只看未分类（无标签）的内容";
    未分类项.addEventListener("click", () => {
      当前标签ID = "all";
      无分类筛选 = true;
      const 无分类框 = document.getElementById("ex-notag") as HTMLInputElement;
      if (无分类框) 无分类框.checked = true;
      选中内容 = null;
      更新面包屑([{ name: "未分类", id: "all" }]);
      文件信息面板.classList.add("hidden");
      void 渲染关联标签();
      void 加载所有内容();
      渲染标签树();
    });
    标签树容器.appendChild(未分类项);

    function renderNode(node: 标签节点, depth: number, parent: HTMLElement): void {
      const hasChildren = node.children.length > 0;
      const item = document.createElement("div");
      item.className = "ex-tag-item";
      item.style.paddingLeft = (0.5 + depth * 14) + "px";
      if (当前标签ID === node.id) item.classList.add("active");
      const expand = document.createElement("span");
      expand.className = "ex-tag-expand";
      if (!hasChildren) expand.classList.add("empty");
      expand.textContent = "▼";
      item.appendChild(expand);
      const icon = document.createElement("span");
      icon.className = "ex-tag-icon";
      icon.textContent = depth === 0 ? "📁" : "🏷️";
      icon.style.fontSize = "0.75rem";
      item.appendChild(icon);
      const nameText = document.createElement("span");
      nameText.textContent = node.name;
      nameText.style.overflow = "hidden";
      nameText.style.textOverflow = "ellipsis";
      item.appendChild(nameText);

      const childrenDiv = document.createElement("div");
      childrenDiv.className = "ex-tag-children";

      let expanded = true;
      expand.addEventListener("click", (e) => {
        e.stopPropagation();
        expanded = !expanded;
        if (expanded) {
          expand.textContent = "▼";
          expand.classList.remove("collapsed");
          childrenDiv.classList.remove("collapsed");
        } else {
          expand.textContent = "▶";
          expand.classList.add("collapsed");
          childrenDiv.classList.add("collapsed");
        }
      });

      item.addEventListener("click", (e) => {
        if ((e.target as HTMLElement).classList.contains("ex-tag-expand")) return;
        导航到标签(node.id);
      });

      parent.appendChild(item);
      if (hasChildren) {
        parent.appendChild(childrenDiv);
        for (const child of node.children) {
          renderNode(child, depth + 1, childrenDiv);
        }
      }
    }

    for (const root of 标签树) {
      renderNode(root, 0, 标签树容器);
    }
  }

  function 更新面包屑(path: { name: string; id: number | "all" }[]): void {
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
      item.addEventListener("click", () => {
        if (p.id === "all") {
          当前标签ID = "all";
          选中内容 = null;
          文件信息面板.classList.add("hidden");
          更新面包屑([{ name: "所有内容", id: "all" }]);
          void 渲染关联标签();
          void 加载所有内容();
          渲染标签树();
        } else {
          导航到标签(p.id as number);
        }
      });
      面包屑.appendChild(item);
    });
  }

  function 更新内容信息面板(): void {
    if (!选中内容) {
      文件信息面板.classList.add("hidden");
      return;
    }
    文件信息面板.classList.remove("hidden");

    const f = 选中内容;
    const iconEl = document.getElementById("ex-info-icon") as HTMLDivElement;
    iconEl.className = "ex-info-icon " + 获取内容图标类(f.category);
    if (f.category === "目录") {
      iconEl.textContent = "📁";
      iconEl.style.background = "";
      iconEl.style.fontSize = "2rem";
    } else if (f.category === "点子") {
      iconEl.textContent = "💡";
      iconEl.style.background = "";
      iconEl.style.fontSize = "2rem";
    } else if (f.category === "素材") {
      iconEl.textContent = "🖼️";
      iconEl.style.background = "";
      iconEl.style.fontSize = "2rem";
    } else if (f.category === "文本段") {
      iconEl.textContent = "📝";
      iconEl.style.background = "";
      iconEl.style.fontSize = "2rem";
    } else {
      const ext = f.extension;
      iconEl.textContent = ext ? ext.slice(0, 3) : "…";
      iconEl.style.fontSize = "1rem";
    }

    document.getElementById("ex-info-name")!.textContent = 显示名(f);
    document.getElementById("ex-info-size")!.textContent = 内容大小文本(f);

    // 信息栏预览：图片/视频显示缩略图，文本类显示内容摘要
    const 预览元素 = document.getElementById("ex-info-preview") as HTMLDivElement;
    预览元素.innerHTML = "";
    预览元素.classList.remove("hidden");
    if (f.category === "图片" && f.path) {
      const 图 = document.createElement("img");
      图.className = "ex-info-preview-img";
      图.src = 转文件URL(f.path);
      图.alt = f.name;
      图.onerror = () => { 预览元素.classList.add("hidden"); };
      预览元素.appendChild(图);
    } else if (f.category === "视频" && f.path) {
      const 视 = document.createElement("video");
      视.className = "ex-info-preview-video";
      视.src = 转文件URL(f.path);
      视.muted = true;
      视.preload = "metadata";
      视.playsInline = true;
      视.controls = true;
      视.onerror = () => { 预览元素.classList.add("hidden"); };
      预览元素.appendChild(视);
    } else if (["文本", "文本段", "点子", "素材"].includes(f.category) && f.content) {
      const 摘要 = document.createElement("div");
      摘要.className = "ex-info-preview-text";
      摘要.textContent = f.content.replace(/\s+/g, " ").trim() || "（无内容）";
      预览元素.appendChild(摘要);
    } else {
      预览元素.classList.add("hidden");
    }
    const pathEl = document.getElementById("ex-info-path") as HTMLSpanElement;
    pathEl.textContent = f.path || (f.type === "resource" || f.type === "directory" ? "-" : "（" + 节点形式名(f.type) + "）");
    pathEl.title = "点击复制物理路径";
    document.getElementById("ex-info-modified")!.textContent = 格式化时间(f.modifiedTime || f.updatedAt);

    // 内联标签：chips（可移除）+ 添加按钮 + 可勾选标签树
    内联标签编辑ID = new Set(f.tagIds);
    const tagsEl = document.getElementById("ex-info-tags") as HTMLDivElement;
    tagsEl.innerHTML = "";
    if (f.tagIds.length === 0) {
      tagsEl.innerHTML = '<span style="color:var(--text-dim);font-size:0.7rem">(无标签)</span>';
    } else {
      const idToLeaf = new Map<number, string>();
      const idToPath = new Map<number, string>();
      function walk(nodes: 标签节点[], trail: string[]): void {
        for (const n of nodes) {
          const pp = [...trail, n.name];
          idToPath.set(n.id, pp.join(" / "));
          idToLeaf.set(n.id, n.name);
          if (n.children) walk(n.children, pp);
        }
      }
      walk(标签树, []);
      for (const tid of f.tagIds) {
        const chip = document.createElement("span");
        chip.className = "tag-chip";
        chip.title = idToPath.get(tid) || ("标签ID:" + tid);
        const leaf = document.createElement("span");
        leaf.textContent = idToLeaf.get(tid) || ("ID:" + tid);
        chip.appendChild(leaf);
        const x = document.createElement("span");
        x.className = "tc-remove";
        x.textContent = "×";
        x.title = "移除标签";
        x.addEventListener("click", () => {
          内联标签编辑ID.delete(tid);
          void 内联保存标签();
        });
        chip.appendChild(x);
        tagsEl.appendChild(chip);
      }
    }
    渲染内联标签树();
  }

  /** 渲染详情栏内的可勾选标签树 */
  function 渲染内联标签树(): void {
    const container = document.getElementById("ex-info-tag-tree") as HTMLDivElement | null;
    if (!container) return;
    渲染可勾选标签树(标签树, {
      containerId: "ex-info-tag-tree",
      选中的标签ID: 内联标签编辑ID,
      onToggle: () => void 内联保存标签(),
    });
    if (container) {
      // 顶部提示
      const hint = document.createElement("div");
      hint.className = "inline-tag-hint";
      hint.textContent = "勾选以添加标签，点击详情中标签的 × 可移除";
      container.insertBefore(hint, container.firstChild);
    }
  }

  /** 保存内联标签（详情栏） */
  async function 内联保存标签(): Promise<void> {
    if (!选中内容) return;
    try {
      await window.kugua.request("mkg", "mkg.node.setTags", { nodeId: 选中内容.id, tagIds: Array.from(内联标签编辑ID) });
      选中内容 = { ...选中内容, tagIds: Array.from(内联标签编辑ID) };
      更新内容信息面板();
    } catch (err) {
      添加消息("保存标签失败：" + String(err), "error");
    }
  }

  async function 内联新建标签(): Promise<void> {
    const input = document.getElementById("ex-info-tag-input") as HTMLInputElement | null;
    if (!input) return;
    const p = input.value.trim();
    if (!p) { 添加消息("请输入标签路径", "error"); return; }
    try {
      await window.kugua.request("mkg", "mkg.tag.createTree", { names: p.split("/").filter(Boolean) });
      添加消息("已创建标签：" + p, "system");
      input.value = "";
      await 加载标签树();
      渲染内联标签树();
    } catch (err) {
      添加消息("创建标签失败：" + String(err), "error");
    }
  }

  async function 在资源管理器中显示(item: 内容条目): Promise<void> {
    if (item.resourceId == null) { 添加消息("该内容不是文件，无法显示", "system"); return; }
    try {
      await window.kugua.request("mkg", "mkg.file.explorer", { resourceId: item.resourceId });
    } catch (err) {
      添加消息("打开资源管理器失败：" + String(err), "error");
    }
  }

  async function 复制物理路径(item: 内容条目): Promise<void> {
    if (item.resourceId == null) { 添加消息("该内容不是文件，无法复制路径", "system"); return; }
    try {
      const result = (await window.kugua.request("mkg", "mkg.file.physicalPath", { resourceId: item.resourceId })) as { path: string };
      await navigator.clipboard.writeText(result.path);
      状态栏计数.textContent = "已复制路径：" + result.path;
      setTimeout(() => { 状态栏计数.textContent = 筛选内容().length + " 个项目"; }, 2000);
    } catch (err) {
      添加消息("复制路径失败：" + String(err), "error");
    }
  }

  async function 设置别名(item: 内容条目, alias: string): Promise<void> {
    if (item.resourceId == null) { 添加消息("该内容不是文件，无法重命名", "system"); return; }
    try {
      await window.kugua.request("mkg", "mkg.alias.set", { resourceId: item.resourceId, alias });
      await 加载所有内容();
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

  async function 加载所有内容(重试次数 = 0): Promise<void> {
    try {
      const categories = 类型筛选 === "all" ? undefined : [类型筛选];
      const result = (await window.kugua.request("mkg", "mkg.node.listAll", {
        keyword: 搜索关键词 || undefined,
        categories,
        tagId: typeof 当前标签ID === "number" ? 当前标签ID : undefined,
        noTag: 无分类筛选,
        sort: 排序方式,
        limit: 1000,
      })) as 内容条目[];
      所有内容 = result;
      渲染内容列表();
      void 渲染关联标签();
    } catch {
      if (重试次数 < 5) {
        setTimeout(() => void 加载所有内容(重试次数 + 1), 800);
        return;
      }
      所有内容 = [];
      渲染内容列表();
    }
  }

  async function 加载标签树(重试次数 = 0): Promise<void> {
    try {
      标签树 = (await window.kugua.request("mkg", "mkg.tag.tree", {})) as 标签节点[];
      渲染标签树();
    } catch {
      // 首次启动时 mkg 模块可能尚未就绪，最多重试 5 次
      if (重试次数 < 5) {
        setTimeout(() => void 加载标签树(重试次数 + 1), 800);
        return;
      }
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
  // ========== 可勾选标签树 ==========
  interface 可勾选标签树选项 {
    containerId: string;
    选中的标签ID: Set<number>;
    onToggle?: (tagId: number, checked: boolean) => void;
  }

  function 渲染可勾选标签树(tree: 标签节点[], opts: 可勾选标签树选项): void {
    const container = document.getElementById(opts.containerId) as HTMLDivElement | null;
    if (!container) return;
    container.innerHTML = "";
    if (!tree || tree.length === 0) {
      container.innerHTML = '<div style="color:var(--text-dim);font-size:0.75rem;padding:0.5rem">还没有标签，先在上方输入路径新建一个吧。</div>';
      return;
    }

    function render(nodes: 标签节点[], parent: HTMLDivElement, depth: number): void {
      for (const node of nodes) {
        const nodeDiv = document.createElement("div");
        nodeDiv.className = "tt-node";

        const row = document.createElement("div");
        row.className = "tt-row";
        row.style.paddingLeft = depth * 0.2 + "rem";

        const hasChildren = node.children && node.children.length > 0;
        const toggle = document.createElement("span");
        toggle.className = "tt-toggle" + (hasChildren ? "" : " empty");
        toggle.textContent = "▼";
        row.appendChild(toggle);

        const cb = document.createElement("input");
        cb.type = "checkbox";
        cb.className = "tt-check";
        cb.checked = opts.选中的标签ID.has(node.id);
        cb.addEventListener("change", () => {
          if (cb.checked) opts.选中的标签ID.add(node.id); else opts.选中的标签ID.delete(node.id);
          opts.onToggle?.(node.id, cb.checked);
        });
        row.appendChild(cb);

        const name = document.createElement("span");
        name.className = "tt-name";
        name.textContent = node.name;
        row.appendChild(name);
        nodeDiv.appendChild(row);

        let childrenDiv: HTMLDivElement | null = null;
        if (hasChildren) {
          childrenDiv = document.createElement("div");
          childrenDiv.className = "tt-children";
          render(node.children, childrenDiv, depth + 1);
          nodeDiv.appendChild(childrenDiv);

          toggle.addEventListener("click", (e: MouseEvent) => {
            e.stopPropagation();
            if (!childrenDiv) return;
            const collapsed = childrenDiv.classList.toggle("collapsed");
            toggle.textContent = collapsed ? "▶" : "▼";
          });
        }
        parent.appendChild(nodeDiv);
      }
    }
    render(tree, container, 0);
  }

  // ===== 文件/图片统一直导导入（不弹窗、不预填名称和标签） =====
  async function 直接导入(): Promise<void> {
    let paths: string[] = [];
    try {
      paths = (await (window.kugua as any).dialog.openFiles({ title: "选择文件或图片导入到知识库", multi: true })) as string[];
    } catch (err) {
      添加消息("选择文件失败：" + String(err), "error");
      return;
    }
    if (!paths || paths.length === 0) return;
    try {
      const items = paths.map((p) => ({ sourcePath: p }));
      const r = (await window.kugua.request("mkg", "mkg.resource.importFiles", { items })) as { count: number };
      添加消息("成功导入 " + r.count + " 个内容", "system");
      await 加载所有内容();
    } catch (err) {
      添加消息("导入失败：" + String(err), "error");
    }
  }

  // ===== 打开内容（文件用系统打开，纯内容仅展示） =====
  async function 打开内容(item: 内容条目, programPath?: string): Promise<void> {
    if (item.resourceId == null) {
      选中内容 = item;
      更新内容信息面板();
      return;
    }
    try {
      if (programPath) {
        await window.kugua.request("mkg", "mkg.file.openWith", { resourceId: item.resourceId, programPath });
      } else {
        await window.kugua.request("mkg", "mkg.file.open", { resourceId: item.resourceId });
      }
    } catch (err) {
      添加消息("打开内容失败：" + String(err), "error");
    }
  }

  // ===== 新建片段（其他片段知识/文本段） =====
  let 片段编辑标签ID = new Set<number>();

  function 打开新建片段对话框(): void {
    (document.getElementById("snippet-dialog-title") as HTMLDivElement).textContent = "新建片段";
    (document.getElementById("snippet-title") as HTMLInputElement).value = "";
    (document.getElementById("snippet-content") as HTMLTextAreaElement).value = "";
    (document.getElementById("snippet-new-tag-path") as HTMLInputElement).value = "";
    片段编辑标签ID = new Set();
    渲染片段对话框标签();
    渲染可勾选标签树(标签树, {
      containerId: "snippet-tag-tree",
      选中的标签ID: 片段编辑标签ID,
      onToggle: () => 渲染片段对话框标签(),
    });
    document.getElementById("snippet-dialog")?.classList.remove("hidden");
    (document.getElementById("snippet-title") as HTMLInputElement).focus();
  }

  function 渲染片段对话框标签(): void {
    const tagsEl = document.getElementById("snippet-tag-chips") as HTMLDivElement;
    if (!tagsEl) return;
    tagsEl.innerHTML = "";
    if (片段编辑标签ID.size === 0) {
      tagsEl.innerHTML = '<span style="color:var(--text-dim);font-size:0.7rem">(未选择标签，从下方标签树勾选)</span>';
      return;
    }
    片段编辑标签ID.forEach((id) => {
      const chip = document.createElement("span");
      chip.className = "tag-chip";
      chip.textContent = 标签ID转名称(id);
      const x = document.createElement("span");
      x.className = "tc-remove";
      x.textContent = "×";
      x.title = "移除";
      x.addEventListener("click", () => {
        片段编辑标签ID.delete(id);
        渲染片段对话框标签();
        渲染可勾选标签树(标签树, { containerId: "snippet-tag-tree", 选中的标签ID: 片段编辑标签ID, onToggle: () => 渲染片段对话框标签() });
      });
      chip.appendChild(x);
      tagsEl.appendChild(chip);
    });
  }

  async function 保存片段(): Promise<void> {
    const title = (document.getElementById("snippet-title") as HTMLInputElement).value.trim();
    const content = (document.getElementById("snippet-content") as HTMLTextAreaElement).value;
    const tagIds = Array.from(片段编辑标签ID);
    try {
      await window.kugua.request("mkg", "mkg.snippet.create", { title: title || "未命名", content, tagIds });
      添加消息("已新建片段", "system");
      document.getElementById("snippet-dialog")?.classList.add("hidden");
      await 加载所有内容();
    } catch (err) {
      添加消息("保存片段失败：" + String(err), "error");
    }
  }

  async function 新建片段标签(): Promise<void> {
    const input = document.getElementById("snippet-new-tag-path") as HTMLInputElement;
    const p = input.value.trim();
    if (!p) { 添加消息("请输入标签路径", "error"); return; }
    try {
      await window.kugua.request("mkg", "mkg.tag.createTree", { names: p.split("/").filter(Boolean) });
      添加消息("已创建标签：" + p, "system");
      input.value = "";
      await 加载标签树();
      渲染可勾选标签树(标签树, { containerId: "snippet-tag-tree", 选中的标签ID: 片段编辑标签ID, onToggle: () => 渲染片段对话框标签() });
    } catch (err) {
      添加消息("创建标签失败：" + String(err), "error");
    }
  }

  // ===== 点子视图 =====
  function 格式化笔记时间(秒: number): string {
    if (!秒) return "-";
    const d = new Date(秒 * 1000);
    return d.getFullYear() + "/" + String(d.getMonth() + 1).padStart(2, "0") + "/" + String(d.getDate()).padStart(2, "0") + " " + String(d.getHours()).padStart(2, "0") + ":" + String(d.getMinutes()).padStart(2, "0");
  }

  function 标签ID转名称(id: number): string {
    let name = "ID:" + id;
    function walk(nodes: 标签节点[], trail: string[]): void {
      for (const n of nodes) {
        if (n.id === id) { name = n.name; return; }
        if (n.children) walk(n.children, [...trail, n.name]);
      }
    }
    walk(标签树, []);
    return name;
  }

  async function 加载笔记(): Promise<void> {
    try {
      所有笔记 = (await window.kugua.request("mkg", "mkg.note.list", {})) as 笔记[];
    } catch {
      所有笔记 = [];
    }
    渲染笔记列表();
  }

  function 筛选后的笔记(): 笔记[] {
    const kw = 笔记搜索关键词.trim().toLowerCase();
    if (!kw) return 所有笔记;
    return 所有笔记.filter((n) => n.title.toLowerCase().includes(kw) || n.content.toLowerCase().includes(kw));
  }

  function 渲染笔记列表(): void {
    const list = document.getElementById("ex-note-list") as HTMLDivElement;
    if (!list) return;
    const notes = 筛选后的笔记();
    list.innerHTML = "";
    if (notes.length === 0) {
      list.innerHTML = '<div style="color:var(--text-dim);font-size:0.8rem;padding:1rem;text-align:center">还没有点子，点击右上角「新建点子」开始记录。</div>';
      return;
    }
    for (const note of notes) {
      const tile = document.createElement("div");
      tile.className = "ex-note-tile";
      if (选中笔记?.id === note.id) tile.classList.add("selected");
      const title = document.createElement("div");
      title.className = "en-title";
      title.textContent = note.title || "(无标题)";
      tile.appendChild(title);
      const preview = document.createElement("div");
      preview.className = "en-preview";
      preview.textContent = note.content || "";
      tile.appendChild(preview);
      if (note.tagIds && note.tagIds.length > 0) {
        const tagWrap = document.createElement("div");
        tagWrap.className = "en-tags";
        for (const tid of note.tagIds) {
          const chip = document.createElement("span");
          chip.className = "tag-chip";
          chip.textContent = 标签ID转名称(tid);
          tagWrap.appendChild(chip);
        }
        tile.appendChild(tagWrap);
      }
      tile.addEventListener("click", (e) => {
        e.stopPropagation();
        选中笔记 = note;
        渲染笔记列表();
        渲染笔记详情();
      });
      list.appendChild(tile);
    }
  }

  function 渲染笔记详情(): void {
    const panel = document.getElementById("ex-note-detail") as HTMLDivElement;
    if (!panel) return;
    if (!选中笔记) { panel.classList.add("hidden"); return; }
    panel.classList.remove("hidden");
    (document.getElementById("ex-note-detail-title") as HTMLDivElement).textContent = 选中笔记.title || "(无标题)";
    (document.getElementById("ex-note-detail-time") as HTMLDivElement).textContent = "创建 " + 格式化笔记时间(选中笔记.createdAt) + " · 更新 " + 格式化笔记时间(选中笔记.updatedAt);
    (document.getElementById("ex-note-detail-content") as HTMLDivElement).textContent = 选中笔记.content || "(空内容)";
    const tagsEl = document.getElementById("ex-note-detail-tags") as HTMLDivElement;
    tagsEl.innerHTML = "";
    if (选中笔记.tagIds && 选中笔记.tagIds.length > 0) {
      for (const tid of 选中笔记.tagIds) {
        const chip = document.createElement("span");
        chip.className = "tag-chip";
        chip.textContent = 标签ID转名称(tid);
        tagsEl.appendChild(chip);
      }
    } else {
      tagsEl.innerHTML = '<span style="color:var(--text-dim);font-size:0.7rem">(无标签)</span>';
    }
  }

  function 打开笔记对话框(编辑: boolean): void {
    (document.getElementById("note-dialog-title") as HTMLDivElement).textContent = 编辑 ? "编辑点子" : "新建点子";
    const titleEl = document.getElementById("note-title") as HTMLInputElement;
    const contentEl = document.getElementById("note-content") as HTMLTextAreaElement;
    if (编辑 && 选中笔记) {
      笔记编辑目标 = 选中笔记;
      titleEl.value = 选中笔记.title;
      contentEl.value = 选中笔记.content;
      笔记编辑标签ID = new Set(选中笔记.tagIds);
    } else {
      笔记编辑目标 = null;
      titleEl.value = "";
      contentEl.value = "";
      笔记编辑标签ID = new Set();
    }
    (document.getElementById("note-new-tag-path") as HTMLInputElement).value = "";
    渲染笔记对话框标签();
    渲染可勾选标签树(标签树, {
      containerId: "note-tag-tree",
      选中的标签ID: 笔记编辑标签ID,
      onToggle: () => 渲染笔记对话框标签(),
    });
    document.getElementById("note-dialog")?.classList.remove("hidden");
  }

  function 渲染笔记对话框标签(): void {
    const tagsEl = document.getElementById("note-tag-chips") as HTMLDivElement;
    if (!tagsEl) return;
    tagsEl.innerHTML = "";
    if (笔记编辑标签ID.size === 0) {
      tagsEl.innerHTML = '<span style="color:var(--text-dim);font-size:0.7rem">(未选择标签，从下方标签树勾选)</span>';
      return;
    }
    笔记编辑标签ID.forEach((id) => {
      const chip = document.createElement("span");
      chip.className = "tag-chip";
      chip.textContent = 标签ID转名称(id);
      const x = document.createElement("span");
      x.className = "tc-remove";
      x.textContent = "×";
      x.title = "移除";
      x.addEventListener("click", () => {
        笔记编辑标签ID.delete(id);
        渲染笔记对话框标签();
        渲染可勾选标签树(标签树, { containerId: "note-tag-tree", 选中的标签ID: 笔记编辑标签ID, onToggle: () => 渲染笔记对话框标签() });
      });
      chip.appendChild(x);
      tagsEl.appendChild(chip);
    });
  }

  async function 保存笔记(): Promise<void> {
    const title = (document.getElementById("note-title") as HTMLInputElement).value.trim();
    const content = (document.getElementById("note-content") as HTMLTextAreaElement).value;
    const tagIds = Array.from(笔记编辑标签ID);
    try {
      if (笔记编辑目标) {
        await window.kugua.request("mkg", "mkg.note.update", { id: 笔记编辑目标.id, patch: { title: title || "未命名", content, tagIds } });
        添加消息("已更新点子", "system");
      } else {
        await window.kugua.request("mkg", "mkg.note.create", { title: title || "未命名", content, tagIds });
        添加消息("已新建点子", "system");
      }
      document.getElementById("note-dialog")?.classList.add("hidden");
      await 加载笔记();
    } catch (err) {
      添加消息("保存点子失败：" + String(err), "error");
    }
  }

  async function 删除笔记(): Promise<void> {
    if (!选中笔记) return;
    if (!window.confirm("确定删除这个点子吗？")) return;
    try {
      await window.kugua.request("mkg", "mkg.note.delete", { id: 选中笔记.id });
      选中笔记 = null;
      添加消息("已删除点子", "system");
      await 加载笔记();
      (document.getElementById("ex-note-detail") as HTMLDivElement)?.classList.add("hidden");
    } catch (err) {
      添加消息("删除点子失败：" + String(err), "error");
    }
  }

  async function 新建笔记标签(): Promise<void> {
    const input = document.getElementById("note-new-tag-path") as HTMLInputElement;
    const p = input.value.trim();
    if (!p) { 添加消息("请输入标签路径", "error"); return; }
    try {
      await window.kugua.request("mkg", "mkg.tag.createTree", { path: p });
      添加消息("已创建标签：" + p, "system");
      input.value = "";
      await 加载标签树();
      渲染可勾选标签树(标签树, { containerId: "note-tag-tree", 选中的标签ID: 笔记编辑标签ID, onToggle: () => 渲染笔记对话框标签() });
    } catch (err) {
      添加消息("创建标签失败：" + String(err), "error");
    }
  }

  // ===== 素材视图 =====
  async function 加载素材(): Promise<void> {
    try {
      所有素材 = (await window.kugua.request("mkg", "mkg.material.list", {})) as 素材[];
    } catch {
      所有素材 = [];
    }
    渲染素材列表();
  }

  function 筛选后的素材(): 素材[] {
    const kw = 素材搜索关键词.trim().toLowerCase();
    if (!kw) return 所有素材;
    return 所有素材.filter((m) => m.title.toLowerCase().includes(kw) || m.content.toLowerCase().includes(kw) || m.kind.toLowerCase().includes(kw));
  }

  function 渲染素材列表(): void {
    const list = document.getElementById("ex-mat-list") as HTMLDivElement;
    if (!list) return;
    const mats = 筛选后的素材();
    list.innerHTML = "";
    if (mats.length === 0) {
      list.innerHTML = '<div style="color:var(--text-dim);font-size:0.8rem;padding:1rem;text-align:center">还没有素材，点击右上角「新建素材」开始收集。</div>';
      return;
    }
    for (const mat of mats) {
      const tile = document.createElement("div");
      tile.className = "ex-mat-tile";
      if (选中素材?.id === mat.id) tile.classList.add("selected");
      const title = document.createElement("div");
      title.className = "em-title";
      title.textContent = mat.title || "(无标题)";
      tile.appendChild(title);
      if (mat.kind) {
        const kind = document.createElement("div");
        kind.className = "em-kind";
        kind.textContent = mat.kind;
        tile.appendChild(kind);
      }
      const preview = document.createElement("div");
      preview.className = "em-preview";
      preview.textContent = mat.content || mat.sourceUrl || "";
      tile.appendChild(preview);
      if (mat.tagIds && mat.tagIds.length > 0) {
        const tagWrap = document.createElement("div");
        tagWrap.className = "em-tags";
        for (const tid of mat.tagIds) {
          const chip = document.createElement("span");
          chip.className = "tag-chip";
          chip.textContent = 标签ID转名称(tid);
          tagWrap.appendChild(chip);
        }
        tile.appendChild(tagWrap);
      }
      tile.addEventListener("click", (e) => {
        e.stopPropagation();
        选中素材 = mat;
        渲染素材列表();
        渲染素材详情();
      });
      list.appendChild(tile);
    }
  }

  function 渲染素材详情(): void {
    const panel = document.getElementById("ex-mat-detail") as HTMLDivElement;
    if (!panel) return;
    if (!选中素材) { panel.classList.add("hidden"); return; }
    panel.classList.remove("hidden");
    (document.getElementById("ex-mat-detail-title") as HTMLDivElement).textContent = 选中素材.title || "(无标题)";
    (document.getElementById("ex-mat-detail-time") as HTMLDivElement).textContent = "创建 " + 格式化笔记时间(选中素材.createdAt) + " · 更新 " + 格式化笔记时间(选中素材.updatedAt);
    (document.getElementById("ex-mat-detail-content") as HTMLDivElement).textContent = 选中素材.content || "(空内容)";
    const metaEl = document.getElementById("ex-mat-detail-meta") as HTMLDivElement;
    metaEl.innerHTML = "";
    if (选中素材.kind) {
      const k = document.createElement("div");
      k.textContent = "类型：" + 选中素材.kind;
      metaEl.appendChild(k);
    }
    if (选中素材.sourceUrl) {
      const s = document.createElement("div");
      s.innerHTML = "来源：<a href=\"" + 选中素材.sourceUrl + "\" target=\"_blank\">" + 选中素材.sourceUrl + "</a>";
      metaEl.appendChild(s);
    }
    if (选中素材.imageUrl) {
      const img = document.createElement("img");
      img.src = 选中素材.imageUrl;
      img.alt = "素材预览";
      img.onerror = () => { img.style.display = "none"; };
      metaEl.appendChild(img);
    }
    const tagsEl = document.getElementById("ex-mat-detail-tags") as HTMLDivElement;
    tagsEl.innerHTML = "";
    if (选中素材.tagIds && 选中素材.tagIds.length > 0) {
      for (const tid of 选中素材.tagIds) {
        const chip = document.createElement("span");
        chip.className = "tag-chip";
        chip.textContent = 标签ID转名称(tid);
        tagsEl.appendChild(chip);
      }
    } else {
      tagsEl.innerHTML = '<span style="color:var(--text-dim);font-size:0.7rem">(无标签)</span>';
    }
  }

  function 打开素材对话框(编辑: boolean): void {
    (document.getElementById("material-dialog-title") as HTMLDivElement).textContent = 编辑 ? "编辑素材" : "新建素材";
    const titleEl = document.getElementById("material-title") as HTMLInputElement;
    const contentEl = document.getElementById("material-content") as HTMLTextAreaElement;
    const kindEl = document.getElementById("material-kind") as HTMLInputElement;
    const sourceEl = document.getElementById("material-source") as HTMLInputElement;
    const imageEl = document.getElementById("material-image") as HTMLInputElement;
    if (编辑 && 选中素材) {
      素材编辑目标 = 选中素材;
      titleEl.value = 选中素材.title;
      contentEl.value = 选中素材.content;
      kindEl.value = 选中素材.kind;
      sourceEl.value = 选中素材.sourceUrl;
      imageEl.value = 选中素材.imageUrl;
      素材编辑标签ID = new Set(选中素材.tagIds);
    } else {
      素材编辑目标 = null;
      titleEl.value = "";
      contentEl.value = "";
      kindEl.value = "";
      sourceEl.value = "";
      imageEl.value = "";
      素材编辑标签ID = new Set();
    }
    (document.getElementById("material-new-tag-path") as HTMLInputElement).value = "";
    渲染素材对话框标签();
    渲染可勾选标签树(标签树, {
      containerId: "material-tag-tree",
      选中的标签ID: 素材编辑标签ID,
      onToggle: () => 渲染素材对话框标签(),
    });
    document.getElementById("material-dialog")?.classList.remove("hidden");
  }

  function 渲染素材对话框标签(): void {
    const tagsEl = document.getElementById("material-tag-chips") as HTMLDivElement;
    if (!tagsEl) return;
    tagsEl.innerHTML = "";
    if (素材编辑标签ID.size === 0) {
      tagsEl.innerHTML = '<span style="color:var(--text-dim);font-size:0.7rem">(未选择标签，从下方标签树勾选)</span>';
      return;
    }
    素材编辑标签ID.forEach((id) => {
      const chip = document.createElement("span");
      chip.className = "tag-chip";
      chip.textContent = 标签ID转名称(id);
      const x = document.createElement("span");
      x.className = "tc-remove";
      x.textContent = "×";
      x.title = "移除";
      x.addEventListener("click", () => {
        素材编辑标签ID.delete(id);
        渲染素材对话框标签();
        渲染可勾选标签树(标签树, { containerId: "material-tag-tree", 选中的标签ID: 素材编辑标签ID, onToggle: () => 渲染素材对话框标签() });
      });
      chip.appendChild(x);
      tagsEl.appendChild(chip);
    });
  }

  async function 保存素材(): Promise<void> {
    const title = (document.getElementById("material-title") as HTMLInputElement).value.trim();
    const content = (document.getElementById("material-content") as HTMLTextAreaElement).value;
    const kind = (document.getElementById("material-kind") as HTMLInputElement).value.trim();
    const sourceUrl = (document.getElementById("material-source") as HTMLInputElement).value.trim();
    const imageUrl = (document.getElementById("material-image") as HTMLInputElement).value.trim();
    const tagIds = Array.from(素材编辑标签ID);
    try {
      if (素材编辑目标) {
        await window.kugua.request("mkg", "mkg.material.update", { id: 素材编辑目标.id, patch: { title: title || "未命名", content, kind, sourceUrl, imageUrl, tagIds } });
        添加消息("已更新素材", "system");
      } else {
        await window.kugua.request("mkg", "mkg.material.create", { title: title || "未命名", content, kind, sourceUrl, imageUrl, tagIds });
        添加消息("已新建素材", "system");
      }
      document.getElementById("material-dialog")?.classList.add("hidden");
      await 加载素材();
    } catch (err) {
      添加消息("保存素材失败：" + String(err), "error");
    }
  }

  async function 删除素材(): Promise<void> {
    if (!选中素材) return;
    if (!window.confirm("确定删除这个素材吗？")) return;
    try {
      await window.kugua.request("mkg", "mkg.material.delete", { id: 选中素材.id });
      选中素材 = null;
      添加消息("已删除素材", "system");
      await 加载素材();
      (document.getElementById("ex-mat-detail") as HTMLDivElement)?.classList.add("hidden");
    } catch (err) {
      添加消息("删除素材失败：" + String(err), "error");
    }
  }

  async function 新建素材标签(): Promise<void> {
    const input = document.getElementById("material-new-tag-path") as HTMLInputElement;
    const p = input.value.trim();
    if (!p) { 添加消息("请输入标签路径", "error"); return; }
    try {
      await window.kugua.request("mkg", "mkg.tag.createTree", { path: p });
      添加消息("已创建标签：" + p, "system");
      input.value = "";
      await 加载标签树();
      渲染可勾选标签树(标签树, { containerId: "material-tag-tree", 选中的标签ID: 素材编辑标签ID, onToggle: () => 渲染素材对话框标签() });
    } catch (err) {
      添加消息("创建标签失败：" + String(err), "error");
    }
  }

  // ===== 看板视图 =====
  async function 加载看板(): Promise<void> {
    await Promise.all([加载列(), 加载卡片()]);
    渲染看板();
  }

  async function 加载列(): Promise<void> {
    try {
      所有列 = (await window.kugua.request("mkg", "mkg.card.columnList", {})) as 看板列[];
    } catch {
      所有列 = [];
    }
  }

  async function 加载卡片(): Promise<void> {
    try {
      所有卡片 = (await window.kugua.request("mkg", "mkg.card.list", {})) as 卡片[];
    } catch {
      所有卡片 = [];
    }
  }

  function 渲染看板(): void {
    const board = document.getElementById("ex-board") as HTMLDivElement;
    if (!board) return;
    board.innerHTML = "";
    if (所有列.length === 0) {
      board.innerHTML = '<div class="ex-board-empty">还没有列，点击「新建列」创建看板。</div>';
      return;
    }
    for (const col of 所有列) {
      渲染列(board, col, 所有卡片.filter((c) => c.columnId === col.id));
    }
    const 未分列 = 所有卡片.filter((c) => c.columnId === null);
    if (未分列.length > 0) {
      渲染列(board, { id: -1, name: "未分列", sort: Number.MAX_SAFE_INTEGER, createdAt: 0 }, 未分列);
    }
  }

  function 渲染列(board: HTMLDivElement, col: 看板列, cards: 卡片[]): void {
    const colDiv = document.createElement("div");
    colDiv.className = "ex-board-col";
    colDiv.dataset.colId = String(col.id);

    const head = document.createElement("div");
    head.className = "ex-board-col-head";
    const name = document.createElement("span");
    name.className = "ex-board-col-name";
    name.textContent = col.name;
    const count = document.createElement("span");
    count.className = "ex-board-col-count";
    count.textContent = String(cards.length);
    head.appendChild(name);
    head.appendChild(count);
    if (col.id >= 0) {
      const del = document.createElement("button");
      del.className = "ex-board-col-del";
      del.textContent = "×";
      del.title = "删除列";
      del.addEventListener("click", (e) => {
        e.stopPropagation();
        void 删除列(col);
      });
      head.appendChild(del);
    }
    colDiv.appendChild(head);

    const cardsDiv = document.createElement("div");
    cardsDiv.className = "ex-board-col-cards";
    for (const card of cards) {
      const cardEl = document.createElement("div");
      cardEl.className = "ex-board-card";
      cardEl.draggable = true;
      cardEl.dataset.cardId = String(card.id);
      const t = document.createElement("div");
      t.className = "ebc-title";
      t.textContent = card.title || "(无标题)";
      cardEl.appendChild(t);
      if (card.content) {
        const p = document.createElement("div");
        p.className = "ebc-preview";
        p.textContent = card.content;
        cardEl.appendChild(p);
      }
      if (card.tagIds && card.tagIds.length > 0) {
        const tw = document.createElement("div");
        tw.className = "ebc-tags";
        for (const tid of card.tagIds) {
          const chip = document.createElement("span");
          chip.className = "tag-chip";
          chip.textContent = 标签ID转名称(tid);
          tw.appendChild(chip);
        }
        cardEl.appendChild(tw);
      }
      cardEl.addEventListener("click", (e) => {
        e.stopPropagation();
        编辑中的卡片 = card;
        打开卡片对话框(true);
      });
      cardEl.addEventListener("dragstart", (e) => {
        e.dataTransfer?.setData("text/plain", String(card.id));
      });
      cardsDiv.appendChild(cardEl);
    }
    const addBtn = document.createElement("button");
    addBtn.className = "ex-board-add-card";
    addBtn.textContent = "+ 添加卡片";
    addBtn.addEventListener("click", (e) => {
      e.stopPropagation();
      打开卡片对话框(false, col.id >= 0 ? col.id : null);
    });
    cardsDiv.appendChild(addBtn);

    cardsDiv.addEventListener("dragover", (e) => e.preventDefault());
    cardsDiv.addEventListener("drop", (e) => {
      e.preventDefault();
      const data = e.dataTransfer?.getData("text/plain");
      if (!data) return;
      const cardId = Number(data);
      const card = 所有卡片.find((c) => c.id === cardId);
      if (!card) return;
      const targetColumnId = col.id >= 0 ? col.id : null;
      if (card.columnId === targetColumnId) return;
      void (async () => {
        try {
          await window.kugua.request("mkg", "mkg.card.update", { id: card.id, patch: { columnId: targetColumnId } });
          await 加载看板();
        } catch (err) {
          添加消息("移动卡片失败：" + String(err), "error");
        }
      })();
    });

    colDiv.appendChild(cardsDiv);
    board.appendChild(colDiv);
  }

  function 打开列对话框(编辑: boolean): void {
    (document.getElementById("column-dialog-title") as HTMLDivElement).textContent = 编辑 ? "重命名列" : "新建列";
    const nameEl = document.getElementById("column-name") as HTMLInputElement;
    if (编辑 && 编辑中的列) {
      nameEl.value = 编辑中的列.name;
    } else {
      编辑中的列 = null;
      nameEl.value = "";
    }
    document.getElementById("column-dialog")?.classList.remove("hidden");
    nameEl.focus();
  }

  async function 保存列(): Promise<void> {
    const name = (document.getElementById("column-name") as HTMLInputElement).value.trim();
    if (!name) { 添加消息("请输入列名", "error"); return; }
    try {
      if (编辑中的列) {
        await window.kugua.request("mkg", "mkg.card.columnUpdate", { id: 编辑中的列.id, patch: { name } });
        添加消息("已更新列", "system");
      } else {
        await window.kugua.request("mkg", "mkg.card.columnCreate", { name });
        添加消息("已新建列", "system");
      }
      document.getElementById("column-dialog")?.classList.add("hidden");
      await 加载看板();
    } catch (err) {
      添加消息("保存列失败：" + String(err), "error");
    }
  }

  async function 删除列(col: 看板列): Promise<void> {
    if (!window.confirm("确定删除列「" + col.name + "」吗？列中的卡片会移到其他列。")) return;
    try {
      await window.kugua.request("mkg", "mkg.card.columnDelete", { id: col.id });
      添加消息("已删除列", "system");
      await 加载看板();
    } catch (err) {
      添加消息("删除列失败：" + String(err), "error");
    }
  }

  function 打开卡片对话框(编辑: boolean, 默认列ID?: number | null): void {
    (document.getElementById("card-dialog-title") as HTMLDivElement).textContent = 编辑 ? "编辑卡片" : "新建卡片";
    const titleEl = document.getElementById("card-title") as HTMLInputElement;
    const contentEl = document.getElementById("card-content") as HTMLTextAreaElement;
    const columnEl = document.getElementById("card-column") as HTMLSelectElement;
    columnEl.innerHTML = "";
    const 空选项 = document.createElement("option");
    空选项.value = "";
    空选项.textContent = "（未分列）";
    columnEl.appendChild(空选项);
    for (const col of 所有列) {
      const opt = document.createElement("option");
      opt.value = String(col.id);
      opt.textContent = col.name;
      columnEl.appendChild(opt);
    }
    if (编辑 && 编辑中的卡片) {
      titleEl.value = 编辑中的卡片.title;
      contentEl.value = 编辑中的卡片.content;
      columnEl.value = 编辑中的卡片.columnId != null ? String(编辑中的卡片.columnId) : "";
      卡片编辑标签ID = new Set(编辑中的卡片.tagIds);
    } else {
      编辑中的卡片 = null;
      titleEl.value = "";
      contentEl.value = "";
      columnEl.value = 默认列ID != null ? String(默认列ID) : "";
      卡片编辑标签ID = new Set();
    }
    (document.getElementById("card-new-tag-path") as HTMLInputElement).value = "";
    渲染卡片对话框标签();
    渲染可勾选标签树(标签树, {
      containerId: "card-tag-tree",
      选中的标签ID: 卡片编辑标签ID,
      onToggle: () => 渲染卡片对话框标签(),
    });
    document.getElementById("card-dialog")?.classList.remove("hidden");
  }

  function 渲染卡片对话框标签(): void {
    const tagsEl = document.getElementById("card-tag-chips") as HTMLDivElement;
    if (!tagsEl) return;
    tagsEl.innerHTML = "";
    if (卡片编辑标签ID.size === 0) {
      tagsEl.innerHTML = '<span style="color:var(--text-dim);font-size:0.7rem">(未选择标签，从下方标签树勾选)</span>';
      return;
    }
    卡片编辑标签ID.forEach((id) => {
      const chip = document.createElement("span");
      chip.className = "tag-chip";
      chip.textContent = 标签ID转名称(id);
      const x = document.createElement("span");
      x.className = "tc-remove";
      x.textContent = "×";
      x.title = "移除";
      x.addEventListener("click", () => {
        卡片编辑标签ID.delete(id);
        渲染卡片对话框标签();
        渲染可勾选标签树(标签树, { containerId: "card-tag-tree", 选中的标签ID: 卡片编辑标签ID, onToggle: () => 渲染卡片对话框标签() });
      });
      chip.appendChild(x);
      tagsEl.appendChild(chip);
    });
  }

  async function 保存卡片(): Promise<void> {
    const title = (document.getElementById("card-title") as HTMLInputElement).value.trim();
    const content = (document.getElementById("card-content") as HTMLTextAreaElement).value;
    const columnVal = (document.getElementById("card-column") as HTMLSelectElement).value;
    const columnId = columnVal === "" ? null : Number(columnVal);
    const tagIds = Array.from(卡片编辑标签ID);
    try {
      if (编辑中的卡片) {
        await window.kugua.request("mkg", "mkg.card.update", { id: 编辑中的卡片.id, patch: { title: title || "未命名", content, columnId, tagIds } });
        添加消息("已更新卡片", "system");
      } else {
        await window.kugua.request("mkg", "mkg.card.create", { title: title || "未命名", content, columnId, tagIds });
        添加消息("已新建卡片", "system");
      }
      document.getElementById("card-dialog")?.classList.add("hidden");
      await 加载看板();
    } catch (err) {
      添加消息("保存卡片失败：" + String(err), "error");
    }
  }

  async function 删除卡片(): Promise<void> {
    if (!编辑中的卡片) return;
    if (!window.confirm("确定删除这张卡片吗？")) return;
    try {
      await window.kugua.request("mkg", "mkg.card.delete", { id: 编辑中的卡片.id });
      编辑中的卡片 = null;
      添加消息("已删除卡片", "system");
      document.getElementById("card-dialog")?.classList.add("hidden");
      await 加载看板();
    } catch (err) {
      添加消息("删除卡片失败：" + String(err), "error");
    }
  }

  async function 新建卡片标签(): Promise<void> {
    const input = document.getElementById("card-new-tag-path") as HTMLInputElement;
    const p = input.value.trim();
    if (!p) { 添加消息("请输入标签路径", "error"); return; }
    try {
      await window.kugua.request("mkg", "mkg.tag.createTree", { path: p });
      添加消息("已创建标签：" + p, "system");
      input.value = "";
      await 加载标签树();
      渲染可勾选标签树(标签树, { containerId: "card-tag-tree", 选中的标签ID: 卡片编辑标签ID, onToggle: () => 渲染卡片对话框标签() });
    } catch (err) {
      添加消息("创建标签失败：" + String(err), "error");
    }
  }

  export async function 刷新(): Promise<void> {
    await 加载标签树();
    await 加载所有内容();
  }

  export async function init(): Promise<void> {
    搜索框.addEventListener("input", () => {
      搜索关键词 = 搜索框.value;
      if (搜索防抖) clearTimeout(搜索防抖);
      搜索防抖 = window.setTimeout(() => {
        渲染内容列表();
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
      选中内容 = null;
      更新面包屑([{ name: "所有内容", id: "all" }]);
      文件信息面板.classList.add("hidden");
      await 加载所有内容();
      渲染标签树();
    });

    document.getElementById("ex-nav-refresh")?.addEventListener("click", async () => {
      await 加载标签树();
      await 加载所有内容();
    });

    document.addEventListener("click", () => 隐藏右键菜单());
    右键菜单.addEventListener("click", async (e) => {
      const action = (e.target as HTMLElement).dataset.action;
      if (!action || !选中内容) return;
      switch (action) {
        case "open":
          await 打开内容(选中内容);
          break;
        case "explorer":
          await 在资源管理器中显示(选中内容);
          break;
        case "copyPath":
          await 复制物理路径(选中内容);
          break;
        case "rename":
          显示重命名对话框(选中内容);
          break;
        case "openWith":
          await 加载打开方式列表(选中内容.extension);
          显示打开方式对话框(选中内容);
          break;
      }
      隐藏右键菜单();
    });

    document.getElementById("ex-btn-open")?.addEventListener("click", () => {
      if (选中内容) void 打开内容(选中内容);
    });
    document.getElementById("ex-btn-explorer")?.addEventListener("click", () => {
      if (选中内容) void 在资源管理器中显示(选中内容);
    });
    document.getElementById("ex-info-path")?.addEventListener("click", () => {
      if (选中内容) void 复制物理路径(选中内容);
    });

    // ========== 统一导入 + 新建片段 ==========
    document.getElementById("ex-btn-import")?.addEventListener("click", () => void 直接导入());
    document.getElementById("ex-btn-new-snippet")?.addEventListener("click", () => 打开新建片段对话框());

    // 类型筛选 / 排序 / 无分类
    const 类型筛选框 = document.getElementById("ex-type-filter") as HTMLSelectElement;
    类型筛选框?.addEventListener("change", () => {
      类型筛选 = 类型筛选框.value;
      void 加载所有内容();
    });
    const 排序框 = document.getElementById("ex-sort") as HTMLSelectElement;
    排序框?.addEventListener("change", () => {
      排序方式 = 排序框.value as "import" | "name" | "updated";
      void 加载所有内容();
    });
    const 无分类框 = document.getElementById("ex-notag") as HTMLInputElement;
    无分类框?.addEventListener("change", () => {
      无分类筛选 = 无分类框.checked;
      void 加载所有内容();
    });

    // 详情栏内联标签：添加 + 移除
    document.getElementById("ex-info-tag-add-btn")?.addEventListener("click", () => void 内联新建标签());
    document.getElementById("ex-info-tag-input")?.addEventListener("keydown", (e) => {
      if (e.key === "Enter") { e.preventDefault(); void 内联新建标签(); }
    });

    // 新建片段对话框
    document.getElementById("snippet-cancel")?.addEventListener("click", () => document.getElementById("snippet-dialog")?.classList.add("hidden"));
    document.getElementById("snippet-dialog")?.querySelector(".modal-backdrop")?.addEventListener("click", () => document.getElementById("snippet-dialog")?.classList.add("hidden"));
    document.getElementById("snippet-save")?.addEventListener("click", () => void 保存片段());
    document.getElementById("snippet-btn-create-tag")?.addEventListener("click", () => void 新建片段标签());

    // 全局 ESC 关闭所有浮动层
    document.addEventListener("keydown", (e) => {
      if (e.key !== "Escape") return;
      隐藏右键菜单();
      document.getElementById("openwith-dialog")?.classList.add("hidden");
      document.getElementById("rename-dialog")?.classList.add("hidden");
      document.getElementById("snippet-dialog")?.classList.add("hidden");
      document.getElementById("note-dialog")?.classList.add("hidden");
      document.getElementById("material-dialog")?.classList.add("hidden");
    });

    const owDialog = document.getElementById("openwith-dialog") as HTMLDivElement;
    const owList = document.getElementById("ow-list") as HTMLDivElement;
    const owProgram = document.getElementById("ow-program") as HTMLInputElement;
    const owArgs = document.getElementById("ow-args") as HTMLInputElement;
    const owLabel = document.getElementById("ow-label") as HTMLInputElement;
    const owSetDefault = document.getElementById("ow-set-default") as HTMLInputElement;

    function 显示打开方式对话框(file: 内容条目): void {
      owList.innerHTML = "";
      for (const ow of 打开方式列表) {
        const item = document.createElement("div");
        item.className = "ow-item";
        item.innerHTML = "<strong>" + (ow.label || ow.programPath) + "</strong><br><span style=\"color:var(--text-dim);font-size:0.8rem\">" + ow.programPath + "</span>";
        item.addEventListener("click", async () => {
          await 打开内容(file, ow.programPath);
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
      if (!选中内容) return;
      const programPath = owProgram.value.trim();
      if (!programPath) {
        添加消息("请指定程序路径", "error");
        return;
      }
      await 打开内容(选中内容, programPath);
      if (owSetDefault.checked) {
        try {
          await window.kugua.request("mkg", "mkg.openwith.add", {
            extension: 选中内容.extension,
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
    let 重命名目标: 内容条目 | null = null;

    function 显示重命名对话框(file: 内容条目): void {
      重命名目标 = file;
      renameHint.textContent = "原名称：" + 显示名(file) + "（" + file.name + "）";
      renameInput.value = file.name;
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

    // ===== 点子视图（次级切换 + 操作）=====
    document.querySelectorAll<HTMLButtonElement>(".ex-sub-tab").forEach((btn) => {
      btn.addEventListener("click", () => {
        const mode = btn.dataset.mode;
        if (!mode) return;
        document.querySelectorAll(".ex-sub-tab").forEach((b) => b.classList.remove("active"));
        btn.classList.add("active");
        (document.querySelector(".ex-pane-files") as HTMLDivElement)?.classList.toggle("hidden", mode !== "files");
        (document.querySelector(".ex-pane-notes") as HTMLDivElement)?.classList.toggle("hidden", mode !== "notes");
        (document.querySelector(".ex-pane-materials") as HTMLDivElement)?.classList.toggle("hidden", mode !== "materials");
        (document.querySelector(".ex-pane-boards") as HTMLDivElement)?.classList.toggle("hidden", mode !== "board");
        if (mode === "notes") void 加载笔记();
        if (mode === "materials") void 加载素材();
        if (mode === "board") void 加载看板();
      });
    });

    document.getElementById("ex-note-add")?.addEventListener("click", () => 打开笔记对话框(false));
    document.getElementById("ex-note-refresh")?.addEventListener("click", () => void 加载笔记());
    document.getElementById("ex-note-edit")?.addEventListener("click", () => 打开笔记对话框(true));
    document.getElementById("ex-note-delete")?.addEventListener("click", () => void 删除笔记());
    const noteSearch = document.getElementById("ex-note-search") as HTMLInputElement;
    noteSearch?.addEventListener("input", () => {
      笔记搜索关键词 = noteSearch.value;
      渲染笔记列表();
    });

    document.getElementById("note-cancel")?.addEventListener("click", () => document.getElementById("note-dialog")?.classList.add("hidden"));
    document.getElementById("note-dialog")?.querySelector(".modal-backdrop")?.addEventListener("click", () => document.getElementById("note-dialog")?.classList.add("hidden"));
    document.getElementById("note-save")?.addEventListener("click", () => void 保存笔记());
    document.getElementById("note-btn-create-tag")?.addEventListener("click", () => void 新建笔记标签());

    // ===== 素材视图操作 =====
    document.getElementById("ex-mat-add")?.addEventListener("click", () => 打开素材对话框(false));
    document.getElementById("ex-mat-refresh")?.addEventListener("click", () => void 加载素材());
    document.getElementById("ex-mat-edit")?.addEventListener("click", () => 打开素材对话框(true));
    document.getElementById("ex-mat-delete")?.addEventListener("click", () => void 删除素材());
    const matSearch = document.getElementById("ex-mat-search") as HTMLInputElement;
    matSearch?.addEventListener("input", () => {
      素材搜索关键词 = matSearch.value;
      渲染素材列表();
    });

    document.getElementById("material-cancel")?.addEventListener("click", () => document.getElementById("material-dialog")?.classList.add("hidden"));
    document.getElementById("material-dialog")?.querySelector(".modal-backdrop")?.addEventListener("click", () => document.getElementById("material-dialog")?.classList.add("hidden"));
    document.getElementById("material-save")?.addEventListener("click", () => void 保存素材());
    document.getElementById("material-btn-create-tag")?.addEventListener("click", () => void 新建素材标签());

    // ===== 看板视图操作 =====
    document.getElementById("ex-board-add-col")?.addEventListener("click", () => 打开列对话框(false));
    document.getElementById("ex-board-add-card")?.addEventListener("click", () => 打开卡片对话框(false));
    document.getElementById("ex-board-refresh")?.addEventListener("click", () => void 加载看板());

    document.getElementById("column-cancel")?.addEventListener("click", () => document.getElementById("column-dialog")?.classList.add("hidden"));
    document.getElementById("column-dialog")?.querySelector(".modal-backdrop")?.addEventListener("click", () => document.getElementById("column-dialog")?.classList.add("hidden"));
    document.getElementById("column-save")?.addEventListener("click", () => void 保存列());

    document.getElementById("card-cancel")?.addEventListener("click", () => document.getElementById("card-dialog")?.classList.add("hidden"));
    document.getElementById("card-dialog")?.querySelector(".modal-backdrop")?.addEventListener("click", () => document.getElementById("card-dialog")?.classList.add("hidden"));
    document.getElementById("card-save")?.addEventListener("click", () => void 保存卡片());
    document.getElementById("card-btn-create-tag")?.addEventListener("click", () => void 新建卡片标签());
    // 卡片编辑对话框中的删除按钮（动态注入）
    const cardDialogActions = document.querySelector("#card-dialog .modal-actions") as HTMLDivElement | null;
    if (cardDialogActions && !cardDialogActions.querySelector("#card-delete")) {
      const delBtn = document.createElement("button");
      delBtn.className = "modal-btn danger";
      delBtn.id = "card-delete";
      delBtn.textContent = "删除";
      delBtn.addEventListener("click", () => void 删除卡片());
      cardDialogActions.insertBefore(delBtn, cardDialogActions.firstChild);
    }

    大图标容器.addEventListener("click", () => {
      选中内容 = null;
      文件信息面板.classList.add("hidden");
      渲染内容列表();
    });
    列表容器.addEventListener("click", () => {
      选中内容 = null;
      文件信息面板.classList.add("hidden");
      渲染内容列表();
    });
    详情容器.addEventListener("click", () => {
      选中内容 = null;
      文件信息面板.classList.add("hidden");
      渲染内容列表();
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

    更新面包屑([{ name: "所有内容", id: "all" }]);
    await 加载标签树();
    await 加载所有内容();
    切换视图("large");

    // 大图标视图滚轮缩放（1~10 列）
    大图标容器.addEventListener("wheel", (e) => {
      if (当前视图模式 !== "large") return;
      // 仅 Ctrl+滚轮缩放网格列数；普通滚轮交给列表自然滚动
      if (!e.ctrlKey) return;
      e.preventDefault();
      e.stopPropagation();
      大图标列数 = Math.max(1, Math.min(10, 大图标列数 + (e.deltaY > 0 ? 1 : -1)));
      大图标容器.style.setProperty("--ex-cols", String(大图标列数));
    }, { passive: false });
  }
}

// ===== 事件绑定 =====

function 发送当前输入(): void {
  const 附件批次 = 当前附件.slice();
  当前附件.length = 0;
  刷新附件区();
  void 处理输入(输入框.value, 附件批次);
  输入框.value = "";
}

document.getElementById("chat-send")?.addEventListener("click", 发送当前输入);

输入框.addEventListener("keydown", (e) => {
  if (e.key === "Enter") {
    发送当前输入();
  }
});

// ===== 聊天搜索与清除 =====
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

document.getElementById("refresh-modules")?.addEventListener("click", () => void 刷新模块列表());
document.getElementById("refresh-stats")?.addEventListener("click", () => void 刷新统计());

// ===== Debug 面板 =====

interface 日志条目 {
  时间: number;
  方向: "发送" | "接收" | "超时";
  类型: string;
  from: string;
  to?: string;
  action?: string;
  id: string;
  echo?: string;
  code?: number;
  message?: string;
}

const debug面板 = document.getElementById("debug-panel") as HTMLDivElement;
const debug日志 = document.getElementById("debug-log") as HTMLDivElement;
const debug按钮 = document.getElementById("debug-toggle") as HTMLButtonElement;
const 日志缓存: 日志条目[] = [];
const 最大缓存 = 500;

function 格式化时间(时间戳: number): string {
  const d = new Date(时间戳);
  return `${String(d.getHours()).padStart(2, "0")}:${String(d.getMinutes()).padStart(2, "0")}:${String(d.getSeconds()).padStart(2, "0")}.${String(d.getMilliseconds()).padStart(3, "0")}`;
}

function 添加日志(条目: 日志条目): void {
  日志缓存.push(条目);
  if (日志缓存.length > 最大缓存) 日志缓存.shift();

  // 检查过滤器
  const 方向 = 条目.方向;
  const 过滤项 = document.getElementById(`filter-${方向 === "发送" ? "send" : 方向 === "接收" ? "recv" : "timeout"}`) as HTMLInputElement;
  if (过滤项 && !过滤项.checked) return;

  const div = document.createElement("div");
  div.className = "log-entry";
  const 方向类 = 方向 === "发送" ? "send" : 方向 === "接收" ? "recv" : "timeout";
  const 路由 = 条目.from + (条目.to ? ` → ${条目.to}` : "");
  const 动作 = 条目.action ?? "";
  const 详情 = 条目.code !== undefined ? `[${条目.code}] ${条目.message ?? ""}` : (条目.echo ? `echo=${条目.echo.slice(0, 8)}` : "");
  div.innerHTML = `<span class="log-time">${格式化时间(条目.时间)}</span><span class="log-dir ${方向类}">${方向}</span><span class="log-type">${条目.类型}</span><span class="log-route">${路由}</span>${动作 ? `<span class="log-route">${动作}</span>` : ""}${详情 ? `<span class="log-detail">${详情}</span>` : ""}`;
  debug日志.appendChild(div);
  debug日志.scrollTop = debug日志.scrollHeight;

  // 限制 DOM 条目数
  while (debug日志.children.length > 最大缓存) {
    debug日志.removeChild(debug日志.firstChild!);
  }
}

function 重新渲染日志(): void {
  debug日志.innerHTML = "";
  for (const 条目 of 日志缓存) {
    const 方向 = 条目.方向;
    const 过滤项 = document.getElementById(`filter-${方向 === "发送" ? "send" : 方向 === "接收" ? "recv" : "timeout"}`) as HTMLInputElement;
    if (过滤项 && !过滤项.checked) continue;

    const div = document.createElement("div");
    div.className = "log-entry";
    const 方向类 = 方向 === "发送" ? "send" : 方向 === "接收" ? "recv" : "timeout";
    const 路由 = 条目.from + (条目.to ? ` → ${条目.to}` : "");
    const 动作 = 条目.action ?? "";
    const 详情 = 条目.code !== undefined ? `[${条目.code}] ${条目.message ?? ""}` : (条目.echo ? `echo=${条目.echo.slice(0, 8)}` : "");
    div.innerHTML = `<span class="log-time">${格式化时间(条目.时间)}</span><span class="log-dir ${方向类}">${方向}</span><span class="log-type">${条目.类型}</span><span class="log-route">${路由}</span>${动作 ? `<span class="log-route">${动作}</span>` : ""}${详情 ? `<span class="log-detail">${详情}</span>` : ""}`;
    debug日志.appendChild(div);
  }
  debug日志.scrollTop = debug日志.scrollHeight;
}

debug按钮.addEventListener("click", () => {
  debug面板.classList.toggle("hidden");
  debug按钮.classList.toggle("active");
});

document.getElementById("debug-close")?.addEventListener("click", () => {
  debug面板.classList.add("hidden");
  debug按钮.classList.remove("active");
});

document.getElementById("debug-clear")?.addEventListener("click", () => {
  日志缓存.length = 0;
  debug日志.innerHTML = "";
});

document.querySelectorAll(".debug-filter input").forEach((cb) => {
  cb.addEventListener("change", 重新渲染日志);
});

// 监听主进程转发的通信日志
window.kugua.onLog((entry: unknown) => {
  添加日志(entry as 日志条目);
});

// 客户端连接成功后刷新侧边栏数据
window.kugua.onReady(() => {
  void 刷新模块列表();
  void 刷新统计();
  void Explorer.init();
});

// ===== 初始化 =====

添加消息("苦瓜工作室已启动。输入「帮助」查看可用指令。", "system");

// 定时刷新模块列表
setInterval(() => void 刷新模块列表(), 10000);


// ===== 顶栏：窗口控制（无边框窗口） =====
function 更新最大化按钮(isMax: boolean): void {
  const btn = document.getElementById("win-max") as HTMLButtonElement;
  if (btn) btn.innerHTML = isMax ? "&#x2750;" : "&#x25A1;";
}
document.getElementById("win-min")?.addEventListener("click", () => void window.kugua.window.minimize());
document.getElementById("win-max")?.addEventListener("click", async () => {
  更新最大化按钮(await window.kugua.window.toggleMaximize());
});
document.getElementById("win-close")?.addEventListener("click", () => void window.kugua.window.close());
window.kugua.window.onMaximized(更新最大化按钮);
void window.kugua.window.isMaximized().then(更新最大化按钮);

// ===== 顶栏：知识库 / 插件 / 设置 三视图切换 =====
const 知识库视图 = document.getElementById("explorer-area") as HTMLElement;
const 插件视图El = document.getElementById("plugins-view") as HTMLElement;
const 设置视图El = document.getElementById("settings-view") as HTMLElement;
const 视图映射: Record<string, { 视图: HTMLElement; 激活时?: () => void }> = {
  "tab-kb": { 视图: 知识库视图 },
  "tab-plugins": { 视图: 插件视图El, 激活时: async () => { await 刷新模块列表(); await 刷新统计(); } },
  "tab-settings": { 视图: 设置视图El },
};
function 切换视图(tabId: string): void {
  for (const id of Object.keys(视图映射)) {
    const cfg = 视图映射[id];
    cfg.视图.classList.toggle("hidden", id !== tabId);
    const btn = document.getElementById(id) as HTMLButtonElement | null;
    if (btn) btn.classList.toggle("active", id === tabId);
  }
  const cfg = 视图映射[tabId];
  if (cfg?. 激活时) cfg.激活时();
}
document.getElementById("tab-kb")?.addEventListener("click", () => 切换视图("tab-kb"));
document.getElementById("tab-plugins")?.addEventListener("click", () => 切换视图("tab-plugins"));
document.getElementById("tab-settings")?.addEventListener("click", () => 切换视图("tab-settings"));
document.getElementById("plugins-refresh")?.addEventListener("click", () => {
  void 刷新模块列表();
  void 刷新统计();
});

// ===== 主题切换（日间/夜间） =====
function 应用主题(t: "dark" | "light"): void {
  document.documentElement.dataset.theme = t;
  localStorage.setItem("kugua-theme", t);
  const btn = document.getElementById("btn-theme") as HTMLButtonElement;
  if (btn) btn.innerHTML = t === "light" ? "&#x1F319;" : "&#x2600;&#xFE0F;";
  document.querySelectorAll<HTMLButtonElement>(".oc-theme-btn").forEach((b) => {
    b.classList.toggle("active", b.dataset.theme === t);
  });
}
(function 初始化主题(): void {
  const saved = localStorage.getItem("kugua-theme");
  应用主题(saved === "light" ? "light" : "dark");
})();
document.getElementById("btn-theme")?.addEventListener("click", () => {
  应用主题(document.documentElement.dataset.theme === "light" ? "dark" : "light");
});
document.querySelectorAll<HTMLButtonElement>(".oc-theme-btn").forEach((b) => {
  b.addEventListener("click", () => 应用主题(b.dataset.theme === "light" ? "light" : "dark"));
});

// ===== 聊天侧边栏折叠 =====
const 聊天侧边栏 = document.getElementById("chat-sidebar") as HTMLElement;
const 聊天折叠按钮 = document.getElementById("chat-toggle") as HTMLButtonElement;
function 设置聊天折叠(折叠: boolean): void {
  聊天侧边栏.classList.toggle("chat-collapsed", 折叠);
  聊天折叠按钮.innerHTML = 折叠 ? "&#x25C2;" : "&#x25B8;";
  聊天折叠按钮.title = 折叠 ? "展开聊天面板" : "收起聊天面板";
  const 手 = document.getElementById("chat-resize") as HTMLElement | null;
  if (手) 手.style.display = 折叠 ? "none" : "";
}
聊天折叠按钮.addEventListener("click", () => {
  设置聊天折叠(!聊天侧边栏.classList.contains("chat-collapsed"));
});

// ===== 聊天侧边栏宽度拖拽调整 =====
const 聊天调整手柄 = document.getElementById("chat-resize") as HTMLElement;
let 聊天拖拽中 = false;
聊天调整手柄.addEventListener("mousedown", (e) => {
  聊天拖拽中 = true;
  e.preventDefault();
});
document.addEventListener("mousemove", (e) => {
  if (!聊天拖拽中) return;
  if (聊天侧边栏.classList.contains("chat-collapsed")) return;
  const 宽 = Math.max(220, Math.min(window.innerWidth * 0.6, window.innerWidth - e.clientX - 聊天调整手柄.offsetWidth));
  聊天侧边栏.style.width = 宽 + "px";
  聊天侧边栏.style.minWidth = 宽 + "px";
  聊天侧边栏.style.maxWidth = 宽 + "px";
});
document.addEventListener("mouseup", () => { 聊天拖拽中 = false; });

// ===== 拖拽交互：知识库 <-> 聊天 =====
// 聊天侧边栏作为放置目标：接收知识库资源或外部文件，把引用放入输入框供指令使用
const 聊天面板 = document.getElementById("chat-view") as HTMLElement;
聊天侧边栏.addEventListener("dragover", (e) => {
  e.preventDefault();
  if (e.dataTransfer) e.dataTransfer.dropEffect = "copy";
  聊天侧边栏.classList.add("drop-target");
});
聊天侧边栏.addEventListener("dragleave", () => 聊天侧边栏.classList.remove("drop-target"));
聊天侧边栏.addEventListener("drop", async (e) => {
  e.preventDefault();
  聊天侧边栏.classList.remove("drop-target");
  const 资源 = e.dataTransfer?.getData("text/kugua-resource");
  if (资源) {
    let obj: { id: number; name: string; path: string | null };
    try { obj = JSON.parse(资源); } catch { return; }
    if (是图片路径(obj.path)) {
      当前附件.push({ path: obj.path ?? undefined, name: obj.name, type: "image/" });
      刷新附件区();
      添加消息("已将图片「" + obj.name + "」加入，请输入处理指令（如：灰度、旋转90度、反色）。", "system");
    } else if (obj.path) {
      输入框.value = (输入框.value ? 输入框.value + " " : "") + "[资源:" + obj.path + "]";
      添加消息("已将知识库资源「" + obj.name + "」加入，请告诉我如何操作它。", "system");
    }
    输入框.focus();
    return;
  }
  const files = e.dataTransfer?.files;
  if (files && files.length > 0) {
    const f = files[0] as File & { path?: string };
    if (是图片路径(f.path) || /^image\//.test(f.type)) {
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
});

// 知识库浏览区域作为放置目标：接收来自聊天/知识库/外部文件的路径，导入为新资源
const 知识库区域 = document.getElementById("explorer-area") as HTMLElement;
const 导入提示 = document.getElementById("explorer-drop-hint") as HTMLDivElement;
知识库区域.addEventListener("dragover", (e) => {
  e.preventDefault();
  if (e.dataTransfer) e.dataTransfer.dropEffect = "copy";
  知识库区域.classList.add("drop-target");
  导入提示.classList.remove("hidden");
});
知识库区域.addEventListener("dragleave", (e) => {
  if (!知识库区域.contains(e.relatedTarget as Node)) {
    知识库区域.classList.remove("drop-target");
    导入提示.classList.add("hidden");
  }
});
知识库区域.addEventListener("drop", async (e) => {
  e.preventDefault();
  知识库区域.classList.remove("drop-target");
  导入提示.classList.add("hidden");
  let 资源路径: string | null = null;
  const 资源 = e.dataTransfer?.getData("text/kugua-resource");
  if (资源) {
    try { 资源路径 = (JSON.parse(资源) as { path: string | null }).path; } catch { /* 忽略 */ }
  }
  const 聊天文件 = e.dataTransfer?.getData("text/kugua-file");
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
      const ext = (读.mime.split("/")[1] || "bin").replace(/\+.*$/, "").toLowerCase();
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
});

// 聊天消息中的资源链接可拖拽到知识库保存
聊天面板.addEventListener("dragstart", (e) => {
  const target = e.target as HTMLElement;
  const link = target.closest<HTMLElement>("[data-resource-path]");
  if (link) {
    e.dataTransfer?.setData("text/kugua-file", link.dataset.resourcePath || "");
    e.dataTransfer?.setData("text/plain", link.dataset.resourcePath || "");
    if (e.dataTransfer) e.dataTransfer.effectAllowed = "copy";
  }
});
