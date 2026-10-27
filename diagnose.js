const fs = require('fs');
const filePath = 'c:\\NaviServer\\controllers\\loanController.js';
const lines = fs.readFileSync(filePath, 'utf8').split('\n');
console.log('Total lines:', lines.length);
for (let i = 1106; i <= 1117; i++) {
  console.log(`Line ${i+1}:`, JSON.stringify(lines[i]));
}