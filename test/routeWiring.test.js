const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const routes = require('../routes');

// ─── Route wiring test: every endpoint the frontend calls must exist on the   ───
// ─── router, otherwise a button silently dies with 404 ("spinal cord" check). ───

function collectRegisteredRoutes() {
  const registered = [];
  for (const layer of routes.stack) {
    if (!layer.route) continue;
    const routePath = layer.route.path;
    const methods = Object.keys(layer.route.methods);
    for (const method of methods) {
      registered.push({ method: method.toUpperCase(), path: routePath });
    }
  }
  return registered;
}

function collectFrontendCalls() {
  const publicDir = path.join(__dirname, '..', 'public');
  const calls = [];
  const files = fs.readdirSync(publicDir)
    .filter(name => /\.(html|js)$/.test(name));

  const patterns = [
    /fetch\(\s*(['"`])([^'"`]+?)\1/g,                     // fetch('/x') / fetch(`/x`)
    /\b(?:url|endpoint)\s*[:=]\s*(['"`])(\/[^'"`]+?)\1/gi // url: '/x' helpers
  ];

  for (const name of files) {
    const source = fs.readFileSync(path.join(publicDir, name), 'utf8');
    for (const pattern of patterns) {
      let match;
      while ((match = pattern.exec(source)) !== null) {
        const raw = match[2];
        if (!raw.startsWith('/')) continue;
        // Skip template literals with interpolations (can't be statically resolved)
        if (raw.includes('${')) continue;
        const clean = raw.split('?')[0].split('#')[0];
        calls.push({ file: name, raw, clean });
      }
    }
  }
  return calls;
}

function matchesRoute(frontendPath, routePath) {
  const frontendSegs = frontendPath.split('/').filter(Boolean);
  const routeSegs = routePath.split('/').filter(Boolean);
  if (frontendSegs.length !== routeSegs.length) return false;
  return frontendSegs.every((seg, i) =>
    routeSegs[i].startsWith(':') || routeSegs[i].startsWith('${') || routeSegs[i] === seg
  );
}

test('every frontend fetch target resolves to a registered backend route', () => {
  const registered = collectRegisteredRoutes();
  const calls = collectFrontendCalls();

  assert.ok(calls.length > 0, 'expected to find frontend fetch calls in public/');

  const unmatched = calls.filter(call =>
    !registered.some(route => matchesRoute(call.clean, route.path))
  );

  assert.deepEqual(
    unmatched.map(call => `${call.file}: ${call.raw}`),
    [],
    'frontend calls with no matching backend route'
  );
});

test('router registers the core authentication and data endpoints', () => {
  const registered = collectRegisteredRoutes();
  const expected = [
    ['POST', '/signup'], ['POST', '/signup/confirm'], ['POST', '/signup/resend'],
    ['POST', '/login'], ['POST', '/login/confirm'],
    ['POST', '/password-reset'], ['POST', '/password-reset/confirm'],
    ['GET', '/loans'], ['GET', '/loans/all'], ['GET', '/loans/:id'],
    ['POST', '/loans/request'], ['POST', '/loans/:id/action'], ['POST', '/loans/payment'],
    ['POST', '/loans/notify-overdue'], ['POST', '/loans/:id/notify-overdue'],
    ['GET', '/users'], ['POST', '/admin/users'], ['POST', '/admin/announcements'],
    ['GET', '/feedback'], ['POST', '/feedback'], ['POST', '/feedback/:id/status'],
    ['GET', '/reports/:scope/summary'], ['GET', '/reports/:scope/export'],
    ['GET', '/status'], ['GET', '/health'], ['GET', '/sessions'],
    ['GET', '/logs/access'], ['GET', '/logs/errors'],
    ['POST', '/invites/create'],
    ['POST', '/admin/backup'], ['GET', '/admin/backups'], ['POST', '/admin/restore'],
    ['GET', '/invites/validate/:token'], ['POST', '/invites/validate'],
    ['GET', '/reports/:scope/profits'], ['GET', '/reports/:scope/defaulters'],
    ['GET', '/reports/:scope/overdue'], ['GET', '/reports/:scope/paid'],
    ['GET', '/reports/search'], ['GET', '/reports/user/:email']
  ];

  for (const [method, routePath] of expected) {
    assert.ok(
      registered.some(route => route.method === method && route.path === routePath),
      `missing route ${method} ${routePath}`
    );
  }
});

test('every registered route points at a real controller function', () => {
  for (const layer of routes.stack) {
    if (!layer.route) continue;
    for (const method of Object.keys(layer.route.methods)) {
      const handlers = layer.route.stack;
      assert.ok(handlers.length > 0, `route ${method.toUpperCase()} ${layer.route.path} has no handler`);
      for (const handler of handlers) {
        assert.equal(typeof handler.handle, 'function',
          `route ${method.toUpperCase()} ${layer.route.path} handler is not a function`);
      }
    }
  }
});
