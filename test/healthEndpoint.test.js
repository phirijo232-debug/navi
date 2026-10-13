const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');

const { getHealth, getStatus } = require('../controllers/statusController');

function recorder() {
  return {
    statusCode: 200,
    body: undefined,
    status(code) { this.statusCode = code; return this; },
    json(payload) { this.body = payload; return this; }
  };
}

test('GET /health public tier exposes only status + uptime (no internals)', async () => {
  const req = { headers: {} }; // anonymous, no token
  const res = recorder();
  await getHealth(req, res);

  assert.equal(res.statusCode, 200);
  assert.deepEqual(Object.keys(res.body).sort(), ['status', 'uptime']);
  assert.equal(res.body.status, 'ok');

  // Explicit leak assertions — none of these may ever appear for anon callers.
  const flat = JSON.stringify(res.body);
  for (const forbidden of ['memory', 'db', 'heartbeat', 'pid', 'hostname', 'mode', 'rss']) {
    assert.ok(!flat.includes(forbidden), `public /health must not expose "${forbidden}"`);
  }
});

test('GET /health admin tier adds detail only for a valid admin token', async () => {
  const original = fs.readFileSync(require('../middleware/dataStore').paths.users, 'utf8');
  const users = [
    { id: 1, email: 'h.admin@example.test', role: 'store_admin', storeId: 'buraza',
      trustedDevices: [{ token: 'health-admin-token', lastSeen: new Date().toISOString() }] },
    { id: 2, email: 'h.user@example.test', role: 'user', storeId: 'buraza',
      trustedDevices: [{ token: 'health-customer-token', lastSeen: new Date().toISOString() }] }
  ];
  fs.writeFileSync(require('../middleware/dataStore').paths.users, JSON.stringify(users, null, 2));

  try {
    // Customer token → public tier only, even WITH a token.
    const customerRes = recorder();
    await getHealth({ headers: { 'x-device-token': 'health-customer-token' } }, customerRes);
    assert.deepEqual(Object.keys(customerRes.body).sort(), ['status', 'uptime']);

    // Admin token → detail tier.
    const adminRes = recorder();
    await getHealth({ headers: { 'x-device-token': 'health-admin-token' } }, adminRes);
    assert.ok(adminRes.body.memory, 'admin sees memory');
    assert.ok(adminRes.body.db, 'admin sees db');
    assert.ok(adminRes.body.heartbeat, 'admin sees heartbeat');
    // But even the admin tier must not leak the db file path.
    const flat = JSON.stringify(adminRes.body);
    assert.ok(!flat.includes('navi.db'), 'db file path must never be exposed');
    assert.ok(!flat.includes(process.cwd()), 'filesystem paths must never be exposed');

    // Bogus token → public tier (not a 500, not detail).
    const bogusRes = recorder();
    await getHealth({ headers: { 'x-device-token': 'not-a-real-token' } }, bogusRes);
    assert.deepEqual(Object.keys(bogusRes.body).sort(), ['status', 'uptime']);
  } finally {
    fs.writeFileSync(require('../middleware/dataStore').paths.users, original);
  }
});

test('GET /status no longer exposes machine identity', async () => {
  const res = recorder();
  await getStatus({}, res);

  assert.equal(res.statusCode, 200);
  assert.equal(res.body.status, 'running');
  assert.ok(res.body.uptime);
  assert.ok(res.body.ram.used);      // dashboard renders this
  assert.ok(res.body.cpu.cores);     // dashboard renders this

  assert.ok(!('hostname' in res.body), 'hostname must be stripped');
  assert.ok(!('platform' in res.body), 'platform must be stripped');
  assert.ok(!res.body.cpu.model, 'cpu model must be stripped');
});
