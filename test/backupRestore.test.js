const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

// Resolve the master key at call time inside the controller, so setting it
// here (after require) is respected.
process.env.MASTER_KEY = process.env.MASTER_KEY || 'test-master-key-123';

const dataStore = require('../middleware/dataStore');
const { createBackup, listBackups, restoreBackup } = require('../controllers/backupController');

const USERS_FILE = dataStore.paths.users;
const BACKUPS_DIR = path.join(dataStore.DATA_DIR, 'backups');

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

const adminReq = (body = {}) => ({ authUser: { id: 1, email: 'admin@example.test', role: 'admin' }, body });

test('admin can create a backup snapshot of every core data file', async () => {
  const res = makeRes();
  createBackup(adminReq(), res);

  assert.equal(res.statusCode, 200);
  assert.ok(res.body.backup?.id, 'response carries a backup id');

  const snapshotPath = path.join(BACKUPS_DIR, `${res.body.backup.id}.json`);
  assert.ok(fs.existsSync(snapshotPath), 'snapshot file exists on disk');

  const snapshot = JSON.parse(fs.readFileSync(snapshotPath, 'utf8'));
  assert.equal(snapshot.id, res.body.backup.id);
  // The sandbox users file must be captured byte-for-byte equal in content.
  assert.deepEqual(snapshot.files['users.json'], JSON.parse(fs.readFileSync(USERS_FILE, 'utf8')));
  for (const name of res.body.backup.files) {
    assert.ok(snapshot.files[name] !== undefined, `${name} listed as included must be in the snapshot`);
  }
});

test('non-admin sessions are refused for backup, list and restore', () => {
  const req = { authUser: { id: 2, email: 'user@example.test', role: 'user' }, body: {} };

  const listRes = makeRes();
  listBackups(req, listRes);
  assert.equal(listRes.statusCode, 403);

  const createRes = makeRes();
  createBackup(req, createRes);
  assert.equal(createRes.statusCode, 403);

  const restoreRes = makeRes();
  restoreBackup(req, restoreRes);
  assert.equal(restoreRes.statusCode, 403);
});

test('backup listing returns snapshots newest first with sizes', async () => {
  const created = makeRes();
  await createBackup(adminReq(), created);
  assert.equal(created.statusCode, 200);

  const res = makeRes();
  listBackups(adminReq(), res);

  assert.equal(res.statusCode, 200);
  assert.ok(Array.isArray(res.body.backups));
  assert.ok(res.body.backups.some(b => b.id === created.body.backup.id));
  const newest = res.body.backups[0];
  assert.ok(newest.sizeBytes > 0, 'newest backup reports a positive size');
  for (let i = 1; i < res.body.backups.length; i++) {
    assert.ok(res.body.backups[i - 1].createdAt >= res.body.backups[i].createdAt, 'sorted newest first');
  }
});

test('restore refuses a wrong or missing master key', () => {
  const res = makeRes();
  restoreBackup(adminReq({ id: 'backup-20261010-000000', key: 'wrong-key' }), res);
  assert.equal(res.statusCode, 401);
  assert.match(res.body.error, /master key/i);
});

test('restore refuses backup ids that look like path traversal', () => {
  const traversalIds = ['../users', 'backup-20261010-000000/../x', 'backup-abc', ''];
  for (const id of traversalIds) {
    const res = makeRes();
    restoreBackup(adminReq({ id, key: process.env.MASTER_KEY }), res);
    assert.equal(res.statusCode, 400, `id "${id}" must be rejected`);
    assert.match(res.body.error, /invalid backup id/i);
  }
});

test('restore writes the snapshot back over mutated data and passes integrity', async () => {
  // 1) Snapshot the current (trusted) store.
  const created = makeRes();
  await createBackup(adminReq(), created);
  assert.equal(created.statusCode, 200);
  const originalUsers = JSON.parse(fs.readFileSync(USERS_FILE, 'utf8'));

  // 2) Corrupt the live file with marker data.
  const mutated = [{ id: 999999, email: 'mutated@example.test', role: 'user', storeId: 'buraza' }];
  fs.writeFileSync(USERS_FILE, JSON.stringify(mutated, null, 2));
  assert.deepEqual(JSON.parse(fs.readFileSync(USERS_FILE, 'utf8')), mutated);

  // 3) Restore — the original content must come back.
  const res = makeRes();
  restoreBackup(adminReq({ id: created.body.backup.id, key: process.env.MASTER_KEY }), res);

  assert.equal(res.statusCode, 200);
  assert.ok(res.body.restored.includes('users.json'));
  assert.deepEqual(JSON.parse(fs.readFileSync(USERS_FILE, 'utf8')), originalUsers);

  // A fresh snapshot of the restored file must also exist as the .bak
  // last-known-good copy (dataStore.writeJson refreshes it).
  const bak = JSON.parse(fs.readFileSync(`${USERS_FILE}.bak`, 'utf8'));
  assert.deepEqual(bak, originalUsers);
});

test('restore reports a missing backup file without touching live data', async () => {
  const before = fs.readFileSync(USERS_FILE, 'utf8');
  const res = makeRes();
  restoreBackup(adminReq({ id: 'backup-19990101-000000', key: process.env.MASTER_KEY }), res);

  assert.equal(res.statusCode, 400);
  assert.match(res.body.error, /not found|corrupted/i);
  assert.equal(fs.readFileSync(USERS_FILE, 'utf8'), before, 'live data untouched on failed restore');
});
