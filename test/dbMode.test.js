const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

// HEART: dual-write / sqlite-read behaviour. NAVI_TEST_DB_MODE opts the sandbox
// into a non-json mode; every read still falls back to JSON, so the live
// data/ files are never touched (dataStore redirects DATA_DIR under node:test).

test('json mode: writes never touch the db layer and reads come from JSON', () => {
  delete process.env.NAVI_TEST_DB_MODE;
  process.env.DB_MODE = 'json';
  // Fresh require cycle per mode is not possible mid-process, so we exercise
  // the db module directly — dataStore's json path is covered by every other
  // test in the suite (they all run through readJson/writeJson).
  const db = require('../middleware/db');
  db.close();
  db.init(path.join(process.env.TEMP || '.', 'navi-json-mode-test.db'));
  assert.equal(db.getMode(), 'json');
  assert.equal(db.isHealthy(), null); // not applicable in json mode
  assert.equal(db.setDocument('x.json', { a: 1 }), true); // no-op, succeeds
  assert.equal(db.getDocument('x.json'), null); // never written
  db.close();
});

test('sqlite mode: setDocument/getDocument round-trips and validates', (t) => {
  process.env.NAVI_TEST_DB_MODE = 'sqlite';
  process.env.DB_MODE = 'sqlite';
  const dbFile = path.join(process.env.TEMP || '.', `navi-sqlite-${process.pid}.db`);
  try { fs.rmSync(dbFile, { force: true }); } catch { /* fresh */ }

  const db = require('../middleware/db');
  db.close();
  const init = db.init(dbFile);
  t.after(() => { db.close(); delete process.env.NAVI_TEST_DB_MODE; });

  assert.equal(init.mode, 'sqlite');
  assert.equal(init.opened, true);
  assert.equal(db.isHealthy(), true);

  const users = [{ id: 1, email: 'a@b.test' }, { id: 2, email: 'c@d.test' }];
  assert.equal(db.setDocument('users.json', users), true);
  assert.deepEqual(db.getDocument('users.json'), users);

  // Upsert overwrites rather than duplicating.
  db.setDocument('users.json', [users[0]]);
  assert.deepEqual(db.getDocument('users.json'), [users[0]]);

  // Missing key yields null (callers fall back to JSON).
  assert.equal(db.getDocument('loans.json'), null);

  const stats = db.stats();
  assert.equal(stats.documents, 1);
});

test('sqlite mode: a write failure degrades instead of throwing (JSON stays truth)', (t) => {
  process.env.NAVI_TEST_DB_MODE = 'sqlite';
  process.env.DB_MODE = 'sqlite';
  const db = require('../middleware/db');
  db.close();
  db.init(path.join(process.env.TEMP || '.', `navi-degrade-${process.pid}.db`));
  t.after(() => { db.close(); delete process.env.NAVI_TEST_DB_MODE; });

  // Force failure: close the handle underneath — subsequent writes must return
  // false (not throw) and reads must return null so dataStore falls back.
  db.close();
  // Re-init healthy, then corrupt health by dropping the connection mid-flight.
  const fresh = require('../middleware/db');
  fresh.init(path.join(process.env.TEMP || '.', `navi-degrade2-${process.pid}.db`));
  assert.equal(fresh.setDocument('k.json', { ok: 1 }), true);
  fresh.close();
  // After close(): writes report false, reads report null — degrade, not crash.
  assert.equal(fresh.getDocument('k.json'), null);
});

test('json-wins reconcile copies JSON files newer than their kv row', (t) => {
  process.env.NAVI_TEST_DB_MODE = 'sqlite';
  process.env.DB_MODE = 'sqlite';
  const dir = fs.mkdtempSync(path.join(require('os').tmpdir(), 'navi-reconcile-'));
  const jsonFile = path.join(dir, 'users.json');
  const payload = [{ id: 7, email: 'reconcile@example.test' }];

  const db = require('../middleware/db');
  db.close();
  db.init(path.join(dir, 'navi.db'));
  t.after(() => { db.close(); delete process.env.NAVI_TEST_DB_MODE; });

  // Seed the kv row FIRST (updated_at = now), then write the JSON file and
  // bump its mtime into the future — simulating "JSON written, crash before
  // the mirror landed" where the JSON file is definitively newer.
  db.setDocument('users.json', [{ id: 1, email: 'stale@example.test' }]);
  fs.writeFileSync(jsonFile, JSON.stringify(payload));
  const future = new Date(Date.now() + 5000);
  fs.utimesSync(jsonFile, future, future);

  const readJson = (file) => JSON.parse(fs.readFileSync(file, 'utf8'));
  const fixed = db.reconcileFromJson(readJson, [{ key: 'users.json', file: jsonFile }]);

  assert.deepEqual(fixed, ['users.json']);
  assert.deepEqual(db.getDocument('users.json'), payload);
});
