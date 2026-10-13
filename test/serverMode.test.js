const test = require('node:test');
const assert = require('node:assert/strict');
const security = require('../middleware/security');
const routes = require('../routes');

const { isFranchiseManager, getServerMode, setServerMode } = security;

function registeredRoutes() {
  const out = [];
  for (const layer of routes.stack) {
    if (!layer.route) continue;
    for (const method of Object.keys(layer.route.methods)) {
      out.push(`${method.toUpperCase()} ${layer.route.path}`);
    }
  }
  return out;
}

function findHandler(method, routePath) {
  for (const layer of routes.stack) {
    if (layer.route && layer.route.path === routePath && layer.route.methods[method.toLowerCase()]) {
      return layer.route.stack[layer.route.stack.length - 1].handle;
    }
  }
  return null;
}

function responseRecorder() {
  return {
    statusCode: 200,
    status(code) { this.statusCode = code; return this; },
    json(payload) { this.body = payload; return this; }
  };
}

// ─── Public/private server-mode toggle ───────────────────────────────────────
// The toggle flips the server between LAN-only (private, default) and
// internet-reachable (public, still device-token gated). Only the franchise
// manager admin (jophiri223) may change it.

test('server-mode toggle routes are registered', () => {
  const registered = registeredRoutes();
  assert.ok(registered.includes('GET /admin/server-mode'), 'GET /admin/server-mode missing');
  assert.ok(registered.includes('POST /admin/server-mode'), 'POST /admin/server-mode missing');
});

test('isFranchiseManager: only the allow-listed admin/franchise role qualifies', () => {
  // jophiri223 + admin => allowed (the franchise manager)
  assert.equal(isFranchiseManager({ email: 'jophiri223@gmail.com', role: 'admin' }), true);
  // franchise_admin role with the allow-listed email => allowed
  assert.equal(isFranchiseManager({ email: 'JOPHIRI223@gmail.com', role: 'franchise_admin' }), true);
  // store_admin is NOT a franchise manager, even with the same email
  assert.equal(isFranchiseManager({ email: 'jophiri223@gmail.com', role: 'store_admin' }), false);
  // admin role but a different email => not allowed
  assert.equal(isFranchiseManager({ email: 'someone@else.com', role: 'admin' }), false);
  // missing user / email / role => never allowed (bare trusted-device token)
  assert.equal(isFranchiseManager(null), false);
  assert.equal(isFranchiseManager({}), false);
  assert.equal(isFranchiseManager({ email: 'jophiri223@gmail.com' }), false);
});

test('setServerMode round-trips public/private and rejects invalid values', () => {
  const original = getServerMode();
  try {
    assert.equal(setServerMode('public'), true);
    assert.equal(getServerMode(), 'public');
    assert.equal(setServerMode('private'), true);
    assert.equal(getServerMode(), 'private');
    assert.equal(setServerMode('bogus'), false);
    assert.equal(getServerMode(), 'private'); // unchanged after a rejected value
  } finally {
    setServerMode(original);
  }
});

test('POST /admin/server-mode blocks non-managers and invalid input', () => {
  const handler = findHandler('post', '/admin/server-mode');
  assert.equal(typeof handler, 'function', 'POST /admin/server-mode handler not found');

  // store_admin (not a franchise manager) => 403
  let res = responseRecorder();
  handler({ authUser: { email: 'admin@prymevertex.test', role: 'store_admin' }, ip: '127.0.0.1', body: { mode: 'public' } }, res);
  assert.equal(res.statusCode, 403);

  // unauthenticated (bare trusted-device token, no authUser) => 403
  res = responseRecorder();
  handler({ authUser: undefined, ip: '127.0.0.1', body: { mode: 'public' } }, res);
  assert.equal(res.statusCode, 403);

  // manager but invalid mode => 400 (log-only path, no email)
  res = responseRecorder();
  handler({ authUser: { email: 'jophiri223@gmail.com', role: 'admin' }, ip: '127.0.0.1', body: { mode: 'nope' } }, res);
  assert.equal(res.statusCode, 400);
});

test('GET /admin/server-mode blocks non-managers', () => {
  const handler = findHandler('get', '/admin/server-mode');
  assert.equal(typeof handler, 'function', 'GET /admin/server-mode handler not found');

  const res = responseRecorder();
  handler({ authUser: { email: 'admin@prymevertex.test', role: 'store_admin' }, ip: '127.0.0.1' }, res);
  assert.equal(res.statusCode, 403);
});
