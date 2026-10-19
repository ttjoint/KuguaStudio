/**
 * 测试用端口分配。
 *
 * ## 为什么不用「listen(0) 拿系统分配的端口再关掉」
 *
 * 三个会真起平台的测试文件原来都是这么做的：绑 0 端口、读回端口号、
 * `close()`、再把端口交给子进程去监听。这中间有两个洞：
 *
 * 1. **竞态**：`close()` 之后到子进程真正 listen 之间，端口随时可能被
 *    系统里别的进程抢走（本机开着浏览器、代理、IDE 都可能）。
 * 2. **Windows 保留段**：绑 0 时系统从动态段（49152–65535）分配，而
 *    Hyper-V / WinNAT / Docker 会保留其中若干段。落进保留段会得到
 *    `EACCES`——不是「端口被占」，是「根本不让绑」。
 *
 * 全量跑时这两个洞都会踩到：曾在 `platform-lifecycle` 上见到
 * `listen EACCES: permission denied`，单跑必过、全量偶发。
 *
 * ## 做法
 *
 * 每个测试文件用**自己的固定端口段**（由调用方传基数），段内顺序探测：
 * 绑得上就返回、绑不上就试下一个。段之间拉开距离，避免文件间撞车；
 * 也避开 24600/24601（用户实例）和动态段。
 *
 * 代价是极端情况下可能全段被占（那时会抛错，而不是给个坏端口）。
 * 三四十个端口对测试场景足够。
 */

import { createServer } from "node:net";

/** 某个端口现在能不能绑（能绑立刻释放，仍有一瞬间的竞态，故只用于跳过明显不可用的段） */
function 可绑(端口: number): Promise<boolean> {
  return new Promise((res) => {
    const s = createServer();
    let 结束 = false;
    const 收尾 = (值: boolean) => {
      if (结束) return;
      结束 = true;
      s.close(() => res(值));
    };
    s.once("error", () => 收尾(false));
    s.listen(端口, "127.0.0.1", () => 收尾(true));
  });
}

/**
 * 每个段已经发到哪个位置。
 *
 * **段内必须递增分配**：同一文件里「主控 + WebUI」要两个不同端口，
 * 若每次都从基数开始扫，两次调用都会返回基数同一个值，子进程抢同一个
 * 端口——表现为主控或 WebUI 启动超时，看着像代码坏了。
 */
const 段游标 = new Map<number, number>();

/**
 * 在 `[基数, 基数+跨度)` 内找一个当前能绑的端口。
 *
 * 同一基数多次调用会**依次往后退**，不会返回同一个端口。
 *
 * @param 基数 该测试文件专用端口段的起点，各文件必须不同
 * @param 跨度 段大小，默认 40
 */
export async function 取测试端口(基数: number, 跨度 = 40): Promise<number> {
  const 起 = 段游标.get(基数) ?? 0;
  for (let i = 起; i < 跨度; i++) {
    const 端口 = 基数 + i;
    if (await 可绑(端口)) {
      段游标.set(基数, i + 1);
      return 端口;
    }
  }
  // 段落用完了，从头再找一遍（前面的端口可能已经释放）
  if (起 > 0) {
    for (let i = 0; i < 起; i++) {
      const 端口 = 基数 + i;
      if (await 可绑(端口)) {
        段游标.set(基数, i + 1);
        return 端口;
      }
    }
  }
  throw new Error(`端口段 ${基数}–${基数 + 跨度 - 1} 全被占用，请更换基数`);
}

/**
 * 从某段连续取 n 个端口。
 *
 * 主控和 WebUI 必须用**不同**端口，一把取齐比反复调用更不容易撞。
 */
export async function 取测试端口组(基数: number, 个数: number, 跨度 = 40): Promise<number[]> {
  const 结果: number[] = [];
  for (let i = 0; i < 跨度 && 结果.length < 个数; i++) {
    const 端口 = 基数 + i;
    if (await 可绑(端口)) 结果.push(端口);
  }
  if (结果.length < 个数) {
    throw new Error(`端口段 ${基数}–${基数 + 跨度 - 1} 不足 ${个数} 个可用端口`);
  }
  return 结果;
}

/**
 * 各测试文件专用的端口段基数。
 *
 * 分散在 26000–28999，与用户实例（24600/24601）、动态段（49152+）都拉开。
 * 新增测试文件时在这里登记一个新基数，不要复用。
 */
export const 端口段 = {
  /** packages/webui/test/bad-request.test.ts */
  畸形请求: 26000,
  /** packages/webui/test/platform-lifecycle.test.ts */
  平台生命周期: 26200,
  /** packages/webui/test/startup-robustness.test.ts */
  启动健壮性: 26400,
} as const;
