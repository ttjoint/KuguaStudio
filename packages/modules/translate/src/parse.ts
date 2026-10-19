/**
 * Google 网页翻译接口的响应解析。
 *
 * 为什么单独成文件：
 *
 * 这些函数是**在线抓取**的解析层，最容易被上游改版打坏，而且坏了很静默——
 * 解析不出来就返回空串，用户看到的是「翻译结果是空的」而不是报错。
 * 放在 `index.ts` 里它们没有导出、无法测；抽出来才能钉住。
 *
 * 另外 `解析译文` 的正则本身就很脆：它假设了 `result-container`
 * 出现在某个 div 上且内容里没有嵌套 div。这里把当前**实际行为**
 * 连同它的边界一起测住，将来上游变了只要改一个文件。
 */

/** 解码 HTML 实体（&amp; &lt; 等） */
export function 解码HTML实体(s: string): string {
  return s
    .replace(/&amp;/g, "&")
    .replace(/&lt;/g, "<")
    .replace(/&gt;/g, ">")
    .replace(/&quot;/g, '"')
    .replace(/&#39;/g, "'")
    .replace(/&nbsp;/g, " ");
}

/**
 * 从 HTML 中解析 `result-container` div 的内容。
 *
 * 找不到返回 `null`（而不是空串）——调用方据此区分「没找到容器」
 * 与「容器是空的」，前者通常是上游改版，值得看一眼。
 */
export function 解析译文(html: string): string | null {
  const m = html.match(/div[^"]*?"result-container".*?>([\s\S]*?)<\/div>/);
  return m ? m[1] : null;
}

/** 语言名 → 显示名（去掉「语」结尾，用于拼「译日译法」这种链路） */
export function 语言显示名(名: string): string {
  return 名.endsWith("语") ? 名.slice(0, -1) : 名;
}

/**
 * 把输入按行切开、每行再按 100 字符分块。
 *
 * 抽出来是为了能验「分行与分块的边界」——尤其空行处理：
 * 全空行会被丢掉（不是保留成空串），这是当前行为，接缝处容易踩。
 */
export function 切块(输入: string, 每块 = 100): { 行: string; 块: string[] }[] {
  const 行s = 输入
    .split(/\r?\n/)
    .map((s) => s.trim())
    .filter((s) => s.length > 0);
  return 行s.map((行) => {
    const 块: string[] = [];
    for (let i = 0; i < 行.length; i += 每块) 块.push(行.slice(i, i + 每块));
    return { 行, 块 };
  });
}
