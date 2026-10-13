const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const bcrypt = require('bcryptjs');
const otpService = require('../middleware/otp');
const { requestLogin, confirmLogin } = require('../controllers/authController');

const USERS_FILE = require('../middleware/dataStore').paths.users;

test('admin login sends OTP to the registered account mailbox and reuses the same trusted device', async (t) => {
  const original = fs.readFileSync(USERS_FILE, 'utf8');

  const passwordHash = await bcrypt.hash('StrongPass1!', 10);
  const user = {
    id: 1,
    username: 'sameuser',
    email: 'sameuser@example.com',
    password: passwordHash,
    role: 'admin',
    createdAt: new Date().toISOString(),
    trustedDevices: [
      {
        token: 'existing-device-token',
        createdAt: new Date().toISOString(),
        lastSeen: new Date().toISOString(),
        ip: '127.0.0.1'
      }
    ]
  };

  fs.writeFileSync(USERS_FILE, JSON.stringify([user], null, 2));

  try {
    const sendOtp = t.mock.method(otpService, 'sendOTP', async (purpose, targetEmail) => {
      return otpService.generateOTP(`${targetEmail}:${purpose}`);
    });

    const loginReq = {
      body: { email: 'sameuser@example.com', password: 'StrongPass1!' },
      ip: '127.0.0.1'
    };
    const loginRes = {
      statusCode: 200,
      status(code) { this.statusCode = code; return this; },
      json(payload) { this.body = payload; return this; }
    };

    await requestLogin(loginReq, loginRes);

    assert.equal(loginRes.body.otpSentTo, 'sameuser@example.com');
    assert.equal(sendOtp.mock.calls[0].arguments[1], 'sameuser@example.com');
    assert.equal(sendOtp.mock.calls[0].arguments[3], 'sameuser@example.com');
    const otp = otpService.generateOTP('sameuser@example.com:Login Verification');

    const confirmReq = {
      body: { email: 'sameuser@example.com', otp },
      ip: '127.0.0.1'
    };

    const confirmRes = {
      statusCode: 200,
      status(code) { this.statusCode = code; return this; },
      json(payload) { this.body = payload; return this; }
    };

    await confirmLogin(confirmReq, confirmRes);

    const updatedUsers = JSON.parse(fs.readFileSync(USERS_FILE, 'utf8'));
    assert.equal(updatedUsers[0].trustedDevices.length, 1);
    assert.equal(updatedUsers[0].trustedDevices[0].token, 'existing-device-token');
    assert.match(confirmRes.body.message, /Login successful/i);
  } finally {
    fs.writeFileSync(USERS_FILE, original);
  }
});
