#!/usr/bin/env node
/**
 * 从 image 模块的动作声明表生成一份「默认值常量」，供 WebUI 路由器使用。
 *
 * ## 为什么需要它
 *
 * 聊天框的指令路由器（`04-router.ts`）是个**同步纯函数**——它要在一串
 * `if (...) return 需图("image.rotate", { degrees: 90 })` 里立刻给出结果，
 * 没法去 await 一个模块请求拿声明表。所以那些默认值只能写成字面量。
 *
 * 于是就有了两份描述：模块声明表说 `rotate.degrees` 默认 0、界面默认 90，
 * 路由器说「请输入 90」。现在两份值恰好一致，但**没有任何机制保证以后一致**。
 * 改了声明表忘了改路由器，症状是「界面里默认 90，聊天框里默认 0」这种
 * 只在对比时才发现的不一致，而且不报错。
 *
 * 这个脚本把声明表里的默认值抽成纯数据文件，路由器引用它。
 * 单一来源仍然是 `actions.ts`，这里只是把它的一个子集编译成同步可用的常量。
 *
 * ## 用法
 *
 * `npm run gen:image-defaults`（也挂在 webui 的 build 前面）
 */

import { writeFileSync, mkdirSync } from "node:fs";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";

const 此处 = dirname(fileURLToPath(import.meta.url));
const 仓库根 = resolve(此处, "..");
const 声明产物 = join(仓库根, "packages/modules/image/dist/actions.js");
const 输出 = join(仓库根, "packages/webui/src/renderer/image-defaults.ts");

const 模 = await import(pathToFileURL(声明产物).href);
const 动作声明表 = 模.动作声明表;

if (!Array.isArray(动作声明表)) {
  throw new Error(`没从 ${声明产物} 拿到 动作声明表`);
}

/**
 * 只收「界面默认 或 协议默认」存在的参数。
 *
 * 取哪个？**文档里两条路线用的是不同语义**：
 * - 聊天框指令（「旋转」不带度数）要的是**用户期望的默认操作**，即 90 度，
 *   不是「转 0 度」这种什么都没做的操作 → 取 `界面默认`
 * - 没有 `界面默认` 时退回 `默认`
 *
 * 这正是 `rotate` 那条声明的意义所在。
 */
const 表 = {};
for (const d of 动作声明表) {
  const 项 = {};
  for (const p of d.参数 ?? []) {
    const 值 = p.界面默认 !== undefined ? p.界面默认 : p.默认;
    if (值 !== undefined) 项[p.键] = 值;
  }
  if (Object.keys(项).length) 表[d.动作] = 项;
}

const 序 = Object.keys(表).sort();
const 行 = [
  "/**",
  " * **自动生成，不要手改。**",
  " *",
  " * 来源：`packages/modules/image/src/actions.ts` 的 `动作声明表`",
  " * 生成：`npm run gen:image-defaults`",
  " *",
  " * 为什么聊天框要单独抄一份默认值，见 `scripts/gen-image-defaults.mjs` 顶部的说明。",
  " * 简言之：路由器是同步纯函数，没法 await 模块请求，只能引用预生成的常量。",
  " * 两份不一致会被 `packages/webui/test/image-defaults.test.ts` 抓住。",
  " */",
  "",
  "export const 图片动作默认值: Record<string, Record<string, unknown>> = {",
];
for (const 动作 of 序) {
  const 项 = 表[动作];
  const 键们 = Object.keys(项).sort();
  const 内 = 键们.map((k) => `${JSON.stringify(k)}: ${JSON.stringify(项[k])}`).join(", ");
  行.push(`  ${JSON.stringify(动作)}: { ${内} },`);
}
行.push("};", "");

mkdirSync(dirname(输出), { recursive: true });
writeFileSync(输出, 行.join("\n"), "utf8");
console.log(`[gen-image-defaults] 已生成 ${序.length} 个动作的默认值 → ${输出}`);
