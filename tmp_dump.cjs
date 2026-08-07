const fs = require('fs');
const t = fs.readFileSync('packages/gui/src/renderer/index.ts', 'utf8');
const l = t.split('\n');
function seg(a, b, label){ console.log('\n===== '+label+' L'+a+'-'+b+' ====='); console.log(l.slice(a-1, b).join('\n')); }
seg(160, 270, '处理输入+路由指令');
seg(280, 402, '格式化输出');
seg(404, 425, '帮助文本');
seg(2405, 2420, 'send绑定');
seg(2520, 2535, 'send按钮原始');