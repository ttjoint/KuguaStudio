// 用 esbuild 打包渲染层为多个 IIFE 产物：
//   index.js       主界面（parts/ 全部模块）
//   kugua-shim.js  浏览器桥接（window.kugua，必须早于 index.js 加载）
//   plugin-sdk.js  插件 UI SDK（经 /plugin-sdk.js 提供给插件页）
import { build } from "esbuild";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const 包根 = join(dirname(fileURLToPath(import.meta.url)), "..");

await build({
  absWorkingDir: 包根,
  entryPoints: {
    index: "src/renderer/parts/main.ts",
    "kugua-shim": "src/renderer/kugua-shim.ts",
    "plugin-sdk": "src/renderer/plugin-sdk.ts",
  },
  bundle: true,
  format: "iife",
  target: ["es2020"],
  platform: "browser",
  outdir: "dist/renderer",
  entryNames: "[name]",
  charset: "utf8",
  legalComments: "none",
  logLevel: "warning",
  minify: false,
});

console.log("[renderer] esbuild 打包完成（index.js / kugua-shim.js / plugin-sdk.js）");
