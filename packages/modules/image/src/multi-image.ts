/**
 * 多图参数的路径 ↔ base64 转换（纯逻辑，不启动模块）。
 *
 * ## 为什么单独一个文件
 *
 * 这段逻辑原来写在 `index.ts` 里，而 `index.ts` 在**导入时**就
 * `启动模块({...})`——读配置、连主控，连不上直接 `process.exit(1)`。
 * 结果是单测只能 import `dist/index.js`，测试进程里跑起一个模块，
 * 报一堆 `process.exit unexpectedly called`，把真正的失败淹掉。
 *
 * ## 为什么必须有这一层
 *
 * 编辑页手里的图是路径（路径契约），而 `combine` / `gifZip` 这类底层函数
 * 的入参一直是 base64 数组（聊天框从第一天就这样传）。
 *
 * 两套契约都没错，错在中间没人做转换。不转的后果极隐蔽——甚至不报错：
 * `Buffer.from("D:\\x\\a.png", "base64")` 会静默返回一堆垃圾字节，
 * ImageMagick 照样能把它当成一张乱码图处理完，最后给用户一张 600x400 的
 * 怪东西，而两张 200x150 的图纵向拼接本该是 200x300。
 *
 * 所以统一在注册层转换：不管上游给的是路径还是 base64，下游只看到 base64。
 */

import { existsSync, readFileSync } from "node:fs";

/** 判断一个字符串是不是 base64（不靠长度猜，靠字符集） */
function 像base64(s: string): boolean {
  // base64 里不会有盘符冒号或路径分隔符，所以这条判断不会把 Windows 路径误判成 base64
  return /^[A-Za-z0-9+/=\r\n]+$/.test(s);
}

/**
 * 把多图参数里的路径读成 base64。
 *
 * 只转换声明里 `类型: "images"` 的参数——其它参数偶尔也带"看起来像路径"
 * 的字符串（比如输出目录），一并读进来的话会把目录当文件读，抛一堆 EISDIR。
 */
export function 补多图(
  声明: { 参数?: { 键: string; 类型: string }[] } | undefined,
  params: unknown,
): unknown {
  if (!声明 || !params || typeof params !== "object") return params;
  const 入 = params as Record<string, unknown>;
  const 多图键 = (声明.参数 ?? []).filter((p) => p.类型 === "images").map((p) => p.键);
  if (!多图键.length) return params;

  let 出: Record<string, unknown> | null = null;
  for (const 键 of 多图键) {
    const 列 = 入[键];
    if (!Array.isArray(列) || !列.length) continue;
    const 换 = 列.map((项) => {
      const s = String(项 ?? "");
      // 只有「看着不像 base64」且文件真实存在时才读。
      // 不靠长度/字符集猜 base64：base64 里不会有盘符冒号或路径分隔符。
      if (!s || 像base64(s)) return s;
      try {
        if (!existsSync(s)) return s;
        return readFileSync(s).toString("base64");
      } catch (err) {
        // 读失败就原样返回：下层会给出「这不是图」的报错，
        // 比在这里抛一个 EACCES 更接近用户的实际操作
        console.debug(`[图片模块] 多图参数 ${键} 读文件失败：${String(err)}`);
        return s;
      }
    });
    出 ??= { ...入 };
    出[键] = 换;
  }
  return 出 ?? params;
}
