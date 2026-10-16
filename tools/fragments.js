const fs = require('fs');
const files = ['controllers/reportSpec.js', 'controllers/reportSpec.js.bak', 'checkpoint_reportSpec.js'];
const keys = [
  'buildReportDataset',
  'function buildWorkbook',
  'function searchBorrowers',
  'function buildBusinessPdf',
  'function buildTablePdf',
  'function buildDailyWorkbook',
  'module.exports',
  'const REPORT_TYPES',
  'styleSheetTitle',
  'styleBanner',
  'USERS_FILE',
  'THIN_BORDER',
  'monthLabels =',
  'const byCustomer',
  'allLoanRows =',
  'overdueRows =',
  'defaulterRows =',
  'borrowerStatements =',
  'performanceRows =',
  'loansInScope',
  'monthlyRows =',
  'const summary =',
  'approvalLogRows =',
  'revenueMonthly ='
];
const out = [];
for (const f of files) {
  const lines = fs.readFileSync(f, 'utf8').split(/\r?\n/);
  out.push(`===== ${f} (${lines.length}) =====`);
  for (const k of keys) {
    const locs = [];
    lines.forEach((l, i) => { if (l.includes(k)) locs.push(i + 1); });
    out.push(`${k}: ${locs.join(', ') || '—'}`);
  }
  out.push('');
}
fs.writeFileSync('fragments.txt', out.join('\n'), 'utf8');
