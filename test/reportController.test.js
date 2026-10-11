const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const emailService = require('../middleware/email');
const { categorizeLoan, buildExcelReport } = require('../controllers/reportController');
const { sendDailyBmfReport, checkDailyReportSchedule } = require('../middleware/dailyReport');

test('loan report categories distinguish requests, pending balances, partials, defaults, and loyal settlements', () => {
  const today = '2026-10-01';
  assert.equal(categorizeLoan({ status: 'pending', outstanding: 100, dueDate: '2026-10-10' }, today), 'pending_application');
  assert.equal(categorizeLoan({ status: 'approved', outstanding: 100, dueDate: '2026-10-10' }, today), 'pending_payment');
  assert.equal(categorizeLoan({ status: 'approved', outstanding: 50, dueDate: '2026-10-10', payments: [{ amount: 50 }] }, today), 'partial_payment');
  assert.equal(categorizeLoan({ status: 'approved', outstanding: 100, dueDate: '2026-09-30' }, today), 'defaulter');
  assert.equal(categorizeLoan({ status: 'paid', outstanding: 0, dueDate: '2026-10-10', settledAt: '2026-10-01T10:00:00Z' }, today), 'settled_on_time');
  assert.equal(categorizeLoan({ status: 'paid', outstanding: 0, dueDate: '2026-09-30', settledAt: '2026-10-01T10:00:00Z' }, today), 'settled');
});

test('Excel portfolio report is generated as an XLSX workbook', async () => {
  const workbook = await buildExcelReport({
    generatedAt: new Date().toISOString(),
    summary: { customerAccounts: 1, totalLoans: 0, cashCollected: 0, feedback: { total: 0 } },
    loans: [],
    payments: [],
    defaulters: [],
    partialPaymentLoans: [],
    settledLoans: [],
    loyalCustomers: [],
    loyalSettlementLoans: [],
    feedback: []
  });

  assert.equal(workbook[0], 0x50);
  assert.equal(workbook[1], 0x4b);
});

test('daily report is sent to the configured reporting administrator', async (t) => {
  const expectedRecipient = process.env.DAILY_REPORT_EMAIL || 'jophiri223@gmail.com';
  const sendMail = t.mock.method(emailService, 'sendCustomerEmail', async () => ({ ok: true }));

  const result = await sendDailyBmfReport(new Date('2026-10-01T10:00:00Z'));

  assert.equal(result.ok, true);
  assert.equal(sendMail.mock.calls[0].arguments[0].to, expectedRecipient);
  assert.match(sendMail.mock.calls[0].arguments[0].subject, /Daily BMF portfolio report/);
});

test('daily report scheduler sends at 23:59 Lusaka time and sends only once that day', async (t) => {
  let reportCalls = 0;
  t.mock.method(fs, 'writeFileSync', () => {});
  const sendTime = new Date('2026-10-01T21:59:00.000Z');
  const sendReport = async () => {
    reportCalls += 1;
    return { ok: true };
  };

  const firstCheck = await checkDailyReportSchedule(sendTime, sendReport);
  const secondCheck = await checkDailyReportSchedule(sendTime, sendReport);

  assert.equal(firstCheck, true);
  assert.equal(secondCheck, false);
  assert.equal(reportCalls, 1);
});
