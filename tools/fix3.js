const fs = require('fs');
const p = 'c:/NaviServer/controllers/reportSpec.js';
let s = fs.readFileSync(p, 'utf8');

// Remove the original monthLabels block (template literal syntax) that now duplicates the new monthlyLabels block.
// Original block starts at 'const monthLabels = [];' with template literals
const origStart = s.indexOf("const monthLabels = [];");
// Find the 'const fixedYear' after this
const fixedYearIdx = s.indexOf('const fixedYear = Number(today.slice(0, 4));');

if (origStart === -1 || fixedYearIdx === -1 || origStart >= fixedYearIdx) {
  console.error('ORIG_RANGE_INVALID: origStart=' + origStart + ', fixedYearIdx=' + fixedYearIdx);
  process.exit(1);
}

// Delete from origStart up to (but not including) fixedYearIdx
const deleted = s.slice(origStart, fixedYearIdx);
s = s.slice(0, origStart) + s.slice(fixedYearIdx);

fs.writeFileSync(p, s);
console.log('Deleted original monthLabels block. New length=' + s.length);
