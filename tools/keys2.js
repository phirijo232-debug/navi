const fs = require('fs');
const files = ['controllers/reportSpec.js', 'controllers/reportSpec.js.bak', 'checkpoint_reportSpec.js'];
const keys = [
  'paymentsTodayRows', 'const today', 'const period', 'const scope', 'loansInScope',
  'const users', 'const loans', 'function buildReportDataset', 'revenueLoanRows',
  'const metrics', 'styleSheetTitle', 'styleBanner', 'buildBusinessPdf', 'Sign Off',
  'Sign-Off', 'sign off', 'buildAllLoansSheet', 'buildMonthlyCollectionsSheet',
  'buildRepaymentPerformanceSheet', 'buildBorrowerStatementsSheet', 'buildPaymentsTodaySheet',
  'monthPayments', 'todayIso()'
];
const out = [];
for (const f of files) {
  const lines = fs.readFileSync(f, 'utf8').split(/\r?\n/);
  out.push('=== ' + f + ' (' + lines.length + ' lines)');
  for (const k of keys) {
    const locs = [];
    lines.forEach((x, i) => { if (x.includes(k)) locs.push(i + 1); });
    out.push('  ' + k + ' => ' + (locs.join(', ') || '-'));
  }
}
fs.writeFileSync('keys2.txt', out.join('\n'), 'utf8');
