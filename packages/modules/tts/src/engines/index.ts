/**
 * 内置引擎登记
 *
 * 新增引擎的完整步骤：
 *  1. 在 `engines/` 写一个实现 `语音引擎` 的类
 *  2. 在这里 `注册引擎(new Xxx引擎())`
 *  3. 在 `kugua.config.json` 的 `tts.engines` 加一节配置
 *
 * 上层（handlers / UI / 批处理）**无需改动**。
 */

import { 注册引擎 } from "../registry.js";
import { VoxCPM引擎 } from "./voxcpm.js";
import { IndexTTS引擎 } from "./indextts.js";
import { GptSoVits引擎 } from "./gpt-sovits.js";
import { Sherpa引擎, Sapi引擎 } from "./cpu.js";

let 已登记 = false;

/** 登记全部内置引擎；重复调用安全 */
export function 登记内置引擎(): void {
  if (已登记) return;
  已登记 = true;
  注册引擎(new VoxCPM引擎());
  注册引擎(new IndexTTS引擎());
  注册引擎(new GptSoVits引擎());
  注册引擎(new Sherpa引擎());
  注册引擎(new Sapi引擎());
}
