const fs = require('fs');
const p = 'c:/NaviServer/controllers/reportSpec.js';
let s = fs.readFileSync(p, 'utf8');
let lines = s.split(String.fromCharCode(10));

// Find the exact damage: searchBorrowers function has missing closes
// Line 102: customers.push({
// Lines 106-118: blank
// Line 119: comment
// Line 120: const fixedYear

// The original structure should be:
// Line 102: customers.push({
// ... object properties ...
// Line 106:   });
// }
// (blank)
// // ── Monthly collections: per-month aggregates ─────────────────────────────
// const fixedYear = ...

// Replace lines 105-118 (0-indexed 105-117) — from 'storeId: user.storeId' through the blanks before the comment
const objEnd = '      storeId: user.storeId';
let objIdx = -1;
for (let j = 101; j < 118; j++) {
  if (lines[j].includes(objEnd)) {
    objIdx = j;
    break;
  }
}
if (objIdx === -1) {
  console.error('OBJECT END NOT FOUND');
  process.exit(1);
}

// Build replacement: close the object, close the for loop, close the function, then blank + comment
const replacement = [
  '    });',
  '  }',
  '',
  '// ── Monthly collections: per-month aggregates ─────────────────────────────',
  '  const fixedYear = Number(today.slice(0, 4));'
].join(String.fromCharCode(10));

// Find the position of the comment line (line 118, 0-indexed 118) that starts with the comment
let commentIdx = -1;
for (let j = 118; j < 125; j++) {
  if (lines[j].includes('Monthly collections')) {
    commentIdx = j;
    break;
  }
}
if (commentIdx === -1) {
  console.error('COMMENT NOT FOUND');
  process.exit(1);
}

// Replace from the line after objIdx through the comment line (exclusive)
const newLines = [
  ...lines.slice(0, objIdx + 1),
  ...replacement.split(String.fromCharCode(10)),
  ...lines.slice(commentIdx)
];

s = newLines.join(String.fromCharCode(10));
fs.writeFileSync(p, s);
console.log('Fixed searchBorrowers closing. New length=' + s.length);
