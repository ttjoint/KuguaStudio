#!/usr/bin/env node
/**
 * 模块发现与同步工具
 *
 * 单一事实来源：各模块 `packages/modules/<名>/package.json` 内的 `kugua` 字段：
 *   {
 *     "module": true,          // 是否是一个可被主控启动的模块（false/缺省则不纳入）
 *     "type": "process",       // 可选，默认 "process"；"library" 表示静态库
 *     "entry": "dist/index.js",// 可选，相对包根的入口；默认 dist/index.js
 *     "file": "bin/math.dll",  // library 类型的文件相对路径
 *     "autoStart": true,       // 是否随主控自动启动
 *     "description": "……"      // 说明文字
 *   }
 *
 * 用法：
 *   node scripts/sync-modules.mjs           # 同步 kugua.config.json 的 modules[] 与根 start 脚本
 *   node scripts/sync-modules.mjs --check   # 仅校验是否一致（不一致则非零退出，供 CI 用）
 *
 * 这样新增/删除模块只需：建包 + 写 kugua 字段 + `npm install`，其余自动生成。
 *
 * 纯函数都在 `sync-modules-core.mjs` 里（便于测试），这里只负责扫目录、读写文件。
 */
import { readFileSync, writeFileSync, readdirSync, existsSync } from "node:fs";
import { join, resolve, dirname } from "node:path";
import { fileURLToPath } from "node:url";
import {
  收集描述,
  合并手工条目,
  生成配置,
  生成启动脚本,
} from "./sync-modules-core.mjs";

const 根 = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const 检查模式 = process.argv.includes("--check");
const 配置路径 = join(根, "kugua.config.json");
const 根包路径 = join(根, "package.json");

/** 读取一个 package.json */
function 读包(路径) {
  return JSON.parse(readFileSync(路径, "utf8"));
}

/** 扫描所有 workspace 包（packages/* 与 packages/modules/*） */
function 扫描包() {
  const 结果 = [];
  const 顶级 = join(根, "packages");
  const 模块目录 = join(顶级, "modules");
  const 目录列表 = [];
  for (const d of 安全读目录(顶级)) {
    if (d === "modules") continue;
    目录列表.push(join(顶级, d));
  }
  for (const d of 安全读目录(模块目录)) 目录列表.push(join(模块目录, d));
  for (const 目录 of 目录列表) {
    const f = join(目录, "package.json");
    if (!existsSync(f)) continue;
    结果.push({ 目录, 相对目录: 相对(根, 目录), 包: 读包(f) });
  }
  return 结果;
}

function 安全读目录(p) {
  try {
    return readdirSync(p, { withFileTypes: true })
      .filter((e) => e.isDirectory())
      .map((e) => e.name);
  } catch {
    return [];
  }
}

function 相对(a, b) {
  return b.slice(a.length + 1).replace(/\\/g, "/");
}

function 主() {
  const 包列表 = 扫描包();
  const 原配置文本 = readFileSync(配置路径, "utf8");
  const 现有配置 = JSON.parse(原配置文本);
  const 模块列表 = 合并手工条目(现有配置, 收集描述(包列表));

  const 新配置文本 = 生成配置(原配置文本, 模块列表);

  const 原根包文本 = readFileSync(根包路径, "utf8");
  const 新根包文本 = 生成启动脚本(JSON.parse(原根包文本), 原根包文本, 模块列表);

  const 配置变化 = 原配置文本 !== 新配置文本;
  const 根包变化 = 原根包文本 !== 新根包文本;

  const 摘要 = 模块列表
    .map((m) => `  ${m.name.padEnd(12)} ${m.type.padEnd(9)} ${
      m.type === "process" ? `autoStart=${String(m.autoStart).padEnd(5)} ${m.entry}` : m.file ?? ""
    }`)
    .join("\n");

  if (检查模式) {
    if (配置变化 || 根包变化) {
      console.error("[sync-modules] 发现不一致：");
      if (配置变化) console.error("  - kugua.config.json 的 modules[] 需重新生成");
      if (根包变化) console.error("  - package.json 的模块 start 脚本需重新生成");
      console.error("  请运行：node scripts/sync-modules.mjs");
      process.exit(1);
    }
    console.log(`[sync-modules] 一致（${模块列表.length} 个模块）`);
    return;
  }

  if (配置变化) writeFileSync(配置路径, 新配置文本);
  if (根包变化) writeFileSync(根包路径, 新根包文本);

  console.log(`[sync-modules] 共发现 ${模块列表.length} 个模块：\n${摘要}`);
  console.log(
    `[sync-modules] ${配置变化 ? "已更新 kugua.config.json" : "kugua.config.json 无变化"}；` +
      `${根包变化 ? "已更新 package.json start 脚本" : "package.json 无变化"}`,
  );
}

主();
