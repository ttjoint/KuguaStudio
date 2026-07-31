const fs = require('fs');
let c = fs.readFileSync('packages/gui/src/renderer/index.ts', 'utf8');
if (!c.includes('interface 资源 {')) {
  // Fix line endings - try both
  let s1 = '  数据库大小: number;\n}\n\ninterface 资源详情 {';
  let s2 = '  数据库大小: number;\r\n}\r\n\r\ninterface 资源详情 {';
  let r = '  数据库大小: number;\n}\n\ninterface 资源 {\n  id: number;\n  path: string;\n  name: string;\n  size: number;\n  kind: "file" | "directory";\n  modifiedTime: number;\n  snippet?: string;\n}\n\ninterface 资源详情 {';
  if (c.includes(s1)) {
    c = c.replace(s1, r);
    console.log('Fixed with LF');
  } else if (c.includes(s2)) {
    r = r.replace(/\n/g, '\r\n');
    c = c.replace(s2, r);
    console.log('Fixed with CRLF');
  } else {
    console.log('Pattern not found');
    let idx = c.indexOf('interface 资源详情');
    console.log('资源详情 at:', idx);
    if (idx > 0) {
      console.log('Context:', JSON.stringify(c.substring(idx-60, idx+20)));
    }
  }
  fs.writeFileSync('packages/gui/src/renderer/index.ts', c, 'utf8');
} else {
  console.log('资源 interface already exists');
}
