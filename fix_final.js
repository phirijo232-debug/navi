const fs = require('fs');

const filePath = 'c:\\NaviServer\\controllers\\loanController.js';
let content = fs.readFileSync(filePath, 'utf8');

const lines = content.split('\n');
console.log('Total lines:', lines.length);

// Find and fix the notifyUser text variable section
// Lines are 0-indexed in the array, so line N = index N-1

// Find line 1321 (index 1320): "? \`Open balance(s):"
// Replace with proper ternary
for (let i = 0; i < lines.length; i++) {
  if (lines[i].includes('loanDetailsWithInterest') && lines[i].includes('${')) {
    console.log('Found loanDetailsWithInterest at line', i + 1, ':', JSON.stringify(lines[i]));
  }
  if (lines[i].includes('loanDetails') && lines[i].includes('${') && !lines[i].includes('loanDetailsWithInterest')) {
    console.log('Found loanDetails at line', i + 1, ':', JSON.stringify(lines[i]));
  }
}

// Let's find the exact range to replace
// Look for the pattern: line with "? \`Open balance(s):" followed by template lines
let startReplace = -1;
let endReplace = -1;

for (let i = 0; i < lines.length; i++) {
  if (lines[i].trim() === '? \`Open balance(s):') {
    startReplace = i;
    console.log('Found start at line', i + 1);
  }
  if (startReplace !== -1 && lines[i].trim() === '\`') {
    endReplace = i;
    console.log('Found end at line', i + 1);
    break;
  }
}

console.log('startReplace:', startReplace, 'endReplace:', endReplace);

if (startReplace !== -1 && endReplace !== -1) {
  // Replace lines from startReplace to endReplace (inclusive)
  const newLines = [
    '        ? `Open balance(s):\\n${loanDetailsWithInterest}\\n\\nTotal outstanding: ${formatCurrency(outstandingTotal)}\\n\\nKindly settle the outstanding balance to continue enjoying the BMF loan service.\\n`',
    '        : `Our records show no open balance on your account. Thank you for staying up to date.\\n`'
  ];
  
  lines.splice(startReplace, endReplace - startReplace + 1, ...newLines);
  content = lines.join('\n');
  fs.writeFileSync(filePath, content, 'utf8');
  console.log('Replaced template lines');
}

// Now fix the trailing part - find ") +" followed by template string
for (let i = 0; i < lines.length; i++) {
  if (lines[i].includes('):') && lines[i].includes('+') && lines[i].includes('`')) {
    console.log('Found trailing at line', i + 1, ':', JSON.stringify(lines[i]));
  }
}

console.log('Done');