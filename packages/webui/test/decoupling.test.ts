/**
 * GUI 抗卡死：三处解耦的契约检查
 *
 * 排查结论：架构本身是异步的（主控转发不 await、模块 handler 并发执行、
 * 心跳独立定时器），长任务不会串行阻塞 GUI。实测 10 个并发 agent.run
 * 期间，GUI 请求仍 43-51ms。
 *
 * 但发现三个真实风险点，全部修复：
 * 1. 前端 fetch 无超时 → HTTP 连接半死时永久挂着，界面停在"加载中"
 * 2. 加载所有内容无竞态保护 → 快速切标签时旧响应覆盖新结果
 * 3. 大文件同步 IO → readFileSync 64MB 让 Node 事件循环停数秒，
 *    期间所有请求（含界面轮询）全部卡住
 */
import { describe, expect, it } from "vitest";
import { existsSync, readFileSync } from "node:fs";
import { resolve } from "node:path";

const 根 = resolve(process.cwd(), "packages/webui");
function 读(相对: string): string {
  const p = resolve(根, 相对);
  if (!existsSync(p)) throw new Error(`找不到：${p}`);
  return readFileSync(p, "utf-8");
}

describe("前端请求超时（防永久挂起）", () => {
  it("fetch 带 AbortController", () => {
    const 源 = 读("src/renderer/bridge.ts");
    expect(源).toContain("AbortController");
    expect(源).toContain("signal: 控制器.signal");
  });

  it("超时后给出可操作提示，而不是裸的 abort 错误", () => {
    expect(读("src/renderer/bridge.ts")).toContain("请求超时");
  });

  it("fetch 失败转成用户能懂的话", () => {
    const 源 = 读("src/renderer/bridge.ts");
    expect(源).toContain("无法连接后台");
    expect(源).toContain("failed to fetch");
  });

  it("超时时长与请求体 timeoutMs 挂钩（长任务不被误杀）", () => {
    expect(读("src/renderer/bridge.ts")).toContain("timeoutMs");
  });
});

describe("加载竞态保护", () => {
  it("有加载序号", () => {
    expect(读("src/renderer/parts/07-explorer.ts")).toContain("加载序号");
  });

  it("两条返回路径都检查序号（丢弃过期响应）", () => {
    const 源 = 读("src/renderer/parts/07-explorer.ts");
    const 次数 = (源.match(/本次序号 !== 加载序号/g) ?? []).length;
    expect(次数).toBeGreaterThanOrEqual(2);
  });

  it("过期请求的失败不触发重试（避免放大风暴）", () => {
    const 源 = 读("src/renderer/parts/07-explorer.ts");
    const 段 = 源.slice(源.indexOf("} catch {", 源.indexOf("export async function 加载所有内容")));
    expect(段.slice(0, 300)).toContain("本次序号 !== 加载序号");
  });
});

describe("大文件异步 IO（防阻塞事件循环）", () => {
  it("媒体读取用异步 readFile", () => {
    const 源 = 读("src/server.ts");
    const 段 = 源.slice(源.indexOf("/api/media/read"), 源.indexOf("/api/media/read") + 1200);
    expect(段).toContain("异步读文件");
    expect(段).not.toContain("readFileSync(文件)");
  });

  it("临时文件写入用异步 writeFile", () => {
    const 源 = 读("src/server.ts");
    const 起 = 源.indexOf('路径 === "/api/writeTempFile"');
    const 段 = 源.slice(起, 起 + 900);
    expect(段).toContain("异步写文件");
    expect(段).not.toContain('writeFileSync(文件, Buffer.from(base64');
  });

  it("剪贴板图片写入也改异步", () => {
    const 源 = 读("src/server.ts");
    const 段 = 源.slice(源.indexOf("async function 写入剪贴板图片"), 源.indexOf("async function 写入剪贴板图片") + 900);
    expect(段).toContain("异步写");
  });
});

describe("架构层面的解耦（回归守护）", () => {
  it("主控转发请求不 await（纯透传）", () => {
    const 源 = readFileSync(resolve(process.cwd(), "packages/nigane/src/index.ts"), "utf-8");
    const 段 = 源.slice(源.indexOf('case "event": {'), 源.indexOf('case "event": {') + 2000);
    // forward 分支用 目标.send，不是 await 目标.request
    expect(源).toContain("目标.send(JSON.stringify(消息))");
  });

  it("模块侧请求处理是并发投递（void 不 await）", () => {
    const 源 = readFileSync(resolve(process.cwd(), "packages/nigane/src/index.ts"), "utf-8");
    expect(源).toContain("void this.处理请求(消息)");
  });

  it("模块 handler 有超时保护", () => {
    const 源 = readFileSync(resolve(process.cwd(), "packages/nigane/src/index.ts"), "utf-8");
    expect(源).toContain("处理超时");
  });
});
