/**
 * 进程级兜底：插件跑在主控进程内（这是刻意的设计选择——常用功能不值得
 * 每次 IPC 往返，生命周期也由平台完全掌控），代价是**插件的错误就是平台的错误**。
 *
 * 插件作者写的是普通 JS：`setTimeout` 里抛错、事件回调里 `throw`、
 * 忘了 `catch` 的 Promise——这些都不在平台的 try/catch 范围内。
 * 没有兜底的话，一个插件的小失误会让整个 Studio 直接消失，
 * 而用户看到的只是「窗口突然没了」，连报错都看不到。
 *
 * 所以这里兜两层：
 *   1. uncaughtException   同步异常逃逸到事件循环根部
 *   2. unhandledRejection  没人接的 Promise rejection
 *
 * 注意：兜底不等于可以继续运行。Node 在 uncaughtException 之后的
 * 状态是不可信的（可能留下半完成的操作），但相比「静默消失」，
 * 记录清楚再继续是更好的选择——插件是聊天回复这类**尽力而为**的功能，
 * 一次命令失败远没有整个平台崩掉严重。
 */

export interface 兜底选项 {
  /** 写日志（使用平台统一的日志器） */
  记录: (级别: "错误" | "警告", 消息: string) => void;
  /** 同一个错误短时间内重复出现时只记一次，避免刷屏拖垮日志 */
  去重窗口毫秒?: number;
}

let 已安装 = false;

/**
 * 安装进程级兜底（幂等，重复调用无副作用）。
 *
 * 不使用 `process.exit()`：崩溃恢复后继续服务，比直接退出对用户更友好。
 */
export function 安装进程兜底(选项: 兜底选项): void {
  if (已安装) return;
  已安装 = true;

  const 窗口 = 选项.去重窗口毫秒 ?? 5000;
  const 最近 = new Map<string, number>();

  const 应当记录 = (签名: string): boolean => {
    const 现在 = Date.now();
    const 上次 = 最近.get(签名);
    if (上次 !== undefined && 现在 - 上次 < 窗口) return false;
    最近.set(签名, 现在);
    // 简单的容量保护：太多不同的错误签名时清空，避免长期增长
    if (最近.size > 200) 最近.clear();
    return true;
  };

  process.on("uncaughtException", (err) => {
    const 文本 = err instanceof Error ? err.stack ?? err.message : String(err);
    const 签名 = `同步:${err instanceof Error ? err.message : String(err)}`;
    if (应当记录(签名)) {
      选项.记录("错误", `未捕获异常（插件/模块代码可能有问题）：${文本}`);
    }
  });

  process.on("unhandledRejection", (原因) => {
    const 文本 =
      原因 instanceof Error ? 原因.stack ?? 原因.message : String(原因);
    const 签名 = `异步:${原因 instanceof Error ? 原因.message : String(原因)}`;
    if (应当记录(签名)) {
      选项.记录("错误", `未处理的 Promise 拒绝（插件/模块代码可能有问题）：${文本}`);
    }
  });
}

/** 测试用：重置安装状态 */
export function 重置兜底(): void {
  已安装 = false;
}
