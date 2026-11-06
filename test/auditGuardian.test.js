const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const os = require('os');
const path = require('path');

const auditDir = fs.mkdtempSync(path.join(os.tmpdir(), 'navi-audit-guardian-'));
process.env.NAVI_AUDIT_LOG_FILE = path.join(auditDir, 'audit.log');
const audit = require('../middleware/auditLog');

test('audit writes append-only JSON lines and filters records', () => {
  audit.writeAudit({ action: audit.ACTIONS.LOAN_CREATED, actor: 'staff@example.test', targetId: 'BMF-1', detail: { amount: 100 } });
  audit.writeAudit({ action: audit.ACTIONS.USER_LOGIN, actor: 'customer@example.test', detail: {} });
  const raw = fs.readFileSync(audit.LOG_FILE, 'utf8');
  assert.equal(raw.trim().split(/\r?\n/).length, 2);
  const result = audit.readAuditLog({ action: audit.ACTIONS.LOAN_CREATED });
  assert.equal(result.total, 1);
  assert.equal(result.entries[0].targetId, 'BMF-1');
});

test('audit redacts credentials and supports threat-only filtering', () => {
  audit.writeAudit({
    action: audit.ACTIONS.THREAT_UNAUTHORISED_ADMIN,
    actor: 'customer@example.test',
    detail: { password: 'dont-log-me', nested: { deviceToken: 'secret-device-token', path: '/admin/users' } }
  });
  const result = audit.readAuditLog({ threats: true });
  assert.equal(result.total, 1);
  assert.equal(result.entries[0].detail.password, '[redacted]');
  assert.equal(result.entries[0].detail.nested.deviceToken, '[redacted]');
  assert.equal(result.entries[0].detail.nested.path, '/admin/users');
});

test('loan integrity evaluator detects mismatched, negative, and still-active settled balances', () => {
  assert.deepEqual(audit.evaluateLoanIntegrity({ totalRepayment: 100, paidTotal: 40, outstanding: 60 }), []);
  const issues = audit.evaluateLoanIntegrity({ id: 4, status: 'active', totalRepayment: 100, paidTotal: 110, outstanding: -10 });
  assert.deepEqual(issues.map(issue => issue.issueType), ['NEGATIVE_BALANCE', 'LOAN_SHOULD_BE_CLOSED']);
  assert.ok(audit.evaluateLoanIntegrity({ totalRepayment: 100, paidTotal: 55, outstanding: 40 })
    .some(issue => issue.issueType === 'BALANCE_DISCREPANCY'));
});

test('payment integrity evaluator flags zero amount, missing receipt, and unreconciled balance', () => {
  const issues = audit.evaluatePaymentIntegrity({ amount: 0 }, { id: 2 }, 50, 50);
  assert.deepEqual(issues.map(issue => issue.issueType), [
    'ZERO_PAYMENT', 'MISSING_RECEIPT'
  ]);
  assert.ok(audit.evaluatePaymentIntegrity({ amount: 20, paymentReceiptId: 'PAY-2' }, {}, 50, 50)
    .some(issue => issue.issueType === 'PAYMENT_BALANCE_NOT_UPDATED'));
  assert.deepEqual(audit.evaluatePaymentIntegrity({ amount: 20, paymentReceiptId: 'PAY-1' }, {}, 50, 30), []);
});

test('failed-login tracking counts attempts inside its time window and can reset', () => {
  assert.equal(audit.trackFailedLogin('198.51.100.4'), 1);
  assert.equal(audit.trackFailedLogin('198.51.100.4'), 2);
  audit.clearFailedLogin('198.51.100.4');
  assert.equal(audit.trackFailedLogin('198.51.100.4'), 1);
});

test('audit hash chain detects edits to a persisted entry', () => {
  const before = audit.readAuditLog().integrity;
  assert.equal(before.valid, true);
  const lines = fs.readFileSync(audit.LOG_FILE, 'utf8').trim().split(/\r?\n/);
  const record = JSON.parse(lines[0]);
  record.actor = 'tampered@example.test';
  lines[0] = JSON.stringify(record);
  fs.writeFileSync(audit.LOG_FILE, `${lines.join('\n')}\n`, 'utf8');

  const verification = audit.verifyAuditLog();
  assert.equal(verification.valid, false);
  assert.ok(verification.issues.some(issue => issue.reason === 'HASH_MISMATCH'));
  const afterFirstDetection = audit.readAuditLog({ action: audit.ACTIONS.THREAT_TAMPER_DETECTED }).total;
  assert.equal(afterFirstDetection, 1);
  audit.verifyAuditLog();
  assert.equal(audit.readAuditLog({ action: audit.ACTIONS.THREAT_TAMPER_DETECTED }).total, afterFirstDetection);
  assert.equal(audit.readAuditLog().integrity.valid, false);
});
