import { 定时任务, 定时任务动作, 模块详情, 知识库统计, 系统快照, 资源 } from "./01-types";
import { 添加HTML, 添加消息 } from "./03-preview";
import { 路由结果 } from "./04-router";
import { 刷新模块列表, 刷新统计 } from "./06-shell";

// ===== 结果格式化 =====

export function 模块结果文本(r: Record<string, unknown>): string {
  const 输入字段 = ["原因", "输入", "主题", "日期", "攻", "受"];
  const 表现 = 输入字段.map((k) => (typeof r[k] === "string" && r[k] ? r[k] : "")).filter(Boolean).join(" ");
  const 结果 = typeof r.结果 === "string" ? r.结果 : "";
  return 表现 ? `${表现} —— ${结果}` : 结果;
}

export function 格式化输出(路由: 路由结果, 结果: unknown): void {
  const r = 结果 as Record<string, unknown>;

  // 语音合成结果：渲染音频播放器
  if (路由.动作 === "tts.speak") {
    if (r && typeof r.base64 === "string" && r.base64) {
      添加HTML(
        `<div class="msg-sender">${路由.描述}</div><audio controls src="data:audio/wav;base64,${r.base64}" style="width:100%;max-width:320px"></audio>`,
      );
    } else {
      添加消息("语音合成失败：无音频返回", "error");
    }
    return;
  }

  // 图片结果：渲染 base64 图片（图文并茂）
  if (r && typeof r === "object" && typeof r.base64 === "string" && r.base64) {
    const fmt = String(r.format || "png").replace(/^image\//, "");
    添加HTML(`<div class="msg-sender">${路由.描述}</div><img class="msg-image" src="data:image/${fmt};base64,${r.base64}" alt="${路由.描述}">`);
    return;
  }

  // 通用文本模块结果：{ 结果, 原因/输入/主题/日期 }
  if (r && typeof r === "object" && typeof r.结果 === "string") {
    添加消息(模块结果文本(r), "system", 路由.描述);
    return;
  }

  switch (路由.动作) {
    case "divination.zhouyi": {
      const 解读 = r.解读 as string;
      添加消息(解读, "system", "占卜结果");
      break;
    }
    case "avatar.userAvatar": {
      const r = 结果 as { qq: string; url: string; base64: string; format: string };
      添加HTML(
        `<div class="msg-sender">QQ ${r.qq} 的头像（${r.url}）</div><img class="msg-image" src="data:image/${r.format};base64,${r.base64}" alt="头像">`,
      );
      break;
    }
    case "avatar.groupAvatar": {
      const r = 结果 as { groupid: string; 数量: number; 头像: Array<{ url: string; base64: string }> };
      if (!r.头像 || r.头像.length === 0) {
        添加消息(`群 ${r.groupid}：未找到历史头像`, "system", "群头像");
        break;
      }
      const 图 = r.头像
        .map((a) => `<img class="msg-image" src="data:image/jpeg;base64,${a.base64}" alt="群头像">`)
        .join("");
      添加HTML(`<div class="msg-sender">群 ${r.groupid} 的历史头像（${r.数量} 个）</div>${图}`);
      break;
    }
    case "qrcode.generate": {
      const r = 结果 as { format: string; base64: string; 文本?: string };
      添加HTML(
        `<div class="msg-sender">二维码：${r.文本 ?? ""}</div><img class="msg-image" src="data:image/${r.format};base64,${r.base64}" alt="二维码">`,
      );
      break;
    }
    case "chatmode.say": {
      const r = 结果 as { 模式: string; 结果: string };
      添加消息(r.结果 || "（该模式无语料）", "system", `${r.模式}模式`);
      break;
    }
    case "music.play": {
      const r = 结果 as { 名称?: string; 歌手?: string; base64: string; format: string };
      添加HTML(
        `<div class="msg-sender">&#x1F3B5; ${r.名称 ?? ""} ${r.歌手 ?? ""}</div><audio controls src="data:audio/${r.format};base64,${r.base64}"></audio>`,
      );
      break;
    }
    case "music.search": {
      const r = 结果 as { 列表: Array<{ 名称: string; 歌手: string; 可下载: boolean }> };
      const 文本列表 = (r.列表 ?? [])[0]
        ? r.列表.map((s, i) => `${i + 1}. ${s.名称} - ${s.歌手}${s.可下载 ? "" : "（不可下载）"}`).join("\n")
        : "无结果";
      添加消息(文本列表, "system", "搜歌");
      break;
    }
    case "food.recommend": {
      添加消息(r.推荐 as string, "system", "推荐");
      break;
    }
    case "mkg.search": {
      const total = r.total as number;
      const items = r.items as 资源[];
      if (items.length === 0) {
        添加消息("未找到匹配结果", "system", "搜索结果");
        return;
      }
      let html = `<div class="msg-sender">搜索结果（共 ${total} 条，显示 ${items.length} 条）</div>`;
      for (const item of items) {
        const 摘要 = item.snippet ? `：<br>&nbsp;&nbsp;${item.snippet.slice(0, 100)}…` : "";
        html += `<div class="resource-link">${item.path}${摘要}</div>`;
      }
      添加HTML(html);
      break;
    }
    case "mkg.resource.import": {
      const r2 = 结果 as { added: number; updated: number; removed: number; duplicate?: { name: string; path: string } };
      if (r2.duplicate) {
        添加消息(`资料库中已存在完全一致的文件，未重复导入：${r2.duplicate.name}（${r2.duplicate.path}）`, "system", "导入结果");
      } else {
        添加消息(`导入完成：新增 ${r2.added}，更新 ${r2.updated}，移除 ${r2.removed}`, "system", "导入结果");
      }
      void 刷新统计();
      break;
    }
    case "mkg.resource.list": {
      const items = r.items as 资源[];
      if (items.length === 0) {
        添加消息("知识库为空", "system");
        return;
      }
      let html = `<div class="msg-sender">资源列表（共 ${r.total} 条）</div>`;
      for (const item of items.slice(0, 20)) {
        html += `<div>${item.kind === "file" ? "📄" : "📁"} ${item.path} <span style="color:var(--text-dim)">(${item.size}B)</span></div>`;
      }
      if (items.length > 20) html += `<div style="color:var(--text-dim)">…还有 ${items.length - 20} 条</div>`;
      添加HTML(html);
      break;
    }
    case "mkg.tag.list": {
      const tags = 结果 as { id: number; name: string }[];
      if (tags.length === 0) {
        添加消息("暂无标签", "system");
        return;
      }
      const 列表 = tags.map((t) => `[${t.id}] ${t.name}`).join("、");
      添加消息(`标签（${tags.length} 个）：${列表}`, "system");
      break;
    }
    case "mkg.stats": {
      const s = 结果 as 知识库统计;
      添加消息(
        `资源总数：${s.资源总数}（文件 ${s.文件数} / 目录 ${s.目录数}）\n标签：${s.标签数}\n关联：${s.关联数}\n文本索引：${s.文本内容数}`,
        "system",
        "知识库统计",
      );
      void 刷新统计();
      break;
    }
    case "nigane.registry.details": {
      const modules = 结果 as 模块详情[];
      if (modules.length === 0) {
        添加消息("当前无模块注册", "system");
        return;
      }
      let html = `<div class="msg-sender">模块注册（${modules.length} 个）</div>`;
      for (const m of modules) {
        const caps = (m.capabilities ?? []).join("、") || "无能力";
        const online = Boolean(m.online);
        const 类型 = m.type === "library" ? "库" : m.type === "process" ? "进程" : "未知";
        const 状态 = online
          ? m.type === "process"
            ? `运行中 (pid=${m.pid ?? "?"})`
            : "就绪"
          : m.type === "library" && m.fileExists === false
            ? "文件缺失"
            : "离线";
        const autoText = m.autoStart ? " · <span style=\"color:var(--accent)\">[自启]</span>" : "";
        const descText = m.description ? `<div style="color:var(--text-dim);font-size:0.85rem;padding-left:1.2rem">${m.description}</div>` : "";
        html += `<div><span style="color:${online ? "var(--green)" : "var(--text-dim)"}">●</span> <b>${m.name}</b> v${m.version ?? "?"} · [${类型}] ${状态}${autoText}<br><span style="color:var(--text-dim);padding-left:1.2rem">${caps}</span>${descText}</div>`;
      }
      添加HTML(html);
      void 刷新模块列表();
      break;
    }
    case "nigane.registry.start": {
      const r = 结果 as { started: boolean; reason?: string; pid?: number | null };
      if (r.started || r.reason === "already") {
        添加消息(r.reason === "already" ? "模块已在运行" : `启动成功，pid=${r.pid ?? "?"}`, "system", "启动结果");
      } else {
        添加消息(`启动失败：${r.reason ?? "未知"}`, "error");
      }
      void 刷新模块列表();
      break;
    }
    case "nigane.registry.stop": {
      const r = 结果 as { stopped: boolean; reason?: string };
      if (r.stopped || r.reason === "not_running") {
        添加消息(r.reason === "not_running" ? "模块本就未运行" : "已停止", "system", "停止结果");
      } else {
        添加消息(`停止失败：${r.reason ?? "未知"}`, "error");
      }
      void 刷新模块列表();
      break;
    }
    case "monitor.stats": {
      const s = 结果 as 系统快照;
      const 字节 = (n: number): string =>
        n >= 1 << 30 ? `${(n / (1 << 30)).toFixed(1)} GB` : n >= 1 << 20 ? `${(n / (1 << 20)).toFixed(1)} MB` : `${(n / 1024).toFixed(0)} KB`;
      let 文本 = `CPU：${s.cpu.usagePct.toFixed(1)}%（${s.cpu.cores} 核）\n内存：${字节(s.memory.used)} / ${字节(s.memory.total)}（${s.memory.usagePct.toFixed(1)}%）`;
      if (s.disk.length > 0) {
        文本 += "\n磁盘：\n" + s.disk.map((d) => `  ${d.name} ${字节(d.used)} / ${字节(d.total)}（${d.usagePct.toFixed(1)}%）`).join("\n");
      }
      添加消息(文本, "system", "系统状态");
      break;
    }
    case "scheduler.actions": {
      const list = 结果 as Array<{
        名称: string;
        模块: string;
        动作: string;
        标题?: string;
        说明?: string;
        中文指令?: string[];
      }>;
      if (!list || list.length === 0) {
        添加消息("暂无已声明「可定时」的能力。模块可在能力声明中设置 暴露.定时=true。", "system", "任务动作");
        break;
      }
      const 列表 = list
        .map((a, i) => `${i + 1}. ${a.标题 ?? a.名称}（${a.模块}/${a.动作}）${a.说明 ? " — " + a.说明 : ""}`)
        .join("\n");
      添加消息(列表, "system", "任务动作");
      break;
    }
    case "scheduler.task.list": {
      const tasks = 结果 as 定时任务[];
      if (tasks.length === 0) {
        添加消息('暂无定时任务，可用「添加定时任务 <名称> <频率> <模块> <动作>」创建。', "system");
        return;
      }
      let html = `<div class="msg-sender">定时任务（${tasks.length} 个）</div>`;
      for (const t of tasks) {
        const 动作文本 = 任务动作描述(t.action);
        const 下次 = t.nextRunAt ? new Date(t.nextRunAt).toLocaleString() : "—";
        html += `<div>${t.enabled ? "🟢" : "⚪"} <b>${t.name}</b> · ${t.cron} → ${动作文本}<br><span style="color:var(--text-dim);padding-left:1.2rem">下次：${下次}${t.lastResult ? ` · 上次：${t.lastResult.ok ? "成功" : "失败"}` : ""}</span></div>`;
      }
      添加HTML(html);
      break;
    }
    case "scheduler.task.get": {
      const t = 结果 as 定时任务;
      添加消息(
        `定时任务「${t.name}」（${t.enabled ? "启用" : "停用"}）\ncron：${t.cron}\n动作：${任务动作描述(t.action)}\n下次运行：${t.nextRunAt ? new Date(t.nextRunAt).toLocaleString() : "—"}\n上次结果：${t.lastResult ? (t.lastResult.ok ? "成功：" + t.lastResult.message : "失败：" + t.lastResult.message) : "尚未执行"}`,
        "system",
        "查看定时任务",
      );
      break;
    }
    case "scheduler.task.create": {
      const t = 结果 as 定时任务;
      添加消息(
        `已创建定时任务「${t.name}」（${t.enabled ? "启用" : "停用"}）\ncron：${t.cron}\n下次运行：${t.nextRunAt ? new Date(t.nextRunAt).toLocaleString() : "—"}`,
        "system",
        "添加定时任务",
      );
      break;
    }
    case "scheduler.task.update":
    case "scheduler.task.enable": {
      const t = 结果 as 定时任务;
      添加消息(`定时任务「${t.name}」已${t.enabled ? "启用" : "停用"}`, "system");
      break;
    }
    case "scheduler.task.delete": {
      const r = 结果 as { removed: boolean };
      添加消息(r.removed ? "已删除定时任务" : "定时任务不存在", "system");
      break;
    }
    case "scheduler.task.runNow": {
      const r = 结果 as { ok: boolean; message: string };
      添加消息(r.ok ? `执行成功：${r.message}` : `执行失败：${r.message}`, r.ok ? "system" : "error", "立即执行");
      break;
    }
    case "ai.chat": {
      const r = 结果 as { reply: string; model: string };
      添加消息(r.reply, "system", `AI（${r.model}）`);
      break;
    }
    case "ai.memory.clear": {
      添加消息("AI 记忆已清空", "system");
      break;
    }
    case "dice.roll": {
      const d = 结果 as { 文本?: string; 描述?: string; 总和?: number };
      添加消息(d.文本 ?? `掷骰结果：${d.描述 ?? ""}`, "system", "掷骰");
      break;
    }
    default:
      添加消息(JSON.stringify(结果, null, 2), "system");
  }
}

export function 任务动作描述(a: 定时任务动作): string {
  if (a.kind === "request") return `${a.to}/${a.action}`;
  if (a.kind === "event") return `广播 ${a.action}`;
  return `命令 ${a.command ?? ""}`;
}

export function 帮助文本(): string {
  return `可用指令：
【图片】先拖拽图片到聊天框，再输入：
  灰度 / 反色 / 水平翻转 / 垂直翻转 / 镜像
  旋转90度 / 高清（放大/超分，Real-ESRGAN）/ 缩小 / 网格 / 切边 / 抠图 / 做旧 / 取色
  像素字 [文字] / 验证码 [文字] / 随机像素 / 色块 [颜色]

【生成类】
  占卜 [问题]      — 周易蓍草占卜
  今天吃什么       — 随机推荐食物
  [时间][动词]什么  — 如"晚上喝什么"

【掷骰】
  r3d6 / 掷骰 / 掷骰3个6面 [缘由]

【文本】
  反转/大写/小写/乱序/火星文 [内容]
  攻受 [攻] [受] / 讽刺 [话题] / 什么是 [概念]
  狗屁不通 [主题] / 云杰说道 [主题] / 营销号 [主题]
  随机汉字 [行] [列] / 历史上的今天

【万年历】
  今天 / 公历 2012年5月20日

【翻译】
  翻译 [文字] / 翻译成日语 [文字] / 译3次 [文字]

【信息工具】
  计算 1+2*3 / 查IP 1.2.3.4 / url编码 / url解码 / 字节 / 转十六进制 / 十六进制转 / 体脂

【AI 与语音】
  ai <问题>            — 向 AI 提问（前缀忽略大小写；也可用 问AI / AI问答）
  AI图片 <描述>        — AI 生成图片
  清空AI记忆           — 清空当前对话记忆
  说话 <文字>          — 本地语音合成并播放

提示：聊天页左侧「指令」列表可点击调用；双击某项进入持续前缀（对话）模式，
      此后每条输入自动发送给该指令；再次双击或点提示条上的「退出」结束。

【数字论证】
  论证 [词语]

【知识库】
  搜索 [关键词]     — 按路径/文件名搜索
  搜索内容 [关键词] — 按文本内容搜索
  导入 [路径]       — 导入文件或目录
  资源列表          — 列出已索引资源
  标签列表          — 列出所有标签
  统计              — 知识库统计信息

【系统】
  模块列表 / 模块详情 — 查看所有模块（含运行状态、类型、PID）
  启动 <模块名>       — 手动启动进程型模块
  停止 <模块名>       — 手动停止进程型模块
  监控 / 系统状态     — 查看 CPU/内存/磁盘实时状态
  定时任务列表        — 查看全部定时任务
  添加定时任务 <名称> <频率> <模块> <动作>  — 频率：每秒/每分/每5分/每10分/每30分/每小时/每天/每周一/每月
  查看/暂停/恢复/删除/立即执行定时任务 <名称>
  帮助                — 显示本帮助`;
}

