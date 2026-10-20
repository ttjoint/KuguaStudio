/**
 * 动作声明表必须与原实现行为等价。
 *
 * ## 这条测试在防什么
 *
 * 把 34 个动作从「手写能力清单 + 内联类型 + 散落 `?? 默认值`」改成表驱动，
 * 最容易出的错是**默认值搬错**。比如 `colorSample` 原默认 `size: 80`，
 * 我第一版声明写成 200——不会有任何编译错误，也不会有运行时异常，
 * 只是用户不填参数时生成的方块大了 2.5 倍。
 *
 * 这种错**只能靠比对**发现。所以这里把原实现里的每个 `?? 默认值`
 * 抄成一张期望表，逐项断言 `归一参数()` 的结果。
 *
 * ## 为什么不用「跑一遍看输出对不对」
 *
 * 调用真 magick 需要图、需要时间（每次 200ms），30 多个动作要几秒，
 * 而且输出是二进制图——默认值错了未必能看出来（80x80 和 200x200 的
 * 纯色方块都是"一个方块"）。直接断言归一后的参数更快也更准确。
 */

import { describe, expect, it } from "vitest";
import { 动作声明表, 系统动作, 查声明, 归一参数, 动作schema, 需要源图 } from "../src/actions.js";

/**
 * 原实现里的默认值，逐字抄自改造前的 `index.ts`。
 *
 * 格式：动作名 → { 参数键: 默认值 }
 * 这里**宁可写多**：每个有 `??` 的参数都要列，漏列就是漏测。
 */
const 原默认值: Record<string, Record<string, unknown>> = {
  rotate: { degrees: 0 },
  resize: { scaleX: 1, scaleY: 1 },
  cut: { top: 0, bottom: 0, left: 0, right: 0, percent: false },
  mirror: { mode: 1 },
  colorSample: { size: 80, color: "#000000" },
  randomPixel: { size: 100 },
  grid: { scale: 2 },
  oldJpg: { quality: 0.75 },
  removeBg: { tolerance: 10 },
  pixelWords: { text: "", fontSize: 12, lineMax: 20 },
  captcha: { text: "" },
  cisColor: { x: 0.3127, y: 0.329, Y: 1.0, size: 200 },
  colorExtract: { count: 3, size: 80 },
  hytk: { colorful: false },
  gifUnzipGrid: { col: 1, row: 1 },
  gifSprite: { row: "横", col: 1 },
  gifSpeed: { speed: 1.0 },
  shake: { degree: 0.5 },
  roll: { degree: 0 },
  upscale: { scale: 4, provider: "auto", faceEnhance: false },
};

describe("动作声明表", () => {
  it("全部动作在表里，且无重复", () => {
    // 数量不写死：每加一个动作就要改这里的话，这个断言迟早被人顺手改成
    // `toHaveLength(动作声明表.length)`，那就什么都没在测。
    // 真正要守的是下面两条：不重复、能查到。
    const 名 = 动作声明表.map((d) => d.动作);
    expect(名.length).toBeGreaterThanOrEqual(34);
    expect(new Set(名).size).toBe(名.length);
    // 批处理入口必须在表里，否则 scheduler 的 建议作业动作 指向一个不存在的能力
    expect(名).toContain("batch");
  });

  it("每个动作都能查到声明", () => {
    for (const d of 动作声明表) {
      expect(查声明(d.动作)).toBe(d);
    }
  });

  it("声明里的参数不重复", () => {
    for (const d of 动作声明表) {
      const 键 = d.参数.map((p) => p.键);
      expect(new Set(键).size, `${d.动作} 有重复参数`).toBe(键.length);
    }
  });

  describe("默认值与改造前一致", () => {
    for (const [动作, 期望] of Object.entries(原默认值)) {
      it(`${动作}`, () => {
        const d = 查声明(动作);
        expect(d, `${动作} 未声明`).toBeTruthy();
        // 不传任何参数，归一后应该拿到全部原默认值
        const 得 = 归一参数(d!, {});
        for (const [键, 值] of Object.entries(期望)) {
          expect(得[键], `${动作}.${键}`).toEqual(值);
        }
      });
    }
  });

  describe("归一参数会夹取越界值", () => {
    it("旋转超过 360 度被夹到 360", () => {
      const d = 查声明("rotate")!;
      expect(归一参数(d, { degrees: 9999 }).degrees).toBe(360);
      expect(归一参数(d, { degrees: -9999 }).degrees).toBe(-360);
    });

    it("容差超过 255 被夹到 255", () => {
      const d = 查声明("removeBg")!;
      expect(归一参数(d, { tolerance: 999 }).tolerance).toBe(255);
      expect(归一参数(d, { tolerance: -5 }).tolerance).toBe(0);
    });

    it("无法解析成数字时回落到默认值，而不是 NaN", () => {
      const d = 查声明("grid")!;
      expect(归一参数(d, { scale: "不是数字" }).scale).toBe(2);
      expect(归一参数(d, { scale: NaN }).scale).toBe(2);
    });

    it("空字符串数字回落默认值（聊天框容易传出空串）", () => {
      const d = 查声明("oldJpg")!;
      expect(归一参数(d, { quality: "" }).quality).toBe(0.75);
    });

    it("布尔值接受字符串和数字写法", () => {
      const d = 查声明("cut")!;
      expect(归一参数(d, { percent: "true" }).percent).toBe(true);
      expect(归一参数(d, { percent: 1 }).percent).toBe(true);
      expect(归一参数(d, { percent: "false" }).percent).toBe(false);
      expect(归一参数(d, { percent: 0 }).percent).toBe(false);
    });
  });

  describe("图片字段原样透传，不被当成参数", () => {
    it("base64 / path 透传", () => {
      const d = 查声明("rotate")!;
      const 得 = 归一参数(d, { base64: "AAAA", path: "/x.png", degrees: 45 });
      expect(得.base64).toBe("AAAA");
      expect(得.path).toBe("/x.png");
      expect(得.degrees).toBe(45);
    });

    it("images 数组透传且过滤非字符串", () => {
      const d = 查声明("combineH")!;
      const 得 = 归一参数(d, { images: ["a", 123, null, "b"] });
      expect(得.images).toEqual(["a", "b"]);
    });
  });

  describe("源图判定", () => {
    it("要图的动作返回 true", () => {
      expect(需要源图(查声明("rotate")!)).toBe(true);
      expect(需要源图(查声明("gifUnzip")!)).toBe(true);
    });

    it("多图动作也算要图", () => {
      expect(需要源图(查声明("combineH")!)).toBe(true);
      expect(需要源图(查声明("hytk")!)).toBe(true);
    });

    it("纯生成动作不要图", () => {
      expect(需要源图(查声明("colorSample")!)).toBe(false);
      expect(需要源图(查声明("captcha")!)).toBe(false);
    });
  });

  describe("生成的 JSON Schema 可用", () => {
    it("number 参数带范围", () => {
      const s = 动作schema(查声明("rotate")!) as {
        properties: Record<string, Record<string, unknown>>;
      };
      expect(s.properties.degrees.type).toBe("number");
      expect(s.properties.degrees.minimum).toBe(-360);
      expect(s.properties.degrees.maximum).toBe(360);
    });

    it("要图的动作 schema 带 base64 / path", () => {
      const s = 动作schema(查声明("rotate")!) as { properties: Record<string, unknown> };
      expect(s.properties.base64).toBeTruthy();
      expect(s.properties.path).toBeTruthy();
    });

    it("选择题生成 enum", () => {
      const s = 动作schema(查声明("upscale")!) as {
        properties: Record<string, Record<string, unknown>>;
      };
      expect(s.properties.provider.enum).toEqual(["auto", "realesrgan", "imagemagick"]);
    });

    it("多图参数是字符串数组", () => {
      const s = 动作schema(查声明("combineH")!) as {
        properties: Record<string, Record<string, unknown>>;
      };
      expect(s.properties.images.type).toBe("array");
      expect(s.properties.images.items).toEqual({ type: "string" });
    });
  });

  describe("界面用的元信息齐全", () => {
    it("每个动作都有分组和说明", () => {
      for (const d of 动作声明表) {
        expect(d.分组, `${d.动作} 缺分组`).toBeTruthy();
        expect(d.说明, `${d.动作} 缺说明`).toBeTruthy();
        expect(d.标题, `${d.动作} 缺标题`).toBeTruthy();
      }
    });

    it("每个参数都有标题", () => {
      for (const d of 动作声明表) {
        for (const p of d.参数) {
          expect(p.标题, `${d.动作}.${p.键} 缺标题`).toBeTruthy();
        }
      }
    });

    it("数字参数的默认值落在范围内", () => {
      for (const d of 动作声明表) {
        for (const p of d.参数) {
          if (p.类型 !== "number" || typeof p.默认 !== "number") continue;
          if (p.最小 !== undefined) expect(p.默认, `${d.动作}.${p.键} 默认低于最小`).toBeGreaterThanOrEqual(p.最小);
          if (p.最大 !== undefined) expect(p.默认, `${d.动作}.${p.键} 默认超过最大`).toBeLessThanOrEqual(p.最大);
        }
      }
    });

    it("有默认值的参数才能出滑块，没默认值的必须有档位或说明", () => {
      // resize.width / resize.height 故意没默认值（填了才生效），
      // 这类"可选覆盖"参数不需要滑块，但必须写清楚
      for (const d of 动作声明表) {
        for (const p of d.参数) {
          if (p.类型 !== "number" || p.默认 !== undefined) continue;
          expect(p.档位 ?? p.说明, `${d.动作}.${p.键} 既无默认值也无说明`).toBeTruthy();
        }
      }
    });

    it("常用动作约 20 个，不至于把 34 个全铺在界面上", () => {
      const 常用 = 动作声明表.filter((d) => d.常用);
      expect(常用.length).toBeGreaterThanOrEqual(15);
      expect(常用.length).toBeLessThanOrEqual(25);
    });

    it("有预览方式的动作必须真的能本地预览（css-transform / css-filter / overlay）", () => {
      const 可预览 = 动作声明表.filter((d) => d.预览 && d.预览 !== "none");
      // 旋转/翻转/缩放/反色/灰度这些该有；如果哪天全丢了说明字段没填
      expect(可预览.length).toBeGreaterThanOrEqual(5);
    });
  });
});

describe("系统动作（编辑页路径契约）", () => {
  it("查声明 也能查到系统动作", () => {
    // 系统动作的处理函数同样写 `归一参数(查声明(x)!, params)`。
    // 如果 查声明 只查 动作声明表，这里返回 undefined，运行时报
    // 「Cannot read properties of undefined (reading '参数')」——
    // 而 `!` 让 TypeScript 完全看不出问题。这个 bug 真发生过一次。
    for (const d of 系统动作) {
      expect(查声明(d.动作), `${d.动作} 查不到`).toBe(d);
    }
  });

  it("系统动作不进编辑页动作列表", () => {
    // 用户不该在「旋转/缩放」旁边看到「释放会话」按钮
    const 名 = 动作声明表.map((d) => d.动作);
    for (const d of 系统动作) {
      expect(名).not.toContain(d.动作);
    }
  });

  it("系统动作分组是「系统」且不带预览", () => {
    for (const d of 系统动作) {
      expect(d.分组).toBe("系统");
      expect(d.预览 ?? "none").toBe("none");
      expect(d.常用).toBeFalsy();
    }
  });

  it("系统动作的参数能归一（默认值全空）", () => {
    for (const d of 系统动作) {
      const 得 = 归一参数(d, {});
      expect(typeof 得).toBe("object");
    }
  });

  it("系统动作齐全：会话、文件读写、声明表", () => {
    const 名 = 系统动作.map((d) => d.动作).sort();
    expect(名).toEqual([
      "actions.declare",
      "file.read",
      "file.save",
      "session.open",
      "session.release",
    ]);
  });
});

describe("批处理动作：作业入口契约", () => {
  it("batch 声明了 执行，且占位符只引用自己声明的参数", () => {
    const d = 查声明("batch")!;
    expect(d.可作业).toBe(true);
    expect(d.执行?.命令).toBeTruthy();
    // 占位符名写错时 job 会原样把 `{动作名}` 传给子进程，
    // 孩子收到的就是一个带花括号的路径——报「文件不存在」，查半天
    const 参数名 = new Set(d.参数.map((p) => p.键));
    for (const a of d.执行!.参数 ?? []) {
      for (const m of a.matchAll(/\{([^}]+)\}/g)) {
        if (m[1] === "参数") continue;
        expect(参数名.has(m[1]), `占位符 {${m[1]}} 没有对应的参数`).toBe(true);
      }
    }
  });

  it("文件列表 是数组型参数（带计数标题 依赖它）", () => {
    const d = 查声明("batch")!;
    const p = d.参数.find((x) => x.键 === "文件列表");
    expect(p?.类型).toBe("images");
  });

  it("能从能力声明里看到 执行/可作业（漏上报 = 定时任务里静默变回同步阻塞）", async () => {
    // 能力清单在 index.ts 里生成，会被 启动模块 副作用带走，
    // 所以这里只校验「生成规则」本身：动作声明 → 能力声明的映射。
    const mod = await import("../src/actions.js");
    const d = mod.查声明("batch")!;
    // 等价于 index.ts 里的 map 表达式
    const 能力 = { 名称: `image.${d.动作}`, ...(d.执行 ? { 执行: d.执行 } : {}), ...(d.可作业 ? { 可作业: true, 长任务: true } : {}) };
    expect(能力.执行?.命令).toBe(d.执行!.命令);
    expect(能力.可作业).toBe(true);
    expect(能力.长任务).toBe(true);
  });
});
