const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const dataStore = require('../middleware/dataStore');
const emailService = require('../middleware/email');
const {
  createAdminLoan,
  getNotifications,
  markNotificationRead
} = require('../controllers/loanController');

const FILES = [dataStore.paths.loans, dataStore.paths.users, dataStore.paths.notifications];

test('admin-created loans notify both borrower and scoped admin', async t => {
  const originals = FILES.map(file => fs.existsSync(file) ? fs.readFileSync(file, 'utf8') : null);
  const deliveries = [];
  t.mock.method(emailService, 'sendCustomerEmail', async message => {
    deliveries.push(message);
    return { ok: true };
  });
  t.after(() => {
    FILES.forEach((file, index) => {
      if (originals[index] === null) {
        if (fs.existsSync(file)) fs.unlinkSync(file);
      } else {
        fs.writeFileSync(file, originals[index]);
      }
    });
  });

  dataStore.writeJson(dataStore.paths.loans, []);
  dataStore.writeJson(dataStore.paths.users, [
    { email: 'main-admin@example.test', role: 'admin', storeId: 'buraza' },
    { email: 'borrower@example.test', role: 'user', storeId: 'buraza' }
  ]);
  dataStore.writeJson(dataStore.paths.notifications, []);

  const req = {
    authUser: { email: 'main-admin@example.test', role: 'admin', storeId: 'buraza' },
    headers: {},
    query: {},
    body: { email: 'borrower@example.test', product: 'Equipment', amount: 100, tenureWeeks: 1 }
  };
  const res = {
    statusCode: 200,
    status(code) { this.statusCode = code; return this; },
    json(body) { this.body = body; return this; }
  };
  await createAdminLoan(req, res);

  assert.equal(res.statusCode, 201);
  const loanId = res.body.loan.id;
  const notifications = dataStore.readJson(dataStore.paths.notifications, [], Array.isArray);
  assert.ok(notifications.some(item => item.recipientEmail === 'borrower@example.test' && item.loanId === loanId));
  assert.ok(notifications.some(item => !item.recipientEmail && item.loanId === loanId && item.type === 'admin-loan-created'));
  assert.ok(deliveries.some(item => item.to === 'borrower@example.test'));
  assert.ok(deliveries.some(item => Array.isArray(item.to) && item.to.length && !item.to.includes('borrower@example.test')));

  const adminResponse = { json(body) { this.body = body; return this; } };
  getNotifications({ authUser: req.authUser }, adminResponse);
  assert.ok(adminResponse.body.some(item => item.type === 'admin-loan-created' && item.loanId === loanId));

  const borrowerResponse = { json(body) { this.body = body; return this; } };
  getNotifications({ authUser: { email: 'borrower@example.test', role: 'user' } }, borrowerResponse);
  const borrowerNotice = borrowerResponse.body.find(item => item.loanId === loanId && item.type === 'admin-loan-created');
  assert.ok(borrowerNotice);
  const readResponse = {
    status(code) { this.statusCode = code; return this; },
    json(body) { this.body = body; return this; }
  };
  markNotificationRead({ authUser: { email: 'borrower@example.test', role: 'user' }, params: { id: borrowerNotice.id } }, readResponse);
  assert.equal(readResponse.statusCode || 200, 200);
});
