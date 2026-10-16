const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const dataStore = require('../middleware/dataStore');
const { submitPaymentProof, decidePaymentSubmission, getNotifications } = require('../controllers/loanController');

function responseRecorder() {
  return { statusCode: 200, status(code) { this.statusCode = code; return this; }, json(body) { this.body = body; return this; } };
}

test('transfer proof stays pending until scoped staff approval posts a single ledger payment', () => {
  const loanFile = dataStore.paths.loans;
  const notificationFile = dataStore.paths.notifications;
  const originals = [loanFile, notificationFile].map(file => {
    try { return fs.readFileSync(file, 'utf8'); } catch { return null; }
  });
  const loan = { id: 91001, receiptNumber: 'BMF-20261016-9101', email: 'borrower@example.test', storeId: 'buraza',
    status: 'active', amount: 100, interestAmount: 10, totalRepayment: 110, outstanding: 110,
    dueDate: '2026-12-01', payments: [], paymentSubmissions: [] };
  fs.writeFileSync(loanFile, JSON.stringify([loan]));
  fs.writeFileSync(notificationFile, JSON.stringify([]));

  try {
    const customerReq = { params: { id: '91001' }, body: { amount: '40', mode: 'Bank Transfer', transactionReference: 'ab12cd34' },
      files: { paymentProof: [{ filename: 'proof.png' }] }, authUser: { role: 'user', email: 'borrower@example.test', storeId: 'buraza' } };
    const submitted = responseRecorder();
    submitPaymentProof(customerReq, submitted);
    assert.equal(submitted.statusCode, 201);
    assert.equal(submitted.body.submission.status, 'pending');
    let persisted = JSON.parse(fs.readFileSync(loanFile, 'utf8'))[0];
    assert.equal(persisted.payments.length, 0);
    assert.equal(persisted.outstanding, 110);

    const staff = { params: { id: '91001', submissionId: submitted.body.submission.id, decision: 'approve' }, body: { physicalVerificationConfirmed: true },
      headers: {}, query: {}, authUser: { role: 'store_admin', email: 'staff@example.test', storeId: 'buraza' } };
    const approved = responseRecorder();
    decidePaymentSubmission(staff, approved);
    assert.equal(approved.statusCode, 200);
    persisted = JSON.parse(fs.readFileSync(loanFile, 'utf8'))[0];
    assert.equal(persisted.payments.length, 1);
    assert.match(persisted.payments[0].paymentReceiptId, /^PAY-\d{8}-\d{4}$/);
    assert.equal(persisted.payments[0].transactionReference, 'AB12CD34');
    assert.equal(persisted.outstanding, 70);

    const replay = responseRecorder();
    decidePaymentSubmission(staff, replay);
    assert.equal(replay.statusCode, 409);

    const customerNotifications = responseRecorder();
    getNotifications({ authUser: { email: 'borrower@example.test', role: 'user' } }, customerNotifications);
    assert.ok(customerNotifications.body.some(item => item.type === 'payment-approved'));
    const staffNotifications = responseRecorder();
    getNotifications({ authUser: { email: 'staff@example.test', role: 'store_admin', storeId: 'buraza' } }, staffNotifications);
    assert.ok(staffNotifications.body.some(item => item.type === 'payment-review'));

    const crossStoreApproval = responseRecorder();
    decidePaymentSubmission({ ...staff, params: { ...staff.params, decision: 'approve' }, authUser: { role: 'store_admin', storeId: 'other-store' } }, crossStoreApproval);
    assert.equal(crossStoreApproval.statusCode, 403);
  } finally {
    if (originals[0] === null) fs.rmSync(loanFile, { force: true }); else fs.writeFileSync(loanFile, originals[0]);
    if (originals[1] === null) fs.rmSync(notificationFile, { force: true }); else fs.writeFileSync(notificationFile, originals[1]);
  }
});

test('customer proof rejects forged role, duplicate references, and missing proof', () => {
  const loanFile = dataStore.paths.loans;
  const notificationFile = dataStore.paths.notifications;
  const originals = [loanFile, notificationFile].map(file => {
    try { return fs.readFileSync(file, 'utf8'); } catch { return null; }
  });
  fs.writeFileSync(loanFile, JSON.stringify([{ id: 91002, email: 'borrower@example.test', storeId: 'buraza', status: 'active',
    totalRepayment: 50, outstanding: 50, payments: [], paymentSubmissions: [{ id: 'known-submission', transactionReference: 'DUPLICATE', status: 'pending', amount: 10, mode: 'Airtel Money' }] }]));
  fs.writeFileSync(notificationFile, JSON.stringify([]));
  const base = { params: { id: '91002' }, body: { amount: '10', mode: 'Airtel Money', transactionReference: 'DUPLICATE' },
    files: { paymentProof: [{ filename: 'proof.png' }] }, authUser: { role: 'user', email: 'borrower@example.test', storeId: 'buraza' } };
  try {
    const duplicate = responseRecorder();
    submitPaymentProof(base, duplicate);
    assert.equal(duplicate.statusCode, 409);
    const missingPhysicalCheck = responseRecorder();
    decidePaymentSubmission({ params: { id: '91002', submissionId: 'known-submission', decision: 'approve' }, body: {}, headers: {}, query: {}, authUser: { role: 'store_admin', storeId: 'buraza', email: 'staff@example.test' } }, missingPhysicalCheck);
    assert.equal(missingPhysicalCheck.statusCode, 400);
    const noProof = responseRecorder();
    submitPaymentProof({ ...base, body: { ...base.body, transactionReference: 'UNIQUE-123' }, files: {} }, noProof);
    assert.equal(noProof.statusCode, 400);
    const forgedStaff = responseRecorder();
    submitPaymentProof({ ...base, authUser: { role: 'store_admin', email: 'borrower@example.test', storeId: 'buraza' } }, forgedStaff);
    assert.equal(forgedStaff.statusCode, 403);
  } finally {
    if (originals[0] === null) fs.rmSync(loanFile, { force: true }); else fs.writeFileSync(loanFile, originals[0]);
    if (originals[1] === null) fs.rmSync(notificationFile, { force: true }); else fs.writeFileSync(notificationFile, originals[1]);
  }
});
