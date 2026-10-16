import { 附件 } from "./02-chat-core";
import { 添加回应, 添加消息 } from "./03-preview";
import { 帮助文本, 格式化输出 } from "./05-format";
import { 与AI对话 } from "./10-chat-page";

// ===== 命令路由器 =====

/** 分析用户输入，路由到对应模块 */
export async function 处理输入(原文: string, 附件?: 附件[]): Promise<void> {
  const 文本 = 原文.trim();
  if (!文本 && (!附件 || 附件.length === 0)) return;

  if (!文本 && 附件 && 附件.length > 0) {
    添加消息("已添加附件，请输入处理指令（如图片：灰度、旋转90度、反色）。", "system");
    return;
  }

  添加消息(文本, "user");

  try {
    const 路由 = 路由指令(文本, 附件);
    if (路由) {
      await 执行路由(路由);
    } else {
      // 回退到能力注册表的中文指令；命中即调用
      const 已处理 = await 尝试能力指令(文本);
      if (!已处理) {
        添加消息(
          `未识别的指令：「${文本}」。可从左侧指令列表点击，或输入 ai <内容> 与 AI 对话。`,
          "system",
        );
      }
    }
  } catch (err) {
    添加消息(`执行失败：${String(err)}`, "error");
  }
}

/**
 * 尝试把文本当作注册表能力的中文指令调用；返回是否命中并已展示结果。
 */
export async function 尝试能力指令(文本: string): Promise<boolean> {
  try {
    const r = (await window.kugua.request("nigane", "capability.command", { 文本 })) as {
      命中?: boolean;
      能力?: string;
      结果?: unknown;
    };
    if (!r?.命中) return false;
    const 内容 = typeof r.结果 === "string" ? r.结果 : JSON.stringify(r.结果 ?? "");
    添加消息(内容 || "（无输出）", "system", r.能力 ?? "能力");
    return true;
  } catch (err) {
    添加回应(`能力调用失败：${String(err)}`, "能力", true);
    return true;
  }
}

export interface 路由结果 {
  目标: string;
  动作: string;
  参数?: unknown;
  描述: string;
  /** 不需要调用模块，直接显示的提示 */
  本地提示?: string;
}

export function 路由指令(文本: string, 附件?: 附件[]): 路由结果 | null {
  // 图片附件与"需图"辅助：图片类指令必须附带图片
  const 图 = 附件?.find((a) => a.type.startsWith("image/"));
  const 需图 = (动作: string, 参数: object, 描述: string): 路由结果 | null => {
    if (!图) return { 目标: "image", 动作, 描述, 本地提示: "请先拖拽一张图片到聊天框，再输入处理指令。" };
    return { 目标: "image", 动作, 参数: { ...参数, base64: 图.base64, path: 图.path }, 描述 };
  };

  // 占卜
  if (/^占卜/.test(文本)) {
    const 问题 = 文本.slice(2).trim() || undefined;
    return { 目标: "divination", 动作: "divination.zhouyi", 参数: { question: 问题 }, 描述: "周易占卜" };
  }


  // 吃什么
  const 吃匹配 = 文本.match(/^(.+)?(.{1})什么$/);
  if (吃匹配 && (吃匹配[2] === "吃" || 吃匹配[2] === "喝" || 吃匹配[2] === "玩")) {
    const 时间 = 吃匹配[1] || "今天";
    const 动词 = 吃匹配[2];
    return { 目标: "food", 动作: "food.recommend", 参数: { time: 时间, verb: 动词 }, 描述: "今天吃什么" };
  }
  if (文本 === "吃什么" || 文本 === "今天吃什么") {
    return { 目标: "food", 动作: "food.recommend", 参数: { time: "今天", verb: "吃" }, 描述: "今天吃什么" };
  }

  // 搜索（路径/文件名）
  const 搜索匹配 = 文本.match(/^搜索\s+(.+)$/);
  if (搜索匹配) {
    return { 目标: "mkg", 动作: "mkg.search", 参数: { type: "path", query: 搜索匹配[1], options: { limit: 20 } }, 描述: `搜索：${搜索匹配[1]}` };
  }

  // 搜索内容
  const 内容匹配 = 文本.match(/^搜索内容\s+(.+)$/);
  if (内容匹配) {
    return { 目标: "mkg", 动作: "mkg.search", 参数: { type: "content", query: 内容匹配[1], options: { limit: 20 } }, 描述: `搜索内容：${内容匹配[1]}` };
  }

  // 导入
  const 导入匹配 = 文本.match(/^导入\s+(.+)$/);
  if (导入匹配) {
    return { 目标: "mkg", 动作: "mkg.resource.import", 参数: { path: 导入匹配[1] }, 描述: `导入路径` };
  }

  // 资源列表
  if (文本 === "资源列表" || 文本 === "列表") {
    return { 目标: "mkg", 动作: "mkg.resource.list", 参数: { options: { limit: 50 } }, 描述: "资源列表" };
  }

  // 标签列表
  if (文本 === "标签列表" || 文本 === "标签") {
    return { 目标: "mkg", 动作: "mkg.tag.list", 描述: "标签列表" };
  }

  // 统计
  if (文本 === "统计" || 文本 === "知识库统计") {
    return { 目标: "mkg", 动作: "mkg.stats", 描述: "知识库统计" };
  }

  // 模块列表/详情
  if (文本 === "模块列表" || 文本 === "模块" || 文本 === "节点" || 文本 === "模块详情") {
    return { 目标: "nigane", 动作: "nigane.registry.details", 描述: "模块详情" };
  }
  // 启动模块
  const 启动匹配 = 文本.match(/^启动\s+(.+)$/);
  if (启动匹配) {
    return { 目标: "nigane", 动作: "nigane.registry.start", 参数: { name: 启动匹配[1].trim() }, 描述: `启动模块 ${启动匹配[1].trim()}` };
  }
  // 停止模块
  const 停止匹配 = 文本.match(/^停止\s+(.+)$/);
  if (停止匹配) {
    return { 目标: "nigane", 动作: "nigane.registry.stop", 参数: { name: 停止匹配[1].trim() }, 描述: `停止模块 ${停止匹配[1].trim()}` };
  }

  // 定时任务调度（M4）
  if (文本 === "定时任务" || 文本 === "定时任务列表" || 文本 === "任务列表") {
    return { 目标: "scheduler", 动作: "scheduler.task.list", 描述: "定时任务" };
  }
  if (文本 === "任务动作" || 文本 === "任务动作列表" || 文本 === "可用任务动作") {
    return { 目标: "scheduler", 动作: "scheduler.actions", 描述: "可定时任务动作" };
  }
  const 频率映射: Record<string, string> = {
    每秒: "* * * * * *",
    每分: "* * * * *",
    每5分: "*/5 * * * *",
    每10分: "*/10 * * * *",
    每30分: "*/30 * * * *",
    每小时: "0 * * * *",
    每天: "0 0 * * *",
    每周一: "0 0 * * 1",
    每月: "0 0 1 * *",
  };
  const 添加任务匹配 = 文本.match(/^添加定时任务\s+(\S+)\s+(\S+)\s+(\S+)\s+(\S+)\s*$/);
  if (添加任务匹配) {
    const [, 名称, 频率, 模块, 动作名] = 添加任务匹配;
    const cron = 频率映射[频率] ?? 频率;
    return {
      目标: "scheduler",
      动作: "scheduler.task.create",
      参数: { name: 名称, cron, action: { kind: "request", to: 模块, action: 动作名 } },
      描述: `添加定时任务 ${名称}`,
    };
  }
  const 添加启动任务匹配 = 文本.match(/^添加启动任务\s+(\S+)\s+(\S+)\s+(\S+)\s*$/);
  if (添加启动任务匹配) {
    const [, 名称, 模块, 动作名] = 添加启动任务匹配;
    return {
      目标: "scheduler",
      动作: "scheduler.task.create",
      参数: { name: 名称, 触发: "startup", action: { kind: "request", to: 模块, action: 动作名 } },
      描述: `添加启动任务 ${名称}`,
    };
  }
  const 查看任务匹配 = 文本.match(/^查看定时任务\s+(.+)$/);
  if (查看任务匹配) {
    return { 目标: "scheduler", 动作: "scheduler.task.get", 参数: { name: 查看任务匹配[1].trim() }, 描述: "查看定时任务" };
  }
  const 暂停任务匹配 = 文本.match(/^暂停定时任务\s+(.+)$/);
  if (暂停任务匹配) {
    return { 目标: "scheduler", 动作: "scheduler.task.enable", 参数: { name: 暂停任务匹配[1].trim(), enabled: false }, 描述: "暂停定时任务" };
  }
  const 恢复任务匹配 = 文本.match(/^恢复定时任务\s+(.+)$/);
  if (恢复任务匹配) {
    return { 目标: "scheduler", 动作: "scheduler.task.enable", 参数: { name: 恢复任务匹配[1].trim(), enabled: true }, 描述: "恢复定时任务" };
  }
  const 删除任务匹配 = 文本.match(/^删除定时任务\s+(.+)$/);
  if (删除任务匹配) {
    return { 目标: "scheduler", 动作: "scheduler.task.delete", 参数: { name: 删除任务匹配[1].trim() }, 描述: "删除定时任务" };
  }
  const 立即执行匹配 = 文本.match(/^立即执行定时任务\s+(.+)$/);
  if (立即执行匹配) {
    return { 目标: "scheduler", 动作: "scheduler.task.runNow", 参数: { name: 立即执行匹配[1].trim() }, 描述: "立即执行定时任务" };
  }

  // 系统监控
  if (文本 === "监控" || 文本 === "系统状态" || 文本 === "资源监控") {
    return { 目标: "monitor", 动作: "monitor.stats", 描述: "系统状态" };
  }

  // AI 问答 / 图像生成（M6）：前缀 `ai`（忽略大小写）或 `问AI` / `AI问答`
  const AI匹配 = 文本.match(/^(?:问AI|AI问答|ai)\s+(.+)$/i);
  if (AI匹配) {
    return { 目标: "ai", 动作: "ai.chat", 参数: { prompt: AI匹配[1].trim() }, 描述: "AI 问答" };
  }
  const AI图片匹配 = 文本.match(/^AI图片\s+(.+)$/);
  if (AI图片匹配) {
    return { 目标: "ai", 动作: "ai.image", 参数: { prompt: AI图片匹配[1].trim() }, 描述: "AI 生成图片" };
  }
  if (文本 === "清空AI记忆" || 文本 === "清空AI") {
    return { 目标: "ai", 动作: "ai.memory.clear", 描述: "清空 AI 记忆" };
  }

  // 语音合成（M6）
  const 语音匹配 = 文本.match(/^(说话|语音|朗读)\s+(.+)$/);
  if (语音匹配) {
    return { 目标: "tts", 动作: "tts.speak", 参数: { text: 语音匹配[2].trim() }, 描述: "语音合成" };
  }

  // 头像（qlogo，无需登录态）
  const 群头像匹配 = 文本.match(/^群\s*(\d{5,})\s*的头像$/);
  if (群头像匹配) {
    return { 目标: "avatar", 动作: "avatar.groupAvatar", 参数: { groupid: 群头像匹配[1] }, 描述: `群 ${群头像匹配[1]} 的历史头像` };
  }
  const 群头像匹配2 = 文本.match(/^群头像\s*(\d{5,})$/);
  if (群头像匹配2) {
    return { 目标: "avatar", 动作: "avatar.groupAvatar", 参数: { groupid: 群头像匹配2[1] }, 描述: `群 ${群头像匹配2[1]} 的历史头像` };
  }
  const 用户头像匹配 = 文本.match(/^(?:头像\s*)?(\d{5,})\s*的头像$/) || 文本.match(/^头像\s+(\d{5,})$/);
  if (用户头像匹配) {
    return { 目标: "avatar", 动作: "avatar.userAvatar", 参数: { qq: 用户头像匹配[1] }, 描述: `QQ ${用户头像匹配[1]} 的头像` };
  }

  // 模式闲聊（如「基督模式 你好啊」）
  const 模式匹配 = 文本.match(/^(\S{1,12}?)模式\s*(.*)$/);
  if (模式匹配) {
    return { 目标: "chatmode", 动作: "chatmode.say", 参数: { 模式: 模式匹配[1], 内容: 模式匹配[2] ?? "" }, 描述: `${模式匹配[1]}模式` };
  }

  // 音乐（点歌 / 搜歌）
  const 点歌匹配 = 文本.match(/^点歌[：:|\s]+(.+)$/);
  if (点歌匹配) {
    return { 目标: "music", 动作: "music.play", 参数: { 关键词: 点歌匹配[1].trim() }, 描述: "点歌" };
  }
  const 搜歌匹配 = 文本.match(/^搜歌[：:|\s]+(.+)$/);
  if (搜歌匹配) {
    return { 目标: "music", 动作: "music.search", 参数: { 关键词: 搜歌匹配[1].trim() }, 描述: "搜歌" };
  }

  // 帮助
  if (文本 === "帮助" || 文本 === "help" || 文本 === "?") {
    添加消息(帮助文本(), "system");
    return null;
  }

  // ===== 图片模块（严格按参考项目 ModImages 原指令输入方式复刻）=====
  // —— 反色（参考 ^反色$）——
  if (/^(反色|负片|取反|颜色反转)$/.test(文本)) return 需图("image.negate", {}, "图片反色");
  // —— 水平翻转（参考 ^水平翻转(.*)）——
  if (/^水平翻转/.test(文本)) return 需图("image.flipH", {}, "水平翻转");
  // —— 垂直翻转（参考 ^垂直翻转(.*)）——
  if (/^垂直翻转/.test(文本)) return 需图("image.flipV", {}, "垂直翻转");
  // —— 镜像1~4，缺省 1（参考 ^镜像(.*)，1/2/3/4 保留不同部分）——
  const 镜像匹配 = 文本.match(/^镜像([1-4])?$/);
  if (镜像匹配) return 需图("image.mirror", { mode: 镜像匹配[1] ? Number(镜像匹配[1]) : 1 }, "图片镜像");
  if (文本 === "镜子") return 需图("image.mirror", { mode: 1 }, "图片镜像");
  // —— 旋转N度，缺省 90（参考 ^旋转(.*)，缺省参则 90）——
  const 旋转匹配 = 文本.match(/^旋转\s*([\d.]+)?\s*度?$/);
  if (旋转匹配) return 需图("image.rotate", { degrees: 旋转匹配[1] ? Number(旋转匹配[1]) : 90 }, "图片旋转");
  // —— 缩放：横缩放N / 竖缩放N / 横竖缩放N / 缩放N（比例，参考 ^([横竖]*)缩放(.+)）——
  const 缩放匹配 = 文本.match(/^([横竖]*)缩放\s*([\d.]+)%?$/);
  if (缩放匹配) {
    const 方向 = 缩放匹配[1];
    let 倍率 = parseFloat(缩放匹配[2]);
    if (倍率 <= 0) 倍率 = 0.1;
    const 横 = 方向.includes("横") || 方向 === "";
    const 竖 = 方向.includes("竖") || 方向 === "";
    return 需图("image.resize", { scaleX: 横 ? 倍率 : 1, scaleY: 竖 ? 倍率 : 1 }, "图片缩放");
  }
  // —— 高清放大 / 超分（参考 ModImage2x.Get2X：Real-ESRGAN，缺依赖自动回退）——
  const 超分匹配 = 文本.match(/^(高清|放大|超分)([24])?$/);
  if (超分匹配) {
    return 需图("image.upscale", { scale: 超分匹配[2] ? Number(超分匹配[2]) : 4 }, "图片高清放大");
  }
  // 兼容保留：放大N / 缩小N（百分比）
  const 放缩匹配 = 文本.match(/^(放大|缩小|缩放)\s*(\d+)?\s*%?$/);
  if (放缩匹配) {
    const 词 = 放缩匹配[1];
    const 百分比 = 放缩匹配[2] ? Number(放缩匹配[2]) : (词 === "缩小" ? 50 : 词 === "放大" ? 150 : 100);
    return 需图("image.resize", { scaleX: 百分比 / 100, scaleY: 百分比 / 100 }, "图片缩放");
  }
  // —— 切：上下左右组合切 N / N%（参考 ^([上下左右]+)切(.+)）——
  const 切匹配 = 文本.match(/^([上下左右]+)切\s*([\d.]+)%?$/);
  if (切匹配) {
    const 方向 = 切匹配[1];
    const 数 = parseFloat(切匹配[2]);
    const 参: Record<string, number | boolean> = { percent: 切匹配[0].endsWith("%") };
    if (方向.includes("上")) 参.top = 数;
    if (方向.includes("下")) 参.bottom = 数;
    if (方向.includes("左")) 参.left = 数;
    if (方向.includes("右")) 参.right = 数;
    return 需图("image.cut", 参, "图片切割");
  }
  // 兼容保留：切边N（四边等切）
  const 切边匹配 = 文本.match(/^切边\s*(\d+)?$/);
  if (切边匹配) {
    const 边 = 切边匹配[1] ? Number(切边匹配[1]) : 10;
    return 需图("image.cut", { percent: false, top: 边, bottom: 边, left: 边, right: 边 }, "图片切边");
  }
  // —— 抖动：抖N / 内抖N（参考 ^(内?)抖(.*)，数字为震级 0~1 小数，支持逗号小数点）——
  if (/^(内?)抖/.test(文本)) {
    const 抖匹配 = 文本.match(/^(内?)抖\s*([\d.,]+)?$/);
    const 震级 = 抖匹配 && 抖匹配[2] ? parseFloat(抖匹配[2].replace(",", ".")) : 0.5;
    return 需图("image.shake", { degree: 震级 }, "图片抖动");
  }
  // —— 滚动N（参考 ^滚动(.*)，参数为方位角度）——
  if (/^滚动/.test(文本)) {
    const 滚匹配 = 文本.match(/^滚动\s*([\d.]+)?$/);
    const 角度 = 滚匹配 && 滚匹配[1] ? parseFloat(滚匹配[1]) : 0;
    return 需图("image.roll", { degree: 角度 }, "图片滚动");
  }
  // —— 网格化 / 网格化2（参考 ^网格化$ / ^网格化2$）——
  if (文本 === "网格化2") return 需图("image.gridHole", {}, "图片网格孔");
  if (文本 === "网格化") return 需图("image.grid", { scale: 2 }, "图片网格化");
  // 兼容保留：网格N / 网格孔
  const 网格匹配 = 文本.match(/^网格\s*(\d+)?$/);
  if (网格匹配) return 需图("image.grid", { scale: 网格匹配[1] ? Number(网格匹配[1]) : 2 }, "图片网格化");
  if (/^网格孔/.test(文本)) return 需图("image.gridHole", {}, "图片网格孔");
  // —— 抠图（参考 ^抠图）——
  if (/^抠图/.test(文本)) return 需图("image.removeBg", {}, "图片抠图");
  // —— 做旧（参考 ^做旧(.*)）——
  if (/^做旧/.test(文本)) return 需图("image.oldJpg", {}, "图片做旧");
  // —— 取色（参考 ^取色）——
  if (/^取色/.test(文本)) return 需图("image.colorExtract", {}, "图片取色");
  // —— 竖拼 / 横拼（参考 ^竖拼$ / ^横拼$）——
  if (文本 === "竖拼" || 文本 === "纵向拼接") return 需图("image.combineV", {}, "纵向拼接");
  if (文本 === "横拼" || 文本 === "横向拼接") return 需图("image.combineH", {}, "横向拼接");
  // 兼容保留：拼接（用横向拼接）
  const 拼接匹配 = 文本.match(/^(拼接)/);
  if (拼接匹配) return 需图("image.combineH", {}, "横向拼接");
  // —— 摸摸（参考 ^摸摸$）——
  if (文本 === "摸摸") return 需图("image.touchBall", {}, "图片摸摸");
  // —— 幻影坦克（参考 ^(彩色)?幻影(坦克)?$）——
  const 幻影匹配 = 文本.match(/^(彩色)?幻影(坦克)?$/);
  if (幻影匹配) return 需图("image.hytk", { colorful: !!幻影匹配[1] }, "幻影坦克");

  // —— GIF/图片序列系列（参考 ModImageGif.cs）——
  // 拆NxM：拆成 col x row 碎片（参考 ^拆(.+)x(.+)$，col=param[1], row=param[2]）
  const 拆格匹配 = 文本.match(/^拆\s*(\d+)\s*x\s*(\d+)$/);
  if (拆格匹配) return 需图("image.gifUnzipGrid", { col: Number(拆格匹配[1]), row: Number(拆格匹配[2]) }, "拆图");
  // 拆：拆成一组 PNG（参考 ^拆$）
  if (文本 === "拆") return 需图("image.gifUnzip", {}, "拆帧");
  // 拆帧：平铺成序列图（参考 ^拆帧(.*)$）
  if (文本 === "拆帧") return 需图("image.gifSprite", {}, "拆帧平铺");
  // 删N：删帧（参考 ^删(.+)），支持 "2"、"2,3"，第一个为起始帧、第二个为删除帧数
  const 删匹配 = 文本.match(/^删\s*([\-0-9]+)\s*(?:[,， ]+\s*([\-0-9]+))?$/);
  if (删匹配) {
    const 起始 = Number(删匹配[1]);
    const 数量 = 删匹配[2] ? Number(删匹配[2]) : 1;
    return 需图("image.gifRemoveFrame", { begin: 起始, count: 数量 }, "删帧");
  }
  // 合NxM：单图序列帧合成 gif（参考 ^合(\S*)$）
  const 合格匹配 = 文本.match(/^合\s*(\d+)\s*x\s*(\d+)$/);
  if (合格匹配) return 需图("image.gifZip", { row: Number(合格匹配[1]), col: Number(合格匹配[2]) }, "合成GIF");
  if (文本 === "合") return 需图("image.gifZip", { images: [] }, "合成GIF");
  // 乱序：打乱 gif 帧顺序（参考 ^乱序$）
  if (文本 === "乱序") return 需图("image.gifShuffle", {}, "乱序图");
  // gif：webp 转 gif/png（参考 ^gif$）
  if (文本 === "gif") return 需图("image.webpToGif", {}, "转GIF");
  // N倍速：调整 gif 播放速率，负数倒放（参考 ^(.+)倍速$）
  const 倍速匹配 = 文本.match(/^([\-0-9.]+)\s*倍速$/);
  if (倍速匹配) return 需图("image.gifSpeed", { speed: Number(倍速匹配[1]) }, "GIF倍速");

  // 图片生成类（无需附件）
  const 像素字匹配 = 文本.match(/^像素字\s*(.+)?$/);
  if (像素字匹配) return { 目标: "image", 动作: "image.pixelWords", 参数: { text: (像素字匹配[1] ?? "").trim() }, 描述: "像素字" };
  // 扭曲XX → 验证码风格 GIF（参考 ^扭曲(.+)）
  const 扭曲匹配 = 文本.match(/^扭曲\s*(.+)/);
  if (扭曲匹配) return { 目标: "image", 动作: "image.captcha", 参数: { text: 扭曲匹配[1].trim() }, 描述: "扭曲图片" };
  // 噪声N → 随机像素图（参考 ^噪声([0-9]*)）
  const 噪声匹配 = 文本.match(/^噪声\s*(\d*)?$/);
  if (噪声匹配) return { 目标: "image", 动作: "image.randomPixel", 参数: { size: 噪声匹配[1] ? Number(噪声匹配[1]) : 100 }, 描述: "随机像素图" };
  const 验证码匹配 = 文本.match(/^验证码\s*(.+)?$/);
  if (验证码匹配) return { 目标: "image", 动作: "image.captcha", 参数: { text: (验证码匹配[1] ?? "").trim() }, 描述: "验证码图片" };
  if (/^随机像素/.test(文本)) return { 目标: "image", 动作: "image.randomPixel", 参数: { size: 100 }, 描述: "随机像素图" };
  const 色块匹配 = 文本.match(/^色块\s*(#?[0-9a-fA-F]{3,8})?$/);
  if (色块匹配) return { 目标: "image", 动作: "image.colorSample", 参数: { color: 色块匹配[1] ?? "#000000", size: 80 }, 描述: "色块" };

  // —— 色卡：#RRGGBB 直接显示颜色（参考 ^#[0-9A-Fa-f]{6}$，showColor）——
  if (/^#[0-9A-Fa-f]{6}$/.test(文本)) return { 目标: "image", 动作: "image.colorSample", 参数: { color: 文本, size: 80 }, 描述: "色块" };
  // —— 遗像/遗照：灰度（参考 ^(遗像|遗照)$，getYixiang + Rec601Luminance）——
  if (文本 === "遗像" || 文本 === "遗照") return 需图("image.grayscale", {}, "遗像");
  // —— CIS 色卡：CIS x y Y（参考 ^CIS\s*(\S+)\s(\S+)\s(\S+)$，convertCIS + xyYtoRGB）——
  const CIS匹配 = 文本.match(/^CIS\s+([\d.]+)\s+([\d.]+)\s+([\d.]+)$/i);
  if (CIS匹配) return { 目标: "image", 动作: "image.cisColor", 参数: { x: Number(CIS匹配[1]), y: Number(CIS匹配[2]), Y: Number(CIS匹配[3]) }, 描述: "CIS色卡" };

  // ===== 骰子模块 =====
  const 骰匹配 = 文本.match(/^r?(\d*)d(\d+)$/i);
  if (骰匹配) {
    const 个数 = 骰匹配[1] ? Number(骰匹配[1]) : 1;
    const 面数 = Number(骰匹配[2]);
    return { 目标: "dice", 动作: "dice.roll", 参数: { 个数, 面数, 缘由: "掷骰" }, 描述: "掷骰" };
  }
  const 掷骰匹配 = 文本.match(/^掷骰(?:子)?(?:(\d+)个)?(?:(\d+)面)?(.*)$/);
  if (掷骰匹配 && 文本.includes("掷骰")) {
    const 个数 = 掷骰匹配[1] ? Number(掷骰匹配[1]) : 1;
    const 面数 = 掷骰匹配[2] ? Number(掷骰匹配[2]) : 6;
    const 缘由 = (掷骰匹配[3] ?? "").trim() || "掷骰";
    return { 目标: "dice", 动作: "dice.roll", 参数: { 个数, 面数, 缘由 }, 描述: "掷骰" };
  }

  // ===== 文本模块 =====
  if (/^(反转|倒过来|倒序|逆序)/.test(文本)) {
    return { 目标: "text", 动作: "text.reverse", 参数: { 文本: 文本.replace(/^(反转|倒过来|倒序|逆序)/, "").trim() }, 描述: "文本反转" };
  }
  if (/^大写/.test(文本)) return { 目标: "text", 动作: "text.toUpper", 参数: { 文本: 文本.replace(/^大写/, "").trim() }, 描述: "转大写" };
  if (/^小写/.test(文本)) return { 目标: "text", 动作: "text.toLower", 参数: { 文本: 文本.replace(/^小写/, "").trim() }, 描述: "转小写" };
  if (/^(乱序|打乱|洗牌)/.test(文本)) {
    return { 目标: "text", 动作: "text.shuffle", 参数: { 文本: 文本.replace(/^(乱序|打乱|洗牌)/, "").trim() }, 描述: "文本乱序" };
  }
  const 攻受匹配 = 文本.match(/^攻受\s*(\S+)\s*(\S+)$/);
  if (攻受匹配) return { 目标: "text", 动作: "text.gongshou", 参数: { 攻: 攻受匹配[1], 受: 攻受匹配[2] }, 描述: "攻受文" };
  if (/^(讽刺|苏联笑话)/.test(文本)) {
    return { 目标: "text", 动作: "text.joke", 参数: { 输入: 文本.replace(/^(讽刺|苏联笑话)/, "").trim() }, 描述: "讽刺生成" };
  }
  const 什么是匹配 = 文本.match(/^什么是\s*(.+)/);
  if (什么是匹配) return { 目标: "text", 动作: "text.salad", 参数: { 主题: 什么是匹配[1].trim() }, 描述: "概念流水账" };
  const 狗匹配 = 文本.match(/^狗屁不通\s*(.+)/);
  if (狗匹配) return { 目标: "text", 动作: "text.paper", 参数: { 主题: 狗匹配[1].trim() }, 描述: "狗屁不通" };
  const 云杰匹配 = 文本.match(/^云杰说道\s*(.+)/);
  if (云杰匹配) return { 目标: "text", 动作: "text.paper2", 参数: { 主题: 云杰匹配[1].trim() }, 描述: "云杰说道" };
  const 营销匹配 = 文本.match(/^营销号\s*(.+)/);
  if (营销匹配) return { 目标: "text", 动作: "text.paper3", 参数: { 主题: 营销匹配[1].trim() }, 描述: "营销号短文" };
  if (/^火星文/.test(文本)) {
    return { 目标: "text", 动作: "text.hx", 参数: { 文本: 文本.replace(/^火星文/, "").trim() }, 描述: "火星文" };
  }
  const 汉字匹配 = 文本.match(/^随机汉字\s*(\d+)?\s*(?:行)?(\d+)?$/);
  if (汉字匹配) {
    return { 目标: "text", 动作: "text.randomHans", 参数: { 行数: 汉字匹配[1] ? Number(汉字匹配[1]) : 1, 列数: 汉字匹配[2] ? Number(汉字匹配[2]) : 1 }, 描述: "随机汉字" };
  }
  if (/^历史上的今天/.test(文本)) return { 目标: "text", 动作: "text.historyToday", 参数: { 日期: "今天" }, 描述: "历史上的今天" };

  // ===== 万年历模块 =====
  if (/^(今天|今夕|今日黄历|黄历)$/.test(文本)) return { 目标: "calendar", 动作: "calendar.today", 描述: "今夕是何年" };
  const 日期匹配 = 文本.match(/^(\d{4}年\d{1,2}月\d{1,2}日)(?:\s*(\d{1,2})时?)?$/);
  if (日期匹配) {
    return { 目标: "calendar", 动作: "calendar.query", 参数: { 日期: 日期匹配[1], 时: 日期匹配[2] ? Number(日期匹配[2]) : undefined }, 描述: "万年历查询" };
  }

  // ===== 翻译模块 =====
  const 译N匹配 = 文本.match(/^(?:译|翻译)(\d+)(?:次|轮)/);
  if (译N匹配) {
    const 文字 = 文本.replace(/^(?:译|翻译)\d+(?:次|轮)/, "").trim();
    return { 目标: "translate", 动作: "translate.rounds", 参数: { 次数: Number(译N匹配[1]), 文字 }, 描述: "多轮翻译" };
  }
  const 翻译成匹配 = 文本.match(/^翻译成\s*(\S+)\s*[，,:：\s]+(.+)$/);
  if (翻译成匹配 && 文本.includes("翻译")) {
    return { 目标: "translate", 动作: "translate.translate", 参数: { 目标: 翻译成匹配[1], 文字: 翻译成匹配[2].trim() }, 描述: "翻译" };
  }
  const 翻译匹配 = 文本.match(/^翻译\s*(.+)$/);
  if (翻译匹配) {
    return { 目标: "translate", 动作: "translate.translate", 参数: { 目标: "英语", 文字: 翻译匹配[1].trim() }, 描述: "翻译" };
  }

  // ===== 信息工具模块 =====
  const 计算匹配 = 文本.match(/^计算\s*(.+)$/);
  if (计算匹配) return { 目标: "infotool", 动作: "infotool.calc", 参数: { 表达式: 计算匹配[1].trim() }, 描述: "计算" };
  const IP匹配 = 文本.match(/^查IP\s*(\S+)?$/i);
  if (IP匹配) return { 目标: "infotool", 动作: "infotool.ip", 参数: { ip: (IP匹配[1] ?? "").trim() }, 描述: "查IP" };
  if (/^url编码/i.test(文本)) return { 目标: "infotool", 动作: "infotool.urlEncode", 参数: { 数据: 文本.replace(/^url编码/i, "").trim() }, 描述: "URL编码" };
  if (/^url解码/i.test(文本)) return { 目标: "infotool", 动作: "infotool.urlDecode", 参数: { 数据: 文本.replace(/^url解码/i, "").trim() }, 描述: "URL解码" };
  if (/^字节/.test(文本)) return { 目标: "infotool", 动作: "infotool.byteSize", 参数: { 数据: 文本.replace(/^字节/, "").trim() }, 描述: "字节换算" };
  if (/^转十六进制/.test(文本)) return { 目标: "infotool", 动作: "infotool.toHex", 参数: { 数字: 文本.replace(/^转十六进制/, "").trim() }, 描述: "转十六进制" };
  if (/^十六进制转/.test(文本)) return { 目标: "infotool", 动作: "infotool.fromHex", 参数: { 十六进制: 文本.replace(/^十六进制转/, "").trim() }, 描述: "十六进制转十进制" };
  if (/^体脂/.test(文本)) return { 目标: "infotool", 动作: "infotool.bodyFat", 参数: { 参数: 文本.replace(/^体脂/, "").trim() }, 描述: "体脂估算" };

  // ===== 数字论证模块 =====
  const 论证匹配 = 文本.match(/^(论证|证明|数字论证)\s*(.+)/);
  if (论证匹配) return { 目标: "proof", 动作: "proof.demonstrate", 参数: { 输入: 论证匹配[2].trim() }, 描述: "数字论证" };

  return null;
}

export async function 执行路由(路由: 路由结果): Promise<void> {
  if (路由.本地提示) {
    添加消息(路由.本地提示, "system", 路由.描述);
    return;
  }
  // AI 对话：走带 chatId / 模型选择的专用通道（保留会话记忆）
  if (路由.目标 === "ai" && 路由.动作 === "ai.chat") {
    const p = (路由.参数 ?? {}) as { prompt?: string };
    await 与AI对话(String(p.prompt ?? ""));
    return;
  }
  try {
    const 结果 = await window.kugua.request(路由.目标, 路由.动作, 路由.参数);
    格式化输出(路由, 结果);
  } catch (err) {
    添加回应(`【${路由.描述}】失败：${String(err)}`, 路由.描述, true);
  }
}

