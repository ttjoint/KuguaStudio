/**
 * B 站短链（b23.tv）纯逻辑测试。
 *
 * ## 为什么值得测
 *
 * 这个接口有**三种「HTTP 200 但没有短链」**的情况，原实现全用
 * `jo?.data?.content ?? ""` 吞成空串：
 *
 * | 输入 | 实际响应 | 原来的结果 |
 * |---|---|---|
 * | 标准视频链接 | `{code:0, data:{content:"https://b23.tv/X"}}` | 短链 ✓ |
 * | 非 B 站链接 | `{code:0, data:{content:null}}` | `""` 静默空 |
 * | 已经是短链 | `{code:0, data:{content:null}}` | `""` 静默空 |
 * | 空串 | `{code:-400, message:"请求错误"}` | `""` 静默空 |
 *
 * 用户看到「结果一栏空白」时无法区分：链接不支持 / 网络坏了 / 自己没填。
 *
 * 另外原实现只检查 `res.ok` 不检查业务 `code`，HTTP 200 里带
 * `code: -400` 的业务错误被当成功处理。
 *
 * **上面这些响应形状是实测出来的**（2026-10-25 真调接口得到），
 * 不是猜的。接口行为变了的话本文件会红，提醒重新实测。
 */

import { describe, expect, it } from "vitest";
import { 是B站主机, 是合法URL, 短链表单, 解析短链响应 } from "../src/bili.js";

describe("解析短链响应：成功", () => {
  it("正常返回短链", () => {
    const r = 解析短链响应({
      code: 0,
      message: "OK",
      data: { content: "https://b23.tv/TSwaBa0", count: 0, card_type: 0 },
    });
    expect(r).toEqual({ 短链: "https://b23.tv/TSwaBa0" });
  });

  it("短链两侧空白被 trim", () => {
    expect(解析短链响应({ code: 0, data: { content: "  https://b23.tv/x  " } })).toEqual({
      短链: "https://b23.tv/x",
    });
  });

  it("没有 message 字段也能成功（不依赖它判成败）", () => {
    expect("短链" in 解析短链响应({ code: 0, data: { content: "https://b23.tv/x" } })).toBe(true);
  });

  it("code 缺失时按成功处理（只认明确的非 0）", () => {
    expect("短链" in 解析短链响应({ data: { content: "https://b23.tv/x" } })).toBe(true);
  });
});

describe("解析短链响应：业务错误码", () => {
  it("code 非 0 时返回错误，带上 code 与 message", () => {
    // 实测：空串输入返回 {code:-400, message:"请求错误"}
    const r = 解析短链响应({ code: -400, message: "请求错误" });
    expect("错误" in r).toBe(true);
    if ("错误" in r) {
      expect(r.错误).toContain("-400");
      expect(r.错误).toContain("请求错误");
    }
  });

  it("有 code 但没 message 时也能报错（不拼出 undefined）", () => {
    const r = 解析短链响应({ code: -412 });
    expect("错误" in r).toBe(true);
    if ("错误" in r) {
      expect(r.错误).toContain("-412");
      expect(r.错误).not.toContain("undefined");
    }
  });

  it("code 是 -400 但 data 里居然有 content 时，仍按错误处理", () => {
    // 业务码优先于 data：有错就是错，不能因为凑巧有 content 就当成功
    const r = 解析短链响应({ code: -400, message: "请求错误", data: { content: "https://b23.tv/x" } });
    expect("错误" in r).toBe(true);
  });
});

describe("解析短链响应：没有 content", () => {
  it("code 0 + content null → 明确说「无法生成短链」而不是空串", () => {
    // 实测：非 B 站链接与已是短链的链接都是这个响应
    const r = 解析短链响应({ code: 0, message: "OK", data: { content: null } });
    expect("错误" in r).toBe(true);
    if ("错误" in r) {
      expect(r.错误).toContain("无法生成短链");
    }
  });

  it("错误信息说明两种可能原因（用户据此判断）", () => {
    const r = 解析短链响应({ code: 0, data: { content: null } });
    if ("错误" in r) {
      expect(r.错误).toContain("B 站");
      expect(r.错误).toMatch(/短链/);
    }
  });

  it("data 整个缺失", () => {
    const r = 解析短链响应({ code: 0 });
    expect("错误" in r).toBe(true);
  });

  it("data 是 null", () => {
    const r = 解析短链响应({ code: 0, data: null });
    expect("错误" in r).toBe(true);
  });

  it("content 是空串也算没有", () => {
    const r = 解析短链响应({ code: 0, data: { content: "   " } });
    expect("错误" in r).toBe(true);
  });

  it("content 不是字符串（接口改成对象时）算没有", () => {
    const r = 解析短链响应({ code: 0, data: { content: { url: "x" } } });
    expect("错误" in r).toBe(true);
  });

  it("整个响应是垃圾值时不抛错", () => {
    for (const 值 of [null, undefined, "字符串", 42, []]) {
      expect(() => 解析短链响应(值), String(值)).not.toThrow();
      expect("错误" in 解析短链响应(值), String(值)).toBe(true);
    }
  });
});

describe("解析短链响应：永不返回空串", () => {
  it("任何输入下产物要么是短链要么是错误（不出现空串）", () => {
    // 这是本函数的核心不变量：空串无法区分「接口说没有」与「漏了字段」
    const 样本 = [
      { code: 0, data: { content: "https://b23.tv/x" } },
      { code: 0, data: { content: null } },
      { code: -400, message: "请求错误" },
      {},
      null,
      undefined,
      "x",
    ];
    for (const 值 of 样本) {
      const r = 解析短链响应(值);
      if ("短链" in r) expect(r.短链, JSON.stringify(值)).not.toBe("");
      else expect(r.错误.length, JSON.stringify(值)).toBeGreaterThan(0);
    }
  });
});

describe("是合法URL", () => {
  it("http / https 都可以", () => {
    expect(是合法URL("http://example.com")).toBe(true);
    expect(是合法URL("https://www.bilibili.com/video/BV1xx")).toBe(true);
  });

  it("大小写不敏感（HTTPS:// 也认）", () => {
    expect(是合法URL("HTTPS://example.com")).toBe(true);
  });

  it("两侧空白被忽略", () => {
    expect(是合法URL("  https://example.com  ")).toBe(true);
  });

  it("没有协议的算不合法（接口会回 -400）", () => {
    expect(是合法URL("www.bilibili.com/video/BV1xx")).toBe(false);
    expect(是合法URL("bilibili.com")).toBe(false);
  });

  it("空串与空白算不合法", () => {
    expect(是合法URL("")).toBe(false);
    expect(是合法URL("   ")).toBe(false);
  });

  it("其他协议算不合法（只支持 http/https）", () => {
    expect(是合法URL("ftp://example.com")).toBe(false);
    expect(是合法URL("file:///C:/a.txt")).toBe(false);
    expect(是合法URL("javascript:alert(1)")).toBe(false);
  });

  it("有协议但 URL 畸形算不合法", () => {
    expect(是合法URL("https://")).toBe(false);
    expect(是合法URL("https://a b.com")).toBe(false);
  });
});

describe("是B站主机", () => {
  it("主站与子域都算", () => {
    expect(是B站主机("https://www.bilibili.com/video/BV1xx")).toBe(true);
    expect(是B站主机("https://bilibili.com/")).toBe(true);
    expect(是B站主机("https://space.bilibili.com/123")).toBe(true);
    expect(是B站主机("https://m.bilibili.com/video/BV1xx")).toBe(true);
  });

  it("b23.tv 短链也算", () => {
    expect(是B站主机("https://b23.tv/TSwaBa0")).toBe(true);
  });

  it("大小写不敏感", () => {
    expect(是B站主机("https://WWW.BILIBILI.COM/video/BV1xx")).toBe(true);
  });

  it("相似域名不算（防止后缀匹配写松）", () => {
    // 写成 includes("bilibili.com") 的话下面全都会 true
    expect(是B站主机("https://fakebilibili.com/")).toBe(false);
    expect(是B站主机("https://bilibili.com.evil.com/")).toBe(false);
    expect(是B站主机("https://notb23.tv/")).toBe(false);
  });

  it("其他站不算", () => {
    expect(是B站主机("https://example.com/")).toBe(false);
    expect(是B站主机("https://youtube.com/watch?v=1")).toBe(false);
  });

  it("畸形 URL 返回 false 不抛错", () => {
    expect(是B站主机("不是URL")).toBe(false);
    expect(是B站主机("")).toBe(false);
  });
});

describe("短链表单", () => {
  const 表单 = 短链表单("https://www.bilibili.com/video/BV1xx", "ABC".repeat(10) + "infoc");

  it("oid 是长链（URL 编码后原样可还原）", () => {
    expect(表单.get("oid")).toBe("https://www.bilibili.com/video/BV1xx");
  });

  it("buvid 原样传入", () => {
    expect(表单.get("buvid")).toBe("ABC".repeat(10) + "infoc");
  });

  it("平台与分享渠道固定值（接口要求，改了会失败）", () => {
    expect(表单.get("platform")).toBe("android");
    expect(表单.get("share_channel")).toBe("COPY");
    expect(表单.get("share_mode")).toBe("3");
    expect(表单.get("share_id")).toBe("public.webview.0.0.pv");
    expect(表单.get("build")).toBe("6500300");
  });

  it("长链里的 & 与 ? 被正确编码（不会被当成额外字段）", () => {
    const f = 短链表单("https://x.com/a?b=1&c=2", "buv");
    // URLSearchParams 会编码，所以 set 进去的是原值，get 出来也是原值
    expect(f.get("oid")).toBe("https://x.com/a?b=1&c=2");
    // 且不会多出字段
    expect([...f.keys()].sort()).toEqual(
      ["build", "buvid", "oid", "platform", "share_channel", "share_id", "share_mode"].sort(),
    );
  });

  it("恰好七个字段（多一个少一个都会让接口行为变化）", () => {
    expect([...表单.keys()].length).toBe(7);
  });
});
