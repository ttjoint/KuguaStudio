/**
 * **自动生成，不要手改。**
 *
 * 来源：`packages/modules/image/src/actions.ts` 的 `动作声明表`
 * 生成：`npm run gen:image-defaults`
 *
 * 为什么聊天框要单独抄一份默认值，见 `scripts/gen-image-defaults.mjs` 顶部的说明。
 * 简言之：路由器是同步纯函数，没法 await 模块请求，只能引用预生成的常量。
 * 两份不一致会被 `packages/webui/test/image-defaults.test.ts` 抓住。
 */

export const 图片动作默认值: Record<string, Record<string, unknown>> = {
  "captcha": { "text": "" },
  "cisColor": { "Y": 1, "size": 200, "x": 0.3127, "y": 0.329 },
  "colorExtract": { "count": 3, "size": 80 },
  "colorSample": { "color": "#000000", "size": 80 },
  "cut": { "bottom": 0, "left": 0, "percent": false, "right": 0, "top": 0 },
  "gifRemoveFrame": { "begin": 0, "count": 1 },
  "gifSpeed": { "speed": 1 },
  "gifSprite": { "col": 1, "row": "横" },
  "gifUnzipGrid": { "col": 1, "row": 1 },
  "gifZip": { "sprite": false },
  "grid": { "scale": 2 },
  "hytk": { "colorful": false },
  "mirror": { "mode": 1 },
  "oldJpg": { "quality": 0.75 },
  "pixelWords": { "fontSize": 12, "lineMax": 20, "text": "" },
  "randomPixel": { "size": 100 },
  "removeBg": { "tolerance": 10 },
  "resize": { "scaleX": 1, "scaleY": 1 },
  "roll": { "degree": 0 },
  "rotate": { "degrees": 90 },
  "shake": { "degree": 0.5 },
  "upscale": { "faceEnhance": false, "provider": "auto", "scale": 4 },
};
