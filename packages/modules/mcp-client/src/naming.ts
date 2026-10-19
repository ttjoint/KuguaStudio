/**
 * mcp-client 的前缀规范化。
 *
 * ## 为什么这个函数值得单独测
 *
 * 前缀会拼进**能力名**（`前缀.工具名`），而能力名是主控的全局键：
 *
 * - 带非法字符 → 能力名不合法，注册可能失败或前端路由打不到
 * - 带点号 → `a.b.c` 会被当成三层，路由解析歧义
 * - 空串 → 能力名变成 `.tool`，开头是点
 *
 * 这些在「接入成功」的日志里看不出来（日志只打数量和前缀），
 * 只有真去调那个能力才发现打不通。所以要单独钉住。
 *
 * 注意：点号 `.` 是**允许**的（见正则里的 `_.-`），因为
 * `前缀.工具名` 本身就要用点分隔——允许点号意味着前缀可以自带层级，
 * 比如 `my.company`。这是有意的设计，不是漏写。
 */

export interface 清单原文 {
  name?: string;
  command?: string;
  entry?: string;
  args?: string[];
  env?: Record<string, string>;
  prefix?: string;
  timeoutMs?: number;
}

export interface 外部服务配置 {
  name: string;
  command: string;
  args?: string[];
  env?: Record<string, string>;
  cwd?: string;
  prefix?: string;
  timeoutMs?: number;
}

/**
 * 规范化前缀：去掉空白、非法字符换成下划线。
 *
 * 空串 / 全空白时用 `回退`；`回退` 本身也被规范化；
 * 规范化后仍为空则原样返回 `回退`（不再递归，避免 `回退` 也是空串时死循环）。
 */
export function 规范前缀(前缀: string, 回退: string): string {
  const p = (前缀 || 回退).trim().replace(/[^a-zA-Z0-9_.-]/g, "_");
  return p || 回退;
}

/**
 * 把一份 `kugua-module.json` 清单转成服务配置。
 *
 * 返回 `null` 表示这份清单不可用——调用方据此跳过并打日志。
 * 判定「不可用」的条件：没有 `name`，或既没有 `command` 也没有 `entry`。
 *
 * `cwd` 固定指向清单所在目录，这样脚本里的相对路径都以自己为基准，
 * 不依赖平台的工作目录。
 */
export function 清单转配置(
  原文: unknown,
  目录: string,
): 外部服务配置 | null {
  const m = (原文 ?? {}) as 清单原文;
  // 老清单用 entry，新的用 command，两个都认
  const command = m.command ?? m.entry;
  if (!m.name || !command) return null;
  return {
    name: m.name,
    command,
    // args 必须是数组；给了个字符串之类的一律当没有
    args: Array.isArray(m.args) ? m.args : [],
    env: m.env,
    cwd: 目录,
    // prefix 没写就用 name——这就是「前缀默认等于服务名」的出处
    prefix: m.prefix ?? m.name,
    timeoutMs: m.timeoutMs,
  };
}

/**
 * 拼出能力名（也是动作名）。
 *
 * 单独抽出来是因为这个格式两边都要用（注册时拼、调用时查），
 * 两处各写一遍的话，改一处忘一处就会出现「注册了但调不到」。
 */
export function 能力名(前缀: string, 工具名: string): string {
  return `${前缀}.${工具名}`;
}
