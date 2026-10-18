/**
 * 小组件推送限流
 *
 * 独立成模块而不是留在 server.ts 里，是为了能被单测直接覆盖——
 * 限流写错不会报错，只会表现为「有时候数据不更新」，最难查的那种。
 */

/**
 * 固定窗口计数器。
 *
 * 选固定窗口而不是滑动窗口：实现简单、内存恒定，而在 20 次/秒这个量级
 * 上，窗口边界处最多放过 2 倍突发——对界面刷新毫无影响。
 */
export class 推送限流 {
  private 表 = new Map<string, { 计数: number; 窗口: number }>();

  /**
   * @param 上限 每个来源每秒最多允许多少次
   * @param 取窗口 时间源（测试可注入，默认按秒取整）
   */
  constructor(
    private readonly 上限: number,
    private readonly 取窗口: (现在: number) => number = (现在) => Math.floor(现在 / 1000),
  ) {}

  /** 是否有配额通过本次推送 */
  通过(来源: string, 现在: number = Date.now()): boolean {
    const 窗口 = this.取窗口(现在);
    const 记 = this.表.get(来源);
    if (!记 || 记.窗口 !== 窗口) {
      this.表.set(来源, { 计数: 1, 窗口 });
      return true;
    }
    记.计数 += 1;
    return 记.计数 <= this.上限;
  }

  /** 清空某个来源的计数（来源下线时回收内存） */
  重置(来源?: string): void {
    if (来源 === undefined) this.表.clear();
    else this.表.delete(来源);
  }
}
