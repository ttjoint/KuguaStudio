/**
 * 图片编辑页。
 *
 * ## 设计原则
 *
 * **参数控件全部由动作声明表生成**，这个页面里没有 `rotate`、`resize`
 * 之类的硬编码。模块把 `image.actions.declare` 返回的那张表发过来，
 * 前端照着渲染：`number` 出滑块、`string` + 选项出下拉、`boolean` 出勾选。
 * 加一个动作不需要改这里一行。
 *
 * ## 实时预览的分工
 *
 * 用户拖滑块时**不发请求**，纯前端做：
 * - 旋转/缩放/翻转 → CSS `transform`（0ms）
 * - 反色/灰度/模糊 → CSS `filter`（近似，足够判断方向对不对）
 * - 切割/网格 → Canvas 叠线框
 *
 * 松手才调后端。实测一次 ImageMagick 约 65ms 启动 + 处理，拖滑块时
 * 每帧都发请求会把队列堵死，而且用户看到的是几秒前的画面。
 *
 * ## 预览只是「大概」不是「精确」
 *
 * CSS filter 的灰度与 ImageMagick 的 `-colorspace Gray` 系数不同，
 * 旋转的插值算法也不同。所以：
 * - 界面上明确标注「预览」
 * - 松手后立刻用真结果替换
 * - 不做「预览即最终结果」的暗示
 */

// ============ 与平台通信 ============

/**
 * 调平台 API。
 *
 * 直接走 `/api/request` 而不是依赖宿主的 `window.kugua`：模块页由模块自己
 * 提供静态资源，如果依赖宿主注入的全局对象，宿主改一下 shim 路径这里就坏了，
 * 而且坏的时候模块本身照常运行。`/api/request` 是公开契约。
 */
async function 请求(目标, 动作, 参数, 超时毫秒) {
  const r = await fetch("/api/request", {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ target: 目标, action: 动作, params: 参数, timeoutMs: 超时毫秒 }),
  });
  const 数据 = await r.json();
  // 业务失败是 200 + __kuguaError，不能只看 res.ok
  if (数据 && 数据.__kuguaError) throw new Error(数据.__kuguaError);
  return 数据;
}

// ============ 状态 ============

const 状态 = {
  /** 当前会话号 */
  会话: "",
  /** 当前会话目录（模块侧） */
  目录: "",
  /** 原图路径（会话目录内） */
  原图: "",
  /** 当前展示的结果路径 */
  结果: "",
  /** 原图尺寸 */
  宽: 0,
  高: 0,
  /** 动作声明表 */
  声明: [],
  /** 当前选中动作 */
  当前: null,
  /** 当前参数值（键 → 值） */
  值: {},
  /** 请求序号：并发时只认最后一次的结果 */
  序号: 0,
  /** 多帧结果的帧路径（空数组 = 单图结果） */
  帧们: [],
  /** 多图参数的槽位内容（键 → 路径数组） */
  多图: {},
  /** 最近一次结果的元信息（另存时命名用） */
  结果信息: null,
};

// ============ DOM ============

const $ = (id) => document.getElementById(id);
const 空态 = $("empty");
const 编辑区 = $("stage");
const 预览 = $("preview");
const 叠层 = $("overlay");
const 动作列表 = $("action-list");
const 参数表单 = $("params-form");
const 参数标题 = $("params-title");
const 参数备注 = $("params-note");
const 状态尺寸 = $("status-size");
const 状态消息 = $("status-msg");
const 应用按钮 = $("btn-apply");
const 画布内层 = $("canvas-inner");

function 设消息(文字) {
  状态消息.textContent = 文字 ?? "";
}

function 设尺寸(文字) {
  状态尺寸.textContent = 文字;
}

// ============ 会话 ============

async function 开会话() {
  const r = await 请求("image", "image.session.open", {});
  状态.会话 = r.会话;
  状态.目录 = r.目录;
  return r;
}

/** 把一张 base64 图写进会话目录，返回路径 */
async function 写图(base64, 名) {
  const 路径 = `${状态.目录}/${名}`.replace(/\\/g, "/");
  // 用平台的文件落地接口：它写进 kugua-drop，但我们需要写进自己的会话目录。
  // 所以走一个专门的写入通道——这里用 fetch 到模块没法做到（模块不能收
  // 任意路径写），因此改用「模块返回路径」的方式：调 image.file.save。
  const r = await 请求("image", "image.file.save", {
    session: 状态.会话,
    name: 名,
    base64,
  });
  return r.路径 ?? 路径;
}

async function 释放会话() {
  if (!状态.会话) return;
  try {
    await 请求("image", "image.session.release", { session: 状态.会话 });
  } catch {
    // 关页面时清理失败不值得弹提示；模块侧还有兜底扫描
  }
  状态.会话 = "";
  状态.目录 = "";
}

// ============ 显示 ============

function 显示图(路径) {
  状态.结果 = 路径;
  // 加时间戳绕开缓存：同一路径内容变了（重新处理到同名文件）浏览器会拿旧图
  预览.src = `/api/file?path=${encodeURIComponent(路径)}&t=${Date.now()}`;
}

function 进入编辑区() {
  空态.hidden = true;
  编辑区.hidden = false;
}

// ============ 动作列表 ============

function 渲染动作列表(过滤词) {
  const 词 = (过滤词 ?? "").trim().toLowerCase();
  while (动作列表.firstChild) 动作列表.removeChild(动作列表.firstChild);

  // 按分组聚合，顺序沿用声明表顺序
  const 分组 = new Map();
  for (const d of 状态.声明) {
    // 系统动作是前端跟模块之间的契约，不是给用户点的
    if (d.分组 === "系统") continue;
    if (词 && !d.标题.toLowerCase().includes(词) && !d.动作.toLowerCase().includes(词)) continue;
    if (!分组.has(d.分组)) 分组.set(d.分组, []);
    分组.get(d.分组).push(d);
  }

  for (const [组名, 项们] of 分组) {
    const 标签 = document.createElement("div");
    标签.className = "group-label";
    标签.textContent = 组名;
    动作列表.appendChild(标签);

    for (const d of 项们) {
      const 按钮 = document.createElement("button");
      按钮.className = "action-btn";
      按钮.dataset.action = d.动作;
      if (状态.当前 && 状态.当前.动作 === d.动作) 按钮.classList.add("active");

      const 名 = document.createElement("span");
      名.textContent = d.标题;
      按钮.appendChild(名);

      const 说明 = document.createElement("span");
      说明.className = "action-desc";
      说明.textContent = d.说明 ?? "";
      按钮.appendChild(说明);

      按钮.addEventListener("click", () => 选动作(d));
      动作列表.appendChild(按钮);
    }
  }

  if (!动作列表.firstChild) {
    const 空 = document.createElement("div");
    空.className = "group-label";
    空.textContent = "没有匹配的动作";
    动作列表.appendChild(空);
  }
}

function 选动作(d) {
  状态.当前 = d;
  // 参数值回到声明里的界面默认（不是协议默认——见 actions.ts 的说明）
  状态.值 = {};
  for (const p of d.参数 ?? []) {
    状态.值[p.键] = p.界面默认 !== undefined ? p.界面默认 : p.默认;
  }
  参数标题.textContent = d.标题;
  参数备注.textContent = d.说明 ?? "";
  渲染参数();
  渲染动作列表($("action-filter").value);
  设消息("");

  // 选中即预览一次（不调后端）
  应用本地预览();

  const 需要图 = d.源图 || (d.参数 ?? []).some((p) => p.键 === "images");
  应用按钮.disabled = 需要图 && !状态.原图;
}

// ============ 参数控件（由声明生成） ============

/**
 * 生成一个参数的控件。
 *
 * 这里的每个分支对应 `actions.ts` 里 `参数类型` 的四种可能。加一种类型
 * 只需要在这里加一个分支——声明表那边改完这边不改会落到最后的
 * 「未知类型」提示，不会静默出一个不能用的控件。
 */
function 造控件(p) {
  const 容器 = document.createElement("div");
  容器.className = "field";
  容器.dataset.key = p.键;

  const 头 = document.createElement("div");
  头.className = "field-head";
  const 标签 = document.createElement("label");
  标签.className = "field-label";
  标签.textContent = p.标题 ?? p.键;
  if (p.标题) 标签.htmlFor = `f-${p.键}`;
  头.appendChild(标签);
  容器.appendChild(头);

  let 取值控件 = null;
  let 值显示 = null;

  if (p.类型 === "number") {
    if (p.选择 || p.档位) {
      // 有档位：下拉框比滑块更清楚（比如 1/2/4 倍）
      // 注意 档位 是 { 值, 标签 } 对象数组，不是纯数字
      取值控件 = document.createElement("select");
      取值控件.id = `f-${p.键}`;
      for (const 档 of p.档位 ?? []) {
        const o = document.createElement("option");
        o.value = String(档.值 ?? 档);
        o.textContent = 档.标签 ?? String(档.值 ?? 档);
        取值控件.appendChild(o);
      }
    } else if (p.默认 === undefined && p.最小 !== undefined && p.最大 !== undefined) {
      // **没有默认值就不能用滑块**。
      //
      // 典型是 resize 的 width/height：它是「留空就按比例算」，滑块
      // 天生无法表达「空」——滑块总有值，用户一碰就被写进 10001（范围的
      // 中点），意图和他想要的完全相反。
      取值控件 = document.createElement("input");
      取值控件.type = "number";
      取值控件.id = `f-${p.键}`;
      取值控件.placeholder = "留空则不用";
    } else if (p.最小 !== undefined && p.最大 !== undefined) {
      // 有范围且**有默认值**：滑块 + 数字框。滑块便于拖，默认值给一个合理起点
      取值控件 = document.createElement("input");
      取值控件.type = "range";
      取值控件.id = `f-${p.键}`;
      取值控件.min = String(p.最小);
      取值控件.max = String(p.最大);
      取值控件.step = String(p.步进 ?? 1);

      值显示 = document.createElement("span");
      值显示.className = "field-value";
      头.appendChild(值显示);
    } else {
      取值控件 = document.createElement("input");
      取值控件.type = "number";
      取值控件.id = `f-${p.键}`;
    }
    if (取值控件.tagName !== "SELECT") {
      if (p.最小 !== undefined) 取值控件.min = String(p.最小);
      if (p.最大 !== undefined) 取值控件.max = String(p.最大);
      if (p.步进 !== undefined) 取值控件.step = String(p.步进);
    }
  } else if (p.类型 === "string") {
    if (p.选择 && p.选择.length) {
      取值控件 = document.createElement("select");
      取值控件.id = `f-${p.键}`;
      for (const o of p.选择) {
        const opt = document.createElement("option");
        opt.value = String(o.值);
        opt.textContent = o.标签 ?? String(o.值);
        取值控件.appendChild(opt);
      }
    } else {
      取值控件 = document.createElement("input");
      取值控件.type = "text";
      取值控件.id = `f-${p.键}`;
    }
  } else if (p.类型 === "boolean") {
    const 行 = document.createElement("div");
    行.className = "field-row";
    取值控件 = document.createElement("input");
    取值控件.type = "checkbox";
    取值控件.id = `f-${p.键}`;
    行.appendChild(取值控件);
    const 旁注 = document.createElement("span");
    旁注.className = "field-desc";
    旁注.textContent = p.说明 ?? "";
    行.appendChild(旁注);
    容器.appendChild(行);
  } else if (p.类型 === "images") {
    // 多图参数：一个累加槽位。用户拖图进来 / 点「加入当前图」都能往里添。
    //
    // 为什么不做成多选文件对话框：拼接、做 GIF 这类操作的典型顺序是
    // 「先看一张，再决定要不要加第二张」。一次性多选把人逼到先攒够再进来，
    // 而槽位可以边看边加。
    const 槽 = document.createElement("div");
    槽.className = "image-slots";
    槽.dataset.key = p.键;
    槽.id = `f-${p.键}`;
    容器.appendChild(槽);

    const 刷 = () => {
      while (槽.firstChild) 槽.removeChild(槽.firstChild);
      // 必须**写回** 状态.多图。
      //
      // 原来写的是 `const 列 = 状态.多图[p.键] ?? []`，然后直接往 列 里
      // push——数组是新的，push 完没挂回去，下一次 刷() 又取到 新的空数组。
      // 症状：点了「加入当前图」毫无反应，也不报错。
      const 列 = (状态.多图[p.键] ??= []);
      if (!列.length) {
        const 空 = document.createElement("div");
        空.className = "field-desc";
        空.textContent = "还没加图。先选一张图，再点下面的「加入当前图」。";
        槽.appendChild(空);
      }
      列.forEach((路径, i) => {
        const 行 = document.createElement("div");
        行.className = "image-slot";
        const 图 = document.createElement("img");
        图.src = `/api/file?path=${encodeURIComponent(路径)}`;
        图.alt = `第 ${i + 1} 张`;
        行.appendChild(图);
        const 删 = document.createElement("button");
        删.className = "slot-del";
        删.textContent = "×";
        删.title = "移出";
        删.addEventListener("click", () => {
          列.splice(i, 1);
          刷();
        });
        行.appendChild(删);
        槽.appendChild(行);
      });

      const 加 = document.createElement("button");
      加.className = "slot-add";
      加.textContent = "＋ 加入当前图";
      加.disabled = !状态.原图;
      加.addEventListener("click", () => {
        if (!状态.原图) return;
        列.push(状态.原图);
        刷();
      });
      槽.appendChild(加);
    };
    槽._刷 = 刷;
    刷();
    取值控件 = null;
  } else {
    const 提示 = document.createElement("div");
    提示.className = "field-desc";
    提示.textContent = `未知参数类型：${p.类型}`;
    容器.appendChild(提示);
  }

  if (取值控件) {
    const 初 = 状态.值[p.键];
    取值控件.value = 初 === undefined || 初 === null ? "" : String(初);
    if (取值控件.type === "checkbox") 取值控件.checked = 初 === true;

    if (值显示) 值显示.textContent = 取值控件.value;

    const 变化时 = (实时) => {
      const v = 取值控件.type === "checkbox" ? 取值控件.checked
        : p.类型 === "number" ? Number(取值控件.value)
        : 取值控件.value;
      状态.值[p.键] = v;
      if (值显示) 值显示.textContent = String(v);
      if (实时) 应用本地预览();
      else 应用本地预览();
    };

    // 滑块拖动时实时预览，其他控件改完再预览
    取值控件.addEventListener("input", () => 变化时(true));
    取值控件.addEventListener("change", () => 变化时(false));

    if (!容器.contains(取值控件)) 容器.appendChild(取值控件);
  }

  if (p.类型 !== "boolean" && p.说明) {
    const 说明 = document.createElement("div");
    说明.className = "field-desc";
    说明.textContent = p.说明;
    容器.appendChild(说明);
  }

  return 容器;
}

function 渲染参数() {
  while (参数表单.firstChild) 参数表单.removeChild(参数表单.firstChild);
  const 参数 = 状态.当前?.参数 ?? [];
  if (!参数.length) {
    const 空 = document.createElement("div");
    空.className = "field-desc";
    空.textContent = "这个动作没有参数，直接点应用。";
    参数表单.appendChild(空);
    return;
  }
  for (const p of 参数) {
    参数表单.appendChild(造控件(p));
  }
}

// ============ 本地实时预览 ============

/**
 * 只改 DOM，不发请求。
 *
 * 每种动作的预览方式在声明表里（`预览` 字段）。没有声明或声明 `none`
 * 的动作什么也不做——假装能预览比不能预览更糟，用户会以为拖了没生效。
 */
function 应用本地预览() {
  const d = 状态.当前;
  if (!d) return;
  const 方 = d.预览 ?? "none";
  // 先清掉上一轮的
  画布内层.style.transform = "";
  预览.style.filter = "";
  叠层.replaceChildren();

  if (方 === "css-transform") {
    const v = 状态.值;
    const 段 = [];
    if (d.动作 === "rotate") {
      段.push(`rotate(${Number(v.degrees) || 0}deg)`);
    } else if (d.动作 === "resize") {
      const sx = Number(v.scaleX);
      const sy = Number(v.scaleY);
      段.push(`scale(${Number.isFinite(sx) ? sx : 1}, ${Number.isFinite(sy) ? sy : 1})`);
    } else if (d.动作 === "flipH") {
      段.push("scaleX(-1)");
    } else if (d.动作 === "flipV") {
      段.push("scaleY(-1)");
    }
    画布内层.style.transform = 段.join(" ");
  } else if (方 === "css-filter") {
    const v = 状态.值;
    if (d.动作 === "negate") 预览.style.filter = "invert(1)";
    else if (d.动作 === "grayscale") 预览.style.filter = "grayscale(1)";
    else if (d.动作 === "oldJpg") {
      const q = Number(v.quality);
      预览.style.filter = Number.isFinite(q) ? `saturate(${0.4 + q * 0.6}) contrast(${1.3 - q * 0.3})` : "";
    }
  } else if (方 === "overlay") {
    // 切割：在原图上叠一层线框，标出保留区域
    if (d.动作 === "cut") {
      const r = 预览.getBoundingClientRect();
      if (!r.width || !r.height) return;
      const v = 状态.值;
      const 算 = (值, 总) => {
        const x = Number(值) || 0;
        return Math.abs(x) < 1 ? x * 总 : x;
      };
      const t = 算(v.top, r.height);
      const b = 算(v.bottom, r.height);
      const l = 算(v.left, r.width);
      const rr = 算(v.right, r.width);
      const 框 = document.createElement("div");
      框.style.cssText = `position:absolute;left:${l}px;top:${t}px;right:${rr}px;bottom:${b}px;border:1px solid #3a7afe;box-shadow:0 0 0 9999px rgba(0,0,0,0.45);`;
      叠层.appendChild(框);
    }
  }
}

// ============ 应用（真调后端） ============

const 动作名到能力 = (动作) => `image.${动作}`;

async function 应用() {
  const d = 状态.当前;
  if (!d) return;
  if (!状态.原图) {
    设消息("先选一张图");
    return;
  }

  const 序号 = ++状态.序号;
  应用按钮.disabled = true;
  设消息("处理中…");

  try {
    const 参数 = { session: 状态.会话, path: 状态.原图 };
    for (const p of d.参数 ?? []) {
      if (p.类型 === "images") {
        const 列 = 状态.多图[p.键] ?? [];        if (!列.length) {
          设消息(`「${p.标题 ?? p.键}」还没加图`);
          return;
        }
        参数[p.键] = 列;
        continue;
      }
      const v = 状态.值[p.键];
      if (v === undefined || v === null || v === "") continue;
      参数[p.键] = v;
    }
    const r = await 请求("image", 动作名到能力(d.动作), 参数, 120000);
    // 并发保护：用户连点两次时只认最后一次，否则先返回的旧结果会覆盖新结果
    if (序号 !== 状态.序号) return;
    if (r?.path) {
      显示图(r.path);
      设尺寸(`${r.width ?? "?"} x ${r.height ?? "?"}  ·  ${r.message ?? ""}`);
      设消息("");
      // 结果替换原图，形成链式编辑（旋转后再切割）
      状态.原图 = r.path;
      状态.结果信息 = { width: r.width, height: r.height, format: r.format, message: r.message };
      // 多帧动作返回 `frames` 路径数组（拆帧、拆碎片）。
      // 拿掉帧列表只显示一张的话，用户完全不知道拆出来几帧、每帧长什么样。
      渲染帧列表(r.frames ?? []);
      显示结果栏(true);
      应用本地预览();
    } else if (r?.base64) {
      // 兜底：动作还没改成返回路径时走 base64
      预览.src = `data:image/${r.format ?? "png"};base64,${r.base64}`;
      设尺寸(`${r.width} x ${r.height}`);
      渲染帧列表([]);
    } else {
      设消息("模块没有返回图片");
    }
  } catch (e) {
    设消息(`失败：${e.message}`);
  } finally {
    if (序号 === 状态.序号) 应用按钮.disabled = false;
  }
}

// ============ 选图 ============

/**
 * 从本地文件读图并送进模块。
 *
 * 用 FileReader 读成 base64 再交给模块写进会话目录。不走
 * `/api/writeTempFile` 是因为那个目录（kugua-drop）不归模块管，
 * 模块的 `image.file.read` 只认自己的会话目录。
 */
async function 收文件(file) {
  if (!file) return;
  if (!/^image\//.test(file.type)) {
    设消息("这不是图片文件");
    return;
  }
  设消息("读取中…");
  try {
    const base64 = await new Promise((res, rej) => {
      const r = new FileReader();
      r.onload = () => {
        const s = String(r.result ?? "");
        res(s.slice(s.indexOf(",") + 1));
      };
      r.onerror = () => rej(new Error("读取失败"));
      r.readAsDataURL(file);
    });

    if (!状态.会话) await 开会话();
    const ext = (file.name.match(/\.[a-z0-9]+$/i)?.[0] ?? ".png").toLowerCase();
    const 路径 = await 写图(base64, `src${ext}`);

    状态.原图 = 路径;
    进入编辑区();
    渲染帧列表([]);
    显示结果栏(false);
    状态.结果信息 = null;
    显示图(路径);
    设尺寸(file.name);
    设消息("");
    应用按钮.disabled = false;

    if (!状态.声明.length) await 载入声明();
  } catch (e) {
    设消息(`打开失败：${e.message}`);
  }
}

async function 载入声明() {
  const r = await 请求("image", "image.actions.declare", {});
  const 表 = Array.isArray(r) ? r : (r?.actions ?? []);
  状态.声明 = 表;
  渲染动作列表("");
  // 默认选中第一个常用图形动作，省得用户先找一遍
  const 首选 = 表.find((d) => d.动作 === "rotate") ?? 表.find((d) => d.常用 && d.分组 !== "系统") ?? 表[0];
  if (首选) 选动作(首选);
}

// ============ 帧列表 ============

const 帧栏 = $("frames-bar");
const 帧条 = $("frames-strip");
const 帧计数 = $("frames-count");

/**
 * 多帧动作（拆帧、拆碎片）的结果展示。
 *
 * 帧全部走**路径**不走 base64：30 帧的 base64 是 3.7MB，传过去再让浏览器
 * 解码，既堵通道又费内存。路径交给 `<img src>` 后浏览器自己流式加载，
 * 还吃 HTTP 缓存，而且没有的帧根本不会请求。
 */
function 渲染帧列表(帧们) {
  while (帧条.firstChild) 帧条.removeChild(帧条.firstChild);
  状态.帧们 = 帧们;

  if (!帧们.length) {
    帧栏.hidden = true;
    return;
  }

  帧栏.hidden = false;
  帧计数.textContent = `共 ${帧们.length} 帧`;

  帧们.forEach((路径, i) => {
    const 钮 = document.createElement("button");
    钮.className = "frame-thumb";
    钮.dataset.index = String(i);
    if (i === 0) 钮.classList.add("active");

    const 图 = document.createElement("img");
    图.src = `/api/file?path=${encodeURIComponent(路径)}`;
    图.alt = `第 ${i + 1} 帧`;
    // 帧多时一次性全部解码会卡一下，但只 30、50 帧且都是缩略尺寸，
    // 加 loading=lazy 反而让横向滚动时出现空白
    图.decoding = "async";
    钮.appendChild(图);

    const 号 = document.createElement("span");
    号.className = "frame-no";
    号.textContent = String(i + 1);
    钮.appendChild(号);

    钮.addEventListener("click", () => {
      for (const x of 帧条.querySelectorAll(".frame-thumb")) x.classList.remove("active");
      钮.classList.add("active");
      显示图(路径);
      // 点某一帧 = 把它当成「当前图」，后续动作作用于它。
      // 这是拆帧后最常见的后续操作：只看某一帧、或拿它去处理。
      状态.原图 = 路径;
      应用按钮.disabled = false;
    });

    帧条.appendChild(钮);
  });
}

// ============ 结果处置 ============

const 结果栏 = $("result-bar");

function 显示结果栏(显示) {
  结果栏.hidden = !显示;
}

/**
 * 调平台的桥接口。
 *
 * 这几个接口（剪贴板、另存对话框）是平台提供的，模块自己做不到——
 * 浏览器里没有写剪贴板图片、也没有原生保存对话框。宿主已把它们挂在
 * `window.kugua` 上（同源 iframe 可以直接用）。
 *
 * 没拿到桥时静默降级，不能报错：用户可能是在纯浏览器里直接开了
 * `/module-ui/image/` 调试，那时这些功能本来就不存在。
 */
async function 桥(动作, ...参数) {
  const k = window.kugua;
  if (!k || typeof k[动作] !== "function") return null;
  try {
    return await k[动作](...参数);
  } catch (e) {
    设消息(`操作失败：${e.message}`);
    return null;
  }
}

/** 当前结果图的 data URL（剪贴板需要 data URL，不是路径） */
async function 当前图DataURL() {
  const 源 = 预览.src;
  if (!源) throw new Error("没有可用的图片");
  const r = await fetch(源);
  if (!r.ok) throw new Error(`读图失败（${r.status}）`);
  const blob = await r.blob();
  return await new Promise((res, rej) => {
    const fr = new FileReader();
    fr.onload = () => res(String(fr.result ?? ""));
    fr.onerror = () => rej(new Error("转 data URL 失败"));
    fr.readAsDataURL(blob);
  });
}

$("btn-copy").addEventListener("click", async () => {
  try {
    const url = await 当前图DataURL();
    const ok = await 桥("copyImage", url);
    // 桥不存在时退回浏览器原生剪贴板（只支持 png，但大多数情况够用）
    if (ok === null) {
      if (!navigator.clipboard || typeof ClipboardItem === "undefined") {
        设消息("当前环境不支持复制图片");
        return;
      }
      const blob = await (await fetch(url)).blob();
      await navigator.clipboard.write([new ClipboardItem({ [blob.type]: blob })]);
      设消息("已复制到剪贴板");
      return;
    }
    设消息(ok ? "已复制到剪贴板" : "复制失败");
  } catch (e) {
    设消息(`复制失败：${e.message}`);
  }
});

$("btn-save").addEventListener("click", async () => {
  try {
    const url = await 当前图DataURL();
    const 名 = `kugua-${(状态.当前?.动作 ?? "img")}-${Date.now().toString(36)}`;
    const 路径 = await 桥("writeTempFile", { base64: url.slice(url.indexOf(",") + 1), name: 名, ext: ".png" });
    if (!路径) {
      设消息("当前环境不支持另存");
      return;
    }
    // 浏览器没法弹「保存到」对话框（沙箱限制），所以先在系统临时目录落一份，
    // 再用一个 <a download> 把文件交给浏览器自己的下载流程。
    const a = document.createElement("a");
    a.href = `/api/file?path=${encodeURIComponent(路径)}`;
    a.download = `${名}.png`;
    a.click();
    设消息(`已导出 ${名}.png`);
  } catch (e) {
    设消息(`另存失败：${e.message}`);
  }
});

$("btn-chat").addEventListener("click", async () => {
  // 发回聊天框：把结果图交给平台，聊天框会当成一个待发送附件。
  // 走的是平台已有的附件通道，不在模块里另造一套。
  try {
    const url = await 当前图DataURL();
    const k = window.kugua;
    if (k && typeof k.sendToChat === "function") {
      await k.sendToChat({ dataUrl: url, name: `kugua-${Date.now().toString(36)}.png` });
      设消息("已发到聊天框");
      return;
    }
    // 没有专用通道时退一步：复制图片，并提示用户直接粘贴
    const ok = await 桥("copyImage", url);
    设消息(ok ? "已复制，去聊天框粘贴即可" : "当前环境不支持发送到聊天框");
  } catch (e) {
    设消息(`发送失败：${e.message}`);
  }
});

// ============ 事件 ============

$("btn-pick").addEventListener("click", () => {
  const inp = document.createElement("input");
  inp.type = "file";
  inp.accept = "image/*";
  inp.addEventListener("change", () => {
    const f = inp.files?.[0];
    if (f) void 收文件(f);
  });
  inp.click();
});

$("action-filter").addEventListener("input", (e) => 渲染动作列表(e.target.value));
应用按钮.addEventListener("click", () => void 应用());
$("btn-reset").addEventListener("click", () => {
  if (状态.当前) 选动作(状态.当前);
});

// 拖拽：整页接收
let 拖入层数 = 0;
window.addEventListener("dragenter", (e) => {
  e.preventDefault();
  拖入层数++;
  document.body.classList.add("dragging");
});
window.addEventListener("dragover", (e) => e.preventDefault());
window.addEventListener("dragleave", (e) => {
  e.preventDefault();
  拖入层数 = Math.max(0, 拖入层数 - 1);
  if (拖入层数 === 0) document.body.classList.remove("dragging");
});
window.addEventListener("drop", (e) => {
  e.preventDefault();
  拖入层数 = 0;
  document.body.classList.remove("dragging");
  const f = e.dataTransfer?.files?.[0];
  if (f) void 收文件(f);
});

// 关页面时释放会话。`beforeunload` 里发异步请求不保证送达，
// 所以模块侧还有「过旧会话」兜底清理。
window.addEventListener("beforeunload", () => {
  void 释放会话();
});

// 图上尺寸变化时重画叠层（切割线框跟着走）
预览.addEventListener("load", () => {
  设尺寸(
    `${预览.naturalWidth} x ${预览.naturalHeight}`,
  );
  应用本地预览();
});

/**
 * 把动作声明表暴露给测试。
 *
 * 页面的核心价值是「由声明驱动」，所以测试要能断言控件确实是**按声明
 * 生成**的，而不是页面里另写了一份。没有这个钩子就只能靠肉眼数控件。
 */
window.__图片编辑页 = {
  状态,
  渲染动作列表,
  渲染参数,
  选动作,
  应用本地预览,
  造控件,
  async 初始化(声明) {
    状态.声明 = 声明;
    渲染动作列表("");
  },
};
