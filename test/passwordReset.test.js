const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const bcrypt = require('bcryptjs');
const otpService = require('../middleware/otp');
const { requestPasswordReset, confirmPasswordReset } = require('../controllers/authController');

const USERS_FILE = require('../middleware/dataStore').paths.users;

function responseRecorder() {
  return {
    statusCode: 200,
    status(code) { this.statusCode = code; return this; },
    json(payload) { this.body = payload; return this; }
  };
}

test('regular user reset verifies the account mailbox, rejects a wrong OTP, and revokes old devices', async (t) => {
  const original = fs.readFileSync(USERS_FILE, 'utf8');
  const oldHash = await bcrypt.hash('OldPass1!', 10);
  fs.writeFileSync(USERS_FILE, JSON.stringify([{
    id: 1,
    username: 'Reset User',
    email: 'reset-user@example.test',
    password: oldHash,
    role: 'user',
    storeId: 'buraza',
    trustedDevices: [{ token: 'old-token', ip: '127.0.0.1' }]
  }], null, 2));

  try {
    const sendOtp = t.mock.method(otpService, 'sendOTP', async (purpose, targetEmail) => {
      return otpService.generateOTP(`${targetEmail}:${purpose}`);
    });
    const requestResponse = responseRecorder();
    await requestPasswordReset({ body: { email: ' RESET-USER@example.test ' } }, requestResponse);

    assert.equal(requestResponse.statusCode, 200);
    assert.equal(requestResponse.body.otpSentTo, 'reset-user@example.test');
    assert.equal(sendOtp.mock.calls[0].arguments[1], 'reset-user@example.test');

    const otp = otpService.generateOTP('reset-user@example.test:Password Reset');
    const badCodeResponse = responseRecorder();
    await confirmPasswordReset({ body: {
      email: 'reset-user@example.test',
      otp: '000000',
      newPassword: 'NewStrong1!',
      confirmNewPassword: 'NewStrong1!'
    } }, badCodeResponse);
    assert.equal(badCodeResponse.statusCode, 400);

    const confirmationResponse = responseRecorder();
    await confirmPasswordReset({ body: {
      email: 'reset-user@example.test',
      otp,
      newPassword: 'NewStrong1!',
      confirmNewPassword: 'NewStrong1!'
    } }, confirmationResponse);

    const updatedUser = JSON.parse(fs.readFileSync(USERS_FILE, 'utf8'))[0];
    assert.equal(confirmationResponse.statusCode, 200);
    assert.equal(await bcrypt.compare('NewStrong1!', updatedUser.password), true);
    assert.deepEqual(updatedUser.trustedDevices, []);
  } finally {
    fs.writeFileSync(USERS_FILE, original);
  }
});

test('store-admin reset sends and verifies OTP through the registered account mailbox', async (t) => {
  const original = fs.readFileSync(USERS_FILE, 'utf8');
  const oldHash = await bcrypt.hash('OldPass1!', 10);
  fs.writeFileSync(USERS_FILE, JSON.stringify([{
    id: 1,
    username: 'BMF Operator',
    email: 'bmf-admin@example.test',
    password: oldHash,
    role: 'store_admin',
    storeId: 'buraza',
    trustedDevices: []
  }], null, 2));

  try {
    const sendOtp = t.mock.method(otpService, 'sendOTP', async (purpose, targetEmail) => {
      return otpService.generateOTP(`${targetEmail}:${purpose}`);
    });
    const requestResponse = responseRecorder();
    await requestPasswordReset({ body: { email: 'bmf-admin@example.test' } }, requestResponse);

    assert.equal(requestResponse.statusCode, 200);
    assert.equal(requestResponse.body.otpChannel, 'account');
    assert.equal(requestResponse.body.otpSentTo, 'bmf-admin@example.test');
    assert.equal(sendOtp.mock.calls[0].arguments[1], 'bmf-admin@example.test');
    assert.equal(sendOtp.mock.calls[0].arguments[3], 'bmf-admin@example.test');

    const otp = otpService.generateOTP('bmf-admin@example.test:Password Reset');
    const confirmationResponse = responseRecorder();
    await confirmPasswordReset({ body: {
      email: 'bmf-admin@example.test',
      otp,
      newPassword: 'NewStrong1!',
      confirmNewPassword: 'NewStrong1!'
    } }, confirmationResponse);

    assert.equal(confirmationResponse.statusCode, 200);
    assert.match(confirmationResponse.body.message, /reset successfully/i);
  } finally {
    fs.writeFileSync(USERS_FILE, original);
  }
});

test('admin-only reset refuses customer accounts without sending an OTP', async (t) => {
  const original = fs.readFileSync(USERS_FILE, 'utf8');
  fs.writeFileSync(USERS_FILE, JSON.stringify([{
    id: 1,
    username: 'Customer',
    email: 'customer@example.test',
    password: 'hash',
    role: 'user',
    storeId: 'buraza'
  }], null, 2));

  try {
    const sendOtp = t.mock.method(otpService, 'sendOTP', async () => '123456');
    const response = responseRecorder();
    await requestPasswordReset({ body: { email: 'customer@example.test', adminOnly: true } }, response);
    assert.equal(response.statusCode, 400);
    assert.equal(sendOtp.mock.calls.length, 0);
  } finally {
    fs.writeFileSync(USERS_FILE, original);
  }
});
