/**
 * 作业（Job）类型定义。
 * 详见 docs/架构设计.md 第五节。
 */

export type 作业状态 = "running" | "done" | "failed" | "cancelled" | "timeout";

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
}

export interface 日志行 {
  时间: number;
  流: "stdout" | "stderr" | "system";
  行: string;
}

export interface 启动作业参数 {
  命令: string;
  参数?: string[];
  工作目录?: string;
  环境?: Record<string, string>;
  shell?: boolean;
  超时毫秒?: number;
  标题?: string;
}
