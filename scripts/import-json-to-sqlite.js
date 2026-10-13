// ─── HEART migration: one-shot import of the JSON stores into SQLite ────────
// Usage:  node scripts/import-json-to-sqlite.js
// Copies users.json / loans.json / feedback.json / invites.json / notifications
// / dailyReportState.json into the kv `documents` table, verifies row counts,
// and leaves the JSON files byte-for-byte untouched (they remain the fallback).
// Run with DB_MODE=dual or sqlite in .env — the script itself forces a db
// connection regardless of the flag so migration can run before the flip.

require('dotenv').config();
// Force a live db connection for the import regardless of the configured flag
// (must be set before middleware/db is required via dataStore).
if (process.env.DB_MODE !== 'dual') process.env.DB_MODE = 'sqlite';
const fs = require('fs');
const path = require('path');
const dataStore = require('../middleware/dataStore');
const db = require('../middleware/db');

const FILES = [
  'users.json', 'loans.json', 'feedback.json',
  'invites.json', 'notifications.json', 'dailyReportState.json'
];

function main() {
  const before = {};
  const failed = [];

  for (const name of FILES) {
    const file = path.join(dataStore.DATA_DIR, name);
    if (!fs.existsSync(file)) {
      console.log(`SKIP ${name} (not present)`);
      continue;
    }
    const raw = fs.readFileSync(file, 'utf8');
    before[name] = raw;

    let data;
    try {
      data = JSON.parse(raw);
    } catch (err) {
      console.error(`FAIL ${name}: malformed JSON — ${err.message}`);
      failed.push(name);
      continue;
    }

    const ok = db.setDocument(name, data);
    if (!ok) {
      failed.push(name);
      continue;
    }

    // Verify: re-read through the db layer and deep-compare.
    const readBack = db.getDocument(name);
    const match = JSON.stringify(readBack) === JSON.stringify(data);
    console.log(`${match ? 'OK  ' : 'FAIL'} ${name}: ${Array.isArray(data) ? data.length + ' records' : 'object'} imported`);
    if (!match) failed.push(name);

    // JSON file must be byte-identical after import.
    if (fs.readFileSync(file, 'utf8') !== raw) {
      console.error(`FAIL ${name}: JSON file was modified during import!`);
      failed.push(name);
    }
  }

  db.close();

  if (failed.length) {
    console.error(`\nMIGRATION INCOMPLETE — failed: ${failed.join(', ')}`);
    process.exit(1);
  }
  console.log('\nMIGRATION COMPLETE — JSON files unchanged and remain the fallback.');
}

if (require.main === module) {
  try {
    main();
  } catch (err) {
    console.error(`MIGRATION ERROR: ${err.message}`);
    process.exit(1);
  }
}

module.exports = { FILES };
