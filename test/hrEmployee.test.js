const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const {
  createAdminUser,
  listEmployees,
  setEmployeeRestriction,
  requestStoreSwitch,
  verifyStoreSwitch
} = require('../controllers/authController');
const { notifyAllOverdue } = require('../controllers/loanController');
const otpService = require('../middleware/otp');

const USERS_FILE = require('../middleware/dataStore').paths.users;

function responseRecorder() {
  return {
    statusCode: 200,
    status(code) { this.statusCode = code; return this; },
    json(payload) { this.body = payload; return this; }
  };
}

function seedUsers() {
  return JSON.stringify([
    { id: 1, email: 'main@example.test', username: 'Main', role: 'admin', storeId: 'buraza', restrictions: [], trustedDevices: [] },
    { id: 2, email: 'franchise@example.test', username: 'Franchise', role: 'franchise_admin', storeId: 'buraza', restrictions: [], trustedDevices: [] },
    { id: 3, email: 'operator@example.test', username: 'Operator', role: 'store_admin', storeId: 'buraza', restrictions: [], trustedDevices: [] }
  ]);
}

test('only franchise-level admins can list employees; restricted store admins are refused', async () => {
  const original = fs.readFileSync(USERS_FILE, 'utf8');
  fs.writeFileSync(USERS_FILE, seedUsers());
  try {
    const denied = responseRecorder();
    listEmployees({ authUser: { role: 'store_admin', storeId: 'buraza', id: 3 }, headers: {} }, denied);
    assert.equal(denied.statusCode, 403);

    const allowed = responseRecorder();
    listEmployees({ authUser: { role: 'franchise_admin', storeId: 'buraza', id: 2 }, headers: {} }, allowed);
    assert.equal(allowed.statusCode, 200);
    assert.equal(allowed.body.employees.length, 3);
    assert.ok(allowed.body.employees.every(e => ['admin', 'franchise_admin', 'store_admin'].includes(e.role)));
  } finally {
    fs.writeFileSync(USERS_FILE, original);
  }
});

test('franchise admin can restrict a store admin from notifying all; store admin cannot restrict', async () => {
  const original = fs.readFileSync(USERS_FILE, 'utf8');
  fs.writeFileSync(USERS_FILE, seedUsers());
  try {
    const ok = responseRecorder();
    setEmployeeRestriction(
      { authUser: { role: 'franchise_admin', storeId: 'buraza', id: 2 }, headers: {}, params: { id: '3' }, body: { action: 'notifyAll', restricted: true } },
      ok
    );
    assert.equal(ok.statusCode, 200);
    assert.ok(ok.body.employee.restrictions.includes('notifyAll'));

    const stored = JSON.parse(fs.readFileSync(USERS_FILE, 'utf8'));
    assert.ok(stored.find(u => u.id === 3).restrictions.includes('notifyAll'));

    const denied = responseRecorder();
    setEmployeeRestriction(
      { authUser: { role: 'store_admin', storeId: 'buraza', id: 3 }, headers: {}, params: { id: '2' }, body: { action: 'notifyAll', restricted: true } },
      denied
    );
    assert.equal(denied.statusCode, 403);
  } finally {
    fs.writeFileSync(USERS_FILE, original);
  }
});

test('a restricted store admin is blocked from bulk overdue notifications', async () => {
  const original = fs.readFileSync(USERS_FILE, 'utf8');
  fs.writeFileSync(USERS_FILE, seedUsers());
  try {
    const res = responseRecorder();
    await notifyAllOverdue({
      authUser: { role: 'store_admin', storeId: 'buraza', id: 3, restrictions: ['notifyAll'] },
      headers: { 'x-business-unit': 'buraza' }
    }, res);
    assert.equal(res.statusCode, 403);
    assert.match(res.body.error, /not permitted/i);
  } finally {
    fs.writeFileSync(USERS_FILE, original);
  }
});

test('createAdminUser enforces the role hierarchy (main admin can make franchise admins; store admin cannot elevate)', async () => {
  const original = fs.readFileSync(USERS_FILE, 'utf8');
  fs.writeFileSync(USERS_FILE, JSON.stringify([{ id: 1, email: 'existing@example.test' }]));
  try {
    const byMain = responseRecorder();
    await createAdminUser({
      authUser: { role: 'admin', email: 'main@example.test' },
      headers: { 'x-business-unit': 'buraza' },
      body: { username: 'New Franchise', email: 'newfranchise@example.test', password: 'StrongPass1!', confirmPassword: 'StrongPass1!', nrc: '123456/78/1', role: 'franchise_admin' }
    }, byMain);
    assert.equal(byMain.statusCode, 201);
    assert.equal(byMain.body.user.role, 'franchise_admin');

    const byStore = responseRecorder();
    await createAdminUser({
      authUser: { role: 'store_admin', storeId: 'buraza', email: 'operator@example.test' },
      headers: {},
      body: { username: 'Sneaky', email: 'sneaky@example.test', password: 'StrongPass1!', confirmPassword: 'StrongPass1!', nrc: '123456/78/1', role: 'store_admin' }
    }, byStore);
    assert.equal(byStore.statusCode, 201);
    assert.equal(byStore.body.user.role, 'user');
  } finally {
    fs.writeFileSync(USERS_FILE, original);
  }
});

test('createAdminUser rejects a missing NRC', async () => {
  const original = fs.readFileSync(USERS_FILE, 'utf8');
  fs.writeFileSync(USERS_FILE, JSON.stringify([{ id: 1, email: 'existing@example.test' }]));
  try {
    const missing = responseRecorder();
    await createAdminUser({
      authUser: { role: 'admin', email: 'main@example.test' },
      headers: {},
      body: { username: 'No Nrc', email: 'nonrc@example.test', password: 'StrongPass1!', confirmPassword: 'StrongPass1!', role: 'user' }
    }, missing);
    assert.equal(missing.statusCode, 400);
    assert.match(missing.body.error, /NRC/i);
  } finally {
    fs.writeFileSync(USERS_FILE, original);
  }
});

test('store switching requires an OTP that verifies against the franchise admin', async (t) => {
  const original = fs.readFileSync(USERS_FILE, 'utf8');
  const sendOtp = t.mock.method(otpService, 'sendOTP', async () => otpService.generateOTP('franchise@example.test:Store Switch'));
  try {
    fs.writeFileSync(USERS_FILE, JSON.stringify([
      { id: 2, email: 'franchise@example.test', username: 'Franchise', role: 'franchise_admin', storeId: 'other', restrictions: [], trustedDevices: [] },
      { id: 3, email: 'operator@example.test', username: 'Operator', role: 'store_admin', storeId: 'buraza', restrictions: [], trustedDevices: [] }
    ]));
    const req = responseRecorder();
    await requestStoreSwitch({
      authUser: { role: 'store_admin', storeId: 'buraza', id: 3 },
      headers: { 'x-business-unit': 'other' }
    }, req);
    assert.equal(req.statusCode, 200);
    assert.equal(req.body.otpRequired, true);
    assert.equal(sendOtp.mock.calls.length, 1);

    const otp = otpService.generateOTP('franchise@example.test:Store Switch');
    const bad = responseRecorder();
    verifyStoreSwitch({ authUser: { role: 'store_admin', storeId: 'buraza', id: 3 }, headers: {}, body: { otp: '000000', storeId: 'other' } }, bad);
    assert.equal(bad.statusCode, 400);

    const good = responseRecorder();
    verifyStoreSwitch({ authUser: { role: 'store_admin', storeId: 'buraza', id: 3 }, headers: {}, body: { otp, storeId: 'other' } }, good);
    assert.equal(good.statusCode, 200);
    assert.equal(good.body.authorized, true);
    assert.equal(good.body.storeId, 'other');
  } finally {
    sendOtp.mock.restore();
    fs.writeFileSync(USERS_FILE, original);
  }
});

