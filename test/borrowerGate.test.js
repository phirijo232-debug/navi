'use strict';

const { test } = require('node:test');
const assert = require('node:assert/strict');
const { assessBorrowerRequest } = require('../controllers/loanController');

const user = {
  email: 'borrower@example.test',
  address: 'Kalingalinga',
  nextOfKinName: 'Aunt',
  nextOfKinPhone: '0977000009',
  nrcPhoto: 'nrc.jpg'
};

test('a request is refused until identity details are on file', () => {
  const result = assessBorrowerRequest({
    user: { email: 'borrower@example.test' },
    loans: [],
    amount: 500
  });
  assert.equal(result.ok, false);
  assert.match(result.error, /NRC photo/);
});

test('a second open loan is refused unless the shop allows it', () => {
  const open = {
    email: 'borrower@example.test',
    status: 'active',
    amount: 800,
    outstanding: 880,
    dueDate: '2026-12-01'
  };
  const blocked = assessBorrowerRequest({ user, loans: [open], amount: 200 });
  assert.equal(blocked.ok, false);
  assert.match(blocked.error, /open loan/);

  const allowed = assessBorrowerRequest({
    user: { ...user, allowMultipleLoans: true, creditLimit: 5000 },
    loans: [open],
    amount: 200
  });
  assert.equal(allowed.ok, true);
});

test('the borrowing limit counts principal already out', () => {
  const result = assessBorrowerRequest({
    user: { ...user, allowMultipleLoans: true, creditLimit: 1000 },
    loans: [{ email: user.email, status: 'active', amount: 800, outstanding: 880, dueDate: '2026-12-01' }],
    amount: 300
  });
  assert.equal(result.ok, false);
  assert.match(result.error, /borrowing limit/);
});
