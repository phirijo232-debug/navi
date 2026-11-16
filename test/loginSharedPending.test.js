'use strict';

// Login step two on a different Vercel instance: the in-memory pending entry
// is gone, but the code row in the shared otps table is enough to finish.
const test = require('node:test');
const assert = require('node:assert/strict');
const supabaseApi = require('../middleware/supabaseApi');
const dataStore = require('../middleware/dataStore');
const otp = require('../middleware/otp');
const { confirmLogin } = require('../controllers/authController');

function memoryTransport() {
  const docs = new Map();
  const rows = {};
  return (op) => {
    if (op.op === 'putDocument') { docs.set(op.key, op.body); return { status: 200, json: null }; }
    if (op.op === 'getDocument') { const b = docs.get(op.key); return { status: 200, json: b == null ? [] : [{ body: b }] }; }
    if (op.op === 'upsert') { const t = rows[op.table] || new Map(); t.set(op.row[op.onConflict], { ...op.row }); rows[op.table] = t; return { status: 201, json: null }; }
    if (op.op === 'select') {
      const t = rows[op.table] || new Map();
      const key = decodeURIComponent(String(op.query).split('=eq.')[1].split('&')[0]);
      const row = t.get(key) || null;
      return { status: 200, json: row ? [row] : [] };
    }
    if (op.op === 'delete') {
      const t = rows[op.table];
      if (t && String(op.query).includes('=eq.')) t.delete(decodeURIComponent(String(op.query).split('=eq.')[1].split('&')[0]));
      return { status: 204, json: null };
    }
    return { status: 200, json: null };
  };
}

function call(body) {
  return new Promise((resolve) => {
    const res = {
      statusCode: 200,
      status(code) { this.statusCode = code; return this; },
      json(payload) { resolve({ status: this.statusCode, body: payload }); }
    };
    confirmLogin({ body, ip: '203.0.113.9', headers: {}, get: () => '' }, res);
  });
}

test('login code from another instance completes login via the shared otps row', async () => {
  const previous = { STORAGE: process.env.STORAGE, SIGNING_SECRET: process.env.SIGNING_SECRET };
  process.env.STORAGE = 'supabase';
  process.env.SIGNING_SECRET = 'x'.repeat(40);
  supabaseApi.setTransport(memoryTransport());
  try {
    const email = 'admin@example.test';
    dataStore.writeJson(dataStore.paths.users, [{ id: 1, username: 'vlad', email, role: 'admin', storeId: 'buraza', password: 'hash', trustedDevices: [] }]);

    assert.equal((await call({ email, otp: '123456' })).status, 400, 'no code row means no pending login');

    const code = otp.generateOTP(otp.buildOtpKey(email, 'Login Verification'), true);
    const wrong = await call({ email, otp: code === '000000' ? '111111' : '000000' });
    assert.equal(wrong.status, 400);

    const ok = await call({ email, otp: code });
    assert.equal(ok.status, 200);
    assert.equal(ok.body.role, 'admin');
    assert.equal(ok.body.username, 'vlad');
    assert.ok(ok.body.deviceToken);

    assert.equal((await call({ email, otp: code })).status, 400, 'a used code cannot be replayed');
  } finally {
    for (const [k, v] of Object.entries(previous)) { if (v == null) delete process.env[k]; else process.env[k] = v; }
    supabaseApi.setTransport(null);
  }
});
