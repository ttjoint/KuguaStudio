import { readFileSync, writeFileSync } from "node:fs";

const src = readFileSync(
  "d:/Projects/KuguaStudio/参考/Kugua/KuguaNT/Algorithms/Chinese/Huoxingwen.cs",
  "utf-8"
);

function extractConst(name) {
  const re = new RegExp(`public const string ${name} = "([^"]*)";`);
  const m = src.match(re);
  if (!m) throw new Error(`未找到 ${name}`);
  return m[1];
}

const jt = extractConst("jt");
const ft = extractConst("ft");
const hx = extractConst("hx");

// 校验三集合长度一致
const lens = [jt.length, ft.length, hx.length];
console.log("长度:", lens);
if (new Set(lens).size !== 1) throw new Error("三集合长度不一致");

const out = `// 火星文字符集（严格复刻 C# Huoxingwen.cs 内联常量）
// jt=简体 3755 字，ft=繁体 3755 字，hx=火星文 3755 字，按索引一一对应
export const 简体字符集 = ${JSON.stringify(jt)};
export const 繁体字符集 = ${JSON.stringify(ft)};
export const 火星字符集 = ${JSON.stringify(hx)};
`;
writeFileSync("d:/Projects/KuguaStudio/packages/modules/text/src/data/hx_chars.ts", out, "utf-8");
console.log("已写出 hx_chars.ts，字节:", out.length);