import { describe, expect, it } from "vitest";
import {
  判定重新接入,
  能力指纹,
  比较版本,
  规整路径,
  是原位,
  type 注册快照,
  type 上报快照,
} from "../src/module-identity.js";

const 基础: 注册快照 = {
  name: "Demo",
  version: "1.0.0",
  path: "C:/mods/demo/run.js",
  capabilityHash: "abc",
  autoUpdate: true,
};

const 上报 = (改: Partial<上报快照> = {}): 上报快照 => ({
  name: "Demo",
  version: "1.0.0",
  path: "C:/mods/demo/run.js",
  capabilityHash: "abc",
  ...改,
});

describe("比较版本", () => {
  it("识别更新/相同/落后", () => {
    expect(比较版本("1.1.0", "1.0.0")).toBeGreaterThan(0);
    expect(比较版本("1.0.0", "1.0.0")).toBe(0);
    expect(比较版本("0.9.0", "1.0.0")).toBeLessThan(0);
  });

  it("补齐位数：1.2 == 1.2.0", () => {
    expect(比较版本("1.2", "1.2.0")).toBe(0);
  });

  it("忽略 v 前缀与预发布后缀", () => {
    expect(比较版本("v1.2.3", "1.2.3")).toBe(0);
    expect(比较版本("1.2.3-beta", "1.2.3")).toBe(0);
  });

  it("缺失版本时按 0 处理", () => {
    expect(比较版本(undefined, "0.0.0")).toBe(0);
    expect(比较版本("0.0.1", undefined)).toBeGreaterThan(0);
  });
});

describe("规整路径 / 是原位", () => {
  it("统一分隔符与大小写", () => {
    expect(规整路径("C:\\Mods\\Demo\\run.js")).toBe(规整路径("c:/mods/demo/run.js"));
  });

  it("同路径视为原位", () => {
    expect(是原位(基础, 上报())).toBe(true);
  });

  it("不同路径不是原位", () => {
    expect(是原位(基础, 上报({ path: "D:/other/run.js" }))).toBe(false);
  });

  it("双方都没路径时宽松视为原位", () => {
    expect(是原位({ ...基础, path: undefined }, 上报({ path: undefined }))).toBe(true);
  });
});

describe("能力指纹", () => {
  it("顺序无关", () => {
    const a = 能力指纹([{ 名称: "a" }, { 名称: "b" }]);
    const b = 能力指纹([{ 名称: "b" }, { 名称: "a" }]);
    expect(a).toBe(b);
  });

  it("名称变化会产生不同指纹", () => {
    expect(能力指纹([{ 名称: "a" }])).not.toBe(能力指纹([{ 名称: "c" }]));
  });

  it("空声明返回空串", () => {
    expect(能力指纹([])).toBe("");
    expect(能力指纹(undefined)).toBe("");
  });
});

describe("判定重新接入", () => {
  it("无注册记录 → first", () => {
    expect(判定重新接入(null, 上报()).类型).toBe("first");
  });

  it("版本相同、信息未变 → online", () => {
    expect(判定重新接入(基础, 上报()).类型).toBe("online");
  });

  it("版本更新的原位模块默认自动更新", () => {
    const r = 判定重新接入(基础, 上报({ version: "1.1.0" }));
    expect(r.类型).toBe("auto-update");
    if (r.类型 === "auto-update") {
      expect(r.旧版本).toBe("1.0.0");
      expect(r.新版本).toBe("1.1.0");
    }
  });

  it("关闭自动更新时改为 manual-update", () => {
    const r = 判定重新接入({ ...基础, autoUpdate: false }, 上报({ version: "1.1.0" }));
    expect(r.类型).toBe("manual-update");
  });

  it("内置模块强制自动更新", () => {
    const r = 判定重新接入({ ...基础, autoUpdate: false, builtin: true }, 上报({ version: "2.0.0" }));
    expect(r.类型).toBe("auto-update");
  });

  it("版本相同但能力变化 → replace（信息变化）", () => {
    const r = 判定重新接入(基础, 上报({ capabilityHash: "xyz" }));
    expect(r.类型).toBe("replace");
    if (r.类型 === "replace") {
      expect(r.原因).toBe("信息变化");
      expect(r.差异.length).toBeGreaterThan(0);
    }
  });

  it("版本回退 → replace（版本回退）", () => {
    const r = 判定重新接入(基础, 上报({ version: "0.9.0" }));
    expect(r.类型).toBe("replace");
    if (r.类型 === "replace") expect(r.原因).toBe("版本回退");
  });

  it("非原位 → reject", () => {
    const r = 判定重新接入(基础, 上报({ path: "D:/moved/run.js", version: "1.1.0" }));
    expect(r.类型).toBe("reject");
    if (r.类型 === "reject") expect(r.原因).toBe("非原位");
  });

  it("缺少 module.query → reject", () => {
    const r = 判定重新接入(基础, 上报(), false);
    expect(r.类型).toBe("reject");
    if (r.类型 === "reject") expect(r.原因).toBe("缺少状态查询能力");
  });

  it("首次注册不要求 module.query（尚无注册记录可比对）", () => {
    expect(判定重新接入(null, 上报(), false).类型).toBe("first");
  });
});
