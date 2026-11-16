'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const { issueDeviceToken, readDeviceClaims, deviceRecordMatches, hashValue } = require('../middleware/tokenAuth');
const otp = require('../middleware/otp');

test('a forged or expired device token does not resolve', () => {
  const issued = issueDeviceToken({ userId: 4, email: 'member@example.test' });
  const claims = readDeviceClaims(issued.token);
  assert.equal(claims.email, 'member@example.test');
  assert.equal(deviceRecordMatches(issued.record, issued.token, claims), true);
  assert.equal(issued.record.tokenHash, hashValue(issued.token));
  assert.equal(readDeviceClaims('v1.aaaa.bbbb'), null);
  assert.equal(readDeviceClaims(issued.token + 'x'), null);
  const expired = { ...issued.record, expiresAt: '2000-01-01T00:00:00.000Z' };
  assert.equal(deviceRecordMatches(expired, issued.token, claims), false);
  const revoked = { ...issued.record, revoked: true };
  assert.equal(deviceRecordMatches(revoked, issued.token, claims), false);
});

test('OTP checks compare a hash and reject a wrong code', () => {
  const code = otp.generateOTP('otp-hash@example.test:Login Verification', true);
  assert.equal(otp.verifyOTP('000000', 'otp-hash@example.test', 'Login Verification').valid, false);
  assert.equal(otp.verifyOTP(code, 'otp-hash@example.test', 'Login Verification').valid, true);
  assert.equal(otp.verifyOTP(code, 'otp-hash@example.test', 'Login Verification').valid, false);
});
