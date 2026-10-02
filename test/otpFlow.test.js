const test = require('node:test');
const assert = require('node:assert/strict');
const { generateOTP, verifyOTP } = require('../middleware/otp');

test('OTP validation stays isolated by email and purpose', () => {
  const loginKey = 'user@example.com:Login Verification';
  const resetKey = 'user@example.com:Password Reset';

  const loginOtp = generateOTP(loginKey);
  const resetOtp = generateOTP(resetKey);

  assert.equal(verifyOTP(loginOtp, 'user@example.com', 'Login Verification').valid, true);
  assert.equal(verifyOTP(resetOtp, 'user@example.com', 'Password Reset').valid, true);
  assert.equal(verifyOTP(loginOtp, 'user@example.com', 'Password Reset').valid, false);
  assert.equal(verifyOTP(resetOtp, 'user@example.com', 'Login Verification').valid, false);
});

test('duplicate OTP requests for the same email and purpose reuse the active code instead of issuing a fresh one', () => {
  const first = generateOTP('same-user@example.com:Login Verification');
  const second = generateOTP('same-user@example.com:Login Verification');

  assert.equal(first, second);
  assert.equal(verifyOTP(first, 'same-user@example.com', 'Login Verification').valid, true);
});

test('OTP keys are normalized so same email data does not generate a fresh code on alternate casing or spacing', () => {
  const first = generateOTP('sameuser@Example.com:Login Verification');
  const second = generateOTP(' sameuser@example.com : Login Verification ');

  assert.equal(first, second);
  assert.equal(verifyOTP(first, ' sameuser@example.com ', 'Login Verification').valid, true);
});
