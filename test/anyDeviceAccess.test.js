const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const bcrypt = require('bcryptjs');
const security = require('../middleware/security');
const otpService = require('../middleware/otp');
const { clientConfigScript } = require('../middleware/shareLinks');
const { requestLogin, confirmLogin } = require('../controllers/authController');

const USERS_FILE = require('../middleware/dataStore').paths.users;

function responseRecorder() {
  return {
    statusCode: 200,
    body: undefined,
    status(code) { this.statusCode = code; return this; },
    send(payload) { this.body = payload; return this; },
    end() { return this; },
    json(payload) { this.body = payload; return this; },
    set() { return this; },
    type() { return this; }
  };
}

test('anonymous internet clients stay blocked while a logged-in device is accepted', () => {
  const originalMode = security.getServerMode();
  const originalUsers = fs.existsSync(USERS_FILE) ? fs.readFileSync(USERS_FILE, 'utf8') : '[]';
  security.setServerMode('private');
  try {
    fs.writeFileSync(USERS_FILE, JSON.stringify([{
      id: 41,
      email: 'phone@example.test',
      username: 'Phone User',
      role: 'user',
      storeId: 'buraza',
      trustedDevices: [{
        token: 'phone-session-token',
        createdAt: new Date().toISOString(),
        lastSeen: new Date().toISOString(),
        ip: '203.0.113.8'
      }]
    }]));

    const anonymous = responseRecorder();
    let anonymousPassed = false;
    security.deviceAuth({ path: '/loans', ip: '203.0.113.8', headers: {} }, anonymous, () => { anonymousPassed = true; });
    assert.equal(anonymousPassed, false);
    assert.equal(anonymous.statusCode, 403);

    const stranger = responseRecorder();
    let strangerPassed = false;
    security.deviceAuth({
      path: '/loans',
      ip: '203.0.113.9',
      headers: { 'x-device-token': 'not-a-real-session' }
    }, stranger, () => { strangerPassed = true; });
    assert.equal(strangerPassed, false);
    assert.equal(stranger.statusCode, 403);

    const req = {
      path: '/loans',
      ip: '198.51.100.20',
      headers: { 'x-device-token': 'phone-session-token' }
    };
    const phone = responseRecorder();
    let phonePassed = false;
    security.deviceAuth(req, phone, () => { phonePassed = true; });
    assert.equal(phonePassed, true);
    assert.equal(req.authUser.email, 'phone@example.test');
  } finally {
    security.setServerMode(originalMode);
    fs.writeFileSync(USERS_FILE, originalUsers);
  }
});

test('public mode still requires a session token', () => {
  const originalMode = security.getServerMode();
  security.setServerMode('public');
  try {
    const res = responseRecorder();
    let passed = false;
    security.deviceAuth({ path: '/loans', ip: '203.0.113.50', headers: {} }, res, () => { passed = true; });
    assert.equal(passed, false);
    assert.equal(res.statusCode, 403);
  } finally {
    security.setServerMode(originalMode);
  }
});

test('CORS is limited to the configured public origin and carries no secrets', () => {
  const previousUrl = process.env.PUBLIC_URL;
  const previousKey = process.env.SHARE_PUBLIC_KEY;
  process.env.PUBLIC_URL = 'https://bmf-demo.ngrok-free.app';
  process.env.SHARE_PUBLIC_KEY = 'do-not-leak-this-key';
  try {
    const allowed = responseRecorder();
    const headers = {};
    allowed.setHeader = (name, value) => { headers[name] = value; };
    allowed.status = function (code) { this.statusCode = code; return this; };
    allowed.end = function () { this.ended = true; return this; };
    let passed = false;
    security.deviceAuth({
      method: 'OPTIONS',
      path: '/loans',
      ip: '203.0.113.8',
      headers: { origin: 'https://bmf-demo.ngrok-free.app' }
    }, allowed, () => { passed = true; });
    assert.equal(passed, false);
    assert.equal(allowed.statusCode, 204);
    assert.equal(headers['Access-Control-Allow-Origin'], 'https://bmf-demo.ngrok-free.app');
    assert.equal(headers['Access-Control-Allow-Credentials'], undefined);

    const foreign = responseRecorder();
    let foreignPassed = false;
    security.deviceAuth({
      method: 'GET',
      path: '/login',
      ip: '203.0.113.8',
      headers: { origin: 'https://evil.example' }
    }, foreign, () => { foreignPassed = true; });
    assert.equal(foreignPassed, true);

    const script = clientConfigScript();
    assert.match(script, /https:\/\/bmf-demo\.ngrok-free\.app/);
    assert.doesNotMatch(script, /do-not-leak|SHARE_PUBLIC_KEY|MASTER_KEY/);
  } finally {
    if (previousUrl === undefined) delete process.env.PUBLIC_URL;
    else process.env.PUBLIC_URL = previousUrl;
    if (previousKey === undefined) delete process.env.SHARE_PUBLIC_KEY;
    else process.env.SHARE_PUBLIC_KEY = previousKey;
  }
});

test('password plus OTP login registers a second device without dropping the first', async (t) => {
  const original = fs.existsSync(USERS_FILE) ? fs.readFileSync(USERS_FILE, 'utf8') : '[]';
  const passwordHash = await bcrypt.hash('StrongPass1!', 10);
  fs.writeFileSync(USERS_FILE, JSON.stringify([{
    id: 7,
    username: 'traveller',
    email: 'traveller@example.com',
    password: passwordHash,
    role: 'user',
    storeId: 'buraza',
    createdAt: new Date().toISOString(),
    trustedDevices: [{
      token: 'laptop-session',
      createdAt: new Date().toISOString(),
      lastSeen: new Date().toISOString(),
      ip: '127.0.0.1'
    }]
  }]));

  try {
    t.mock.method(otpService, 'sendOTP', async (purpose, targetEmail) => otpService.generateOTP(`${targetEmail}:${purpose}`));
    const loginRes = responseRecorder();
    await requestLogin({ body: { email: 'traveller@example.com', password: 'StrongPass1!' }, ip: '203.0.113.77' }, loginRes);
    assert.equal(loginRes.statusCode, 200);
    const otp = otpService.generateOTP('traveller@example.com:Login Verification');
    const confirmRes = responseRecorder();
    await confirmLogin({ body: { email: 'traveller@example.com', otp }, ip: '203.0.113.77' }, confirmRes);
    assert.equal(confirmRes.statusCode, 200);
    assert.ok(confirmRes.body.deviceToken);
    assert.notEqual(confirmRes.body.deviceToken, 'laptop-session');

    const users = JSON.parse(fs.readFileSync(USERS_FILE, 'utf8'));
    const tokens = users[0].trustedDevices.map(device => device.token);
    assert.ok(tokens.includes('laptop-session'));
    assert.ok(tokens.includes(confirmRes.body.deviceToken));
  } finally {
    fs.writeFileSync(USERS_FILE, original);
  }
});

test('the service worker does not cache API or private responses', () => {
  const worker = fs.readFileSync(require('path').join(__dirname, '../public/sw.js'), 'utf8');
  assert.match(worker, /never cached|API responses/);
  assert.match(worker, /request\.method !== 'GET'/);
  assert.match(worker, /isStaticAsset/);
  assert.match(worker, /if \(!isStaticAsset\(url\)\) return/);
});
