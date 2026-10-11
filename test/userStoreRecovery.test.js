const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const { requestSignup, getAllUsers } = require('../controllers/authController');

const USERS_FILE = require('../middleware/dataStore').paths.users;

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
        phone: '+260977000000',
        nrc: '123456/78/1'
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

test('requestSignup requires a valid Zambian mobile number', async () => {
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
  assert.equal(res.body.error, 'Please enter a valid Zambian mobile number (e.g. 0977123456)');
});

test('requestSignup requires a valid NRC number', async () => {
  const req = {
    body: {
      username: 'NRC User',
      email: 'nrc@example.com',
      password: 'StrongPass1!',
      confirmPassword: 'StrongPass1!',
      phone: '+260977000000'
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
  assert.match(res.body.error, /NRC/i);
});

test('admin can fetch the user directory with account summaries', async () => {
  const req = {
    authUser: { role: 'admin' },
    headers: {},
    query: {},
    body: {}
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

  getAllUsers(req, res);

  assert.equal(res.statusCode, 200);
  assert.ok(Array.isArray(res.body), 'directory returns a plain user array');
  assert.ok(res.body.some(user => user.email));
  assert.ok(res.body.every(user => user.password === undefined), 'passwords must never be exposed');
});
