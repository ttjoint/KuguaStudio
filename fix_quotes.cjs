const fs = require('fs');
let c = fs.readFileSync('packages/gui/src/renderer/index.ts', 'utf8');

// Fix the nested quotes issue
const badStr = 'item.innerHTML = "<strong>" + (ow.label || ow.programPath) + "</strong><br><span style="color:var(--text-dim);font-size:0.8rem">" + ow.programPath + "</span>";';
const goodStr = 'item.innerHTML = "<strong>" + (ow.label || ow.programPath) + "</strong><br><span style=\\"color:var(--text-dim);font-size:0.8rem\\">" + ow.programPath + "</span>";';

if (c.includes(badStr)) {
  c = c.replace(badStr, goodStr);
  console.log('Fixed nested quotes');
} else {
  console.log('Looking for the bad string...');
  // Find it by context
  const idx = c.indexOf('item.innerHTML = "<strong>"');
  if (idx !== -1) {
    console.log('Found at:', idx);
    console.log('Context:', JSON.stringify(c.substring(idx, idx + 250)));
  }
}

fs.writeFileSync('packages/gui/src/renderer/index.ts', c, 'utf8');
