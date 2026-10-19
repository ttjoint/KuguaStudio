/**
 * netspeed —— 实时网络速率（Windows）
 *
 * ## 为什么清单里没有 widgets
 *
 * 两个组件是 `on_load` 里发现「确实启用了」之后**运行时补声明**的，
 * 不是写在清单的 `widgets` 里。
 *
 * 踩过这个坑：清单声明是**静态的**，平台不管插件有没有启用都会注册，
 * 于是默认关闭的 netspeed 照样在主界面留下两个永远显示 `—` 的卡片——
 * 正好就是设计稿反复强调要避免的「永远无数据的卡片」。
 * 清单里只写「这插件能提供什么」是不够的，得按「现在能不能提供」决定。
 *
 * ## 为什么默认关闭
 *
 * 这个插件比 sysmon 贵得多。实测（Windows 11 / PowerShell 5.1）：
 *
 * | 方式 | 首轮 | 之后每轮 |
 * |---|---|---|
 * | 每次起新进程（`Get-NetAdapterStatistics`） | ~1.4 秒 | ~1.4 秒 |
 * | **常驻进程 + 脚本内部循环** | ~1.4 秒（仅启动一次） | **~0.9 秒** |
 *
 * 1.4 秒里绝大部分是 PowerShell 自身启动，真正取数只要几十毫秒。
 * 所以这里**常驻一个 PowerShell 子进程**，由它自己循环输出，
 * 主进程只管解析——每秒一次的监控才可能成立。
 *
 * 代价是多一个约 60-80MB 的常驻进程，因此默认 `enabled: false`：
 * 不开启时**不声明组件、不起子进程**，用户看不到任何多余的东西。
 *
 * ## 为什么要排除虚拟网卡
 *
 * 本机同时有 WLAN（物理）和 Mihomo（Meta Tunnel，代理虚拟网卡），
 * 两者字节数相近——**代理的流量本身就走 WLAN**。全累加会把同一份流量
 * 算两遍，显示的速率直接翻倍。所以按网卡描述过滤掉
 * Virtual / Tunnel / Hyper-V / VMware 等，并按 InterfaceType 排除隧道（53）。
 * 用户确实想统计全部网卡时可以打开 `includeVirtual`。
 *
 * ## 关于「主动测速」
 *
 * 设计稿提到「测速（主动）与实时速率（被动）分开」。这里**只做被动**：
 * 主动测速要往公网传大量数据，属于另一个量级的资源消耗与隐私问题
 * （用户可能用的是按流量计费的网络），应该单独做、单独开关、明确告知。
 * 混在实时监控里会让用户莫名其妙被跑满带宽。
 *
 * ## 关于跨平台
 *
 * Linux 读 `/proc/net/dev`、macOS 用 `netstat -ib` 都能拿到字节计数。
 * 当前只实现 Windows——没在别的平台验证过的代码不如不写，
 * 在非 Windows 上直接不声明组件，让用户看到「不支持」而不是「坏了」。
 */
import { spawn } from "node:child_process";
import { BasePlugin, 定义插件 } from "@kugua/plugin-sdk";

const 默认间隔 = 1000;

/** 常驻 PowerShell 子进程 */
let 子进程 = null;
/** stdout 缓冲（数据可能被切在半个行中间） */
let 缓冲 = "";
/**
 * 按网卡名分开记基线。
 *
 * 原先是「所有网卡加总后记一个数」，这在两种情况下会给出错误数字：
 *
 *   拔掉一块网卡 → 总量骤降 → 差值是负数 → 这一轮被丢弃（看起来像卡住）
 *   插上一块网卡 → 它历史上的累计字节一次性算进来 → 速率瞬间冲高到离谱
 *
 * 分开记就都没有了：新网卡第一次出现只记基线不出数，
 * 拔掉的网卡在 END 时顺手清掉，不会残留。
 */
let 基线表 = new Map();
/** 本轮收到的分项：名字 → { 收, 发 } */
let 本轮 = new Map();
/** 本轮的时间戳（取自 PowerShell 侧，避免管道延迟把分母拉偏） */
let 本轮时刻 = 0;
/** 上一次推送的整数值，避免每轮都推一模一样的数 */
let 上次下行 = null;
let 上次上行 = null;

/**
 * 生成给 PowerShell 的采样脚本。
 *
 * `includeVirtual` 决定过滤条件，所以脚本要按配置重新生成——
 * 这也是为什么改这两项必须重启模块（脚本是启动时一次性传给子进程的）。
 */
function 造脚本(选项) {
  const 过滤 = 选项.包含虚拟
    ? "Get-NetAdapter | Where-Object { $_.Status -eq 'Up' }"
    : [
        "Get-NetAdapter | Where-Object {",
        "  $_.Status -eq 'Up' -and",
        "  $_.InterfaceType -ne 53 -and",
        "  $_.InterfaceDescription -notmatch 'Virtual|Tunnel|Hyper-V|VMware|Loopback|Pseudo|Bluetooth|WAN Miniport'",
        "}",
      ].join("\n");

  return [
    // 不打进度流：否则 CLIXML 会混进 stdout，解析全乱
    "$ProgressPreference = 'SilentlyContinue'",
    "while ($true) {",
    // 每轮重新扫一遍网卡：拔插网线、开 Wi-Fi、禁用网卡都会改变集合。
    // 只在启动时扫一次的话，新插上的网卡永远不出现在统计里，
    // 拔掉的网卡留下一份永远不动的累计值——两者都会让速率算错。
    "  $物理 = @{}",
    `  ${过滤} | ForEach-Object { $物理[$_.Name] = $true }`,
    "  if ($物理.Count -eq 0) { Write-Output 'NONE' } else {",
    "    $t = [DateTimeOffset]::UtcNow.ToUnixTimeMilliseconds()",
    "    Get-NetAdapterStatistics | Where-Object { $物理.ContainsKey($_.Name) } | ForEach-Object {",
    // 一行一块网卡：`时刻|名字|收|发`。名字里可能有空格，所以放在第二段，
    // Node 侧按「第一个 |」和「最后两个 |」切，中间整段就是名字。
    "      Write-Output \"$t|$($_.Name)|$($_.ReceivedBytes)|$($_.SentBytes)\"",
    "    }",
    "  }",
    // 一轮结束标记：Node 侧靠它知道这一轮的数据齐了，可以算差分。
    "  Write-Output 'END'",
    `  Start-Sleep -Milliseconds ${选项.间隔}`,
    "}",
  ].join("\n");
}

/** 重置差分基线。导出供单测用——模块级状态在测试之间需要清干净。 */
export function 重置基线() {
  基线表 = new Map();
  本轮 = new Map();
  本轮时刻 = 0;
  上次下行 = null;
  上次上行 = null;
}

/**
 * 当前记着基线的网卡名。导出给单测用。
 *
 * 「拔掉的网卡要清掉」这条没法通过广播结果观察——拔掉的网卡本来就不进
 * 本轮计算，残留的基线不影响任何数字。但它会一直占内存，而且万一同名
 * 网卡重新插上会拿到过期基线（时间差是几小时，算出来的速率趋近 0）。
 * 所以需要一个能直接看到基线表的入口。
 */
export function 基线网卡名() {
  return [...基线表.keys()];
}

/** 停掉常驻进程。必须调用，否则插件卸载后 PowerShell 一直活着。 */
function 停子进程() {
  if (!子进程) return;
  try {
    子进程.kill();
  } catch {
    // 已经退出了，忽略
  }
  子进程 = null;
  缓冲 = "";
  基线表 = new Map();
  本轮 = new Map();
}

/** 启动常驻采样进程 */
function 起子进程(ctx, 选项) {
  停子进程();

  const 编码 = Buffer.from(造脚本(选项), "utf16le").toString("base64");
  子进程 = spawn("powershell", ["-NoProfile", "-NonInteractive", "-EncodedCommand", 编码], {
    // 所有 spawn 必须显式 windowsHide，否则每次采样闪一个黑框
    windowsHide: true,
    stdio: ["ignore", "pipe", "pipe"],
  });

  子进程.stdout.setEncoding("utf8");
  子进程.stdout.on("data", (块) => {
    缓冲 += 块;
    // 最后一段可能是不完整的行，留在缓冲里等下一次
    const 行们 = 缓冲.split(/\r?\n/);
    缓冲 = 行们.pop() ?? "";
    for (const 行 of 行们) 处理一行(ctx, 行);
  });

  子进程.stderr.on("data", (块) => {
    const 文 = String(块);
    // PowerShell 无 EncodedCommand 时会吐 CLIXML 进度流，那是噪声不是错误
    if (文.includes("CLIXML")) return;
    ctx.日志.警告(`采样进程报错：${文.trim().slice(0, 200)}`);
  });

  子进程.on("error", (err) => {
    子进程 = null;
    ctx.日志.错误(`无法启动采样进程：${String(err)}`);
  });

  子进程.on("exit", (码) => {
    // 主动 kill 时也会走这里，此时 子进程 已被置 null
    if (子进程 === null) return;
    子进程 = null;
    // 意外退出不自动重启：可能是策略组拦了 PowerShell，
    // 反复重启只会一直弹警告。用户改配置或重启模块再试。
    ctx.日志.警告(`采样进程退出（码 ${码}），网络速率组件停止更新`);
  });
}

/**
 * 处理一行输出。导出供单测：拔插网卡这类分支真机很难复现。
 *
 * 协议（与 `造脚本` 对应）：
 *   `时刻|名字|收|发`  一块网卡的分项
 *   `NONE`            本轮没有任何符合条件的网卡
 *   `END`             本轮结束，可以算差分了
 */
export function 处理一行(ctx, 行) {
  // 必须先剥 NUL 再 trim：PowerShell 过管道时常带 \u0000 填充，
  // Number("1024\u0000") 是 NaN——整行被静默丢弃，且没有任何报错。
  // 顺序不能反：\u0000 是 NUL 不是空白，trim() 不会去掉它。
  const 干净 = 行.replace(/\u0000/g, "").trim();
  if (!干净) return;

  if (干净 === "NONE") {
    // 可选链：单测里日志桩可能缺失，别让「没网卡」变成抛异常
    ctx.日志?.警告?.("没有找到物理网卡，网络速率组件不会有数据");
    本轮 = new Map();
    return;
  }

  if (干净 === "END") {
    结算本轮(ctx);
    // 必须清空：不清的话本轮会一直累积，拔掉的网卡永远留在里面，
    // 「本轮没出现就该清基线」这个判断也就永远不成立。
    本轮 = new Map();
    return;
  }

  // `时刻|名字|收|发`：名字里可能有空格和 `|` 以外的任意字符，
  // 所以按第一个 `|` 切开时间，再按最后两个 `|` 切开收/发，中间整段是名字。
  const 段 = 干净.split("|");
  if (段.length < 4) return;
  const 时刻 = Number(段[0]);
  const 收 = Number(段[段.length - 2]);
  const 发 = Number(段[段.length - 1]);
  // 网卡名理论上不该含 `|`，但真有的话中间段要拼回去，
  // 而不是当成字段错位静默丢掉整行。
  const 名字 = 段.slice(1, 段.length - 2).join("|");
  if (!Number.isFinite(时刻) || !Number.isFinite(收) || !Number.isFinite(发)) return;
  if (!名字) return;

  本轮时刻 = 时刻;
  本轮.set(名字, { 收, 发 });
}

/**
 * 一轮数据收齐后结算。
 *
 * 关键决定：**取各网卡里最快的那个，而不是加总**。
 *
 * 加总看着「更全面」，实际有两个问题：
 *   1. 有线 + Wi-Fi 同时 Up 时，同一份流量可能走两条路（尤其开了代理），
 *      加总直接翻倍——这正是当初要排除虚拟网卡的原因，加总等于把它绕回来
 *   2. 用户看「网络速率」想知道的是「现在网快不快」，不是「所有网卡加起来
 *      一共搬了多少字节」。后者在有闲置网卡时是个只增不减的误导数字
 *
 * 取最大值天然满足「不重复计数」：同一份流量无论如何只会在一条路上跑。
 */
function 结算本轮(ctx) {
  if (本轮.size === 0) return;

  // 拔掉的网卡：这轮没出现，基线要清掉。留着不会算错（下一轮不参与），
  // 但会一直占内存，且万一同名网卡重新插上会拿到过期基线。
  for (const 名字 of [...基线表.keys()]) {
    if (!本轮.has(名字)) 基线表.delete(名字);
  }

  let 最快收 = null;
  let 最快发 = null;

  for (const [名字, 当前] of 本轮) {
    const 旧 = 基线表.get(名字);
    // 第一次见到这块网卡：只记基线不出数。它的累计字节是历史总和，
    // 拿它当差分起点会算出天文数字。
    if (!旧) {
      基线表.set(名字, { 时刻: 本轮时刻, ...当前 });
      continue;
    }

    const 秒 = (本轮时刻 - 旧.时刻) / 1000;
    // 网卡重置 / 拔插会让计数器**回退**。丢这一轮重建基线，
    // 不记 0 也不记负数——记 0 会让曲线突然掉到底，误导成「断网了」。
    if (秒 <= 0 || 当前.收 < 旧.收 || 当前.发 < 旧.发) {
      基线表.set(名字, { 时刻: 本轮时刻, ...当前 });
      continue;
    }

    基线表.set(名字, { 时刻: 本轮时刻, ...当前 });

    const 收速率 = (当前.收 - 旧.收) / 秒 / 1024;
    const 发速率 = (当前.发 - 旧.发) / 秒 / 1024;
    if (最快收 === null || 收速率 > 最快收) 最快收 = 收速率;
    if (最快发 === null || 发速率 > 最快发) 最快发 = 发速率;
  }

  // 这一轮全是新网卡（比如刚插上网线），没有可用差值
  if (最快收 === null) return;

  const 下行整 = Math.round(最快收);
  const 上行整 = Math.round(最快发);
  // 取整后再比：小数每轮都在变，去重就失效了
  if (下行整 !== 上次下行) {
    ctx.广播("widget.data", { id: "net.down", 值: 下行整 });
    上次下行 = 下行整;
  }
  if (上行整 !== 上次上行) {
    ctx.广播("widget.data", { id: "net.up", 值: 上行整 });
    上次上行 = 上行整;
  }
}

/**
 * 读选项，坏值回落默认。
 *
 * 导出是为了单测——这些判断最容易错，而它们不需要起 PowerShell 就能测。
 * 插件加载器靠 `解析插件类()` 找默认导出，多几个命名导出不影响加载。
 */
export function 读选项(配置) {
  const 原始 = 配置?.intervalMs;
  // 与 sysmon 同样的坑：`Number(null)` / `Number("")` 都是 0 且有限，
  // 会静默变成「用户填了 0」再被夹成下限。先排除「根本没填」。
  const 没填 = 原始 === null || 原始 === undefined || 原始 === "";
  const 间隔 = 没填 ? 默认间隔 : Number(原始);
  return {
    // 下限 500ms：网卡计数器本身的更新粒度就在几百毫秒，
    // 再快只是把同一个数字重复读出来，还让界面疯狂抖动
    间隔: Number.isFinite(间隔) ? Math.max(500, Math.min(10000, 间隔)) : 默认间隔,
    启用: 配置?.enabled === true,
    包含虚拟: 配置?.includeVirtual === true,
  };
}

class 网络速率 extends BasePlugin {
  async on_load(ctx) {
    super.on_load(ctx);

    // 非 Windows：不声明、不报错。让用户看到「没有这个组件」，
    // 比看到一个永远空白的卡片强。
    if (process.platform !== "win32") {
      ctx.日志.信息(`网络速率暂只支持 Windows，当前平台 ${process.platform}，跳过`);
      return;
    }

    let 配置 = {};
    try {
      配置 = await ctx.配置();
    } catch (err) {
      ctx.日志.警告(`读取配置失败，使用默认值：${String(err)}`);
    }
    const 选项 = 读选项(配置);

    if (!选项.启用) {
      // 默认就在这条路径上：不声明组件、不起子进程，完全静默
      return;
    }

    await ctx.声明小组件([
      {
        id: "net.down",
        type: "number",
        title: "下行",
        unit: "KB/s",
        prominence: "normal",
        stale: 10,
      },
      {
        id: "net.up",
        type: "number",
        title: "上行",
        unit: "KB/s",
        prominence: "secondary",
        stale: 10,
      },
    ]);

    起子进程(ctx, 选项);
  }

  async on_unload() {
    // 这个模块最有价值的测试就是「卸载后 PowerShell 真的没了」——
    // 忘了这一步会留下一个每 0.9 秒醒一次、永远不退的进程
    停子进程();
  }
}

export default 定义插件(网络速率, {
  name: "netspeed",
  version: "1.0.0",
  description: "网络速率：实时上下行监控（Windows）",
  author: "kugua",
});
