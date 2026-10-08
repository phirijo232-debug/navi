const test = require('node:test');
const assert = require('node:assert/strict');
const {
  calculateInterest,
  getApprovalDeadline,
  filterLoansByTimeframe,
  generateLoanReceiptId,
  normalizeStatus,
  deriveLoanStatus,
  summarizeStore,
  searchLoansByReceipt,
  rebuildPaymentLedger,
  migrateLoans,
  getLoansData
} = require('../controllers/loanController');

test('calculateInterest applies the expected weekly rate', () => {
  const result = calculateInterest(1000, 2);
  assert.equal(result.rate, 16);
  assert.equal(result.interest, 160);
  assert.equal(result.total, 1160);
});

test('getApprovalDeadline uses the urgency level', () => {
  const lowDeadline = new Date(getApprovalDeadline('low')).getTime();
  const standardDeadline = new Date(getApprovalDeadline('standard')).getTime();
  const emergencyDeadline = new Date(getApprovalDeadline('emergency')).getTime();

  assert.ok(lowDeadline > Date.now() + 2 * 24 * 60 * 60 * 1000);
  assert.ok(standardDeadline > Date.now() + 1 * 24 * 60 * 60 * 1000);
  assert.ok(emergencyDeadline < standardDeadline);
});

test('receipt ids use the BMF-YYYYMMDD-XXXX format and never collide (Task 1)', () => {
  const used = new Set(['BMF-20260501-0001']);
  const id = generateLoanReceiptId(used, new Date('2026-05-01T00:00:00Z'));
  assert.match(id, /^BMF-20260501-\d{4}$/);
  assert.notEqual(id, 'BMF-20260501-0001');
});

test('legacy statuses normalise onto the BMF lifecycle', () => {
  assert.equal(normalizeStatus('in_progress'), 'active');
  assert.equal(normalizeStatus('overdue'), 'grace');
  assert.equal(normalizeStatus('settled'), 'paid');
  assert.equal(normalizeStatus('rejected'), 'declined');
  assert.equal(normalizeStatus('recovered'), 'liquidated');
});

test('deriveLoanStatus maps the clock to active, grace and defaulted', () => {
  const base = { status: 'approved', amount: 1000, totalRepayment: 1160, outstanding: 1160 };
  assert.equal(deriveLoanStatus({ ...base, dueDate: '2026-10-25' }, '2026-10-01'), 'active');
  assert.equal(deriveLoanStatus({ ...base, dueDate: '2026-10-03' }, '2026-10-01'), 'grace');
  assert.equal(deriveLoanStatus({ ...base, dueDate: '2026-09-20' }, '2026-10-01'), 'defaulted');
  assert.equal(deriveLoanStatus({ ...base, outstanding: 0 }, '2026-10-01'), 'paid');
  assert.equal(deriveLoanStatus({ ...base, status: 'liquidated' }, '2026-10-01'), 'liquidated');
});

test('summarizeStore aggregates capital, interest and defaults', () => {
  const loans = [
    { id: 1, status: 'approved', amount: 1000, interestAmount: 160, dueDate: '2026-10-25', outstanding: 1160, paidTotal: 0 },
    { id: 2, status: 'approved', amount: 500, interestAmount: 40, dueDate: '2026-09-01', outstanding: 540, paidTotal: 0 },
    { id: 3, status: 'approved', amount: 200, interestAmount: 16, dueDate: '2026-09-01', outstanding: 0, paidTotal: 216 }
  ];
  const summary = summarizeStore(loans, '2026-10-01');
  assert.equal(summary.totalLoans, 3);
  assert.equal(summary.totalCapital, 1700);
  assert.equal(summary.defaulted.count, 1);
  assert.equal(summary.defaulted.possibleLoss, 540);
  assert.equal(summary.paid.count, 1);
});

test('rebuildPaymentLedger records receipt, balances and recorder on every row', () => {
  const loan = {
    id: 1,
    receiptNumber: 'BMF-2026-0001',
    totalRepayment: 1160,
    interestAmount: 160,
    reviewedBy: 'admin@example.test',
    payments: [{ amount: 160, date: '2026-10-01T00:00:00Z' }]
  };
  const rebuilt = rebuildPaymentLedger(loan);
  assert.equal(rebuilt.payments[0].balanceBefore, 1160);
  assert.equal(rebuilt.payments[0].balanceAfter, 1000);
  assert.match(rebuilt.payments[0].receiptNumber, /^PAY-\d{8}-\d{4}$/);
  assert.equal(rebuilt.payments[0].paymentReceiptId, rebuilt.payments[0].receiptNumber);
  assert.equal(rebuilt.payments[0].recordedBy, 'admin@example.test');
  assert.equal(rebuilt.payments[0].interestPortion, 160);
  assert.equal(rebuilt.outstanding, 1000);
});

test('searchLoansByReceipt finds loans by receipt number', () => {
  const loans = [
    { id: 1, receiptNumber: 'BMF-2026-0001', email: 'a@test.com' },
    { id: 2, receiptNumber: 'BMF-2026-0002', email: 'b@test.com' }
  ];
  assert.deepEqual(searchLoansByReceipt(loans, 'BMF-2026-0002').map(l => l.id), [2]);
  assert.deepEqual(searchLoansByReceipt(loans, 'bmf-2026').map(l => l.id), [1, 2]);
  assert.deepEqual(searchLoansByReceipt(loans, '1').map(l => l.id), [1]);
});

test('migrateLoans backfills receipts, borrowed dates and ledger fields', () => {
  const before = getLoansData().length;
  const result = migrateLoans();
  const after = getLoansData();
  assert.equal(after.length, before);
  assert.ok(after.every(loan => String(loan.receiptNumber || '').startsWith('BMF-')));
});

test('filterLoansByTimeframe only includes records within the selected window', () => {
  const now = new Date();
  const inRange = new Date(now.getTime() - 3 * 24 * 60 * 60 * 1000).toISOString();
  const outsideRange = new Date(now.getTime() - 50 * 24 * 60 * 60 * 1000).toISOString();

  const loans = [
    { id: 1, createdAt: inRange },
    { id: 2, createdAt: outsideRange },
    { id: 3, createdAt: new Date(now.getTime() + 60 * 60 * 1000).toISOString() }
  ];

  const filtered = filterLoansByTimeframe(loans, '30');
  assert.deepEqual(filtered.map(loan => loan.id), [1]);
});

