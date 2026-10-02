const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const { updateLoanStatus, getAllLoans, notifyAllOverdue, recordPayment } = require('../controllers/loanController');
const emailService = require('../middleware/email');

const LOANS_FILE = path.join(__dirname, '../data/loans.json');

test('loan status updates create a status history and admin summary includes all decision categories', async () => {
  const original = fs.readFileSync(LOANS_FILE, 'utf8');
  const sampleLoan = {
    id: 9991,
    email: 'borrower@example.com',
    product: 'Emergency loan',
    amount: 1000,
    tenureWeeks: 2,
    interestRate: 16,
    interestAmount: 160,
    totalRepayment: 1160,
    outstanding: 1160,
    dueDate: '2026-10-15',
    urgency: 'urgent',
    paymentMode: 'cash',
    status: 'pending',
    createdAt: new Date().toISOString(),
    adminReason: '',
    payments: []
  };

  fs.writeFileSync(LOANS_FILE, JSON.stringify([sampleLoan], null, 2));

  try {
    const req = {
      params: { id: 9991 },
      body: { action: 'approve', reason: 'Approved after review.' },
      authUser: { email: 'admin@prymevertex.test', role: 'store_admin', storeId: 'buraza' }
    };

    const res = {
      statusCode: 200,
      status(code) { this.statusCode = code; return this; },
      json(payload) { this.body = payload; return this; }
    };

    await updateLoanStatus(req, res);

    const summaryReq = { authUser: { email: 'admin@prymevertex.test', role: 'admin' } };
    const summaryRes = {
      statusCode: 200,
      status(code) { this.statusCode = code; return this; },
      json(payload) { this.body = payload; return this; }
    };

    await getAllLoans(summaryReq, summaryRes);

    const updated = JSON.parse(fs.readFileSync(LOANS_FILE, 'utf8'))[0];
    assert.equal(updated.status, 'approved');
    assert.ok(Array.isArray(updated.statusHistory), 'statusHistory should be recorded');
    assert.ok(updated.statusHistory.some(entry => entry.status === 'approved'), 'statusHistory should include the approved status');
    assert.equal(summaryRes.body.summary.approved, 1, 'approved count should be present in admin summary');
    assert.equal(summaryRes.body.summary.in_progress, 0, 'in progress count should be present in admin summary');
    assert.equal(summaryRes.body.summary.declined, 0, 'declined count should be present in admin summary');
  } finally {
    fs.writeFileSync(LOANS_FILE, original);
  }
});

test('bulk overdue notices group all overdue loans into one message per customer', async (t) => {
  const original = fs.readFileSync(LOANS_FILE, 'utf8');
  const yesterday = new Date(Date.now() - 24 * 60 * 60 * 1000).toISOString().slice(0, 10);
  fs.writeFileSync(LOANS_FILE, JSON.stringify([
    { id: 1, email: 'customer@example.test', product: 'Loan A', status: 'approved', outstanding: 100, dueDate: yesterday },
    { id: 2, email: 'CUSTOMER@example.test', product: 'Loan B', status: 'in_progress', outstanding: 200, dueDate: yesterday },
    { id: 3, email: 'other@example.test', product: 'Future', status: 'approved', outstanding: 50, dueDate: '2099-01-01' },
    { id: 4, email: 'declined@example.test', product: 'Declined', status: 'declined', outstanding: 50, dueDate: yesterday }
  ], null, 2));

  try {
    const sendMail = t.mock.method(emailService, 'sendCustomerEmail', async () => ({ ok: true }));
    const req = { authUser: { email: 'admin@example.test', role: 'store_admin', storeId: 'buraza' }, headers: {} };
    const res = {
      statusCode: 200,
      status(code) { this.statusCode = code; return this; },
      json(payload) { this.body = payload; return this; }
    };

    await notifyAllOverdue(req, res);

    assert.equal(res.statusCode, 200);
    assert.equal(res.body.overdueLoans, 2);
    assert.equal(res.body.customers, 1);
    assert.equal(res.body.sent, 1);
    assert.equal(sendMail.mock.calls.length, 1);
    assert.match(sendMail.mock.calls[0].arguments[0].text, /Loan A #1/);
    assert.match(sendMail.mock.calls[0].arguments[0].text, /Loan B #2/);
  } finally {
    fs.writeFileSync(LOANS_FILE, original);
  }
});

test('payment recording stores proof and adds an audit history entry', () => {
  const original = fs.readFileSync(LOANS_FILE, 'utf8');
  fs.writeFileSync(LOANS_FILE, JSON.stringify([
    { id: 5, email: 'customer@example.test', status: 'approved', outstanding: 100, payments: [] }
  ], null, 2));

  try {
    const req = {
      body: { id: '5', amount: '25', mode: 'bank_transfer', note: 'Receipt 25' },
      files: { screenshot: [{ filename: 'proof-25.png' }] },
      authUser: { email: 'admin@example.test', role: 'store_admin', storeId: 'buraza' }
    };
    const res = {
      statusCode: 200,
      status(code) { this.statusCode = code; return this; },
      json(payload) { this.body = payload; return this; }
    };

    recordPayment(req, res);

    const loan = JSON.parse(fs.readFileSync(LOANS_FILE, 'utf8'))[0];
    assert.equal(res.statusCode, 200);
    assert.equal(loan.outstanding, 75);
    assert.equal(loan.payments[0].screenshot, 'proof-25.png');
    assert.ok(loan.statusHistory.some(entry => /K 25\.00/.test(entry.reason)));
  } finally {
    fs.writeFileSync(LOANS_FILE, original);
  }
});
