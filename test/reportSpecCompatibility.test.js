const test = require('node:test');
const assert = require('node:assert/strict');
const reportSpec = require('../controllers/reportSpec');

test('legacy report-spec exports load and delegate to the active report services', () => {
  assert.equal(typeof reportSpec.buildReportDataset, 'function');
  assert.equal(typeof reportSpec.buildBusinessPdf, 'function');
  assert.equal(typeof reportSpec.REPORT_TYPES['daily-report'].buildXlsx, 'function');
  assert.equal(typeof reportSpec.REPORT_TYPES['loan-approval-log'].buildXlsx, 'function');
  assert.equal(reportSpec.displayStatus({ status: 'active', outstanding: 1 }).label, 'Active');
  assert.match(reportSpec.todayIso(), /^\d{4}-\d{2}-\d{2}$/);

  const workbook = reportSpec.buildWorkbook({ allLoanRows: [] }, 'all-loans');
  assert.equal(typeof workbook.xlsx.writeBuffer, 'function');
});
