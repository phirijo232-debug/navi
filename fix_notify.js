const fs = require('fs');

const filePath = 'c:\\NaviServer\\controllers\\loanController.js';
let content = fs.readFileSync(filePath, 'utf8');

// Replace the entire corrupted section from "const activeLoans" to "sendCustomerEmail"
const startStr = '    const activeLoans = loans.filter(loan => Number(loan.outstanding || 0) > 0);';
const endStr = '    const result = await emailService.sendCustomerEmail({ to: target, subject, text });';

const startIdx = content.indexOf(startStr);
const endIdx = content.indexOf(endStr);

if (startIdx === -1 || endIdx === -1) {
  console.log('ERROR: Markers not found');
  process.exit(1);
}

const replacementEndIdx = endIdx + endStr.length;

const newSection = [
  '    const activeLoans = loans.filter(loan => Number(loan.outstanding || 0) > 0);',
  '    const totalInterestAdded = loans.reduce((sum, loan) => sum + Number(loan.graceInterestAdded || 0), 0);',
  '',
  '    const today = new Date().toISOString().slice(0, 10);',
  '    activeLoans.forEach(loan => {',
  '      const interestBefore = Number(loan.graceAccrued || 0);',
  '      applyGraceAccrual(loan, today);',
  '      const interestAfter = Number(loan.graceAccrued || 0);',
  '      const interestAdded = Number((interestAfter - interestBefore).toFixed(2));',
  '      Object.assign(loan, { graceInterestBefore: interestBefore, graceInterestAfter: interestAfter, graceInterestAdded: interestAdded });',
  '    });',
  '',
  '    const outstandingTotal = activeLoans.reduce((sum, loan) => sum + Number(loan.outstanding || 0), 0);',
  '',
  '    const loanDetails = activeLoans.map(loan =>',
  '      `- ${loan.product || ' + "' + "Loan'" + `} ${loan.receiptNumber || \`#${loan.id}\`}: outstanding ${formatCurrency(loan.outstanding)}, due ${loan.dueDate || 'date unavailable'}`,
  '    ).join(' + "' + "\\n" + '");',
  '',
  '    const loanDetailsWithInterest = activeLoans.map(loan =>',
  '      `- ${loan.product || ' + "' + "Loan'" + `} ${loan.receiptNumber || \`#${loan.id}\`}: outstanding ${formatCurrency(loan.outstanding)}, due ${loan.dueDate || 'date unavailable'}, grace interest: K ${preciseCurrency(loan.graceInterestAdded || 0)} (1.8%/day)`',
  '    ).join(' + "' + "\\n" + '");',
  '',
  '    const subject = ' + "'" + 'BMF Loan Reminder' + "'" + ';',
  '    const text = ' + "'" + 'Hello,\\n\\nThis is a reminder from Buraza Micro Finance (BMF) regarding your loan account.\\n\\n' + "'" + ' +',
  '      (activeLoans.length',
  '        ? ' + "'" + 'Open balance(s):\\n' + "'" + ' + loanDetailsWithInterest + ' + "'" + '\\n\\nTotal outstanding: ' + "'" + ' + formatCurrency(outstandingTotal) + ' + "'" + '\\n\\nKindly settle the outstanding balance to continue enjoying the BMF loan service.\\n' + "'" + ' : ' + "'" + 'Our records show no open balance on your account. Thank you for staying up to date.\\n' + "'" + ')',
  '      + ' + "'" + '\\nRegards,\\nBuraza Micro Finance (BMF), a Pryme Vertex subsidiary.' + "'" + ';',
  '',
  '    const result = await emailService.sendCustomerEmail({ to: target, subject, text });'
].join('\n');

content = content.slice(0, startIdx) + newSection + content.slice(replacementEndIdx);

fs.writeFileSync(filePath, content, 'utf8');
console.log('Fix applied successfully');

// Verify syntax
try {
  require('child_process').execSync('node -c ' + filePath, { encoding: 'utf8' });
  console.log('Syntax check PASSED');
} catch (e) {
  console.log('Syntax check FAILED:', e.message);
}