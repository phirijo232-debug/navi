const fs = require('fs');
const path = require('path');

const filePath = 'c:\\NaviServer\\controllers\\loanController.js';
let content = fs.readFileSync(filePath, 'utf8');

console.log('File length:', content.length);

// Fix 1: Replace corrupted join pattern
// Current: .join('\n1109 | ');
// Correct: .join('\n');
content = content.replace(/\\n1109 \| '\\?\);?/g, '\\n');");

// Fix 2: Replace corrupted template string patterns  
// Current: `Loan audit report for Pryme Vertex\n1115 | \n1116 | ${reportLines...`
// Correct: `Loan audit report for Pryme Vertex\n\n${reportLines...`
content = content.replace(/\\n1115 \| \\s*\\n1116 \|/g, '\\n\\n');

// Fix 3: Any other similar corrupted patterns
content = content.replace(/\\n(\d{4}) \|/g, '\\n');

fs.writeFileSync(filePath, content, 'utf8');
console.log('Fix applied successfully');

// Verify
const checkContent = fs.readFileSync(filePath, 'utf8');
if (checkContent.includes('\\n1109') || checkContent.includes('\\n1115') || checkContent.includes('\\n1116')) {
  console.log('WARNING: Some corruption patterns may still exist');
} else {
  console.log('All corruption patterns fixed');
}