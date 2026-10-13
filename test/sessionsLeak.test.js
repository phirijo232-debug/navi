const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');

const { trackSession, getActiveSessions, pruneSessions } = require('../controllers/sessionController');

const USERS_FILE = require('../middleware/dataStore').paths.users;

function recorder() {
  return {
    statusCode: 200,
    body: undefined,
    status(code) { this.statusCode = code; return this; },
    json(payload) { this.body = payload; return this; }
  };
}

test('/sessions never echoes raw device tokens and scopes store_admin to their store', async () => {
  const original = fs.readFileSync(USERS_FILE, 'utf8');
  fs.writeFileSync(USERS_FILE, JSON.stringify([
    { id: 1, email: 'instore@example.test', role: 'user', storeId: 'buraza',
      trustedDevices: [{ token: 'store-a-customer-token-1234', lastSeen: new Date().toISOString() }] },
    { id: 2, email: 'otherstore@example.test', role: 'user', storeId: 'other-store',
      trustedDevices: [{ token: 'store-b-customer-token-5678', lastSeen: new Date().toISOString() }] }
  ], null, 2));

  try {
    // Track both sessions (simulating traffic).
    trackSession({ headers: { 'x-device-token': 'store-a-customer-token-1234' }, ip: '127.0.0.1' }, {}, () => {});
    trackSession({ headers: { 'x-device-token': 'store-b-customer-token-5678' }, ip: '127.0.0.2' }, {}, () => {});

    // store_admin of 'buraza' — sees only their own store's session.
    const storeAdminRes = recorder();
    await getActiveSessions({ authUser: { role: 'store_admin', storeId: 'buraza', email: 'admin@buraza.test' } }, storeAdminRes);
    assert.equal(storeAdminRes.statusCode, 200);
    assert.equal(storeAdminRes.body.total, 1);
    assert.equal(storeAdminRes.body.sessions[0].email, 'instore@example.test');

    // No raw token anywhere in the payload — only the masked id.
    const flat = JSON.stringify(storeAdminRes.body);
    assert.ok(!flat.includes('store-a-customer-token-1234'), 'raw token must not be echoed');
    assert.ok(!flat.includes('store-b-customer-token-5678'), 'other store token must not leak');
    assert.match(storeAdminRes.body.sessions[0].id, /^…\d{4}$/);

    // Full admin sees both, still with masked ids only.
    const fullAdminRes = recorder();
    await getActiveSessions({ authUser: { role: 'admin', storeId: 'buraza', email: 'root@buraza.test' } }, fullAdminRes);
    assert.equal(fullAdminRes.body.total, 2);
    const fullFlat = JSON.stringify(fullAdminRes.body);
    assert.ok(!fullFlat.includes('store-a-customer-token-1234'));
    assert.ok(!fullFlat.includes('store-b-customer-token-5678'));

    // Non-admin is rejected outright.
    const userRes = recorder();
    await getActiveSessions({ authUser: { role: 'user', storeId: 'buraza' } }, userRes);
    assert.equal(userRes.statusCode, 403);
  } finally {
    fs.writeFileSync(USERS_FILE, original);
    pruneSessions(0); // clear tracked test sessions
  }
});
