/**
 * 模块配置声明协议
 *
 * 模块在握手时上报「我的配置长什么样」，平台据此自动渲染表单，
 * 并负责读写、校验、凭据隔离与热重载推送。**模块不必写任何前端代码。**
 *
 * 双向推送：
 *  - 平台 → 模块：`module.config` 事件，携带**该模块完整的新配置**
 *  - 模块 → 平台：`module.config.set` 请求，模块主动改自己的配置
 *    平台写盘成功后，再向所有模块广播 `module.config`（含它自己）
 *
 * 设计原则：
 *  1. **平台只做存储与展示**，不理解字段含义——含义由模块自己解释。
 *  2. **凭据不落公共配置**：字段标 `凭据: true`，值写入 `kugua.config.local.json`
 *     （已 gitignore），公共配置文件里只留占位。
 *  3. **热重载靠推送**：模块收到 `module.config` 后自行决定如何应用，
 *     不必重启进程。
 */

/** 配置字段类型 */
export type 配置字段类型 = "string" | "number" | "boolean" | "select" | "path" | "secret" | "text" | "array";

/** 数组元素里单个列的定义（用于表格式数组编辑） */
export interface 配置列声明 {
  /** 对象数组中的键名 */
  键: string;
  标题: string;
  类型: 配置字段类型;
  /** 占位提示 */
  提示?: string;
  /** 是否必填 */
  必填?: boolean;
  /** select 的选项 */
  选项?: Array<string | { 值: string; 标题: string }>;
  /**
   * 该列是凭据：写进 `kugua.config.local.json`，不进版本库，
   * 表单里也按密码框渲染、只回「已设置」标记。
   *
   * 对象数组里的密钥必须靠这一项才能隔离——否则 `providers[0].apiKey`
   * 会直接落进 `kugua.config.json`。
   */
  凭据?: boolean;
}

/** 数组项声明：既可以是简单类型（字符串列表），也可以是对象表格 */
export interface 配置数组声明 {
  /** 元素类型 */
  元素: "string" | "object";
  /** 元素为 object 时的列定义 */
  列?: 配置列声明[];
  /** 用于生成新行的默认值 */
  默认行?: Record<string, unknown>;
}

/** 单个配置字段声明 */
export interface 配置字段声明 {
  /** 字段键名。支持点号表示嵌套，如 `engines.voxcpm.url` */
  键: string;
  /** 显示标题 */
  标题: string;
  /** 类型，缺省 `string` */
  类型?: 配置字段类型;
  /** 默认值 */
  默认值?: unknown;
  /** 说明文字（表单下方灰字） */
  说明?: string;
  /** 占位提示 */
  提示?: string;
  /** 是否必填 */
  必填?: boolean;
  /** select 的选项 */
  选项?: Array<string | { 值: string; 标题: string }>;
  /** number 的取值范围 */
  最小?: number;
  最大?: number;
  /** number 的步进 */
  步进?: number;
  /**
   * 是否为凭据（密码 / token）。
   *
   * 平台会把它写进 `kugua.config.local.json` 而非公共配置，
   * 并在表单里以密码框展示。
   */
  凭据?: boolean;
  /** array 类型的额外声明 */
  数组?: 配置数组声明;
  /**
   * 生效方式，仅用于提示用户：
   *  - `立即`（默认）：推送后立即生效
   *  - `重启模块`：需要重启该模块
   *  - `重启平台`：需要重启整个平台
   */
  生效?: "立即" | "重启模块" | "重启平台";
}

/** 模块的完整配置声明 */
export interface 配置声明 {
  /** 分组（可选）：把字段分到不同区块，键为分组名，值为该组的字段键前缀或显式列表 */
  说明?: string;
  /** 字段列表（单层平铺，用点号键名表达嵌套） */
  字段: 配置字段声明[];
}

/** 平台推给模块的配置载荷 */
export interface 配置载荷 {
  /** 模块名 */
  模块: string;
  /**
   * **本模块的配置节本身**（已合并 local 覆盖层），不是整个配置文件。
   *
   * 也就是说：如果 `kugua.config.json` 里是 `{ "mkg": { "dbPath": "…" } }`，
   * 这里拿到的就是 `{ "dbPath": "…" }`，**不要**再写 `载荷.配置.mkg`
   * （会得到 `undefined`，然后把你的默认值刷成空）。
   */
  配置: Record<string, unknown>;
  /** 变更来源：便于模块区分「自己改的」与「用户在 UI 改的」 */
  来源: "用户" | "模块" | "初始化";
  /** 变更的字段键（点号路径），便于模块做增量处理 */
  变更: string[];
}
