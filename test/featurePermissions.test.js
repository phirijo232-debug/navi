'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const { requireFeatures } = require('../middleware/featurePermissions');
const { maskPremiumResponse } = require('../middleware/premiumPrivacy');

function response() {
  return { statusCode: 200, body: null, status(code) { this.statusCode = code; return this; }, json(body) { this.body = body; return this; } };
}

test('locked store_admin feature returns a requestable denial and a default allowed feature passes', () => {
  const req = { authUser: { role: 'store_admin', email: 'feature-test@example.test', storeId: 'buraza' } };
  let calledNext = false;
  const denied = response();
  requireFeatures('view_revenue')(req, denied, () => { calledNext = true; });
  assert.equal(denied.statusCode, 403);
  assert.equal(denied.body.accessRequestRequired, true);
  assert.equal(denied.body.feature, 'view_revenue');
  assert.equal(calledNext, false);

  const allowed = response();
  requireFeatures('bulk_notify')(req, allowed, () => { calledNext = true; });
  assert.equal(allowed.statusCode, 200);
  assert.equal(calledNext, true);
});

test('premium customer loan and payment values are masked while normal records remain intact', () => {
  const context = {
    isPremium: record => String(record.email || '').toLowerCase() === 'premium@example.test' || record.loanId === 'BMF-1'
  };
  const source = {
    loans: [
      { receiptNumber: 'BMF-1', email: 'premium@example.test', amount: 100, outstanding: 60, paidTotal: 40, payments: [{ amount: 40 }] },
      { receiptNumber: 'BMF-2', email: 'normal@example.test', amount: 50, outstanding: 20, paidTotal: 30, payments: [{ amount: 30 }] }
    ],
    summary: { totalOutstanding: 80, totalPaid: 70 }
  };
  const result = maskPremiumResponse(source, context);
  assert.equal(result.loans[0].amount, null);
  assert.equal(result.loans[0].outstanding, null);
  assert.deepEqual(result.loans[0].payments, []);
  assert.equal(result.loans[0].masked, true);
  assert.equal(result.loans[1].amount, 50);
  assert.deepEqual(result.loans[1].payments, [{ amount: 30 }]);
  assert.equal(result.summary.totalOutstanding, null);
  assert.equal(result.summary.totalPaid, null);
});
