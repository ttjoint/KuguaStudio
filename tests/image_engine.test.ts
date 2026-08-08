/**
 * 图片引擎（Python + Pillow）：高清放大（超分）能力测试。
 * 环境无 Python/Pillow 时自动跳过（生产环境由用户 Python 环境提供依赖）。
 */

import { describe, expect, it } from "vitest";
import { execFileSync } from "node:child_process";
import { resolve } from "node:path";

const 引擎脚本 = resolve(process.cwd(), "packages/modules/image/engine/image_engine.py");

/** 1x1 红色 PNG */
const 红色1x1 =
  "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg==";

/** 收集阶段探测 Python/Pillow 可用性（describe.skipIf 需在收集时确定） */
let 可用 = false;
try {
  execFileSync("python", ["-c", "from PIL import Image; print('ok')"], {
    timeout: 10000,
    windowsHide: true,
    encoding: "utf-8",
  });
  可用 = true;
} catch {
  可用 = false;
}

function 调用引擎(payload: unknown): { ok: boolean; error?: string; base64?: string; width?: number; height?: number; format?: string; message?: string } {
  const 输出 = execFileSync("python", [引擎脚本], {
    timeout: 120000,
    windowsHide: true,
    encoding: "utf-8",
    input: JSON.stringify(payload),
  });
  return JSON.parse(输出) as ReturnType<typeof 调用引擎>;
}

describe.skipIf(!可用)("图片引擎高清放大（超分）", () => {
  it("provider=pillow：2x 放大尺寸正确", () => {
    const 结果 = 调用引擎({
      op: "upscale",
      params: { scale: 2, provider: "pillow" },
      base64: 红色1x1,
    });
    expect(结果.ok).toBe(true);
    expect(结果.format).toBe("png");
    expect(结果.width).toBe(2);
    expect(结果.height).toBe(2);
    expect(结果.message).toBe("pillow");
    expect(结果.base64?.length ?? 0).toBeGreaterThan(0);
  }, 120000);

  it("provider=auto：优先 Real-ESRGAN，否则回退 pillow（两者皆返回成功）", () => {
    const 结果 = 调用引擎({
      op: "upscale",
      params: { scale: 4, provider: "auto" },
      base64: 红色1x1,
    });
    expect(结果.ok).toBe(true);
    expect(结果.width).toBe(4);
    expect(结果.height).toBe(4);
    expect(["realesrgan", "pillow"]).toContain(结果.message);
  }, 300000);

  it("非法 scale 回退为 4", () => {
    const 结果 = 调用引擎({
      op: "upscale",
      params: { scale: 3, provider: "pillow" },
      base64: 红色1x1,
    });
    expect(结果.ok).toBe(true);
    expect(结果.width).toBe(4);
  }, 120000);
});
