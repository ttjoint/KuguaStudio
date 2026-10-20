/**
 * 作业（Job）类型定义。
 * 详见 docs/架构设计.md 第五节。
 */

export type 作业状态 = "queued" | "running" | "done" | "failed" | "cancelled" | "timeout";

/**
 * 作业与「谁发起的」的关系。
 *
 * 插件/模块发起作业时没有会话，跑完不知道找谁；用户从 GUI/聊天里
 * 发起的作业跑完了又想收到通知。两边诉求正好相反，所以必须显式记。
 */
export type 作业来源 = "user" | "module" | "plugin" | "scheduler";

export interface 作业记录 {
  id: string;
  /** 人类可读标题 */
  标题: string;
  /** 可执行命令 */
  命令: string;
  /** 命令参数 */
  参数: string[];
  /** 工作目录 */
  工作目录: string;
  /** 是否经 shell 执行 */
  shell: boolean;
  /** 状态 */
  状态: 作业状态;
  /** 退出码 */
  退出码: number | null;
  /** 启动时间（毫秒） */
  启动时间: number;
  /** 结束时间（毫秒） */
  结束时间: number | null;
  /** 耗时（毫秒） */
  耗时毫秒: number | null;
  /** 日志文件路径 */
  日志文件: string;
  /** 错误说明 */
  错误: string | null;
  /** 标题里是否已有「（N 项）」，避免续跑时越挂越长 */
  标题已加计数?: boolean;
  /** 发起者：模块名 / 插件名 / scheduler / system */
  发起者: string;
  /** 来源种类 */
  来源: 作业来源;
  /**
   * 本次是第几次尝试，从 1 开始。
   *
   * 断点续跑靠它区分「第一次跑」和「中断后接着跑」——批处理可以用它
   * 决定「进度文件里有记录就跳过已完成的」，也可以只打日志。
   */
  尝试次数: number;
  /**
   * 进度文件路径约定（批处理自己读写，job 只负责给出稳定路径）。
   *
   * 为什么由 job 定路径：批处理换个地方存进度就续不上了，
   * 而「作业 id → 进度文件」的映射只有 job 知道。
   */
  进度文件: string;
  /**
   * `能力名`（仅「能力作业」有）。
   *
   * 指向一个 `长任务: true` 或带 `超时毫秒` 参数的能力，实际命令在启动时
   * 解析成 `命令`/`参数`——这样 GUI 里的「作业」页和外部调用者看到的是
   * 同一条记录，不用维护两套。
   */
  能力名: string | null;
  /** 解析前的原始参数（能力作业重跑/续跑要用） */
  能力参数: unknown;
}

export interface 日志行 {
  时间: number;
  流: "stdout" | "stderr" | "system";
  行: string;
}

export interface 启动作业参数 {
  /** 直接给命令（`命令` 与 `能力名` 二选一） */
  命令?: string;
  参数?: string[];
  工作目录?: string;
  环境?: Record<string, string>;
  shell?: boolean;
  超时毫秒?: number;
  标题?: string;
  /** 能力作业：把一次能力调用转成作业执行（见 index.ts 的 解析能力命令） */
  能力名?: string;
  能力参数?: unknown;
  发起者?: string;
  来源?: 作业来源;
}

/** 能力作业的命令解析结果 */
export interface 能力命令 {
  命令: string;
  参数: string[];
  shell: boolean;
  能力参数: unknown;
}

/** 启动作业返回值 */
export interface 启动作业结果 {
  记录: 作业记录;
  /** `续跑: true` 但上次那条还在跑时，先取消也没用——这里如实告诉调用方 */
  已清理旧进程: boolean;
}
