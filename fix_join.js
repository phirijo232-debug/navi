const fs = require('fs');

const filePath = 'c:\\NaviServer\\controllers\\loanController.js';
let content = fs.readFileSync(filePath, 'utf8');

// Fix: Replace .join(' followed by newline then ); with .join('\n');
// The corruption has: .join('\r\n'); where \r\n is a literal CR+LF inside single quotes
// We need: .join('\n'); where \n is the two characters backslash-n
content = content.replace(/\.join\('\r?\n'\);/g, ".join('\\n');");

// Also fix the template string section - lines 1114-1116 have blank line
// Current: `Loan audit report for Pryme Vertex\r\n\r\n${reportLines...`
// This is actually valid JS template literal (literal newlines are OK)
// But let's make sure it renders correctly

fs.writeFileSync(filePath, content, 'utf8');
console.log('Fix applied');

// Verify by checking if the pattern still exists
const checkContent = fs.readFileSync(filePath, 'utf8');
if (checkContent.includes('.join(' + String.fromCharCode(10) + "');")) {
  console.log('WARNING: join pattern may still exist');
} else {
  console.log('Join pattern fixed');
}

// Try to parse
try {
  require('child_process').execSync('node -c ' + filePath);
  console.log('Syntax check PASSED');
} catch (e) {
  console.log('Syntax check FAILED:', e.message);
}