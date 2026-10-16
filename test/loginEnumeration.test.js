const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const bcrypt = require('bcryptjs');
const { requestLogin } = require('../controllers/authController');
const USERS_FILE = require('../middleware/dataStore').paths.users;

function responseRecorder() {
  return {
    statusCode: 200,
    status(code) { this.statusCode = code; return this; },
    json(payload) { this.body = payload; return this; }
  };
}

test('login uses the same response for an unknown email and a wrong password', async () => {
  const original = fs.readFileSync(USERS_FILE, 'utf8');
  const password = await bcrypt.hash('StrongPass1!', 4);
  fs.writeFileSync(USERS_FILE, JSON.stringify([{
    id: 1, email: 'known@example.test', username: 'Known', password,
    role: 'user', storeId: 'buraza', trustedDevices: []
  }]));

  try {
    const unknownResponse = responseRecorder();
    const wrongPasswordResponse = responseRecorder();
    await requestLogin({ body: { email: 'missing@example.test', password: 'wrong' } }, unknownResponse);
    await requestLogin({ body: { email: 'known@example.test', password: 'wrong' } }, wrongPasswordResponse);

    assert.equal(unknownResponse.statusCode, 400);
    assert.equal(wrongPasswordResponse.statusCode, 400);
    assert.deepEqual(unknownResponse.body, wrongPasswordResponse.body);
  } finally {
    fs.writeFileSync(USERS_FILE, original);
  }
});
