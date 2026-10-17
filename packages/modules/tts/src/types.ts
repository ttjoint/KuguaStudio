/**
 * 语音合成引擎抽象层：类型定义
 *
 * 目标：把「哪个引擎、哪个音色、什么情绪、什么格式」从调用方解耦出来。
 * 上层（能力处理器 / 批处理 / UI）只认这里的类型，不认具体引擎。
 *
 * 三类引擎按用途分层（`tier`）：
 *  - `fast`：低占用、低延迟，用于实时对话
 *  - `quality`：高质量、拟真、可控情绪，用于有声书批处理
 *  - `fallback`：纯 CPU 兜底，显存被占满时仍可用
 *
 * 新增引擎只需：
 *  1. 实现 `语音引擎` 接口
 *  2. 在 `registry.ts` 里登记
 *  无需改动上层任何代码。
 */

/** 引擎分层：决定调度顺序与默认用途 */
export type 引擎分层 = "fast" | "quality" | "fallback";

/** 输出音频格式 */
export type 音频格式 = "wav" | "ogg" | "aac" | "mp3";

/**
 * 音色定义。
 *
 * 零样本模型（VoxCPM / IndexTTS / CosyVoice）靠「参考音频 + 参考文本」克隆音色，
 * 不需要训练；微调模型（GPT-SoVITS）另需权重对。两类共用这一个结构，
 * 由引擎自行决定读哪些字段。
 */
export interface 音色 {
  /** 唯一标识，供 `tts.speak` 的 voice 参数引用 */
  id: string;
  /** 展示名 */
  name?: string;
  /** 自然语言描述，供引擎做风格迁移或 LLM 挑选 */
  description?: string;
  /** 参考音频路径（零样本克隆必需） */
  refAudio?: string;
  /** 参考音频对应的文本（提升克隆保真度；IndexTTS/VoxCPM 的 Ultimate 模式需要） */
  refText?: string;
  /** 参考音频语言（zh / en / ja …） */
  refLang?: string;

  // ---- 以下为微调类引擎（GPT-SoVITS）专用 ----
  /** GPT 权重路径 */
  gptWeights?: string;
  /** SoVITS 权重路径 */
  sovitsWeights?: string;
  /** 引擎内部说话人编号（sherpa 的多说话人模型用） */
  speakerId?: number;
}

/**
 * 情绪控制。
 *
 * 不同引擎支持程度不同，引擎应**忽略自己不支持的字段**而不是报错——
 * 这样同一份剧本可以换引擎渲染。
 */
export interface 情绪控制 {
  /** 自然语言情绪描述，如「低沉压抑地朗读」 */
  text?: string;
  /** 指定情绪参考音频，把该音频的情绪迁移过来 */
  refAudio?: string;
  /** 情绪强度 0~1 */
  intensity?: number;
  /**
   * 多维情绪向量。
   *
   * 顺序按 IndexTTS 约定：高兴、愤怒、悲伤、恐惧、厌恶、忧郁、惊讶、平静。
   * 未提供的维度视为 0。
   */
  vector?: number[];
}

/** 合成请求（引擎无关） */
export interface 合成请求 {
  text: string;
  /** 音色 id；缺省用配置里的默认音色 */
  voice?: string;
  /** 情绪控制 */
  emotion?: 情绪控制;
  /**
   * 语速倍率，1 为原速。
   *
   * 注意语义统一：**大于 1 表示更快**。各引擎内部自行换算
   * （sherpa 的 length-scale 是反比，需要取倒数）。
   */
  speed?: number;
  /** 期望输出格式；引擎不支持时回落到它支持的格式，并在结果里如实返回 */
  format?: 音频格式;
  /** 语言；缺省由引擎按文本推断 */
  lang?: string;
  /** 随机种子，便于复现同一份配音 */
  seed?: number;
  /** 采样温度（影响表现力，越大越发散） */
  temperature?: number;
}

/** 合成结果 */
export interface 合成结果 {
  /** 音频数据 */
  audio: Buffer;
  /** 实际输出格式（可能因引擎能力不同于请求值） */
  format: 音频格式;
  /** 实际使用的引擎名 */
  engine: string;
  /** 实际使用的音色 id */
  voice?: string;
  /** 音频采样率（Hz），未知时省略 */
  sampleRate?: number;
  /** 合成耗时（毫秒） */
  elapsedMs?: number;
}

/** 引擎能力声明：供上层判断能否满足某次请求 */
export interface 引擎能力 {
  /** 分层 */
  tier: 引擎分层;
  /** 支持的输出格式 */
  formats: 音频格式[];
  /** 是否支持零样本克隆（靠参考音频） */
  zeroShot: boolean;
  /** 是否支持微调权重 */
  finetune: boolean;
  /** 情绪控制支持程度；`false` 表示完全不支持 */
  emotion: {
    text: boolean;
    refAudio: boolean;
    vector: boolean;
  };
  /** 是否支持流式输出 */
  streaming: boolean;
  /** 是否支持一次提交多条文本批处理 */
  batch: boolean;
  /** 需要的显存下限（GB）；0 表示纯 CPU */
  vramGb: number;
}

/**
 * 语音引擎接口。
 *
 * 所有方法都是同步声明、异步实现，便于统一 await。
 * 实现方需保证：**未配置时不抛异常，由 `可用()` 返回 false**。
 */
export interface 语音引擎 {
  /** 引擎名，与配置键一致 */
  readonly name: string;
  /** 能力声明 */
  readonly 能力: 引擎能力;

  /**
   * 引擎当前是否可用。
   *
   * 只做**轻量探测**（检查文件存在 / TCP 连通），
   * **不得**加载模型权重（那要几十秒且吃显存）。
   */
  可用(): Promise<boolean>;

  /** 列出该引擎已知的音色 */
  音色列表(): Promise<音色[]>;

  /** 合成一条 */
  合成(请求: 合成请求): Promise<合成结果>;
}

/** 引擎配置基类：所有引擎配置共有的字段 */
export interface 引擎配置基类 {
  /** 是否启用；false 时该引擎在调度中被跳过 */
  enabled?: boolean;
  /** 服务地址（HTTP 类引擎） */
  url?: string;
  /** 模型目录 / 可执行文件路径（本地类引擎） */
  root?: string;
  /** 该引擎的音色表 */
  voices?: 音色[];
  /** 该引擎的默认音色 id */
  defaultVoice?: string;
  /** 请求超时（毫秒） */
  timeoutMs?: number;
}

/** tts 节完整配置 */
export interface TTS配置 {
  /** 全局默认引擎 */
  defaultEngine?: string;
  /** 各引擎配置，键为引擎名 */
  engines?: Record<string, 引擎配置基类 & Record<string, unknown>>;
}
