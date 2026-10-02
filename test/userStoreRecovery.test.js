const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const { requestSignup, getUsersDirectory } = require('../controllers/authController');

const USERS_FILE = path.join(__dirname, '../data/users.json');

test('requestSignup can recover when the users store is malformed', async () => {
  const original = fs.readFileSync(USERS_FILE, 'utf8');
  fs.writeFileSync(USERS_FILE, '{"broken":');

  try {
    const req = {
      body: {
        username: 'Recover User',
        email: 'recover@example.com',
        password: 'StrongPass1!',
        confirmPassword: 'StrongPass1!',
        phone: '+2600000000'
      }
    };

    const res = {
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

    await requestSignup(req, res);

    assert.equal(res.statusCode, 200);
    assert.match(res.body.message, /OTP sent to your email/i);
  } finally {
    fs.writeFileSync(USERS_FILE, original);
  }
});

test('requestSignup requires a valid WhatsApp phone number', async () => {
  const req = {
    body: {
      username: 'WhatsApp User',
      email: 'whatsapp@example.com',
      password: 'StrongPass1!',
      confirmPassword: 'StrongPass1!',
      phone: '12345'
    }
  };

  const res = {
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

  await requestSignup(req, res);

  assert.equal(res.statusCode, 400);
  assert.match(res.body.error, /valid WhatsApp|phone number/i);
});

test('admin can fetch the user directory with account summaries', async () => {
  const req = {
    authUser: { role: 'admin' }
  };

  const res = {
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

  await getUsersDirectory(req, res);

  assert.equal(res.statusCode, 200);
  assert.ok(Array.isArray(res.body.users));
  assert.ok(res.body.users.some(user => user.email));
});
