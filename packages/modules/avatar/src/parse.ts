/**
 * 头像模块的两个纯函数。
 *
 * ## 为什么单独抽出来
 *
 * `图片尺寸` 靠读文件头判断 PNG/GIF/JPEG 的宽高——三种格式、三套字节偏移，
 * 写错一个偏移量的后果是**返回 {0,0}**，然后下游把它当成「这张图没有尺寸」。
 * 不会抛错、不会崩，只是功能悄悄失效。
 *
 * `取号码` 决定「用户给的那串东西里哪段是 QQ 号」。正则放宽一格
 * 就可能把「2024年3月」当成 QQ 号；收紧一格就可能把合法的 5 位数挡掉。
 * 这类边界只能一条一条钉。
 */

/**
 * 读图片尺寸（PNG / GIF / JPEG）。
 *
 * 认不出时返回 `{width:0, height:0}` 而不是抛错——调用方据此判断
 * 「这不是一张能识别的图」并给用户一句人话，比抛异常更合适。
 */
export function 图片尺寸(buf: Buffer): { width: number; height: number } {
  // PNG: 89 50 4E 47 ... IHDR 在固定位置，宽高在偏移 16/20，大端
  if (buf.length >= 24 && buf[0] === 0x89 && buf[1] === 0x50) {
    return { width: buf.readUInt32BE(16), height: buf.readUInt32BE(20) };
  }
  // GIF: "GIF"，宽高在偏移 6/8，**小端**
  if (buf.length >= 10 && buf[0] === 0x47 && buf[1] === 0x49 && buf[2] === 0x46) {
    return { width: buf.readUInt16LE(6), height: buf.readUInt16LE(8) };
  }
  // JPEG: 逐段扫 SOF 标记
  if (buf.length >= 4 && buf[0] === 0xff && buf[1] === 0xd8) {
    let i = 2;
    while (i + 9 < buf.length) {
      if (buf[i] !== 0xff) {
        i++;
        continue;
      }
      const 标记 = buf[i + 1];
      // SOF0~SOF15 里带尺寸，但要排除 C4(DHT)/C8(JPG)/CC(DAC)——它们同段但没尺寸
      if (标记 >= 0xc0 && 标记 <= 0xcf && 标记 !== 0xc4 && 标记 !== 0xc8 && 标记 !== 0xcc) {
        return { height: buf.readUInt16BE(i + 5), width: buf.readUInt16BE(i + 7) };
      }
      const 长度 = buf.readUInt16BE(i + 2);
      i += 2 + 长度;
    }
  }
  return { width: 0, height: 0 };
}

/**
 * 从参数里取 QQ 号 / 群号。
 *
 * 按固定顺序试多个键名，取**第一个**能抠出合法号码的。
 * 合法 = 5 位及以上、首位非 0 的数字串（QQ 号最短 5 位，群号同理）。
 */
export function 取号码(p: Record<string, unknown>): string {
  const 候选 = [p.qq, p.groupid, p.群号, p.号码, p.参数文本, p.原文];
  for (const c of 候选) {
    if (typeof c === "string") {
      const m = c.match(/[1-9][0-9]{4,}/);
      if (m) return m[0];
    }
    if (typeof c === "number" && c >= 10000) return String(c);
  }
  return "";
}
