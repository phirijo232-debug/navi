'use strict';

const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const path = require('path');
const { spawnSync } = require('child_process');

const {
  deriveLoanStatus,
  applyGraceAccrual,
  rebuildPaymentLedger,
  summarizeStore
} = require('../controllers/loanController');
const { calendarToday, contractDueDate, approvalSchedule } = require('../middleware/calendar');
const { BUSINESS_DATA_FILES } = require('../middleware/dataFiles');
const dataStore = require('../middleware/dataStore');
const { createBackup } = require('../controllers/backupController');
const { generateOTP } = require('../middleware/otp');

test('a 1-week loan is due 7 days after approval, with no waiting days added', () => {
  const approvedAt = new Date('2026-11-06T09:00:00Z');
  const schedule = approvalSchedule(approvedAt, 1);
  assert.equal(schedule.dueDate, contractDueDate(schedule.borrowedDate, 1));
  assert.equal(schedule.dueDate, '2026-11-13');
  assert.equal(schedule.borrowedDate, calendarToday(approvedAt));
});

test('approval just after Lusaka midnight uses the Lusaka day, not UTC', () => {
  // 23:30 UTC is 01:30 the next day in Africa/Lusaka.
  const schedule = approvalSchedule(new Date('2026-11-01T23:30:00Z'), 2);
  assert.equal(schedule.borrowedDate, '2026-11-02');
  assert.equal(schedule.dueDate, '2026-11-16');
});

test('the written late rule: grace from 3 days before due, defaulted the day after', () => {
  const base = { status: 'active', amount: 800, totalRepayment: 880, outstanding: 880 };
  assert.equal(deriveLoanStatus({ ...base, dueDate: '2026-11-05' }, '2026-11-01'), 'active');
  assert.equal(deriveLoanStatus({ ...base, dueDate: '2026-11-04' }, '2026-11-01'), 'grace');
  assert.equal(deriveLoanStatus({ ...base, dueDate: '2026-11-01' }, '2026-11-01'), 'grace');
  assert.equal(deriveLoanStatus({ ...base, dueDate: '2026-10-31' }, '2026-11-01'), 'defaulted');
});

test('the first late day is charged, and the same day does not charge twice', () => {
  const loan = {
    status: 'grace',
    amount: 1000,
    interestAmount: 100,
    totalRepayment: 1100,
    outstanding: 1100,
    dueDate: '2026-11-01',
    graceUntil: '2026-11-10'
  };
  applyGraceAccrual(loan, '2026-11-01');
  assert.equal(loan.graceAccrued, 19.8);
  applyGraceAccrual(loan, '2026-11-01');
  assert.equal(loan.graceAccrued, 19.8);
});

test('a request that is not approved is not money already owed', () => {
  const summary = summarizeStore([
    { id: 1, status: 'pending', amount: 1500, outstanding: 1740, interestAmount: 240, dueDate: '2026-11-15' },
    { id: 2, status: 'active', amount: 800, outstanding: 880, interestAmount: 80, dueDate: '2026-12-01' }
  ], '2026-11-01');
  assert.equal(summary.totalOutstanding, 880);
  assert.equal(summary.totalLoans, 2);
});

test('undoing a payment puts the balance back and a fee does not reduce the loan', () => {
  const loan = {
    totalRepayment: 1100,
    interestAmount: 100,
    payments: [
      { amount: 100, fee: 15, paymentReceiptId: 'PAY-1', reversed: true, reversalReason: 'typed wrong' },
      { amount: 50, fee: 5, paymentReceiptId: 'PAY-2' }
    ]
  };
  rebuildPaymentLedger(loan);
  assert.equal(loan.outstanding, 1050);
  assert.equal(loan.payments[0].interestPortion, 0);
  assert.equal(loan.payments[1].interestPortion, 50);
  assert.equal(loan.payments[1].fee, 5);
});

test('backup snapshots include the expense book', () => {
  assert.ok(BUSINESS_DATA_FILES.includes('expenses.json'));
  const expensesFile = path.join(dataStore.DATA_DIR, 'expenses.json');
  fs.writeFileSync(expensesFile, JSON.stringify([{ id: 1, amount: 400, category: 'Rent' }]));
  const res = {
    statusCode: 200,
    status(code) { this.statusCode = code; return this; },
    json(body) { this.body = body; return this; }
  };
  createBackup({ authUser: { role: 'admin', email: 'admin@example.test' } }, res);
  assert.equal(res.statusCode, 200);
  assert.ok(res.body.backup.files.includes('expenses.json'));
  const snapshot = JSON.parse(fs.readFileSync(path.join(dataStore.DATA_DIR, 'backups', `${res.body.backup.id}.json`), 'utf8'));
  assert.equal(snapshot.files['expenses.json'][0].amount, 400);
});

test('a login code is still on disk for a fresh process', () => {
  const email = 'persist-otp@example.test';
  const code = generateOTP(`${email}:Login Verification`, true);
  const stored = JSON.parse(fs.readFileSync(path.join(dataStore.DATA_DIR, 'otp-store.json'), 'utf8'));
  assert.equal(stored[`${email}:Login Verification`].code, code);

  const child = spawnSync(process.execPath, ['-e', `
    const { verifyOTP } = require('./middleware/otp');
    const result = verifyOTP(process.argv[1], process.argv[2], 'Login Verification');
    if (!result.valid) {
      console.error(result.message);
      process.exit(1);
    }
  `, code, email], {
    cwd: path.join(__dirname, '..'),
    env: { ...process.env, NAVI_DATA_DIR: dataStore.DATA_DIR }
  });
  assert.equal(child.status, 0, child.stderr && child.stderr.toString());
});
