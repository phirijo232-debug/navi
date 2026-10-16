const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const dataStore = require('../middleware/dataStore');
const { getLoans, searchByReceiptId } = require('../controllers/loanController');

function responseRecorder() {
  return {
    statusCode: 200,
    status(code) { this.statusCode = code; return this; },
    json(payload) { this.body = payload; return this; }
  };
}

test('receipt search respects the caller role and store scope', () => {
  const loansFile = dataStore.paths.loans;
  const original = fs.readFileSync(loansFile, 'utf8');
  fs.writeFileSync(loansFile, JSON.stringify([
    { id: 701, email: 'buraza@example.test', storeId: 'buraza', receiptNumber: 'BMF-20261016-0701', amount: 100, outstanding: 100 },
    { id: 702, email: 'other@example.test', storeId: 'other-store', receiptNumber: 'BMF-20261016-0702', amount: 200, outstanding: 200,
      payments: [{ paymentReceiptId: 'PAY-20261016-0702', amount: 50, paymentDate: '2026-10-16T10:00:00.000Z' }] }
  ]));

  try {
    const customerLoans = responseRecorder();
    getLoans({ query: { email: 'buraza@example.test', storeId: 'other-store' }, headers: {}, authUser: { role: 'user', storeId: 'buraza', email: 'buraza@example.test' } }, customerLoans);
    assert.equal(customerLoans.statusCode, 200);
    assert.deepEqual(customerLoans.body.loans.map(loan => loan.id), [701]);

    const storeAdmin = responseRecorder();
    searchByReceiptId({ query: { receiptId: 'PAY-20261016-0702' }, headers: {}, authUser: { role: 'store_admin', storeId: 'buraza' } }, storeAdmin);
    assert.equal(storeAdmin.statusCode, 404);

    const franchiseAdmin = responseRecorder();
    searchByReceiptId({ query: { receiptId: 'PAY-20261016-0702' }, headers: {}, authUser: { role: 'franchise_admin', storeId: 'buraza' } }, franchiseAdmin);
    assert.equal(franchiseAdmin.statusCode, 404);

    const crossStoreAdmin = responseRecorder();
    searchByReceiptId({ query: { receiptId: 'PAY-20261016-0702', storeId: 'other-store' }, headers: {}, authUser: { role: 'store_admin', storeId: 'buraza' } }, crossStoreAdmin);
    assert.equal(crossStoreAdmin.statusCode, 403);

    const mainAdmin = responseRecorder();
    searchByReceiptId({ query: { receiptId: 'PAY-20261016-0702', storeId: 'all' }, headers: {}, authUser: { role: 'admin' } }, mainAdmin);
    assert.equal(mainAdmin.statusCode, 200);
    assert.deepEqual(mainAdmin.body.loans.map(loan => loan.id), [702]);
  } finally {
    fs.writeFileSync(loansFile, original);
  }
});
