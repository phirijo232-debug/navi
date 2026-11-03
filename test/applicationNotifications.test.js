const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const express = require('express');
const dataStore = require('../middleware/dataStore');
const applyRouter = require('../routes/apply');

const APPLICATIONS_FILE = dataStore.paths.applications || path.join(dataStore.DATA_DIR, 'applications.json');
const NOTIFICATIONS_FILE = dataStore.paths.notifications;
const USERS_FILE = dataStore.paths.users;

test('public Quick Screen submission bypasses device auth while other application routes stay protected', async t => {
  const original = fs.existsSync(APPLICATIONS_FILE) ? fs.readFileSync(APPLICATIONS_FILE, 'utf8') : null;
  const app = express();
  app.use('/api/apply', (req, res, next) => {
    if (req.method !== 'POST') return next();
    return applyRouter(req, res, next);
  });
  app.use((req, res, next) => req.get('x-device-token')
    ? next()
    : res.status(403).send('Device token is required.'));
  app.use('/api/apply', applyRouter);
  const server = app.listen(0);
  t.after(async () => {
    await new Promise(resolve => server.close(resolve));
    if (original === null) {
      if (fs.existsSync(APPLICATIONS_FILE)) fs.unlinkSync(APPLICATIONS_FILE);
    } else {
      fs.writeFileSync(APPLICATIONS_FILE, original);
    }
  });

  const baseUrl = `http://127.0.0.1:${server.address().port}/api/apply`;
  const submission = await fetch(baseUrl, { method: 'POST', body: new FormData() });
  assert.equal(submission.status, 400, 'public submission must reach its required-field validation without a device token');
  assert.match((await submission.json()).error, /required fields/i);

  const protectedList = await fetch(baseUrl);
  assert.equal(protectedList.status, 403, 'application listing must still require device authentication');
});

test('Quick Screen notifications are store-scoped, backfilled, and idempotent', async t => {
  const files = [APPLICATIONS_FILE, NOTIFICATIONS_FILE, USERS_FILE];
  const originals = files.map(file => fs.existsSync(file) ? fs.readFileSync(file, 'utf8') : null);
  const app = express();
  app.use(express.json());
  app.use((req, _res, next) => {
    const role = req.get('x-test-role') || 'store_admin';
    const email = req.get('x-test-email') || 'buraza-admin@example.test';
    const storeId = req.get('x-test-store') || 'buraza';
    req.authUser = { email, role, storeId };
    next();
  });
  app.use('/api/apply', applyRouter);
  const server = app.listen(0);
  t.after(() => new Promise(resolve => server.close(resolve)));

  try {
    dataStore.writeJson(USERS_FILE, [
      { email: 'main-admin@example.test', role: 'admin' },
      { email: 'buraza-admin@example.test', role: 'store_admin', storeId: 'buraza' },
      { email: 'other-admin@example.test', role: 'store_admin', storeId: 'other-store' },
      { email: 'customer@example.test', role: 'user', storeId: 'buraza' }
    ]);
    dataStore.writeJson(APPLICATIONS_FILE, [
      { id: 'QS-BMF-1', applicationId: 'QS-BMF-1', fullName: 'Applicant One', status: 'pending', storeId: 'buraza', createdAt: '2026-01-01T10:00:00.000Z' },
      { id: 'QS-OTHER-1', applicationId: 'QS-OTHER-1', fullName: 'Applicant Two', status: 'pending', storeId: 'other-store', createdAt: '2026-01-02T10:00:00.000Z' }
    ]);
    dataStore.writeJson(NOTIFICATIONS_FILE, []);

    const baseUrl = `http://127.0.0.1:${server.address().port}/api/apply`;
    const bmfResponse = await fetch(`${baseUrl}?notificationsOnly=true`, {
      headers: { 'x-test-role': 'store_admin', 'x-test-store': 'buraza', 'x-business-unit': 'buraza' }
    });
    assert.equal(bmfResponse.status, 200);
    assert.deepEqual(await bmfResponse.json(), { pendingCount: 1 });
    let notifications = dataStore.readJson(NOTIFICATIONS_FILE, [], Array.isArray);
    assert.deepEqual(
      notifications.map(notification => notification.recipientEmail).sort(),
      ['buraza-admin@example.test', 'main-admin@example.test']
    );

    const allResponse = await fetch(baseUrl, {
      headers: { 'x-test-role': 'admin', 'x-test-email': 'main-admin@example.test', 'x-business-unit': 'all' }
    });
    assert.equal(allResponse.status, 200);
    assert.equal((await allResponse.json()).count, 2);
    notifications = dataStore.readJson(NOTIFICATIONS_FILE, [], Array.isArray);
    assert.equal(notifications.length, 4);

    const duplicateSync = await fetch(baseUrl, {
      headers: { 'x-test-role': 'admin', 'x-test-email': 'main-admin@example.test', 'x-business-unit': 'all' }
    });
    assert.equal(duplicateSync.status, 200);
    assert.equal(dataStore.readJson(NOTIFICATIONS_FILE, [], Array.isArray).length, 4);
  } finally {
    files.forEach((file, index) => {
      if (originals[index] === null) {
        if (fs.existsSync(file)) fs.unlinkSync(file);
      } else {
        fs.writeFileSync(file, originals[index]);
      }
    });
  }
});
