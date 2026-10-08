const test = require('node:test');
const assert = require('node:assert/strict');
const {
  normalizeZambianPhone,
  isValidZambianPhone,
  isMobileNumber,
  formatZambianPhone
} = require('../middleware/phoneNumber');
const { TEMPLATES, buildDedupeKey, sendTemplatedMessage, runDueDatePass } = require('../middleware/loanNotifications');
const emailService = require('../middleware/email');
const fs = require('node:fs');
const dataStore = require('../middleware/dataStore');

test('Zambian numbers normalise to E.164 and foreign numbers are rejected', () => {
  assert.equal(normalizeZambianPhone('0977123456'), '+260977123456');
  assert.equal(normalizeZambianPhone('+260 97 712 3456'), '+260977123456');
  assert.equal(normalizeZambianPhone('00260977123456'), '+260977123456');
  assert.equal(normalizeZambianPhone('260977123456'), '+260977123456');
  assert.equal(normalizeZambianPhone('+14155552671'), null);
  assert.equal(normalizeZambianPhone('09771234'), null);
  assert.ok(isValidZambianPhone('0977123456'));
  assert.ok(!isValidZambianPhone('+441632960961'));
  assert.ok(isMobileNumber('0977123456'));
  assert.equal(formatZambianPhone('+260977123456'), '0977 123 456');
});

test('notification templates use the exact BMF operations wording (Task 7)', () => {
  assert.equal(TEMPLATES.REMINDER.body(3),
    'Loan still unsettled — 3 days remaining. Your BMF loan is not yet settled. You still have time to repay the outstanding balance and continue enjoying the BMF loan service.');
  assert.equal(TEMPLATES.REMINDER.subject(3), 'BMF Loan Reminder — 3 Days Remaining');
  assert.equal(TEMPLATES.OVERDUE.body(),
    'Your BMF loan is now overdue. Kindly settle the outstanding balance as soon as possible to restore and continue your access to the BMF loan service.');
  assert.equal(TEMPLATES.OVERDUE.subject(), 'BMF Loan Overdue Notice');
  assert.match(TEMPLATES.REMINDER.body(0), /due today/i);
});

test('borrower notifications dedupe per loan per day (Task 7)', async (t) => {
  const notifPath = dataStore.paths.notifications;
  const originalLog = fs.existsSync(notifPath) ? fs.readFileSync(notifPath, 'utf8') : '[]';
  const sentTo = [];
  t.mock.method(emailService, 'sendCustomerEmail', async ({ to }) => {
    sentTo.push(to);
    return { ok: true, messageId: 'mock-1' };
  });
  const loan = { id: 4242, receiptNumber: 'BMF-20261006-4242', email: 'notified@example.test', outstanding: 100, dueDate: '2026-11-01' };

  try {
    const first = await sendTemplatedMessage({ loan, messageKey: 'OVERDUE', day: '2026-11-01' });
    const second = await sendTemplatedMessage({ loan, messageKey: 'OVERDUE', day: '2026-11-01' });

    assert.equal(first.ok, true);
    assert.equal(second.skipped, true);
    assert.equal(sentTo.length, 1);
    assert.equal(buildDedupeKey({ loanId: 4242, day: '2026-11-01' }), '4242:2026-11-01');
  } finally {
    fs.writeFileSync(notifPath, originalLog);
  }
});

test('due-date pass fires three-day and overdue triggers by the clock', async (t) => {
  const sent = [];
  t.mock.method(emailService, 'sendCustomerEmail', async ({ to, subject }) => {
    sent.push(subject);
    return { ok: true, messageId: 'mock-2' };
  });

  const { getLoansData, saveLoansData } = require('../controllers/loanController');
  const notifPath = dataStore.paths.notifications;
  const originalLog = fs.existsSync(notifPath) ? fs.readFileSync(notifPath, 'utf8') : '[]';
  const original = JSON.parse(JSON.stringify(getLoansData()));

  try {
    saveLoansData([
      {
        id: 9001, receiptNumber: 'BMF-2026-9001', email: 'three-days@example.test',
        product: 'Test loan', amount: 1000, totalRepayment: 1160, interestAmount: 160,
        outstanding: 1160, dueDate: '2026-11-04', status: 'approved', payments: []
      },
      {
        id: 9002, receiptNumber: 'BMF-2026-9002', email: 'late@example.test',
        product: 'Test loan', amount: 1000, totalRepayment: 1160, interestAmount: 160,
        outstanding: 1160, dueDate: '2026-10-20', status: 'approved', payments: []
      }
    ]);

    const summary = await runDueDatePass('2026-11-01');
    assert.equal(summary.reminders, 1);
    assert.equal(summary.overdue, 1);
    assert.match(sent.join('\n'), /3 days remaining/i);
    assert.match(sent.join('\n'), /overdue/i);
  } finally {
    saveLoansData(original);
    fs.writeFileSync(notifPath, originalLog);
  }
});