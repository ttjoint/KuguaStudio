#!/usr/bin/env node
/**
 * 复制 WebUI 静态资源到 dist（index.html / style.css / assets）。
 *
 * 背景：当本机已有一个 WebUI 实例在运行（例如用户的正式服务），它会锁定
 * `dist/assets/icon.jpg`，导致 copyFile 抛 EBUSY/EACCES。此时该资源通常已存在，
 * 不应因此让整个 `npm run build` 失败。这里对每个文件做「重试 + 降级为警告」：
 *   - 优先覆盖复制；EBUSY/EPERM/EACCES 时短暂重试；
 *   - 仍失败但目标文件已存在 → 打印警告并继续（视为已就绪）；
 *   - 目标不存在且无法写入 → 抛错（真正的失败）。
 */
import { copyFile, mkdir, access } from "node:fs/promises";
import { constants } from "node:fs";
import { dirname } from "node:path";

const 任务 = [
  ["src/renderer/index.html", "dist/renderer/index.html"],
  ["src/renderer/style.css", "dist/renderer/style.css"],
  ["src/assets/icon.jpg", "dist/assets/icon.jpg"],
];

const 可重试 = new Set(["EBUSY", "EPERM", "EACCES", "EMFILE", "ENFILE"]);

async function 存在(p) {
  try {
    await access(p, constants.F_OK);
    return true;
  } catch {
    return false;
  }
}

async function 复制(源, 目标) {
  await mkdir(dirname(目标), { recursive: true });
  for (let 次 = 1; 次 <= 4; 次++) {
    try {
      await copyFile(源, 目标);
      return { ok: true };
    } catch (err) {
      if (!可重试.has(err.code) || 次 === 4) {
        if (可重试.has(err.code) && (await 存在(目标))) {
          console.warn(`[copy-assets] ${目标} 被占用（${err.code}），但已存在，跳过复制`);
          return { ok: true, skipped: true };
        }
        throw err;
      }
      await new Promise((r) => setTimeout(r, 150 * 次));
    }
  }
  return { ok: true };
}

let 跳过 = 0;
for (const [源, 目标] of 任务) {
  const r = await 复制(源, 目标);
  if (r.skipped) 跳过++;
  else console.log(`[copy-assets] ${源} -> ${目标}`);
}
console.log(`[copy-assets] 完成${跳过 ? `（${跳过} 项因占用跳过）` : ""}`);
