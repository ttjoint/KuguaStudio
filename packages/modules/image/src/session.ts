/**
 * 图片模块的会话目录管理。
 *
 * ## 为什么不复用 `用临时目录`
 *
 * `magick.ts` 里的 `用临时目录()` 是「进去 → 干活 → 立刻删」，生命周期
 * 一次调用。编辑页需要的是**相反的东西**：用户拖滑块、切动作、翻帧列表，
 * 期间图片文件得一直躺在盘上，等页面关掉才清。
 *
 * ## 为什么编辑页必须走文件而不是 base64
 *
 * 实测（30 帧 GIF，Windows 11）：
 *
 * | 传法 | 体积 |
 * |---|---|
 * | 每帧 base64 塞 JSON | 3.7 MB |
 * | 只传路径 | 1.4 KB |
 *
 * 差 2687 倍。而且这不是一次性开销——编辑页每次调动作都要拿一次结果。
 * 前端拿到路径后走 `/api/file` 由浏览器自己流式加载，还能吃到 HTTP 缓存。
 *
 * ## 目录布局
 *
 * ```
 * <tmp>/kugua-image-<会话id>/
 *   源图.png
 *   结果-1.png
 *   结果-2.png
 *   ...
 * ```
 *
 * 会话 id 由调用方给（前端生成），这样同一个页面刷新后还能接上原来那批文件。
 * 不给就新建一个。
 *
 * ## 清理时机
 *
 * 1. 前端显式调 `image.session.release`（关页面、换图）
 * 2. 模块退出时（`注册` 返回的清理函数）
 * 3. **兜底**：`清掉过旧会话()` 在每次新建会话时扫一遍，删掉 6 小时前的。
 *    第 3 条是必须的——模块被 `taskkill` 或者机器断电时第 2 条不会跑，
 *    `tmp` 目录会无限长胖。
 */

import { existsSync, mkdirSync, mkdtempSync, readdirSync, rmSync, statSync } from "node:fs";
import { tmpdir } from "node:os";
import { basename, join, resolve, sep } from "node:path";

/** 会话目录前缀 */
const 前缀 = "kugua-image-";

/** 会话多久没人碰就认为已废弃（毫秒） */
const 废弃时限 = 6 * 60 * 60 * 1000;

/** 会话 id 只允许这些字符，防止拼出目录穿越 */
const 合法会话 = /^[A-Za-z0-9_-]{1,64}$/;

/** 当前进程里所有活着的会话（根目录绝对路径） */
const 活会话 = new Set<string>();

/** 会话根目录（`<tmp>/kugua-image-<id>`） */
export function 会话目录(会话: string): string {
  const 根 = join(tmpdir(), 前缀 + 会话);
  return 根;
}

/**
 * 校验会话 id。
 *
 * 单列出来是因为它同时被**目录拼接**和**文件路径校验**用：
 * 只要 id 合法，`resolve(会话目录(id), 文件名)` 就必然落在会话目录内。
 */
export function 会话合法(会话: unknown): 会话 is string {
  return typeof 会话 === "string" && 合法会话.test(会话);
}

/**
 * 打开（或新建）会话。
 *
 * 传了合法 id 就复用，否则新生成一个。返回值一定是绝对路径。
 */
export function 打开会话(会话?: unknown): { 会话: string; 目录: string } {
  // 顺便做一次兜底清理：一次 readdir + 少量 stat，代价可以忽略
  清掉过旧会话();

  let id: string;
  if (会话合法(会话)) {
    id = 会话;
    mkdirSync(会话目录(id), { recursive: true });
  } else {
    // mkdtemp 保证唯一，避免两个页面撞同一个 id
    const 临时 = mkdtempSync(join(tmpdir(), 前缀));
    id = basename(临时);
    // mkdtemp 的目录名已经带前缀，这里只取后面那段，统一由 会话目录() 拼
    if (!会话合法(id)) {
      // 理论上不会发生；真发生了说明前缀配置坏了，退化用时间戳
      id = Date.now().toString(36);
      mkdirSync(会话目录(id), { recursive: true });
      try {
        rmSync(临时, { recursive: true, force: true });
      } catch {
        // 删不掉不影响主流程，兜底清理会处理
      }
    }
  }
  const 目录 = 会话目录(id);
  mkdirSync(目录, { recursive: true });
  活会话.add(目录);
  return { 会话: id, 目录 };
}

/**
 * 判断一个路径是否落在某个会话目录里。
 *
 * 编辑页会把模块返回的路径原样发给 `/api/file`，服务端必须确认这个路径
 * 是「我们自己发给它的」而不是前端随便编的 `C:\Windows\...`。
 *
 * 注意 `startsWith(根 + sep)` 而不是 `startsWith(根)`：后者会让
 * `kugua-image-abc-evil` 通过 `kugua-image-abc` 的检查。
 */
export function 在会话内(路径: string): boolean {
  if (typeof 路径 !== "string" || !路径) return false;
  let 绝对: string;
  try {
    绝对 = resolve(路径);
  } catch {
    return false;
  }
  const 根 = resolve(tmpdir());
  // 必须直接在 tmp 下、且目录名以我们的前缀开头
  if (!绝对.startsWith(根 + sep)) return false;
  const 相对 = 绝对.slice(根.length + sep.length);
  const 首段 = 相对.split(sep)[0] ?? "";
  if (!首段.startsWith(前缀)) return false;
  const id = 首段.slice(前缀.length);
  return 会话合法(id);
}

/** 释放一个会话的目录（幂等） */
export function 释放会话(会话: unknown): boolean {
  if (!会话合法(会话)) return false;
  const 目录 = 会话目录(会话);
  let 删了 = false;
  // rmSync({force:true}) 对不存在的目录**不报错**，所以不能靠 try/catch
  // 判断「删没删」——必须先看它存不存在，否则幂等调用永远报「成功」。
  if (existsSync(目录)) {
    try {
      rmSync(目录, { recursive: true, force: true });
      删了 = !existsSync(目录);
    } catch {
      // 文件被别的进程占着（比如浏览器正在读）时 Windows 会拒绝删除。
      // 不抛错：前端只需要知道「我尽力了」，兜底清理会再来一次。
    }
  }
  活会话.delete(目录);
  return 删了;
}

/** 释放本进程打开过的所有会话（模块退出时调） */
export function 释放全部会话(): number {
  let n = 0;
  for (const 目录 of [...活会话]) {
    try {
      rmSync(目录, { recursive: true, force: true });
      n++;
    } catch {
      // 同上，交给兜底
    }
  }
  活会话.clear();
  return n;
}

/**
 * 删掉太旧的会话目录。
 *
 * 为什么必须有：正常路径是「前端 release → 删目录」，但模块被强杀、
 * 浏览器崩溃、机器断电时这条路径不会走。没有兜底的话 `%TEMP%` 会一直
 * 攒 `kugua-image-*` 目录，用户永远不会去清。
 *
 * 判定用目录的**修改时间**而不是创建时间：长时间编辑的页面会不断写新结果图，
 * mtime 一直在更新，不会被误删。
 */
export function 清掉过旧会话(现在 = Date.now()): number {
  let 删了 = 0;
  let 名们: string[];
  try {
    名们 = readdirSync(tmpdir());
  } catch {
    return 0;
  }
  for (const 名 of 名们) {
    if (!名.startsWith(前缀)) continue;
    const id = 名.slice(前缀.length);
    if (!会话合法(id)) continue;
    const 目录 = join(tmpdir(), 名);
    try {
      const st = statSync(目录);
      if (!st.isDirectory()) continue;
      if (现在 - st.mtimeMs > 废弃时限) {
        rmSync(目录, { recursive: true, force: true });
        活会话.delete(目录);
        删了++;
      }
    } catch {
      // 单个目录读失败（权限/竞争）不影响其余
    }
  }
  return 删了;
}

/** 内省：当前进程打开的会话目录（测试用） */
export function 活会话列表(): string[] {
  return [...活会话];
}
