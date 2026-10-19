const fs=require("fs");

// system.ts：删本地 磁盘信息 接口与 组装磁盘，改用 calc.ts
let p="packages/modules/monitor/src/system.ts";
let s=fs.readFileSync(p,"utf8");const 前=s;

s=s.replace(
`import { arch, availableParallelism, cpus, freemem, hostname, platform, totalmem, uptime } from "node:os";

export interface 磁盘信息 {
  name: string;
  total: number;
  free: number;
  used: number;
  usagePct: number;
}
`,
`import { arch, availableParallelism, cpus, freemem, hostname, platform, totalmem, uptime } from "node:os";
import { 组装磁盘, 解析df, type 磁盘信息 } from "./calc.js";

export type { 磁盘信息 };
`);

// 删本地 组装磁盘
const a=s.indexOf("function 组装磁盘(name: unknown, total: unknown, free: unknown): 磁盘信息 {");
const b=s.indexOf("function 读磁盘Windows(): Promise<磁盘信息[]> {");
if(a<0||b<0){console.log("组装磁盘 未找到");process.exit(1);}
s=s.slice(0,a)+s.slice(b);

// 磁盘 POSIX 改用 解析df
const 旧df = `      const 结果: 磁盘信息[] = [];
      for (const 行 of stdout.split("\n").slice(1)) {
        const 段 = 行.trim().split(/\s+/);
        if (段.length < 6) continue;
        const 总 = Number(段[1]) * 1024;
        const 已用 = Number(段[2]) * 1024;
        if (!Number.isFinite(总) || 总 <= 0) continue;
        结果.push({
          name: 段[0],
          total: 总,
          free: 总 - 已用,
          used: 已用,
          usagePct: (已用 / 总) * 100,
        });
      }
      resolve(结果);`;
if(!s.includes(旧df)){console.log("df 解析段未找到");process.exit(1);}
s=s.replace(旧df, `      resolve(解析df(stdout));`);

if(s===前){console.log("system.ts 未变");process.exit(1);}
fs.writeFileSync(p,s);

// handlers.ts：间隔归一改用 归一间隔
p="packages/modules/monitor/src/handlers.ts";
s=fs.readFileSync(p,"utf8");
const 前2=s;
s=s.replace(`import { 采集快照 } from "./system.js";`,`import { 采集快照 } from "./system.js";
import { 归一间隔 } from "./calc.js";`);
s=s.replace(`    const 间隔 = Math.max(2, Math.floor(p.intervalSec ?? 10));`,`    const 间隔 = 归一间隔(p.intervalSec, 10);`);
if(s===前2){console.log("handlers.ts 未变");process.exit(1);}
fs.writeFileSync(p,s);
console.log("ok");
