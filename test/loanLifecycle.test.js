'use strict';

// Loan lifecycle (ExecPlan: loan-lifecycle) — canonical statuses only, the
// 1.8%/day grace penalty, and the manual/automatic transition rules.
const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const path = require('path');

const {
  deriveLoanStatus,
  applyGraceAccrual,
  parseDateInput,
  rebuildPaymentLedger
} = require('../controllers/loanController');

test('manual grace window drives the status until the agreed date, then defaulted', () => {
  const loan = { status: 'grace', graceUntil: '2026-10-15', dueDate: '2026-10-01', outstanding: 500, amount: 1000 };
  assert.equal(deriveLoanStatus(loan, '2026-10-15'), 'grace');
  assert.equal(deriveLoanStatus(loan, '2026-10-16'), 'defaulted');
});

test('verified overdue stays defaulted even when the clock would say active', () => {
  const loan = {
    status: 'defaulted',
    verifiedOverdueAt: '2026-10-05T09:00:00Z',
    dueDate: '2026-10-30',
    outstanding: 500,
    amount: 1000
  };
  assert.equal(deriveLoanStatus(loan, '2026-10-08'), 'defaulted');
});

test('grace accrual pins the base on first pass, then adds 1.8%/day idempotently', () => {
  const loan = {
    status: 'active',
    amount: 1000,
    interestAmount: 200,
    totalRepayment: 1200,
    outstanding: 1200,
    dueDate: '2026-10-05'
  };
  // Past due -> grace by the clock. First pass pins the window: no charge today.
  applyGraceAccrual(loan, '2026-10-08');
  assert.equal(loan.graceAccrualBase, 1200);
  assert.equal(loan.graceAccrued, 0);

  // Two days later: 2 x 1200 x 1.8% = 43.20.
  applyGraceAccrual(loan, '2026-10-10');
  assert.equal(loan.graceAccrued, 43.2);
  assert.equal(loan.interestAmount, 243.2);
  assert.equal(loan.totalRepayment, 1243.2);

  // Same day again — idempotent, no double charge.
  applyGraceAccrual(loan, '2026-10-10');
  assert.equal(loan.graceAccrued, 43.2);

  // The accrued penalty rides on the ledger balance.
  rebuildPaymentLedger(loan);
  assert.equal(loan.outstanding, 1243.2);
});

test('grace penalty is capped at 50% of the original principal', () => {
  const loan = {
    status: 'defaulted',
    amount: 1000,
    interestAmount: 200,
    totalRepayment: 1200,
    outstanding: 1200,
    dueDate: '2026-09-01'
  };
  applyGraceAccrual(loan, '2026-09-02'); // pin base
  applyGraceAccrual(loan, '2026-11-30'); // far beyond the 50% cap
  assert.equal(loan.graceAccrued, 500); // 50% x 1000
});

test('liquidated and paid loans never accrue grace', () => {
  const liquidated = { status: 'liquidated', amount: 1000, outstanding: 400, dueDate: '2026-09-01' };
  applyGraceAccrual(liquidated, '2026-10-08');
  assert.equal(liquidated.graceAccrued, undefined);

  const paid = { status: 'paid', amount: 1000, outstanding: 0, dueDate: '2026-09-01' };
  applyGraceAccrual(paid, '2026-10-08');
  assert.equal(paid.graceAccrued, undefined);
});

test('parseDateInput accepts ISO and DD/MM/YYYY, rejects junk', () => {
  assert.equal(parseDateInput('2026-10-15'), '2026-10-15');
  assert.equal(parseDateInput('15/10/2026'), '2026-10-15');
  assert.equal(parseDateInput('nonsense'), null);
  assert.equal(parseDateInput(''), null);
  assert.equal(parseDateInput(null), null);
});

test('canonical-only statuses: no fabricated labels in the customer/admin UI', () => {
  const publicDir = path.join(__dirname, '..', 'public');
  for (const file of ['admin.js', 'user.html', 'dashboard.js']) {
    const source = fs.readFileSync(path.join(publicDir, file), 'utf8');
    assert.ok(!source.includes('Good Standing'), `${file} must not contain "Good Standing"`);
    assert.ok(!source.includes('Has Overdue'), `${file} must not contain "Has Overdue"`);
  }

  // The admin loan-filter list uses only canonical statuses (plus "all").
  const adminSource = fs.readFileSync(path.join(publicDir, 'admin.js'), 'utf8');
  const match = adminSource.match(/LOAN_STATUS_FILTERS = \[([^\]]+)\]/);
  assert.ok(match, 'LOAN_STATUS_FILTERS must exist in admin.js');
  const filters = match[1].split(',').map(value => value.trim().replace(/'/g, ''));
  const allowed = new Set(['all', 'pending', 'active', 'grace', 'defaulted', 'liquidated', 'paid', 'declined']);
  for (const filter of filters) {
    assert.ok(allowed.has(filter), `filter "${filter}" is not a canonical status`);
  }
});

test('admin loans are created with the activating admin attributed', () => {
  const source = fs.readFileSync(path.join(__dirname, '..', 'controllers', 'loanController.js'), 'utf8');
  assert.ok(source.includes('Loan created and activated by ${activatingAdmin}'),
    'createAdminLoan must attribute the activation to the logged-in admin');
});
