'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const bcrypt = require('bcryptjs');
const otpService = require('../middleware/otp');
const { requestLogin, confirmLogin } = require('../controllers/authController');

const USERS_FILE = require('../middleware/dataStore').paths.users;

function responseRecorder() {
  return {
    statusCode: 200,
    status(code) { this.statusCode = code; return this; },
    json(payload) { this.body = payload; return this; }
  };
}

async function withUsers(users, fn) {
  const original = fs.readFileSync(USERS_FILE, 'utf8');
  fs.writeFileSync(USERS_FILE, JSON.stringify(users));
  try {
    return await fn();
  } finally {
    fs.writeFileSync(USERS_FILE, original);
  }
}

test('login accepts username or email, and OTP is optional', async (t) => {
  const password = await bcrypt.hash('StrongPass1!', 4);
  const users = [{
    id: 7,
    username: 'store.officer',
    email: 'officer@example.test',
    password,
    role: 'store_admin',
    storeId: 'buraza',
    trustedDevices: []
  }];

  await withUsers(users, async () => {
    const sendOtp = t.mock.method(otpService, 'sendOTP', async () => {});

    const byUsername = responseRecorder();
    await requestLogin({
      body: { identifier: 'Store.Officer', password: 'StrongPass1!', requireOtp: false },
      ip: '127.0.0.1'
    }, byUsername);
    assert.equal(byUsername.statusCode, 200);
    assert.equal(byUsername.body.message, 'Login successful.');
    assert.equal(byUsername.body.username, 'store.officer');
    assert.equal(byUsername.body.role, 'store_admin');
    assert.equal(byUsername.body.email, 'officer@example.test');
    assert.match(byUsername.body.deviceToken, /^v1\./);
    assert.equal(sendOtp.mock.calls.length, 0);

    const byEmail = responseRecorder();
    await requestLogin({
      body: { email: 'officer@example.test', password: 'StrongPass1!', requireOtp: false },
      ip: '127.0.0.2'
    }, byEmail);
    assert.equal(byEmail.statusCode, 200);
    assert.equal(byEmail.body.message, 'Login successful.');
    assert.match(byEmail.body.deviceToken, /^v1\./);

    const withOtp = responseRecorder();
    await requestLogin({
      body: { identifier: 'store.officer', password: 'StrongPass1!', requireOtp: true },
      ip: '127.0.0.3'
    }, withOtp);
    assert.equal(withOtp.statusCode, 200);
    assert.equal(withOtp.body.email, 'officer@example.test');
    assert.equal(withOtp.body.otpSentTo, 'officer@example.test');
    assert.equal(withOtp.body.deviceToken, undefined);
    assert.equal(sendOtp.mock.calls.length, 1);

    const legacy = responseRecorder();
    await requestLogin({
      body: { email: 'officer@example.test', password: 'StrongPass1!' },
      ip: '127.0.0.4'
    }, legacy);
    assert.match(legacy.body.message, /OTP sent/i);
    assert.equal(sendOtp.mock.calls.length, 2);

    const code = otpService.generateOTP(otpService.buildOtpKey('officer@example.test', 'Login Verification'));
    const confirm = responseRecorder();
    await confirmLogin({ body: { email: 'officer@example.test', otp: code }, ip: '127.0.0.4' }, confirm);
    assert.equal(confirm.statusCode, 200);
    assert.equal(confirm.body.message, 'Login successful.');
    assert.match(confirm.body.deviceToken, /^v1\./);

    const unknown = responseRecorder();
    const wrong = responseRecorder();
    await requestLogin({ body: { identifier: 'nobody', password: 'nope', requireOtp: false }, ip: '10.0.0.8' }, unknown);
    await requestLogin({ body: { identifier: 'store.officer', password: 'nope', requireOtp: false }, ip: '10.0.0.9' }, wrong);
    assert.equal(unknown.statusCode, 400);
    assert.equal(wrong.statusCode, 400);
    assert.deepEqual(unknown.body, wrong.body);
  });
});
