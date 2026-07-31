const fs = require('fs');
let c = fs.readFileSync('packages/gui/src/renderer/index.ts', 'utf8');

// Fix 1: 7z key needs quotes
c = c.replace('7z: "7z压缩包"', '"7z": "7z压缩包"');

// Check other errors
console.log('Checking errors...');
const lines = c.split('\n');
console.log('Line 535:', lines[534] ? lines[534].substring(0, 100) : 'not found');
console.log('Line 781:', lines[780] ? lines[780].substring(0, 100) : 'not found');
console.log('Line 994:', lines[993] ? lines[993].substring(0, 150) : 'not found');

fs.writeFileSync('packages/gui/src/renderer/index.ts', c, 'utf8');
console.log('Fixed 7z key');
