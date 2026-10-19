/**
 * mkg 模块纯逻辑测试：索引默认值 / 路径包含判定 / 扩展名识别。
 *
 * ## 为什么测这三处
 *
 * mkg 主体是 SQLite + FTS5，单测要建库灌数据。但三层纯判定
 * 都符合「错了不报错，只是结果不对」：
 *
 * 1. **`读取索引默认值`**：「0 表示不限」是唯一约定。
 *    写反了默认配置就变成「深度 0」，扫描静默只扫第一层。
 *
 * 2. **`是否在目录下`**：这是 `pathInfo` 的核心。
 *    少了 `+ sep` 会把 `/a/bc` 判成在 `/a/b` 下 →
 *    导入的副本被当成原址文件 → **编辑器保存时静默覆盖源文件**。
 *
 * 3. **`识别扩展名`**：`split(".").pop()` 对无扩展名文件返回文件名本身。
 */

import { describe, expect, it } from "vitest";
import {
  压缩包扩展名,
  图片扩展名,
  是否在目录下,
  判定文件类型,
  文本扩展名,
  识别扩展名,
  规范路径,
  读取索引默认值,
  音乐扩展名,
  视频扩展名,
} from "../src/pure.js";

describe("读取索引默认值：0 / 空表示不限", () => {
  it("空配置时 maxDepth 与 exclude 是 undefined（不限）", () => {
    const r = 读取索引默认值({});
    expect(r.maxDepth).toBeUndefined();
    expect(r.exclude).toBeUndefined();
  });

  it("indexMaxDepth = 0 视为不限（不是深度 0）", () => {
    // 关键：0 是哨兵值。若写成 `深度 >= 0 ? 深度 : undefined`，
    // 默认配置就变成「深度 0」，扫描静默只扫一层
    expect(读取索引默认值({ indexMaxDepth: 0 }).maxDepth).toBeUndefined();
  });

  it("indexMaxDepth 为负数也视为不限", () => {
    expect(读取索引默认值({ indexMaxDepth: -3 }).maxDepth).toBeUndefined();
  });

  it("正数原样保留", () => {
    expect(读取索引默认值({ indexMaxDepth: 5 }).maxDepth).toBe(5);
  });

  it("非数字退成不限", () => {
    expect(读取索引默认值({ indexMaxDepth: "abc" }).maxDepth).toBeUndefined();
    expect(读取索引默认值({ indexMaxDepth: null }).maxDepth).toBeUndefined();
  });
});

describe("读取索引默认值：文件大小上限", () => {
  it("缺省 10 MB", () => {
    expect(读取索引默认值({}).maxTextSize).toBe(10 * 1024 * 1024);
  });

  it("单位是 MB，转成字节", () => {
    expect(读取索引默认值({ maxTextSizeMb: 1 }).maxTextSize).toBe(1024 * 1024);
    expect(读取索引默认值({ maxTextSizeMb: 2.5 }).maxTextSize).toBe(2.5 * 1024 * 1024);
  });

  it("0 视为不限（undefined）", () => {
    expect(读取索引默认值({ maxTextSizeMb: 0 }).maxTextSize).toBeUndefined();
  });

  it("负数视为不限", () => {
    expect(读取索引默认值({ maxTextSizeMb: -1 }).maxTextSize).toBeUndefined();
  });

  it("非数字退成不限（不是退成默认 10MB）", () => {
    // 注意这条**不能证伪** `Number.isFinite(上限MB) && 上限MB > 0` 里的
    // Number.isFinite：NaN > 0 本身就是 false，去掉也一样走 undefined。
    // 换句话说那个 Number.isFinite 是可读性冗余，不是必要防护。
    // Infinity 是同理（Infinity > 0 为 true，会得到 Infinity——
    // 但配置文件里写不出 Infinity，所以不测）。
    expect(读取索引默认值({ maxTextSizeMb: "abc" }).maxTextSize).toBeUndefined();
  });
});

describe("读取索引默认值：排除规则", () => {
  it("正常数组原样保留", () => {
    expect(读取索引默认值({ excludePatterns: ["node_modules", ".git"] }).exclude).toEqual([
      "node_modules",
      ".git",
    ]);
  });

  it("空数组变成 undefined（不是 []）", () => {
    expect(读取索引默认值({ excludePatterns: [] }).exclude).toBeUndefined();
  });

  it("全是空白项的数组变成 undefined", () => {
    // 若不清掉空白项，最后会得到 exclude: ["", "  "]，
    // 而空串 glob 可能匹配到所有路径
    expect(读取索引默认值({ excludePatterns: ["", "  ", "\t"] }).exclude).toBeUndefined();
  });

  it("混合时只保留非空白项（不 trim 值本身）", () => {
    expect(读取索引默认值({ excludePatterns: ["a", "", "b"] }).exclude).toEqual(["a", "b"]);
  });

  it("非数组退成 undefined", () => {
    expect(读取索引默认值({ excludePatterns: "node_modules" }).exclude).toBeUndefined();
    expect(读取索引默认值({ excludePatterns: null }).exclude).toBeUndefined();
  });

  it("数组里非字符串项转字符串", () => {
    expect(读取索引默认值({ excludePatterns: [1, true] }).exclude).toEqual(["1", "true"]);
  });
});

describe("读取索引默认值：是否索引文本内容", () => {
  it("缺省是 true", () => {
    expect(读取索引默认值({}).indexTextContent).toBe(true);
  });

  it("只有明确的 false 才关闭", () => {
    expect(读取索引默认值({ indexTextContent: false }).indexTextContent).toBe(false);
  });

  it("0 / 空串 / null 都不关闭（只有 false 算）", () => {
    // 若写成 `节.indexTextContent ? true : false`，
    // "false" 字符串、0、null 全都会变成「关闭」，用户改了配置文件却没生效
    expect(读取索引默认值({ indexTextContent: 0 }).indexTextContent).toBe(true);
    expect(读取索引默认值({ indexTextContent: "" }).indexTextContent).toBe(true);
    expect(读取索引默认值({ indexTextContent: null }).indexTextContent).toBe(true);
  });
});

describe("规范路径", () => {
  it("转小写（Windows 路径大小写不敏感）", () => {
    expect(规范路径("C:/Users/Test").toLowerCase()).toBe(规范路径("C:/Users/Test"));
    expect(规范路径("C:/Users/Test")).toBe(规范路径("c:/users/test"));
  });

  it("去掉尾部路径分隔符", () => {
    const a = 规范路径("C:/a/b");
    expect(规范路径("C:/a/b/")).toBe(a);
    expect(规范路径("C:/a/b///")).toBe(a);
  });

  it("相对路径转绝对（不依赖 cwd 的字面值，只验证一致性）", () => {
    expect(规范路径(".")).toBe(规范路径("./"));
    expect(规范路径("a/../b")).toBe(规范路径("b"));
  });
});

describe("是否在目录下：边界", () => {
  it("根自身算在根下", () => {
    expect(是否在目录下("C:/data/mkg", "C:/data/mkg")).toBe(true);
  });

  it("直接子项算在根下", () => {
    expect(是否在目录下("C:/data/mkg/a.txt", "C:/data/mkg")).toBe(true);
  });

  it("深层子项算在根下", () => {
    expect(是否在目录下("C:/data/mkg/a/b/c.txt", "C:/data/mkg")).toBe(true);
  });

  it("前缀相同但不同目录**不算**（+ sep 不能省）", () => {
    // 少了 `+ sep` 时 startsWith("c:/data/mkg") 对 "c:/data/mkg-backup" 为 true，
    // 于是备份目录被当成知识库目录 → 编辑器保存时覆盖错文件
    expect(是否在目录下("C:/data/mkg-backup/a.txt", "C:/data/mkg")).toBe(false);
  });

  it("根是子串的兄弟目录不算", () => {
    expect(是否在目录下("C:/data/mkg2", "C:/data/mkg")).toBe(false);
  });

  it("父目录不算在子目录下", () => {
    expect(是否在目录下("C:/data", "C:/data/mkg")).toBe(false);
  });

  it("不同盘符不算", () => {
    expect(是否在目录下("D:/data/mkg/a", "C:/data/mkg")).toBe(false);
  });

  it("尾部分隔符不影响判定", () => {
    expect(是否在目录下("C:/data/mkg/a.txt", "C:/data/mkg/")).toBe(true);
  });

  it("大小写不影响判定（Windows）", () => {
    expect(是否在目录下("C:/DATA/MKG/a.txt", "c:/data/mkg")).toBe(true);
  });
});

describe("识别扩展名", () => {
  it("普通文件", () => {
    expect(识别扩展名("a.txt")).toBe("txt");
    expect(识别扩展名("C:/a/b.md")).toBe("md");
  });

  it("转小写", () => {
    expect(识别扩展名("A.TXT")).toBe("txt");
    expect(识别扩展名("a.JsOn")).toBe("json");
  });

  it("多个点时取最后一个", () => {
    expect(识别扩展名("a.b.c.ts")).toBe("ts");
    expect(识别扩展名("archive.tar.gz")).toBe("gz");
  });

  it("**无扩展名时返回空串，不返回文件名**", () => {
    // split(".").pop() 对 "/a/Makefile" 返回 "Makefile"，
    // 看起来像扩展名，会进各类型集合做无用匹配
    expect(识别扩展名("C:/a/Makefile")).toBe("");
    expect(识别扩展名("noext")).toBe("");
  });

  it("点开头的隐藏文件整体当扩展名（.gitignore → gitignore）", () => {
    // 这样 .gitignore / .editorconfig 能进文本集合。
    // **注意**：这条测的是行为，但不构成守门人——
    // 实现里 `点 === 0` 那个分支删掉也得到同样结果
    // （lastIndexOf(".") 为 0 时 slice(0+1) === slice(1)），
    // 它是可读性分支而非必要防护。真正的守门人是上面那条
    // 「无扩展名时返回空串」——用 split(".").pop() 会红 4 条。
    expect(识别扩展名(".gitignore")).toBe("gitignore");
    expect(识别扩展名("C:/a/.editorconfig")).toBe("editorconfig");
  });

  it("路径里的点不会被误当扩展名（目录名带点）", () => {
    // 若先 split(".") 再 pop，"C:/a.b/Makefile" 会得到 "b/Makefile"
    expect(识别扩展名("C:/a.b/Makefile")).toBe("");
  });

  it("尾部有分隔符不炸", () => {
    expect(识别扩展名("C:/a/b/")).toBe("");
  });

  it("以点结尾返回空串（\"a.\" 没有扩展名）", () => {
    expect(识别扩展名("a.")).toBe("");
  });
});

describe("判定文件类型", () => {
  it("文本类", () => {
    const r = 判定文件类型("C:/a/readme.md");
    expect(r.isText).toBe(true);
    expect(r.extension).toBe("md");
    expect(r.isImage).toBe(false);
  });

  it("代码文件也算文本", () => {
    for (const 名 of ["a.ts", "a.py", "a.rs", "a.go", "a.sql", "a.ps1"]) {
      expect(判定文件类型(名).isText, 名).toBe(true);
    }
  });

  it("图片", () => {
    expect(判定文件类型("a.png").isImage).toBe(true);
    expect(判定文件类型("a.JPG").isImage).toBe(true);
  });

  it("svg 同时是文本和图片（不是二选一）", () => {
    // svg 既能被文本编辑器打开，又是图片
    const r = 判定文件类型("a.svg");
    expect(r.isImage).toBe(true);
    expect(r.isText).toBe(true);
  });

  it("压缩包", () => {
    expect(判定文件类型("a.zip").isArchive).toBe(true);
    expect(判定文件类型("a.tar.gz").isArchive).toBe(true);
  });

  it("视频与音频", () => {
    expect(判定文件类型("a.mp4").isVideo).toBe(true);
    expect(判定文件类型("a.mp3").isAudio).toBe(true);
  });

  it("ogg 同时是音频和视频（容器格式）", () => {
    expect(判定文件类型("a.ogg").isAudio).toBe(true);
    expect(判定文件类型("a.ogg").isVideo).toBe(true);
  });

  it("未知扩展名时全部 false，但 extension 仍然回填", () => {
    const r = 判定文件类型("a.xyz");
    expect(r.isText).toBe(false);
    expect(r.isImage).toBe(false);
    expect(r.isArchive).toBe(false);
    expect(r.isVideo).toBe(false);
    expect(r.isAudio).toBe(false);
    expect(r.extension).toBe("xyz");
  });

  it("无扩展名时全部 false 且 extension 是空串", () => {
    const r = 判定文件类型("C:/a/Makefile");
    expect(r.extension).toBe("");
    expect(r.isText).toBe(false); // Makefile 在集合里但没有扩展名，取不到
  });

  it("各类集合互不混淆（抽查几个关键的）", () => {
    expect(文本扩展名.has("ts")).toBe(true);
    expect(图片扩展名.has("ts")).toBe(false);
    expect(压缩包扩展名.has("zip")).toBe(true);
    expect(视频扩展名.has("mp4")).toBe(true);
    expect(音乐扩展名.has("flac")).toBe(true);
    expect(视频扩展名.has("flac")).toBe(false);
  });
});
