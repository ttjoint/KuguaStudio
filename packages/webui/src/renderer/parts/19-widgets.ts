/**
 * 小组件渲染（19-widgets）
 *
 * 插件向主界面注入的小展示块。插件只说「块里显示什么」和「哪个重要」，
 * 渲染形式全由这里决定（docs/小组件设计.md 第四节）。
 *
 * 三条实现约束：
 *  1. **绝不 innerHTML**：标题/副标题来自插件，一律 textContent。
 *  2. **全部挂载、不惰性订阅**：数据推送需要有人接，切页才订阅会导致
 *     切过去瞬间是空白。代价是始终在更新 DOM，10 个以内可忽略。
 *  3. **超时必须置灰**：插件崩了但界面还显示最后一帧，用户会以为是实时的。
 */
import type { 小组件声明, 显著度 } from "@kugua/nigane";

/** 服务端返回的已注册小组件（带来源与在线状态） */
interface 已注册小组件 extends 小组件声明 {
  来源: string;
  在线: boolean;
  键: string;
}

interface 布局覆盖 {
  隐藏?: boolean;
  顺序?: number;
  外形?: "大卡" | "横条" | "窄条";
  区域?: "顶部" | "侧栏" | "状态栏";
}

interface 布局方案 {
  展示?: "自动" | "紧凑" | "详细" | "仅状态栏";
  覆盖?: Record<string, 布局覆盖>;
}

interface 小组件配置节 {
  当前方案: string;
  方案: Record<string, 布局方案>;
}

interface 列表响应 {
  小组件: 已注册小组件[];
  配置: 小组件配置节;
  警告: Array<{ 来源: string; 警告: string[] }>;
}

/** 单个已挂载小组件的运行时状态 */
interface 挂载项 {
  声明: 已注册小组件;
  根: HTMLElement;
  /** 数值显示位（number / gauge 用） */
  值位?: HTMLElement;
  /** 副标题位 */
  副标题位?: HTMLElement;
  /** 火花线画布 */
  画布?: HTMLCanvasElement;
  /** 环形进度（SVG） */
  环?: SVGCircleElement;
  /** 最近若干值（sparkline 用，环形缓冲在主界面侧） */
  缓冲: number[];
  /** 最后一次收到数据的时间 */
  最后推送: number;
  /** 挂载时刻（从未收到数据时的过期起算点） */
  挂载时刻: number;
  /** 是否已标为无数据 */
  已过期: boolean;
}

/** 已挂载项，按全局键索引 */
const 挂载表 = new Map<string, 挂载项>();
/** 最近一次拉到的注册表，供设置页复用 */
let 最近列表: 列表响应 | null = null;
/** 过期检查定时器 */
let 过期定时: number | undefined;

/** 当前生效的槽位容器 */
interface 槽位 {
  顶部: HTMLElement | null;
  侧栏: HTMLElement | null;
  状态栏: HTMLElement | null;
}

let 槽位: 槽位 = { 顶部: null, 侧栏: null, 状态栏: null };

/** 取某小组件在配置里的覆盖项 */
function 取覆盖(配置: 小组件配置节 | null, 键: string): 布局覆盖 {
  if (!配置) return {};
  const 方案 = 配置.方案[配置.当前方案];
  return 方案?.覆盖?.[键] ?? {};
}

/** 当前方案的形态预设 */
function 取展示预设(配置: 小组件配置节 | null): NonNullable<布局方案["展示"]> {
  if (!配置) return "自动";
  return 配置.方案[配置.当前方案]?.展示 ?? "自动";
}

/**
 * 决定一个小组件的最终外形。
 *
 * 优先级：用户覆盖 > 形态预设 > 显著度。
 * 显著度只是**输入**，不是输出——这是职责分界的落点。
 */
function 决定外形(
  项: 已注册小组件,
  覆盖: 布局覆盖,
  预设: NonNullable<布局方案["展示"]>,
): "大卡" | "横条" | "窄条" {
  if (覆盖.外形) return 覆盖.外形;
  if (预设 === "紧凑") return "窄条";
  if (预设 === "详细") return "大卡";
  if (预设 === "仅状态栏") return "窄条";
  // 自动：按显著度
  if (项.显著度 === "primary") return "大卡";
  if (项.显著度 === "secondary") return "窄条";
  return "横条";
}

/** 决定放在哪个区域（同样只受用户覆盖与显著度影响） */
function 决定区域(项: 已注册小组件, 覆盖: 布局覆盖): "顶部" | "侧栏" | "状态栏" {
  if (覆盖.区域) return 覆盖.区域;
  if (项.显著度 === "primary") return "顶部";
  if (项.显著度 === "secondary") return "状态栏";
  return "顶部";
}

/** 排序键：用户覆盖的顺序优先，其次按显著度与标题 */
function 排序键(项: 已注册小组件, 覆盖: 布局覆盖): number {
  if (typeof 覆盖.顺序 === "number") return 覆盖.顺序;
  const 显著度权重: Record<显著度, number> = { primary: 0, normal: 100, secondary: 200 };
  return 显著度权重[项.显著度 ?? "normal"];
}

/** 转义不必要——全部走 textContent。这里只做数值格式化 */
function 格式化值(声明: 小组件声明, 值: number): string {
  if (!Number.isFinite(值)) return "—";
  const 位 = 声明.小数位 ?? 0;
  return 值.toFixed(位);
}

/** 按阈值决定颜色类名 */
function 颜色类(声明: 小组件声明, 值: number): string {
  if (typeof 声明.危险 === "number" && 值 >= 声明.危险) return "danger";
  if (typeof 声明.警示 === "number" && 值 >= 声明.警示) return "warn";
  return "";
}

/** 建一个小组件的 DOM */
function 建小组件(项: 已注册小组件, 外形: "大卡" | "横条" | "窄条"): 挂载项 {
  const 根 = document.createElement("div");
  根.className = `wg wg-${项.类型} wg-shape-${外形 === "大卡" ? "big" : 外形 === "横条" ? "bar" : "slim"}`;
  根.dataset.键 = 项.键;

  const 头 = document.createElement("div");
  头.className = "wg-head";
  const 标题 = document.createElement("span");
  标题.className = "wg-title";
  标题.textContent = 项.标题;
  头.appendChild(标题);
  根.appendChild(头);

  const 身 = document.createElement("div");
  身.className = "wg-body";
  根.appendChild(身);

  const 挂载: 挂载项 = { 声明: 项, 根, 缓冲: [], 最后推送: 0, 已过期: false, 挂载时刻: Date.now() };

  if (项.类型 === "gauge") {
    const 壳 = document.createElement("div");
    壳.className = "wg-gauge";
    const svgNs = "http://www.w3.org/2000/svg";
    const svg = document.createElementNS(svgNs, "svg");
    svg.setAttribute("viewBox", "0 0 36 36");
    svg.setAttribute("class", "wg-ring");
    const 底 = document.createElementNS(svgNs, "circle");
    底.setAttribute("cx", "18");
    底.setAttribute("cy", "18");
    底.setAttribute("r", "15.5");
    底.setAttribute("class", "wg-ring-bg");
    const 环 = document.createElementNS(svgNs, "circle");
    环.setAttribute("cx", "18");
    环.setAttribute("cy", "18");
    环.setAttribute("r", "15.5");
    环.setAttribute("class", "wg-ring-fg");
    // 周长 2πr ≈ 97.39，用 dasharray 控制进度，不必清画布
    const 周长 = 2 * Math.PI * 15.5;
    环.setAttribute("stroke-dasharray", String(周长));
    环.setAttribute("stroke-dashoffset", String(周长));
    svg.appendChild(底);
    svg.appendChild(环);

    const 值 = document.createElement("span");
    值.className = "wg-value";
    值.textContent = "—";
    壳.appendChild(svg);
    壳.appendChild(值);
    身.appendChild(壳);
    挂载.环 = 环;
    挂载.值位 = 值;
  } else if (项.类型 === "sparkline") {
    const 行 = document.createElement("div");
    行.className = "wg-spark-row";
    const 值 = document.createElement("span");
    值.className = "wg-value";
    值.textContent = "—";
    行.appendChild(值);
    身.appendChild(行);

    const 画布 = document.createElement("canvas");
    画布.className = "wg-spark";
    // 高 DPI：CSS 尺寸与位图尺寸分开设，否则锯齿明显
    画布.width = 240;
    画布.height = 40;
    身.appendChild(画布);
    挂载.值位 = 值;
    挂载.画布 = 画布;
    挂载.缓冲 = [];
  } else {
    const 值 = document.createElement("span");
    值.className = "wg-value";
    值.textContent = "—";
    身.appendChild(值);
    挂载.值位 = 值;
  }

  return 挂载;
}

/** 绘制火花线 */
function 绘火花线(挂载: 挂载项): void {
  const 画布 = 挂载.画布;
  if (!画布) return;
  const ctx = 画布.getContext("2d");
  if (!ctx) return;
  const 宽 = 画布.width;
  const 高 = 画布.height;
  ctx.clearRect(0, 0, 宽, 高);
  const 数据 = 挂载.缓冲;
  if (数据.length < 2) return;

  const 最大 = 挂载.声明.最大 ?? 100;
  const 样式 = getComputedStyle(挂载.根);
  const 线色 = 样式.getPropertyValue("--wg-line").trim() || "#4e9af1";

  ctx.strokeStyle = 线色;
  ctx.lineWidth = 2;
  ctx.lineJoin = "round";
  ctx.beginPath();
  const 步 = 宽 / Math.max(1, 数据.length - 1);
  数据.forEach((值, i) => {
    const 比 = Math.max(0, Math.min(1, 值 / 最大));
    const x = i * 步;
    const y = 高 - 比 * (高 - 4) - 2;
    if (i === 0) ctx.moveTo(x, y);
    else ctx.lineTo(x, y);
  });
  ctx.stroke();
}

/** 更新一个小组件的显示 */
function 更新显示(挂载: 挂载项, 值: number, 副标题?: string): void {
  const 声明 = 挂载.声明;
  const 色 = 颜色类(声明, 值);
  挂载.根.classList.remove("warn", "danger");
  if (色) 挂载.根.classList.add(色);

  if (挂载.值位) {
    const 单位 = 声明.单位 ? 声明.单位 : "";
    挂载.值位.textContent = `${格式化值(声明, 值)}${单位}`;
  }

  if (挂载.环) {
    const 最大 = 声明.最大 ?? 100;
    const 比 = Math.max(0, Math.min(1, 值 / 最大));
    const 周长 = 2 * Math.PI * 15.5;
    挂载.环.setAttribute("stroke-dashoffset", String(周长 * (1 - 比)));
  }

  if (挂载.画布) {
    const 点数 = 声明.点数 ?? 60;
    挂载.缓冲.push(值);
    while (挂载.缓冲.length > 点数) 挂载.缓冲.shift();
    绘火花线(挂载);
  }

  if (副标题) {
    if (!挂载.副标题位) {
      const 位 = document.createElement("span");
      位.className = "wg-sub";
      挂载.根.appendChild(位);
      挂载.副标题位 = 位;
    }
    挂载.副标题位.textContent = 副标题;
  }

  挂载.最后推送 = Date.now();
  if (挂载.已过期) {
    挂载.已过期 = false;
    挂载.根.classList.remove("stale");
  }
}

/** 标为无数据（插件可能崩了/停了/根本不支持） */
function 标记过期(): void {
  const 现在 = Date.now();
  for (const 挂载 of 挂载表.values()) {
    if (挂载.已过期) continue;
    const 阈值 = (挂载.声明.过期 ?? 30) * 1000;
    // 从未收到过数据的，从挂载时刻算起。
    // 否则「插件声明了组件但平台取不到数」会永远停在“—”，
    // 用户看不出是“还没采到”还是“这个功能根本不可用”。
    const 起算 = 挂载.最后推送 || 挂载.挂载时刻;
    if (现在 - 起算 > 阈值) {
      挂载.已过期 = true;
      挂载.根.classList.add("stale");
      if (挂载.值位) 挂载.值位.textContent = "无数据";
    }
  }
}

/** 取或建槽位容器 */
function 取槽位(名: "顶部" | "侧栏" | "状态栏"): HTMLElement | null {
  if (名 === "顶部") return 槽位.顶部;
  if (名 === "侧栏") return 槽位.侧栏;
  return 槽位.状态栏;
}

/** 建槽位容器（若页面还没有） */
function 确保槽位(): void {
  const 工作区 = document.getElementById("workspace");
  if (!工作区) return;

  if (!槽位.顶部) {
    const el = document.createElement("div");
    el.id = "wg-top";
    el.className = "wg-slot wg-slot-top";
    // 插在工作区最前面：监控条属于"常驻信息"，不该被内容挤走
    工作区.insertBefore(el, 工作区.firstChild);
    槽位.顶部 = el;
  }
  if (!槽位.状态栏) {
    const el = document.createElement("div");
    el.id = "wg-statusbar";
    el.className = "wg-slot wg-slot-status";
    工作区.appendChild(el);
    槽位.状态栏 = el;
  }
  if (!槽位.侧栏) {
    // 侧栏挂在工作区右侧；没内容时隐藏，否则会白占一条宽度
    const el = document.createElement("div");
    el.id = "wg-side";
    el.className = "wg-slot wg-slot-side hidden";
    工作区.appendChild(el);
    槽位.侧栏 = el;
  }
}

/** 清空所有已挂载的小组件 */
function 清空(): void {
  for (const 挂载 of 挂载表.values()) 挂载.根.remove();
  挂载表.clear();
}

/** 按注册表重建全部小组件 */
function 重建(响应: 列表响应): void {
  确保槽位();
  清空();
  if (过期定时 === undefined) {
    过期定时 = window.setInterval(标记过期, 3000);
  }

  const 预设 = 取展示预设(响应.配置);
  const 按槽位: Record<"顶部" | "侧栏" | "状态栏", Array<{ 项: 已注册小组件; 覆盖: 布局覆盖 }>> = {
    顶部: [],
    侧栏: [],
    状态栏: [],
  };

  for (const 项 of 响应.小组件) {
    const 覆盖 = 取覆盖(响应.配置, 项.键);
    if (覆盖.隐藏) continue;
    按槽位[决定区域(项, 覆盖)].push({ 项, 覆盖 });
  }

  for (const 名 of ["顶部", "侧栏", "状态栏"] as const) {
    const 容器 = 取槽位(名);
    if (!容器) continue;
    const 列 = 按槽位[名].sort((a, b) => 排序键(a.项, a.覆盖) - 排序键(b.项, b.覆盖));
    容器.classList.toggle("hidden", 列.length === 0);
    if (列.length === 0) continue;

    for (const { 项, 覆盖 } of 列) {
      const 外形 = 决定外形(项, 覆盖, 预设);
      const 挂载 = 建小组件(项, 外形);
      if (!项.在线) {
        挂载.根.classList.add("stale");
        if (挂载.值位) 挂载.值位.textContent = "离线";
      }
      容器.appendChild(挂载.根);
      挂载表.set(项.键, 挂载);
    }
  }
}

/** 拉取注册表并重建 */
export async function 刷新小组件(): Promise<void> {
  try {
    const 响应 = (await window.kugua.request("nigane", "nigane.widgets.list", {})) as 列表响应;
    最近列表 = 响应;
    重建(响应);
  } catch {
    // 主控尚未支持该接口时静默跳过——旧版本后端不该让界面报错
  }
}

/** 供设置页取当前注册表（避免重复请求） */
export function 取小组件列表(): 列表响应 | null {
  return 最近列表;
}

/** 处理一条推送 */
function 收到推送(来源: string, id: string, 值: number, 副标题?: string): void {
  const 挂载 = 挂载表.get(`${来源}.${id}`);
  if (!挂载) return;
  更新显示(挂载, 值, 副标题);
}

/** 初始化：订阅总线 + 首次拉取 */
export function 初始化小组件(): void {
  window.kugua.onBus((action: string, params: unknown) => {
    if (action === "widgets.changed") {
      void 刷新小组件();
      return;
    }
    if (action === "widget.data") {
      const p = (params ?? {}) as {
        来源?: string;
        id?: string;
        值?: number;
        value?: number;
        副标题?: string;
      };
      const 来源 = String(p.来源 ?? "");
      if (!来源) return;
      收到推送(来源, String(p.id ?? ""), Number(p.值 ?? p.value), p.副标题);
    }
  });
  void 刷新小组件();
}
