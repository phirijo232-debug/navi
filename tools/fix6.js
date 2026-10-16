const fs = require('fs');
const p = 'c:/NaviServer/controllers/reportSpec.js';
let s = fs.readFileSync(p, 'utf8');

// The issue: the 'if (type === ...)' that pairs with the orphaned '} else if (type === ...)' is missing.
// Currently the code has:
//   ...buildPaymentsTodaySheet... }
//   \r\n\r\n    // ── Sheets 2–10: full workbooks ───────────────────────────────────────
//   const sheetBuilders = { ... };
//   for (...) { ... }
//   return wb;
// \r\n\r\n  } else if (type === 'borrower-statements') { ... }

// We need to wrap the sheetBuilders section in an 'if (type === 'repayment-performance')' block.
// Find the start: the comment '    // ── Sheets 2–10: full workbooks'
// Find the end: '    return wb;' that comes right before '  } else if (type === 'borrower-statements')

const startMarker = '    // ── Sheets 2–10: full workbooks ───────────────────────────────────────';
const endMarker = '  } else if (type === ';

let start = s.indexOf(startMarker);
let end = s.indexOf(endMarker);

if (start === -1 || end === -1 || start >= end) {
  console.error('RANGE INVALID: start=' + start + ', end=' + end);
  process.exit(1);
}

const replacement = (
  '  if (type === ' + "'repayment-performance'" + ') {' + String.fromCharCode(10) +
  '    const sheetBuilders = {' + String.fromCharCode(10) +
  "      'all-loans': buildAllLoansSheet," + String.fromCharCode(10) +
  "      'payments-today': buildPaymentsTodaySheet," + String.fromCharCode(10) +
  "      'overdue': buildOverdueSheet," + String.fromCharCode(10) +
  "      'defaulters': buildDefaultersSheet," + String.fromCharCode(10) +
  "      'monthly-collections': buildMonthlyCollectionsSheet," + String.fromCharCode(10) +
  "      'borrower-statements': buildBorrowerStatementsSheet," + String.fromCharCode(10) +
  "      'loan-approval-log': buildLoanApprovalLogSheet," + String.fromCharCode(10) +
  "      'interest-revenue': buildInterestRevenueSheet," + String.fromCharCode(10) +
  "      'repayment-performance': buildRepaymentPerformanceSheet" + String.fromCharCode(10) +
  '    };' + String.fromCharCode(10) +
  '    for (const [key, builder] of Object.entries(sheetBuilders)) {' + String.fromCharCode(10) +
  '      const ws = builder(dataset);' + String.fromCharCode(10) +
  '      ws.properties.pageSetup.orientation = ' + "'landscape'" + ';' + String.fromCharCode(10) +
  '      ws.getRow(1).height = 30;' + String.fromCharCode(10) +
  '      ws.getRow(2).height = 22;' + String.fromCharCode(10) +
  '      wb.addWorksheet(ws);' + String.fromCharCode(10) +
  "      const renamed = wb.getWorksheet(ws.id);" + String.fromCharCode(10) +
  "      if (renamed) renamed.name = dataProductName(key);" + String.fromCharCode(10) +
  '    }' + String.fromCharCode(10) +
  '    return wb;' + String.fromCharCode(10) +
  '  }' + String.fromCharCode(10)
);

s = s.slice(0, start) + replacement + s.slice(end);

fs.writeFileSync(p, s);
console.log('New length=' + s.length);
