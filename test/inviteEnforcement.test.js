const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const otpService = require('../middleware/otp');
const emailService = require('../middleware/email');
const dataStore = require('../middleware/dataStore');
const {
  requestSignup, confirmSignup, createInvite, validateInvite
} = require('../controllers/authController');

const INVITES_FILE = path.join(dataStore.DATA_DIR, 'invites.json');

function makeRes() {
  return {
    statusCode: 200,
    status(code) {
      this.statusCode = code;
      return this;
    },
    json(payload) {
      this.body = payload;
      return this;
    }
  };
}

function signupBody(email, extra = {}) {
  return {
    username: 'Invite Tester',
    email,
    password: 'StrongPass1!',
    confirmPassword: 'StrongPass1!',
    phone: '+260977111222',
    nrc: '123456/78/1',
    ...extra
  };
}

async function createInviteToken(email) {
  const res = makeRes();
  await createInvite({ body: { email }, authUser: { role: 'admin' } }, res);
  assert.equal(res.statusCode, 200, `invite generation failed: ${JSON.stringify(res.body)}`);
  return res.body.inviteToken;
}

test('signup without an invite token is refused', async (t) => {
  t.mock.method(otpService, 'sendOTP', async () => '000000');
  const res = makeRes();
  await requestSignup({ body: signupBody('no-token@example.com') }, res);

  assert.equal(res.statusCode, 400);
  assert.match(res.body.error, /invitation/i);
});

test('signup with a token issued for a different email is refused', async (t) => {
  t.mock.method(otpService, 'sendOTP', async () => '000000');
  const token = await createInviteToken('invited@example.com');
  const res = makeRes();
  await requestSignup({ body: signupBody('someone-else@example.com', { inviteToken: token }) }, res);

  assert.equal(res.statusCode, 400);
  assert.equal(res.body.error, 'Invalid or expired signup token.');
});

test('an unknown token is refused with the same public message', async (t) => {
  t.mock.method(otpService, 'sendOTP', async () => '000000');
  const res = makeRes();
  await requestSignup({ body: signupBody('ghost@example.com', { inviteToken: 'deadbeefdeadbeef' }) }, res);

  assert.equal(res.statusCode, 400);
  assert.equal(res.body.error, 'Invalid or expired signup token.');
});

test('a valid invite lets signup proceed to the OTP step', async (t) => {
  const sendMail = t.mock.method(otpService, 'sendOTP', async () => '123456');
  const token = await createInviteToken('valid-invite@example.com');
  const res = makeRes();
  await requestSignup({ body: signupBody('valid-invite@example.com', { inviteToken: token }) }, res);

  assert.equal(res.statusCode, 200);
  assert.match(res.body.message, /OTP sent to your email/i);
  assert.equal(sendMail.mock.callCount(), 1);
});

test('invites survive a server restart (persisted to disk, read by a fresh module)', async () => {
  const token = await createInviteToken('restart@example.com');

  // The invite must live on disk, not in process memory.
  assert.ok(fs.existsSync(INVITES_FILE), 'data/invites.json must exist');
  const onDisk = JSON.parse(fs.readFileSync(INVITES_FILE, 'utf8'));
  assert.equal(onDisk[token].email, 'restart@example.com');

  // Simulate a restart: load a brand-new controller instance that has no
  // memory of the old one — it must still validate the token from disk.
  const modulePath = require.resolve('../controllers/authController');
  const cached = require.cache[modulePath];
  delete require.cache[modulePath];
  try {
    const freshController = require('../controllers/authController');
    const res = makeRes();
    freshController.validateInvite({ params: { token } }, res);

    assert.equal(res.statusCode, 200);
    assert.equal(res.body.valid, true);
    assert.equal(res.body.email, 'restart@example.com');
  } finally {
    // Restore the original module instance for the rest of the suite.
    delete require.cache[modulePath];
    if (cached) require.cache[modulePath] = cached;
  }
});

test('a completed signup burns the invite — the link cannot be reused', async (t) => {
  t.mock.method(otpService, 'sendOTP', async () => '654321');
  t.mock.method(emailService, 'sendCustomerEmail', async () => ({ ok: true }));
  const email = 'burn-once@example.com';
  const token = await createInviteToken(email);

  const first = makeRes();
  await requestSignup({ body: signupBody(email, { inviteToken: token }) }, first);
  assert.equal(first.statusCode, 200);

  // Grab the OTP the mocked sendOTP stands in for, then confirm the signup.
  const otp = otpService.generateOTP(`${email}:Account Signup Verification`);
  const confirmRes = makeRes();
  await confirmSignup({ body: { email, otp } }, confirmRes);
  assert.equal(confirmRes.statusCode, 200);
  assert.equal(confirmRes.body.message, 'Account created successfully.');

  // The same link must now be dead — even for the same email.
  const second = makeRes();
  await requestSignup({ body: signupBody(email, { inviteToken: token }) }, second);
  assert.equal(second.statusCode, 400);
  assert.equal(second.body.error, 'Invalid or expired signup token.');
});
