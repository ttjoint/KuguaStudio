/**
 * music 纯解析层测试。
 *
 * ## 这个模块为什么危险
 *
 * 「搜歌」出错了不会报错，只会**结果不对**：
 * 用户点「搜歌 周杰伦 数量 3」，得到 10 条；点「点歌」，搜的是网易云而不是他指定的 QQ。
 * 这类默认值错误肉眼几乎看不出——因为 10 条看起来也挺正常。
 *
 * 更隐蔽的是三源响应归一化。三个平台的字段名完全不一样
 * （`name` / `SongName` / `name`，`ar` / `singer` / `SingerName`），
 * 抄错一个字段名的后果是「歌手一栏全空」，而列表本身照样能显示。
 *
 * 文件名清洗错了则直接是事故：Windows 上写文件抛 EINVAL，
 * 或者 `../` 逃出数据目录。
 */

import { describe, expect, it } from "vitest";
import {
  安全文件名,
  归一参数,
  是否MP3,
  默认数量,
  最大数量,
  解析QQ,
  解析酷狗,
  解析网易云,
} from "../src/parse.js";

describe("归一参数：关键词的回退链", () => {
  it("优先用 关键词", () => {
    expect(归一参数({ 关键词: "周杰伦" }).关键词).toBe("周杰伦");
  });

  it("没有 关键词 时用 参数文本", () => {
    expect(归一参数({ 参数文本: "晴天" }).关键词).toBe("晴天");
  });

  it("都没有时用 原文", () => {
    expect(归一参数({ 原文: "稻香" }).关键词).toBe("稻香");
  });

  it("三个都给时，关键词优先（不是按出现顺序）", () => {
    expect(归一参数({ 关键词: "甲", 参数文本: "乙", 原文: "丙" }).关键词).toBe("甲");
  });

  it("一律 trim（指令面板常带尾随空格）", () => {
    expect(归一参数({ 关键词: "  周杰伦  " }).关键词).toBe("周杰伦");
  });

  it("全空时是空串而不是 \"undefined\"", () => {
    expect(归一参数({}).关键词).toBe("");
    expect(归一参数(null).关键词).toBe("");
    expect(归一参数(undefined).关键词).toBe("");
  });
});

describe("归一参数：来源白名单", () => {
  it("三个合法值原样通过", () => {
    expect(归一参数({ 来源: "wyy" }).来源).toBe("wyy");
    expect(归一参数({ 来源: "qq" }).来源).toBe("qq");
    expect(归一参数({ 来源: "kg" }).来源).toBe("kg");
  });

  it("非法值退回 wyy（因为只有 wyy 能下载）", () => {
    // 退到 qq/kg 会让「点歌」直接失败，所以退到 wyy 是刻意的
    expect(归一参数({ 来源: "kuwo" }).来源).toBe("wyy");
    expect(归一参数({ 来源: "" }).来源).toBe("wyy");
    expect(归一参数({ 来源: 123 }).来源).toBe("wyy");
  });

  it("大小写不认（QQ 不合法，要小写）", () => {
    expect(归一参数({ 来源: "QQ" }).来源).toBe("wyy");
  });

  it("缺省时是 wyy", () => {
    expect(归一参数({}).来源).toBe("wyy");
  });
});

describe("归一参数：数量", () => {
  it("缺省是 10", () => {
    expect(归一参数({}).数量).toBe(默认数量);
    expect(默认数量).toBe(10);
  });

  it("合法值原样通过", () => {
    expect(归一参数({ 数量: 3 }).数量).toBe(3);
  });

  it("上限夹到 30", () => {
    expect(最大数量).toBe(30);
    expect(归一参数({ 数量: 999 }).数量).toBe(30);
    expect(归一参数({ 数量: 31 }).数量).toBe(30);
  });

  it("30 本身不夹（是闭区间上界）", () => {
    expect(归一参数({ 数量: 30 }).数量).toBe(30);
  });

  it("0 和负数退默认（不是夹到 1）", () => {
    // 数量 0 意味着「我不要结果」，视为没填更合理
    expect(归一参数({ 数量: 0 }).数量).toBe(10);
    expect(归一参数({ 数量: -5 }).数量).toBe(10);
  });

  it("非数字退默认", () => {
    expect(归一参数({ 数量: "5" }).数量).toBe(10); // 字符串不认
    expect(归一参数({ 数量: NaN }).数量).toBe(10);
    expect(归一参数({ 数量: Infinity }).数量).toBe(30); // Math.min(Infinity,30)=30
  });
});

describe("归一参数：反向与 id", () => {
  it("反向是真值转换", () => {
    expect(归一参数({ 反向: true }).反向).toBe(true);
    expect(归一参数({ 反向: "yes" }).反向).toBe(true); // Boolean("yes")=true
    expect(归一参数({ 反向: 0 }).反向).toBe(false);
    expect(归一参数({}).反向).toBe(false);
  });

  it("id 一律转字符串（数字 id 不能变 number 去拼 URL）", () => {
    expect(归一参数({ id: 12345 }).id).toBe("12345");
    expect(归一参数({ id: "abc" }).id).toBe("abc");
    expect(归一参数({}).id).toBe("");
  });
});

describe("安全文件名：非法字符", () => {
  it("Windows 九个非法字符都换成下划线", () => {
    const 结果 = 安全文件名('a\\b/c:d*e?f"g<h>i|j', 0);
    expect(结果).toBe("a_b_c_d_e_f_g_h_i_j");
  });

  it("中文与空格保留（不需要转义）", () => {
    expect(安全文件名("周杰伦 - 晴天", 0)).toBe("周杰伦 - 晴天");
  });

  it("斜杠必须替换（否则能逃出数据目录）", () => {
    expect(安全文件名("../../etc/passwd", 0)).toBe(".._.._etc_passwd");
    expect(安全文件名("..\\..\\windows", 0)).toBe(".._.._windows");
  });
});

describe("安全文件名：长度与兜底", () => {
  it("截断到 80 字符", () => {
    const 长 = "甲".repeat(200);
    expect(安全文件名(长, 0).length).toBe(80);
  });

  it("正好 80 不截断", () => {
    const 正好 = "甲".repeat(80);
    expect(安全文件名(正好, 0)).toBe(正好);
  });

  it("清洗后为空时用时间戳兜底（不能返回空串）", () => {
    // 返回空串会写出 `.mp3`：隐藏文件，用户找不到，而且下次会互相覆盖
    expect(安全文件名("", 1700000000000)).toBe("music_1700000000000");
  });

  it("全是非法字符时也兜底", () => {
    const r = 安全文件名('///', 42);
    expect(r).toBe("___"); // 非空，所以不走兜底
    expect(r.length).toBeGreaterThan(0);
  });

  it("兜底值随时间戳变化（不互相覆盖）", () => {
    expect(安全文件名("", 1)).not.toBe(安全文件名("", 2));
  });
});

describe("是否MP3", () => {
  it("content-type 含 audio 就算", () => {
    expect(是否MP3("audio/mpeg", [])).toBe(true);
    expect(是否MP3("audio/mp3; charset=binary", [])).toBe(true);
  });

  it("content-type 是 JSON 但开头是 ID3 → 算（有些 CDN 不给 audio 类型）", () => {
    expect(是否MP3("application/octet-stream", [0x49, 0x44, 0x33])).toBe(true);
  });

  it("JSON 错误页（HTTP 200 但不含 audio、无 ID3）→ 不算", () => {
    // 网易云外链在 VIP/版权限制时就是这样：状态码 200，内容是 JSON
    const json = Buffer.from('{"code":404}');
    expect(是否MP3("application/json", json)).toBe(false);
  });

  it("HTML 错误页 → 不算", () => {
    const html = Buffer.from("<html>");
    expect(是否MP3("text/html", html)).toBe(false);
  });

  it("content-type 为空但开头是 ID3 → 算", () => {
    expect(是否MP3("", [0x49, 0x44, 0x33])).toBe(true);
  });

  it("只有两个字节时不能越界崩", () => {
    expect(是否MP3("", [0x49, 0x44])).toBe(false);
    expect(是否MP3("", [])).toBe(false);
  });

  it("ID3 魔数必须三个字节全对（前两字节对不够）", () => {
    expect(是否MP3("", [0x49, 0x44, 0x00])).toBe(false);
  });
});

describe("解析网易云", () => {
  it("正常响应", () => {
    const r = 解析网易云({
      result: {
        songs: [
          {
            id: 123,
            name: "晴天",
            ar: [{ name: "周杰伦" }],
            al: { name: "叶惠美" },
            privilege: { fl: 320000 },
          },
        ],
      },
    });
    expect(r).toEqual([
      { id: "123", 名称: "晴天", 歌手: "周杰伦", 专辑: "叶惠美", 来源: "wyy", 可下载: true },
    ]);
  });

  it("id 是 number 但归一出 string（拼 URL 时不能是 number）", () => {
    expect(typeof 解析网易云({ result: { songs: [{ id: 1, name: "x" }] } })[0].id).toBe("string");
  });

  it("fl === 0 视为不可下载", () => {
    const r = 解析网易云({ result: { songs: [{ id: 1, name: "x", privilege: { fl: 0 } }] } });
    expect(r[0].可下载).toBe(false);
  });

  it("没有 privilege 字段时视为可下载（免费歌常不带）", () => {
    const r = 解析网易云({ result: { songs: [{ id: 1, name: "x" }] } });
    expect(r[0].可下载).toBe(true);
  });

  it("缺 ar / al 时给空串而不是 undefined", () => {
    const r = 解析网易云({ result: { songs: [{ id: 1, name: "x" }] } });
    expect(r[0].歌手).toBe("");
    expect(r[0].专辑).toBe("");
  });

  it("畸形响应一律返空数组（不抛错）", () => {
    expect(解析网易云(null)).toEqual([]);
    expect(解析网易云({})).toEqual([]);
    expect(解析网易云({ result: {} })).toEqual([]);
    expect(解析网易云({ result: { songs: null } })).toEqual([]);
    expect(解析网易云("字符串")).toEqual([]);
  });
});

describe("解析QQ", () => {
  it("正常响应", () => {
    const r = 解析QQ({
      data: {
        song: {
          list: [
            {
              mid: "0039MnYb0qxYhV",
              name: "稻香",
              singer: [{ name: "周杰伦" }],
              album: { name: "魔杰座" },
              pay: { pay_play: 0 },
            },
          ],
        },
      },
    });
    expect(r).toEqual([
      {
        id: "0039MnYb0qxYhV",
        名称: "稻香",
        歌手: "周杰伦",
        专辑: "魔杰座",
        来源: "qq",
        可下载: true,
      },
    ]);
  });

  it("pay_play === 1 视为付费", () => {
    const r = 解析QQ({
      data: { song: { list: [{ mid: "m", name: "x", pay: { pay_play: 1 } }] } },
    });
    expect(r[0].可下载).toBe(false);
  });

  it("没有 pay 时视为可下载", () => {
    const r = 解析QQ({ data: { song: { list: [{ mid: "m", name: "x" }] } } });
    expect(r[0].可下载).toBe(true);
  });

  it("缺 singer / album 时给空串", () => {
    const r = 解析QQ({ data: { song: { list: [{ mid: "m", name: "x" }] } } });
    expect(r[0].歌手).toBe("");
    expect(r[0].专辑).toBe("");
  });

  it("畸形响应一律返空数组", () => {
    expect(解析QQ(null)).toEqual([]);
    expect(解析QQ({})).toEqual([]);
    expect(解析QQ({ data: {} })).toEqual([]);
    expect(解析QQ({ data: { song: {} } })).toEqual([]);
  });
});

describe("解析酷狗", () => {
  it("正常响应（字段名与另两源完全不同）", () => {
    const r = 解析酷狗({
      data: {
        lists: [
          {
            FileHash: "abc123",
            SongName: "夜曲",
            SingerName: "周杰伦",
            AlbumName: "十一月的萧邦",
            trans_param: { musicpack_advance: 0 },
          },
        ],
      },
    });
    expect(r).toEqual([
      {
        id: "abc123",
        名称: "夜曲",
        歌手: "周杰伦",
        专辑: "十一月的萧邦",
        来源: "kg",
        可下载: true,
      },
    ]);
  });

  it("musicpack_advance === 1 视为付费", () => {
    const r = 解析酷狗({
      data: { lists: [{ FileHash: "h", SongName: "x", SingerName: "", AlbumName: "", trans_param: { musicpack_advance: 1 } }] },
    });
    expect(r[0].可下载).toBe(false);
  });

  it("酷狗的 id 是 FileHash（不是数字 id）", () => {
    const r = 解析酷狗({ data: { lists: [{ FileHash: "HASH", SongName: "x", SingerName: "", AlbumName: "" }] } });
    expect(r[0].id).toBe("HASH");
  });

  it("畸形响应一律返空数组", () => {
    expect(解析酷狗(null)).toEqual([]);
    expect(解析酷狗({})).toEqual([]);
    expect(解析酷狗({ data: {} })).toEqual([]);
    expect(解析酷狗({ data: { lists: null } })).toEqual([]);
  });
});

describe("三源的共同不变量", () => {
  const 样本 = [
    { 名: "wyy", 解析: 解析网易云, 体: { result: { songs: [{ id: 1, name: "x" }] } }, 源: "wyy" },
    { 名: "qq", 解析: 解析QQ, 体: { data: { song: { list: [{ mid: "m", name: "x" }] } } }, 源: "qq" },
    {
      名: "kg",
      解析: 解析酷狗,
      体: { data: { lists: [{ FileHash: "h", SongName: "x", SingerName: "", AlbumName: "" }] } },
      源: "kg",
    },
  ];

  it("每源的 来源 字段都正确标记（错了会导致下载失败）", () => {
    for (const { 名, 解析, 体, 源 } of 样本) {
      expect(解析(体)[0].来源, 名).toBe(源);
    }
  });

  it("每源的 id 都是非空字符串", () => {
    for (const { 名, 解析, 体 } of 样本) {
      const id = 解析(体)[0].id;
      expect(typeof id, 名).toBe("string");
      expect(id.length, 名).toBeGreaterThan(0);
    }
  });

  it("每源的空响应都返回 []（不是抛错）", () => {
    expect(解析网易云({ result: { songs: [] } })).toEqual([]);
    expect(解析QQ({ data: { song: { list: [] } } })).toEqual([]);
    expect(解析酷狗({ data: { lists: [] } })).toEqual([]);
  });
});
