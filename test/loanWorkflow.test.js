const test = require('node:test');
const assert = require('node:assert/strict');
const {
  calculateInterest,
  getApprovalDeadline,
  filterLoansByTimeframe
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
