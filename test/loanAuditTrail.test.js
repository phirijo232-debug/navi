const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const { updateLoanStatus, getAllLoans, notifyAllOverdue, recordPayment, getLoans, getLoanById } = require('../controllers/loanController');
const emailService = require('../middleware/email');

const LOANS_FILE = require('../middleware/dataStore').paths.loans;

test('loan status updates create a status history and admin summary includes all decision categories', async (t) => {
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
    t.mock.method(emailService, 'sendCustomerEmail', async () => ({ ok: true }));
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
    assert.equal(updated.status, 'active');
    assert.ok(Array.isArray(updated.statusHistory), 'statusHistory should be recorded');
    assert.ok(updated.statusHistory.some(entry => entry.status === 'active'), 'statusHistory should record the canonical active status after approval');
    assert.equal(summaryRes.body.summary.active, 1, 'active count should be present in admin summary');
    assert.equal(summaryRes.body.summary.pending, 0, 'pending count should be present in admin summary');
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

// Regression guard for "recorded payment does not show up for the user":
// both the list (getLoans) and the single-loan detail (getLoanById) endpoints
// must return the RECONCILED paidTotal/outstanding derived from the payments
// ledger — never a stale persisted balance. If either endpoint regresses to
// returning raw stored rows, this test fails.
test('recorded payments are reconciled in both the loan list and the loan detail view', () => {
  const original = fs.readFileSync(LOANS_FILE, 'utf8');
  // Deliberately store a STALE outstanding (1000) alongside two payments that
  // already total 200 — the enriched reads must ignore the stale value.
  fs.writeFileSync(LOANS_FILE, JSON.stringify([
    {
      id: 7001,
      email: 'borrower@example.com',
      status: 'active',
      amount: 1000,
      interestAmount: 0,
      totalRepayment: 1000,
      outstanding: 1000, // stale on purpose
      payments: [
        { amount: 100, paymentDate: '2026-10-01', mode: 'cash' },
        { amount: 100, paymentDate: '2026-10-02', mode: 'cash' }
      ]
    }
  ], null, 2));

  try {
    const borrower = { email: 'borrower@example.com', role: 'user', storeId: 'buraza' };
    const makeRes = () => ({
      statusCode: 200,
      status(code) { this.statusCode = code; return this; },
      json(payload) { this.body = payload; return this; }
    });

    // --- list view (GET /loans?email=) ---
    const listRes = makeRes();
    getLoans({ query: { email: 'borrower@example.com' }, authUser: borrower }, listRes);
    assert.equal(listRes.statusCode, 200);
    const listLoan = listRes.body.loans[0];
    assert.equal(listLoan.paidTotal, 200, 'list view: paidTotal must equal the sum of recorded payments');
    assert.equal(listLoan.outstanding, 800, 'list view: outstanding must be recomputed, not the stale stored value');

    // --- detail view (GET /loans/:id) ---
    const detailRes = makeRes();
    getLoanById({ params: { id: 7001 }, authUser: borrower }, detailRes);
    assert.equal(detailRes.statusCode, 200);
    const detailLoan = detailRes.body.loan;
    assert.equal(detailLoan.paidTotal, 200, 'detail view: paidTotal must equal the sum of recorded payments');
    assert.equal(detailLoan.outstanding, 800, 'detail view: outstanding must be recomputed, not the stale stored value');
    assert.equal(detailLoan.payments.length, 2, 'detail view: payment history must be present');
    assert.equal(detailLoan.payments[0].balanceBefore, 1000, 'detail view: ledger must reconcile balanceBefore');
    assert.equal(detailLoan.payments[1].balanceAfter, 800, 'detail view: ledger must reconcile balanceAfter');
  } finally {
    fs.writeFileSync(LOANS_FILE, original);
  }
});
