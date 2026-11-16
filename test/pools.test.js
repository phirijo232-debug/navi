'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const { computePools } = require('../controllers/poolsController');

test('lending pools move with principal, not with interest', () => {
  const loans = [{
    status: 'active',
    approvedAt: '2026-11-01T00:00:00.000Z',
    amount: 10000,
    interestAmount: 1600,
    totalRepayment: 11600,
    outstanding: 11600,
    interestOutstanding: 1600,
    payments: []
  }];
  const open = computePools(loans, 100000);
  assert.equal(open.availableToLend, 90000);
  assert.equal(open.expectedIncome, 11600);
  assert.equal(open.expectedInterest, 1600);
  assert.equal(open.collected, 0);

  loans[0].payments.push({ amount: 10000, principalPortion: 8400, interestPortion: 1600 });
  loans[0].outstanding = 1600;
  loans[0].interestOutstanding = 0;
  const after = computePools(loans, 100000);
  assert.equal(after.availableToLend, 98400);
  assert.equal(after.expectedIncome, 1600);
  assert.equal(after.expectedInterest, 0);
  assert.equal(after.collected, 10000);
});

test('pending loans do not reduce the lending pool', () => {
  const pools = computePools([{ status: 'pending', amount: 5000, outstanding: 5000, payments: [] }], 10000);
  assert.equal(pools.availableToLend, 10000);
  assert.equal(pools.expectedIncome, 0);
});
