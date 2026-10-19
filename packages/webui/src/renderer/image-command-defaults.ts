/**
 * 图片指令默认值的查询入口。
 *
 * ## 为什么单独一个文件
 *
 * 路由器 `04-router.ts` 顶层 import 了 `02-chat-core` / `03-preview` /
 * `10-chat-page`，这些模块在 import 时就摸 `document`。于是路由器
 * **在 Node 里根本 import 不进来**，想真跑一次看它返回什么参数都做不到。
 *
 * （这是小组件那边踩过的同一个坑：`19-widgets.ts` 依赖 DOM 不可测，
 * 决策逻辑抽 `widget-layout.ts`。）
 *
 * 所以把「某个图片动作某个参数的默认值是多少」抽到这里——它只依赖
 * 一份纯数据，Node 里随便 import。
 */

import { 图片动作默认值 } from "./image-defaults";

/** 取某个图片动作某参数的默认值；没声明过就返回兜底值 */
export function 图默认(动作: string, 键: string, 兜底: number | string | boolean = 0): number | string | boolean {
  const 值 = 图片动作默认值[动作]?.[键];
  if (值 === undefined) return 兜底;
  return 值 as number | string | boolean;
}
