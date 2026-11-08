'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const loanTerms = require('../services/loanTerms');
const dataStore = require('../middleware/dataStore');
const auditGuardian = require('../middleware/auditLog');
const { getLoanInterestPolicy, updateLoanInterestPolicy, calculateDueDateFromApprovalDays } = require('../controllers/loanController');

function response() {
  return {
    statusCode: 200,
    status(code) { this.statusCode = code; return this; },
    json(body) { this.body = body; return this; }
  };
}

test('custom day calculations preserve the four existing weekly checkpoints', () => {
  const policy = loanTerms.getDefaultPolicy();
  assert.equal(loanTerms.getInterestRatePercentForDays(7, policy), 10);
  assert.equal(loanTerms.getInterestRatePercentForDays(14, policy), 16);
  assert.equal(loanTerms.getInterestRatePercentForDays(21, policy), 24);
  assert.equal(loanTerms.getInterestRatePercentForDays(28, policy), 32);
  assert.equal(loanTerms.getInterestRatePercentForDays(90, policy), 38.2);
  assert.equal(loanTerms.calculateInterestForDays(1000, 90, policy).interest, 382);
});

test('non-week terms interpolate and daily extension scales with the current one-week rate', () => {
  const base = loanTerms.getDefaultPolicy();
  assert.equal(loanTerms.getInterestRatePercentForDays(8, base), 10.857143);
  const changed = loanTerms.normalizePolicy({
    weeklyRates: { 1: 12, 2: 18, 3: 26, 4: 34 },
    extensionDailyRatePercent: 0.1
  });
  assert.equal(loanTerms.getEffectiveDailyExtensionRatePercent(changed), 0.12);
  assert.equal(loanTerms.getInterestRatePercentForDays(90, changed), 41.44);
});

test('loan duration display preserves exact days and full weeks', () => {
  assert.equal(loanTerms.formatLoanTerm({ tenureDays: 90, tenureWeeks: 13 }), '90 days');
  assert.equal(loanTerms.formatLoanTerm({ tenureDays: 84, tenureWeeks: 12 }), '12 weeks');
  assert.equal(loanTerms.formatLoanTerm({ tenureWeeks: 2 }), '2 weeks');
});

test('custom loan due date uses the approved date plus stored days', () => {
  assert.equal(calculateDueDateFromApprovalDays('2026-11-08T10:00:00+02:00', 90), '2027-02-06');
  assert.throws(() => calculateDueDateFromApprovalDays('2026-11-08T10:00:00+02:00', 154), /between 7 and 153 days/);
});

test('customers can read their store policy but store admins cannot edit rates', () => {
  const originalRead = dataStore.readJson;
  dataStore.readJson = (_file, fallback) => fallback;
  try {
    const getRes = response();
    getLoanInterestPolicy({ method: 'GET', authUser: { role: 'user', storeId: 'buraza' } }, getRes);
    assert.equal(getRes.statusCode, 200);
    assert.equal(getRes.body.weeklyRates[1], 10);
    assert.equal(getRes.body.effectiveExtensionDailyRatePercent, 0.1);

    const patchRes = response();
    updateLoanInterestPolicy({ authUser: { role: 'store_admin', storeId: 'buraza' }, body: {} }, patchRes);
    assert.equal(patchRes.statusCode, 403);
  } finally {
    dataStore.readJson = originalRead;
  }
});

test('franchise admin rate edits persist per store and write an audit record', () => {
  const originalRead = dataStore.readJson;
  const originalWrite = dataStore.writeJson;
  const originalAudit = auditGuardian.writeAudit;
  let savedFile;
  let savedData;
  let auditRecord;
  dataStore.readJson = (_file, fallback) => fallback;
  dataStore.writeJson = (file, value) => { savedFile = file; savedData = value; };
  auditGuardian.writeAudit = value => { auditRecord = value; };
  try {
    const res = response();
    updateLoanInterestPolicy({
      authUser: { role: 'franchise_admin', storeId: 'buraza', email: 'rate.manager@example.test' },
      headers: {},
      body: { weeklyRates: { 1: 10, 2: 16, 3: 24, 4: 32 }, extensionDailyRatePercent: 0.15 },
      ip: '127.0.0.1'
    }, res);
    assert.equal(res.statusCode, 200);
    assert.ok(savedFile.endsWith('loanInterestPolicy.json'));
    assert.equal(savedData.buraza.extensionDailyRatePercent, 0.15);
    assert.equal(auditRecord.action, 'LOAN_INTEREST_POLICY_UPDATED');
    assert.equal(auditRecord.detail.storeId, 'buraza');
  } finally {
    dataStore.readJson = originalRead;
    dataStore.writeJson = originalWrite;
    auditGuardian.writeAudit = originalAudit;
  }
});

test('rate updates reject decreasing tiers and invalid extension values', () => {
  const originalRead = dataStore.readJson;
  dataStore.readJson = (_file, fallback) => fallback;
  try {
    const res = response();
    updateLoanInterestPolicy({
      authUser: { role: 'admin', storeId: 'buraza' },
      headers: { 'x-business-unit': 'buraza' },
      body: { weeklyRates: { 1: 15, 2: 14, 3: 24, 4: 32 }, extensionDailyRatePercent: 0.1 }
    }, res);
    assert.equal(res.statusCode, 400);
    assert.match(res.body.error, /increase with each longer term/);
  } finally {
    dataStore.readJson = originalRead;
  }
});
