const fs = require('fs');
const p = 'c:/NaviServer/controllers/reportSpec.js';
let s = fs.readFileSync(p, 'utf8');
let lines = s.split(String.fromCharCode(10));
console.log('LINES=' + lines.length);

// Find all occurrences of 'fixedYear' declarations
const decl = 'const fixedYear =';
let idx = -1;
let count = 0;
while ((idx = s.indexOf(decl, idx + 1)) !== -1) {
  count++;
  const lineEnd = s.indexOf(String.fromCharCode(10), idx);
  console.log('fixedYear#'+count+' at line ' + (idx + 1) + ': ' + s.slice(idx, lineEnd + 1).replace(/\r/g, ''));
  idx = lineEnd + 1;
}
console.log('Total fixedYear declarations: ' + count);

// Find the searchBorrowers function area
idx = s.indexOf('function searchBorrowers');
console.log('\n--- searchBorrowers area ---');
const end = s.indexOf('function buildReportDataset', idx);
console.log(s.slice(idx, end).slice(0, 3000));
