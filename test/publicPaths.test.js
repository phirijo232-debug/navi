const test = require('node:test');
const assert = require('node:assert/strict');
const config = require('../config');
const security = require('../middleware/security');
const { getStatus, getHealth } = require('../controllers/statusController');

function responseRecorder() {
  return {
    statusCode: 200,
    status(code) { this.statusCode = code; return this; },
    json(payload) { this.body = payload; return this; }
  };
}

test('config.PUBLIC_PATHS contains required unauthenticated routes including invite validation', () => {
  assert.ok(Array.isArray(config.PUBLIC_PATHS), 'config.PUBLIC_PATHS must be an array');
  assert.ok(config.PUBLIC_PATHS.includes('/invites/validate'), 'must include /invites/validate');
  assert.ok(config.PUBLIC_PATHS.includes('/status'), 'must include /status');
  assert.ok(config.PUBLIC_PATHS.includes('/health'), 'must include /health');
  assert.ok(config.PUBLIC_PATHS.includes('/login'), 'must include /login');
  assert.ok(config.PUBLIC_PATHS.includes('/signup'), 'must include /signup');
});

test('deviceAuth skips invite validation endpoints without device token', (t, done) => {
  const req = { path: '/invites/validate/abc123token', ip: '192.168.1.10', headers: {} };
  const res = responseRecorder();
  security.deviceAuth(req, res, () => {
    assert.equal(res.statusCode, 200);
    done();
  });
});

test('GET /status public tier (unauthenticated) does not leak serverMode', async () => {
  const req = { headers: {} };
  const res = responseRecorder();
  await getStatus(req, res);
  assert.equal(res.statusCode, 200);
  assert.equal(res.body.serverMode, undefined, 'unauthenticated /status must not include serverMode');
});

test('GET /health public tier (unauthenticated) does not leak serverMode', async () => {
  const req = { headers: {} };
  const res = responseRecorder();
  await getHealth(req, res);
  assert.equal(res.statusCode, 200);
  assert.equal(res.body.serverMode, undefined, 'unauthenticated /health must not include serverMode');
});
