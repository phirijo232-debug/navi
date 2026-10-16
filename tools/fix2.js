const fs = require('fs');
const p = 'c:/NaviServer/controllers/reportSpec.js';
let s = fs.readFileSync(p, 'utf8');

const startAnchor = '  const fixedYear = Number(today.slice(0, 4));';
let start = s.indexOf(startAnchor);
if (start === -1) {
  console.error('START ANCHOR NOT FOUND');
  process.exit(1);
}

const endMarker = '    const monthPayments = allLoanRows.flatMap(loan => loan.payments || []).reduce((acc, p) => {';
let end = s.indexOf(endMarker);
if (end === -1) {
  console.error('END ANCHOR NOT FOUND');
  process.exit(1);
}
const closeBrace = s.indexOf('}, {});', end);
if (closeBrace === -1) {
  console.error('CLOSE BRACE NOT FOUND');
  process.exit(1);
}
end = closeBrace + '}, {});'.length;

const NL = String.fromCharCode(10);
const q = "'";
const dq = '"';
const replacement =
  '  const fixedYear = Number(today.slice(0, 4));' + NL +
  '  const monthlyLabels = [];' + NL +
  '  for (let m = 0; m < 12; m += 1) {' + NL +
  '    const monthNum = String(m + 1).padStart(2, ' + dq + '0' + dq + ');' + NL +
  '    monthlyLabels.push({' + NL +
  '      month: monthNum,' + NL +
  "      label: m === 0 ? 'Jan' : new Date(Date.UTC(2026, m, 1)).toLocaleString('en-ZA', { month: 'short' })," + NL +
  '      first: today.slice(0, 4) + "-" + monthNum + "-01",' + NL +
  '      last: today.slice(0, 4) + "-" + monthNum + "-" + new Date(Date.UTC(Number(today.slice(0, 4)), m, 0)).getDate().toString().padStart(2, ' + dq + '0' + dq + '),' + NL +
  '    });' + NL +
  '  }' + NL +
  NL +
  '  const monthlyRows = monthlyLabels.map(month => {' + NL +
  '    const monthLoans = loansInScope.filter(l => {' + NL +
  '      const d = l.approvedAt || l.createdAt;' + NL +
  '      return d && d.startsWith(fixedYear + "-" + month.month);' + NL +
  '    });' + NL +
  NL +
  '    const capital = monthLoans.reduce((s, l) => s + Number(l.principalAmount || 0), 0);' + NL +
  '    const totalPaid = monthLoans.reduce((s, l) => s + Number(l.paidAmount || 0) + Number(l.totalPaid || 0), 0);' + NL +
  '    const interestPaid = monthLoans.reduce((s, l) => s + Number(l.interestPaid || 0), 0);' + NL +
  '    const outstanding = monthLoans.reduce((s, l) => s + Number(l.outstanding || 0), 0);' + NL +
  NL +
  '    return {' + NL +
  '      month: month.month,' + NL +
  '      label: month.label,' + NL +
  '      capital,' + NL +
  '      totalPaid,' + NL +
  '      interestPaid,' + NL +
  '      outstanding,' + NL +
  '      loanCount: monthLoans.length' + NL +
  '    };' + NL +
  '  });' + NL +
  NL +
  '  const monthPayments = allLoanRows.flatMap(loan => loan.payments || []).reduce((acc, p) => {' + NL +
  '    const m = String(Number(p.paymentDate?.slice(0, 7)) || String(Date.now()).slice(0, 7)).padStart(7, ' + dq + '0' + dq + ');' + NL +
  '    acc[m] = (acc[m] || 0) + Number(p.amount || 0);' + NL +
  '    return acc;' + NL +
  '  }, {});' + NL +
  NL +
  '  const monthlyTotals = monthlyRows.reduce((acc, row) => {' + NL +
  '    acc[row.month] = {' + NL +
  '      capital: row.capital,' + NL +
  '      totalPaid: row.totalPaid,' + NL +
  '      interestPaid: row.interestPaid,' + NL +
  '      outstanding: row.outstanding,' + NL +
  '      loanCount: row.loanCount' + NL +
  '    };' + NL +
  '    return acc;' + NL +
  '  }, {});' + NL
;

s = s.slice(0, start) + replacement + s.slice(end);

const strayMarker = 'function buildRepaymentPerformanceSheet(dataset) {';
let strayIdx = s.indexOf(strayMarker, end);
if (strayIdx !== -1) {
  s = s.slice(0, strayIdx) + s.slice(strayIdx + strayMarker.length);
  console.log('Removed stray duplicate function at ' + (strayIdx + 1));
}

fs.writeFileSync(p, s);
console.log('New length=' + s.length);
