/**
 * 第四层：**界面页的可装卸性**。
 *
 * 模块可以通过 `界面: { title, entry }` 向主界面贡献一整个 iframe 页
 * （目前 `image` 和 `tts` 这么做了）。这一层测的是：**模块来去，界面不能塌**。
 *
 * ## 为什么单独测
 *
 * 界面页是「可装卸」最容易破的地方，因为它是跨进程的：
 * `webui` 通过 `nigane.registry.details` 问主控有哪些模块带 ui，
 * 再按 `/module-ui/<模块名>/...` 去磁盘上找文件。
 *
 * 这里有三处各自可能出错：
 * 1. 模块不在线 → `registry.details` 里没有它 → 页面列表该少一项
 * 2. 主控根本没起来 → 查询抛错 → `列出模块页面()` catch 成 `[]`
 * 3. 有页面但文件被删 → HTTP 该 404 而不是 500
 *
 * 前两条是「降级」而不是「崩溃」，第三条是「宁可 404 不能崩」。
 *
 * ## 关于「主界面本身」
 *
 * 澄清一下概念，免得后面看测试时误解：
 *
 * - **主界面是 `webui` 这个包**，不是模块。它本身不可拆卸，
 *   拆了就没有任何 UI 了——这与「26 个功能模块可装卸」不矛盾，
 *   因为 `webui` 提供的是**框架**（聊天框、配置页、日志页），
 *   而不是某项功能。
 * - **模块贡献的是页面**，挂在框架里。所以「无主界面模块」
 *   准确说是「没有任何模块贡献页面」——此时框架照常可用，
 *   只是「模块页」那一栏是空的。
 *
 * 这个区分很重要：如果哪天有人把「聊天框」也做成模块，
 * 那才会出现「无主界面模块时整个界面空白」。当前不是这样，
 * 下面的用例把这条边界钉死。
 */

import { afterAll, describe, expect, it } from "vitest";
import { existsSync, mkdtempSync, rmSync } from "node:fs";
import { join } from "node:path";
import { 起沙盒, 等到, 模块入口, 仓库根, 主控脚本 } from "./isolation-sandbox.js";
import { 取测试端口, 端口段 } from "./port-pool.js";

const 有image = 模块入口("image") !== null;
const 有tts = 模块入口("tts") !== null;
const WebUI脚本 = join(仓库根, "packages", "webui", "dist", "server.js");
const 已构建 = existsSync(主控脚本) && existsSync(WebUI脚本);

describe.skipIf(!有image)("界面页：模块来去，页面列表跟着变", () => {
  it("只有 image 时页面列表里有 image 一项", async () => {
    const 端口 = await 取测试端口(端口段.隔离);
    const 沙盒 = await 起沙盒({ 模块: ["image"], 端口 });
    try {
      expect(await 等到(async () => (await 沙盒.在线模块()).includes("image"))).toBe(true);
      const 页 = await 沙盒.模块页();
      expect(页.map((p) => p.name)).toContain("image");
      const 图片页 = 页.find((p) => p.name === "image");
      expect(图片页?.title).toBe("图片编辑");
      expect(图片页?.entry).toBe("ui/index.html");
    } finally {
      await 沙盒.关停();
    }
  }, 60000);

  it("没有 image 时页面列表里没有它，且不报错", async () => {
    const 端口 = await 取测试端口(端口段.隔离);
    const 沙盒 = await 起沙盒({ 模块: [], 端口 });
    try {
      expect(await 沙盒.在线模块()).toEqual([]);
      expect(await 沙盒.模块页()).toEqual([]);
    } finally {
      await 沙盒.关停();
    }
  }, 60000);

  it("卸掉 image 后它的页面从列表消失", async () => {
    const 端口 = await 取测试端口(端口段.隔离);
    const 沙盒 = await 起沙盒({ 模块: ["image"], 端口 });
    try {
      expect(await 等到(async () => (await 沙盒.在线模块()).includes("image"))).toBe(true);
      expect((await 沙盒.模块页()).map((p) => p.name)).toContain("image");

      // 能力表是 Record<模块名, 能力[]>，不是平铺的数组
      const 卸前能力 = (await 沙盒.能力表())["image"] ?? [];
      expect(卸前能力.length, "image 没声明任何能力，这条测试就没意义").toBeGreaterThan(0);

      // 把 image 从配置里摘掉
      await 沙盒.装载([]);

      const 消失 = await 等到(async () => !(await 沙盒.模块页()).some((p) => p.name === "image"), 30);
      expect(消失, `卸掉 image 后页面还在：\n${沙盒.输出()}`).toBe(true);

      // 页面没了还不够——能力也得真的没了。
      // 只查页面会漏掉一种坏情况：模块进程还在跑、能力还在，
      // 只是详情里 ui 字段没了（比如配置改了但进程没退）。
      //
      // 注：这条是**冒烟**而非守门人。卸载路径是「改配置 → reload →
      // 停止模块」，停止模块直接 kill 子进程，几乎不可能「kill 了还活着」。
      // 真正容易错的是上层（页面列表、描述表），那些在上面查页面时已经拦了。
      // 留着这条是为了万一哪天改成「懒卸载」时有人被叫醒。
      const 卸后能力 = await 沙盒.能力表();
      expect(卸后能力["image"], "image 卸载后还挂在模块列表里").toBeUndefined();
    } finally {
      await 沙盒.关停();
    }
  }, 90000);
});

describe.skipIf(!有image || !有tts)("界面页：多个模块各自独立", () => {
  it("image + tts 都有页面；卸掉 image 后 tts 的页面还在", async () => {
    const 端口 = await 取测试端口(端口段.隔离);
    const 沙盒 = await 起沙盒({ 模块: ["image", "tts"], 端口 });
    try {
      expect(await 等到(async () => (await 沙盒.在线模块()).length === 2)).toBe(true);

      const 齐 = (await 沙盒.模块页()).map((p) => p.name).sort();
      expect(齐).toEqual(["image", "tts"]);

      await 沙盒.装载(["tts"]);

      const 剩下 = await 等到(async () => {
        const 名们 = (await 沙盒.模块页()).map((p) => p.name);
        return 名们.includes("tts") && !名们.includes("image");
      }, 30);
      expect(剩下, `卸掉 image 影响了 tts 的页面：\n${沙盒.输出()}`).toBe(true);
    } finally {
      await 沙盒.关停();
    }
  }, 90000);
});

describe.skipIf(!已构建)("界面页：WebUI 在模块缺失时的降级", () => {
  const 临时目录 = mkdtempSync(join(仓库根, ".tmp-界面-"));
  afterAll(() => {
    rmSync(临时目录, { recursive: true, force: true });
  });

  /** 起一个带 WebUI 的完整实例 */
  async function 起WebUI(模块们: string[], 端口: number, webui端口: number) {
    const { spawn } = await import("node:child_process");
    const { writeFileSync, mkdirSync } = await import("node:fs");
    const 数据目录 = join(临时目录, `data-${webui端口}`);
    mkdirSync(数据目录, { recursive: true });
    const 配置 = join(临时目录, `cfg-${webui端口}.json`);
    writeFileSync(
      配置,
      JSON.stringify({
        host: "127.0.0.1",
        port: 端口,
        token: "",
        webui: { port: webui端口, open: false, tray: false },
        modules: 模块们.map((名) => ({
          name: 名,
          type: "process",
          entry: 模块入口(名),
          autoStart: true,
        })),
      }),
    );
    const 进程 = spawn(process.execPath, [WebUI脚本, "--no-open", "--port", String(webui端口)], {
      cwd: 仓库根,
      env: {
        ...process.env,
        KUGUA_CONFIG: 配置,
        KUGUA_CONFIG_LOCAL: join(临时目录, `local-${webui端口}.json`),
        KUGUA_DATA_DIR: 数据目录,
        KUGUA_GLOBAL_LOCK: join(临时目录, `lock-${webui端口}`),
      },
      stdio: ["ignore", "pipe", "pipe"],
      windowsHide: true,
    });
    let 文本 = "";
    进程.stdout?.on("data", (d: Buffer) => (文本 += d.toString()));
    进程.stderr?.on("data", (d: Buffer) => (文本 += d.toString()));
    return { 进程, 输出: () => 文本, webui端口 };
  }

  it("零模块时 WebUI 的模块页接口返回空数组，界面本身正常", async () => {
    const 端口 = await 取测试端口(端口段.隔离);
    const webui端口 = await 取测试端口(端口段.隔离);
    const w = await 起WebUI([], 端口, webui端口);
    try {
      const 就绪 = await 等到(async () => {
        try {
          return (await fetch(`http://127.0.0.1:${webui端口}/api/status`)).status === 200;
        } catch {
          return false;
        }
      }, 40);

      // 界面框架本身（/api/status）必须可用——这是「主界面不是模块」的证据
      expect(就绪, `零模块时 WebUI 没起来：\n${w.输出()}`).toBe(true);

      const 页 = await (await fetch(`http://127.0.0.1:${webui端口}/api/module-pages`)).json();
      expect(Array.isArray(页)).toBe(true);
      expect(页).toEqual([]);

      // 首页 HTML 也要能拿到
      const 首页 = await fetch(`http://127.0.0.1:${webui端口}/`);
      expect(首页.status).toBe(200);
    } finally {
      进程关(w.进程);
      await new Promise((r) => setTimeout(r, 2000));
    }
  }, 120000);

  it("模块页面文件不存在时 404，不是 500", async () => {
    // 「宁可 404 不能崩」
    const 端口 = await 取测试端口(端口段.隔离);
    const webui端口 = await 取测试端口(端口段.隔离);
    const w = await 起WebUI([], 端口, webui端口);
    try {
      const 就绪 = await 等到(async () => {
        try {
          return (await fetch(`http://127.0.0.1:${webui端口}/api/status`)).status === 200;
        } catch {
          return false;
        }
      }, 40);
      expect(就绪).toBe(true);

      const r = await fetch(`http://127.0.0.1:${webui端口}/module-ui/不存在的模块/index.html`);
      expect(r.status).toBe(404);

      // 目录穿越也不行
      const t = await fetch(`http://127.0.0.1:${webui端口}/module-ui/image/../../package.json`);
      expect([403, 404]).toContain(t.status);
    } finally {
      进程关(w.进程);
      await new Promise((r) => setTimeout(r, 2000));
    }
  }, 120000);
});

function 进程关(p: import("node:child_process").ChildProcess) {
  try {
    p.kill("SIGINT");
  } catch {
    /* ignore */
  }
  setTimeout(() => {
    try {
      p.kill("SIGKILL");
    } catch {
      /* ignore */
    }
  }, 1500);
}
