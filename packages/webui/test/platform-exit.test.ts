import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";

/**
 * 「平台主动退出」通知的协议契约测试。
 *
 * 背景：桌面端靠端口探测判断后端死没死，那个路径要等满十来秒。用户点
 * 「退出平台」后会看到窗口先失联、再卡住，体验很糟。现在后端在退出前
 * 通过 WebSocket 主动推一条 `platform_exit`，前端据此立刻收工。
 *
 * 这里不启真进程（那需要拉起整个 WebUI），而是守住**两端的关键字面量一致**：
 * 一旦有人改了消息类型名或 reason 取值而没同步另一边，测试就会失败。
 * 这类"两头对不上、但各自都能编译通过"的 bug，只能靠契约测试拦。
 */

const 服务端 = readFileSync(resolve(__dirname, "..", "src", "server.ts"), "utf8");
const 前端 = readFileSync(resolve(__dirname, "..", "src", "renderer", "kugua-shim.ts"), "utf8");

describe("平台退出通知", () => {
  it("服务端广播的消息类型与前端监听的一致", () => {
    expect(服务端).toContain('type: "platform_exit"');
    expect(前端).toContain('消息.type === "platform_exit"');
  });

  it("服务端在关闭与重启两条路径上都会广播", () => {
    // 关闭：必须广播 shutdown（桌面端据此关窗）
    expect(服务端).toMatch(/广播平台退出\("shutdown"\)/);
    // 重启：必须广播 restart（桌面端据此**不**关窗）
    expect(服务端).toMatch(/广播平台退出\("restart"\)/);
  });

  it("前端按 reason 区分关窗与只提示", () => {
    // restart → 不关窗
    expect(前端).toMatch(/reason === "restart"/);
    // shutdown 分支里必须调用关窗
    const 关闭段 = 前端.slice(前端.indexOf('消息.type === "platform_exit"'));
    expect(关闭段.slice(0, 1600)).toContain("关闭桌面窗口()");
  });

  it("主动退出后不再重连（否则会一直傻等）", () => {
    expect(前端).toContain("if (平台已退出) return;");
  });

  it("关窗走 quit_app 而不是 window.close()", () => {
    // WebView2 里 window.close() 对非脚本打开的窗口会被静默忽略
    const 函数段 = 前端.slice(前端.indexOf("function 关闭桌面窗口"));
    expect(函数段.slice(0, 900)).toContain('invoke("quit_app")');
    expect(函数段.slice(0, 900)).not.toContain("window.close()");
  });

  it("浏览器环境不做关窗动作", () => {
    const 函数段 = 前端.slice(前端.indexOf("function 关闭桌面窗口"));
    expect(函数段.slice(0, 900)).toContain("if (!全局?.core?.invoke) return;");
  });
});
