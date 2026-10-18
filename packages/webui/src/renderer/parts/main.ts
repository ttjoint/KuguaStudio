// 入口：按序号导入各分区，保证副作用初始化顺序与拆分前一致。
import "./01-types";
import "./02-chat-core";
import "./03-preview";
import "./04-router";
import "./05-format";
import "./06-shell";
import "./07-explorer";
import "./08-logs";
import "./09-init";
import "./10-chat-page";
import "./11-tabs";
import "./12-jobs";
import "./13-tools";
import "./14-plugin-ui";
import "./15-misc";
import "./16-cmd-panel";
// 声明式配置表单（模块自报配置声明 → 平台自动渲染）
import "./17-config-form";
// 扩展统一列表（模块 + 插件合表展示）
import "./18-extensions";
// 小组件：插件向主界面注入的展示块（数据推送 + 自动布局）
import "./19-widgets";
