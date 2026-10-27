const fs = require('fs');

const filePath = 'c:\\NaviServer\\controllers\\loanController.js';
let content = fs.readFileSync(filePath, 'utf8');

const lines = content.split('\n');
console.log('Total lines:', lines.length);

// Replace lines 1316-1334 (1-indexed) = indices 1315-1333 (0-indexed)
// with the correct continuation after line 1315
const startIdx = 1315; // 0-indexed, line 1316
const endIdx = 1333;   // 0-indexed, line 1334

console.log('Replacing lines', startIdx + 1, 'to', endIdx + 1);

const replacement = [
  '      (activeLoans.length',
  '        ? `Open balance(s):\\n${loanDetailsWithInterest}\\n\\nTotal outstanding: ${formatCurrency(outstandingTotal)}\\n\\nKindly settle the outstanding balance to continue enjoying the BMF loan service.\\n`',
  '        : `Our records show no open balance on your account. Thank you for staying up to date.\\n`) +',
  '      `\\nRegards,\\nBuraza Micro Finance (BMF), a Pryme Vertex subsidiary.`;'
];

lines.splice(startIdx, endIdx - startIdx + 1, ...replacement);
content = lines.join('\n');
fs.writeFileSync(filePath, content, 'utf8');
console.log('Replacement done');

// Verify
try {
  require('child_process').execSync('node -c ' + filePath, { encoding: 'utf8' });
  console.log('Syntax check PASSED');
} catch (e) {
  console.log('Syntax check FAILED:', e.message);
}