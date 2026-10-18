/**
 * 模块同步的纯函数部分
 *
 * 从 `scripts/sync-modules.mjs` 拆出来的理由：那个脚本原来是一整坨顶层过程代码，
 * 最后一行直接 `主()`，**没法在测试里 import**——一导入就会去改真实的
 * `kugua.config.json` 和根 `package.json`。而它每次 `npm run build` 都会跑，
 * 又要写 26 个模块的配置，写错了就是全盘污染。
 *
 * 所以这里只放**不碰文件系统**的纯函数：给什么文本，返回什么文本。
 * 读写文件、退出码都留在脚本里。
 */

/**
 * 运行时写入却不在包清单里的字段。
 *
 * `version` / `capabilityHash` 是模块**首次注册时**由主控写到配置里的，
 * 用于下次接入的身份门禁（版本回退、能力指纹变化 → 暂下线）。
 * 它们不属于包的功能声明，却必须跨重启存活。
 *
 * 早期这里直接整体替换 modules[]，每次跑同步都把它们抹掉，
 * 结果是身份校验静默失效——不报错，只是再也不拦任何东西。
 */
export const 运行时字段 = ["version", "capabilityHash"];

/** 由包的 kugua 字段构造模块描述；不是模块则返回 null */
export function 构造描述(条目) {
  const k = 条目.包.kugua;
  if (!k || k.module !== true) return null;
  const 类型 = k.type ?? "process";
  const 描述 = {
    name: 条目.包.kugua.name ?? 条目.相对目录.split("/").pop(),
    type: 类型,
  };
  if (类型 === "process") {
    描述.entry = `${条目.相对目录}/${k.entry ?? "dist/index.js"}`;
    描述.autoStart = k.autoStart !== false;
  } else {
    描述.file = k.file ?? "";
  }
  if (k.description) 描述.description = k.description;
  return 描述;
}

/** 由模块目录列表构造所有描述，按「process 优先、名字排序」稳定输出 */
export function 收集描述(包列表) {
  const 描述表 = 包列表.map(构造描述).filter(Boolean);
  描述表.sort((a, b) => {
    if ((a.type === "process") !== (b.type === "process")) return a.type === "process" ? -1 : 1;
    return a.name.localeCompare(b.name, "en");
  });
  return 描述表;
}

/**
 * 保留「手工维护」的非进程模块条目（未由任何包发现，例如静态库 math）。
 * 仅保留显式标为非 process 的条目；已消失的 process 模块会被自动移除。
 */
export function 合并手工条目(现有配置, 发现列表) {
  const 已发现名 = new Set(发现列表.map((m) => m.name));
  const 手工 = (现有配置.modules ?? []).filter(
    (m) => m && m.name && m.type !== "process" && !已发现名.has(m.name),
  );
  return [...发现列表, ...手工];
}

/**
 * 写回时保持原文件的行尾风格。
 *
 * 仓库在 Windows 下检出为 CRLF，而 `JSON.stringify` 只产 LF。
 * 早期这里直接拼 `"\n"`，导致「内容完全相同但字节不同」——
 * `--check` 永远报不一致，而跑一次同步又没任何实质变更。
 */
export function 保持行尾(文本, 原文本) {
  return 原文本.includes("\r\n") ? 文本.replace(/\n/g, "\r\n") : 文本;
}

/** 生成配置：保留已有条目的运行时字段，其余以包清单为准 */
export function 生成配置(原文本, 新模块列表) {
  const 对象 = JSON.parse(原文本);
  const 已有表 = new Map(
    (对象.modules ?? []).filter((m) => m && m.name).map((m) => [m.name, m]),
  );
  对象.modules = 新模块列表.map((新项) => {
    const 旧项 = 已有表.get(新项.name);
    if (!旧项) return 新项;
    // 字段顺序稳定：先包声明字段，再运行时字段
    const 合并 = { ...新项 };
    for (const 字段 of 运行时字段) {
      if (旧项[字段] !== undefined) 合并[字段] = 旧项[字段];
    }
    return 合并;
  });
  return 保持行尾(JSON.stringify(对象, null, 2) + "\n", 原文本);
}

/** 生成根 package.json 中每个模块的 start 脚本（<名>: node <entry>） */
export function 生成启动脚本(原包, 原包文本, 模块列表) {
  const 脚本 = { ...原包.scripts };
  // 先清除旧的模块脚本（值为 node packages/modules/... 的项）
  for (const [k, v] of Object.entries(脚本)) {
    if (typeof v === "string" && /^node packages\/modules\/[^/]+\/dist\/index\.js$/.test(v)) {
      delete 脚本[k];
    }
  }
  for (const m of 模块列表) {
    if (m.type !== "process" || !m.entry) continue;
    脚本[m.name] = `node ${m.entry}`;
  }
  return 保持行尾(JSON.stringify({ ...原包, scripts: 脚本 }, null, 2) + "\n", 原包文本);
}
