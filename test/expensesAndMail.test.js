const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const path = require('path');

test('preview mailer records OTP, customer mail, and breakage alerts without SMTP', async () => {
  const previous = {
    MAIL_MODE: process.env.MAIL_MODE,
    SMTP_USER: process.env.SMTP_USER,
    SMTP_PASS: process.env.SMTP_PASS,
    GMAIL_USER: process.env.GMAIL_USER,
    GMAIL_APP_PASSWORD: process.env.GMAIL_APP_PASSWORD,
    ADMIN_EMAILS: process.env.ADMIN_EMAILS
  };
  process.env.MAIL_MODE = 'preview';
  delete process.env.SMTP_USER;
  delete process.env.SMTP_PASS;
  delete process.env.GMAIL_USER;
  delete process.env.GMAIL_APP_PASSWORD;
  process.env.ADMIN_EMAILS = 'reports@example.test';

  const email = require('../middleware/email');
  const otp = require('../middleware/otp');
  const { sendErrorAlert } = require('../middleware/logger');

  const loginOtp = await otp.sendOTP('Login Verification', 'customer@bmf.test', true);
  const signupOtp = await otp.sendOTP('Account Signup Verification', 'new@bmf.test', true);
  const resetOtp = await otp.sendOTP('Password Reset', 'customer@bmf.test', true);
  assert.match(loginOtp, /^\d{6}$/);
  assert.match(signupOtp, /^\d{6}$/);
  assert.match(resetOtp, /^\d{6}$/);

  const announcement = await email.sendCustomerEmail({
    to: 'customer@bmf.test',
    subject: '[Buraza Micro Finance (BMF)] Rate update',
    text: 'Dear valued BMF customer,\n\nRates are unchanged.\n\nRegards,\nBuraza Micro Finance (BMF)'
  });
  const overdue = await email.sendCustomerEmail({
    to: 'customer@bmf.test',
    subject: 'Buraza Micro Finance (BMF): overdue loan notice',
    text: 'Dear customer,\n\nYour balance is overdue.'
  });
  assert.equal(announcement.delivered, 'preview');
  assert.equal(overdue.delivered, 'preview');
  assert.match(email.previewNotice(), /not configured/);

  await sendErrorAlert('Navi Server Error Alert', '[expenseController.js → createExpense] EXPENSE RECORD FAILED: disk full');

  const log = fs.readFileSync(email.previewFile(), 'utf8');
  assert.match(log, /OTP for Login Verification/);
  assert.match(log, /OTP for Account Signup Verification/);
  assert.match(log, /OTP for Password Reset/);
  assert.match(log, /Rate update/);
  assert.match(log, /overdue loan notice/);
  assert.match(log, /EXPENSE RECORD FAILED/);

  for (const [key, value] of Object.entries(previous)) {
    if (value === undefined) delete process.env[key];
    else process.env[key] = value;
  }
});

test('store staff can record, edit, and delete an expense, and net profit subtracts it', async () => {
  const { createExpense, updateExpense, deleteExpense, listExpenses, EXPENSES_FILE } = require('../controllers/expenseController');
  const { getReportSummary } = require('../controllers/reportController');
  const original = fs.existsSync(EXPENSES_FILE) ? fs.readFileSync(EXPENSES_FILE, 'utf8') : null;

  function recorder() {
    return {
      statusCode: 200,
      status(code) { this.statusCode = code; return this; },
      json(payload) { this.body = payload; return this; }
    };
  }

  const storeReq = {
    authUser: { email: 'store@bmf.test', role: 'store_admin', storeId: 'buraza' },
    headers: { 'x-business-unit': 'buraza' },
    body: { date: '2026-10-15', category: 'Rent', amount: '400', note: 'October shop' },
    params: {}
  };

  try {
    fs.writeFileSync(EXPENSES_FILE, '[]');
    const created = recorder();
    createExpense(storeReq, created);
    assert.equal(created.statusCode, 201);
    assert.equal(created.body.expense.amount, 400);

    const listed = recorder();
    listExpenses(storeReq, listed);
    assert.equal(listed.body.expenses.length, 1);

    const edited = recorder();
    updateExpense({ ...storeReq, params: { id: String(created.body.expense.id) }, body: { amount: 250, note: 'Corrected rent' } }, edited);
    assert.equal(edited.statusCode, 200);
    assert.equal(edited.body.expense.amount, 250);

    const outsider = recorder();
    deleteExpense({
      authUser: { email: 'other@bmf.test', role: 'store_admin', storeId: 'future-store' },
      headers: {},
      params: { id: String(created.body.expense.id) }
    }, outsider);
    assert.equal(outsider.statusCode, 403);

    const report = recorder();
    getReportSummary({
      authUser: { email: 'admin@bmf.test', role: 'admin', storeId: 'buraza' },
      headers: {},
      params: { scope: 'buraza' },
      query: {}
    }, report);
    assert.equal(report.body.summary.operatingExpenses, 250);
    assert.equal(report.body.summary.netProfit, Number((report.body.summary.interestCollected + report.body.summary.feesCollected - 250).toFixed(2)));
    assert.match(report.body.note, /Net profit is collected interest and fees minus operating expenses/);
    assert.doesNotMatch(report.body.note, /not calculated/);

    const removed = recorder();
    deleteExpense({ ...storeReq, params: { id: String(created.body.expense.id) } }, removed);
    assert.equal(removed.statusCode, 200);
  } finally {
    if (original === null) fs.rmSync(EXPENSES_FILE, { force: true });
    else fs.writeFileSync(EXPENSES_FILE, original);
  }
});
