'use strict';

const fs = require('fs');
const os = require('os');
const path = require('path');
const test = require('node:test');
const assert = require('node:assert/strict');
const http = require('http');

const logsDir = fs.mkdtempSync(path.join(os.tmpdir(), 'navi-audit-logs-'));
process.env.NAVI_LOGS_DIR = logsDir;

const { logAccess } = require('../middleware/logger');
const { shareKeyGate } = require('../middleware/shareLinks');
const { issueDeviceToken } = require('../middleware/tokenAuth');
const dataStore = require('../middleware/dataStore');
const { createBackup, listBackups, restoreBackup } = require('../controllers/backupController');
const { createInvite, listInvites } = require('../controllers/authController');
const app = require('../server');

const USERS_FILE = dataStore.paths.users;
const LOANS_FILE = dataStore.paths.loans;
const INVITES_FILE = path.join(dataStore.DATA_DIR, 'invites.json');

function responseRecorder() {
  return {
    statusCode: 200,
    status(code) { this.statusCode = code; return this; },
    json(payload) { this.body = payload; return this; }
  };
}

function listen(server) {
  return new Promise((resolve) => server.listen(0, '127.0.0.1', () => resolve(server.address().port)));
}

function request(port, method, target, { headers = {}, body } = {}) {
  return new Promise((resolve, reject) => {
    const payload = body ? JSON.stringify(body) : null;
    const req = http.request({
      hostname: '127.0.0.1',
      port,
      path: target,
      method,
      headers: {
        ...headers,
        ...(payload ? { 'content-type': 'application/json', 'content-length': Buffer.byteLength(payload) } : {})
      }
    }, (res) => {
      const chunks = [];
      res.on('data', (chunk) => chunks.push(chunk));
      res.on('end', () => {
        const text = Buffer.concat(chunks).toString('utf8');
        let json = null;
        try { json = JSON.parse(text); } catch { /* not json */ }
        resolve({ status: res.statusCode, json, text });
      });
    });
    req.on('error', reject);
    if (payload) req.write(payload);
    req.end();
  });
}

function readJson(file, fallback) {
  try { return JSON.parse(fs.readFileSync(file, 'utf8')); } catch { return fallback; }
}

test('access log redacts signed upload links and share keys', () => {
  const req = {
    method: 'GET',
    ip: '127.0.0.1',
    url: '/uploads/nrc.jpg?exp=1&sig=super-secret-sig&jti=abcjti&u=person@example.test&token=device-token&key=share-key'
  };
  logAccess(req, {}, () => {});
  const log = fs.readFileSync(path.join(logsDir, 'access.log'), 'utf8');
  assert.match(log, /sig=REDACTED/);
  assert.match(log, /jti=REDACTED/);
  assert.match(log, /token=REDACTED/);
  assert.match(log, /key=REDACTED/);
  assert.equal(log.includes('super-secret-sig'), false);
  assert.equal(log.includes('device-token'), false);
  assert.equal(log.includes('share-key'), false);
});

test('share key comparison does not accept a wrong key', () => {
  const previous = process.env.SHARE_PUBLIC_KEY;
  process.env.SHARE_PUBLIC_KEY = 'correct-share-key';
  try {
    let nexted = false;
    const denied = { statusCode: 200, status(code) { this.statusCode = code; return this; }, send() { return this; } };
    shareKeyGate({ path: '/signup', query: { key: 'wrong-share-key' } }, denied, () => { nexted = true; });
    assert.equal(denied.statusCode, 403);
    assert.equal(nexted, false);

    const allowed = { statusCode: 200, status(code) { this.statusCode = code; return this; }, send() { return this; } };
    let passed = false;
    shareKeyGate({ path: '/signup', query: { key: 'correct-share-key' } }, allowed, () => { passed = true; });
    assert.equal(passed, true);
  } finally {
    if (previous === undefined) delete process.env.SHARE_PUBLIC_KEY;
    else process.env.SHARE_PUBLIC_KEY = previous;
  }
});

test('store admin cannot export or restore the whole franchise backup', () => {
  const storeAdmin = { authUser: { id: 9, email: 'store@example.test', role: 'store_admin', storeId: 'buraza' }, body: {} };
  const created = responseRecorder();
  createBackup(storeAdmin, created);
  assert.equal(created.statusCode, 403);
  const listed = responseRecorder();
  listBackups(storeAdmin, listed);
  assert.equal(listed.statusCode, 403);
  const restored = responseRecorder();
  restoreBackup(storeAdmin, restored);
  assert.equal(restored.statusCode, 403);
});

test('invite secret does not let a customer mint links, and store staff cannot list them', async () => {
  const previousSecret = process.env.INVITE_SECRET;
  const original = fs.existsSync(INVITES_FILE) ? fs.readFileSync(INVITES_FILE, 'utf8') : null;
  process.env.INVITE_SECRET = 'audit-invite-secret';
  try {
    const customer = responseRecorder();
    await createInvite({
      body: { email: 'invited-victim@example.test', secret: 'audit-invite-secret' },
      authUser: { role: 'user', email: 'customer@example.test' }
    }, customer);
    assert.equal(customer.statusCode, 403);

    const admin = responseRecorder();
    await createInvite({
      body: { email: 'invited-ok@example.test' },
      authUser: { role: 'admin', email: 'admin@example.test' }
    }, admin);
    assert.equal(admin.statusCode, 200);
    assert.ok(admin.body.signupUrl);

    const staff = responseRecorder();
    listInvites({ authUser: { role: 'store_admin', email: 'store@example.test', storeId: 'buraza' } }, staff);
    assert.equal(staff.statusCode, 403);
    assert.equal(JSON.stringify(staff.body).includes('invited-ok@example.test'), false);
  } finally {
    if (previousSecret === undefined) delete process.env.INVITE_SECRET;
    else process.env.INVITE_SECRET = previousSecret;
    if (original === null) fs.rmSync(INVITES_FILE, { force: true });
    else fs.writeFileSync(INVITES_FILE, original);
  }
});

test('legacy user routes stay inside the caller store and cannot mint staff', async () => {
  const originalUsers = fs.existsSync(USERS_FILE) ? fs.readFileSync(USERS_FILE, 'utf8') : '[]';
  const originalLoans = fs.existsSync(LOANS_FILE) ? fs.readFileSync(LOANS_FILE, 'utf8') : null;
  const storeToken = issueDeviceToken({ userId: 8801, email: 'store-a-audit@example.test' });
  const adminToken = issueDeviceToken({ userId: 8802, email: 'main-audit@example.test' });
  const users = [
    {
      id: 8801,
      username: 'Store A',
      email: 'store-a-audit@example.test',
      role: 'store_admin',
      storeId: 'buraza',
      phone: '+260977000111',
      trustedDevices: [{ ...storeToken.record, ip: '127.0.0.1', lastSeen: new Date().toISOString() }]
    },
    {
      id: 8802,
      username: 'Main',
      email: 'main-audit@example.test',
      role: 'admin',
      storeId: 'buraza',
      phone: '+260977000112',
      trustedDevices: [{ ...adminToken.record, ip: '127.0.0.1', lastSeen: new Date().toISOString() }]
    },
    {
      id: 8803,
      username: 'Other Customer',
      email: 'other-store-audit@example.test',
      role: 'user',
      storeId: 'other-store',
      phone: '+260977000113',
      nrc: '111111/11/1',
      trustedDevices: []
    }
  ];
  fs.writeFileSync(USERS_FILE, JSON.stringify(users));
  fs.writeFileSync(LOANS_FILE, JSON.stringify([
    { id: 88001, email: 'other-store-audit@example.test', storeId: 'other-store', amount: 500, outstanding: 500, status: 'active', payments: [] }
  ]));

  const server = http.createServer(app);
  const port = await listen(server);
  try {
    const minted = await request(port, 'POST', '/admin/users', {
      headers: { 'x-device-token': storeToken.token },
      body: { fullName: 'Extra Admin', email: 'minted-audit@example.test', phone: '0977000222', role: 'store_admin' }
    });
    assert.notEqual(minted.status, 201);
    const afterMint = readJson(USERS_FILE, []);
    assert.equal(afterMint.some(user => user.email === 'minted-audit@example.test'), false);

    const directory = await request(port, 'GET', '/admin/users', {
      headers: { 'x-device-token': storeToken.token }
    });
    assert.equal(directory.status, 200);
    assert.equal(JSON.stringify(directory.json).includes('other-store-audit@example.test'), false);
    assert.equal(JSON.stringify(directory.json).includes('111111/11/1'), false);

    const customers = await request(port, 'GET', '/admin/customers', {
      headers: { 'x-device-token': storeToken.token }
    });
    assert.equal(customers.status, 200);
    assert.equal(JSON.stringify(customers.json).includes('other-store-audit@example.test'), false);

    const restricted = await request(port, 'PATCH', '/admin/users/other-store-audit@example.test/restrict', {
      headers: { 'x-device-token': storeToken.token },
      body: { restricted: true }
    });
    assert.equal(restricted.status, 403);

    const created = await request(port, 'POST', '/admin/users', {
      headers: { 'x-device-token': adminToken.token },
      body: {
        username: 'Real Customer',
        email: 'real-customer-audit@example.test',
        phone: '0977000333',
        role: 'user',
        password: 'StrongPass1!',
        confirmPassword: 'StrongPass1!'
      }
    });
    assert.equal(created.status, 201);
    assert.equal(created.json.user.role, 'user');
    const saved = readJson(USERS_FILE, []).find(user => user.email === 'real-customer-audit@example.test');
    assert.ok(saved.password);
    assert.notEqual(saved.password, 'StrongPass1!');
  } finally {
    server.close();
    fs.writeFileSync(USERS_FILE, originalUsers);
    if (originalLoans === null) fs.rmSync(LOANS_FILE, { force: true });
    else fs.writeFileSync(LOANS_FILE, originalLoans);
  }
});
