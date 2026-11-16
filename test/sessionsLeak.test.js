const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');

const { trackSession, getActiveSessions, pruneSessions } = require('../controllers/sessionController');
const { issueDeviceToken } = require('../middleware/tokenAuth');

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
  const instore = issueDeviceToken({ userId: 1, email: 'instore@example.test' });
  const other = issueDeviceToken({ userId: 2, email: 'otherstore@example.test' });
  fs.writeFileSync(USERS_FILE, JSON.stringify([
    { id: 1, email: 'instore@example.test', role: 'user', storeId: 'buraza', trustedDevices: [instore.record] },
    { id: 2, email: 'otherstore@example.test', role: 'user', storeId: 'other-store', trustedDevices: [other.record] }
  ], null, 2));

  try {
    trackSession({ headers: { 'x-device-token': instore.token }, ip: '127.0.0.1' }, {}, () => {});
    trackSession({ headers: { 'x-device-token': other.token }, ip: '127.0.0.2' }, {}, () => {});

    // store_admin of 'buraza' — sees only their own store's session.
    const storeAdminRes = recorder();
    await getActiveSessions({ authUser: { role: 'store_admin', storeId: 'buraza', email: 'admin@buraza.test' } }, storeAdminRes);
    assert.equal(storeAdminRes.statusCode, 200);
    assert.equal(storeAdminRes.body.total, 1);
    assert.equal(storeAdminRes.body.sessions[0].email, 'instore@example.test');

    // No raw token anywhere in the payload — only the masked id.
    const flat = JSON.stringify(storeAdminRes.body);
    assert.ok(!flat.includes(instore.token), 'raw token must not be echoed');
    assert.ok(!flat.includes(other.token), 'other store token must not leak');
    assert.match(storeAdminRes.body.sessions[0].id, /^….{4}$/);

    // Full admin sees both, still with masked ids only.
    const fullAdminRes = recorder();
    await getActiveSessions({ authUser: { role: 'admin', storeId: 'buraza', email: 'root@buraza.test' } }, fullAdminRes);
    assert.equal(fullAdminRes.body.total, 2);
    const fullFlat = JSON.stringify(fullAdminRes.body);
    assert.ok(!fullFlat.includes(instore.token));
    assert.ok(!fullFlat.includes(other.token));

    // Non-admin is rejected outright.
    const userRes = recorder();
    await getActiveSessions({ authUser: { role: 'user', storeId: 'buraza' } }, userRes);
    assert.equal(userRes.statusCode, 403);
  } finally {
    fs.writeFileSync(USERS_FILE, original);
    pruneSessions(0); // clear tracked test sessions
  }
});
