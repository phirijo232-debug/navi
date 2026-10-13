const fs = require('fs');
const os = require('os');
const path = require('path');
const { logError } = require('./logger');
// HEART delegate: SQLite mirror behind DB_MODE (json|dual|sqlite). All logic
// lives in db.js — this file keeps its exact API and JSON-first behaviour.
const db = require('./db');

// ─── Single source of truth for where the JSON data lives ───────────────────
// Production: <repo>/data
// Tests:      a private temp sandbox per process, so the suite can NEVER
//             read, truncate, or overwrite the live user/loan/feedback files
//             again (this is what wiped users.json before).

const LIVE_DATA_DIR = path.join(__dirname, '..', 'data');
const CORE_DATA_FILES = ['users.json', 'loans.json', 'feedback.json'];
const KNOWN_DATA_FILES = [...CORE_DATA_FILES, 'dailyReportState.json', 'notifications.json'];

function isTestEnvironment() {
  return Boolean(process.env.NODE_TEST_CONTEXT) ||           // node --test runner
    process.argv.some(arg => arg.includes('mocha')) ||        // mocha / npm test
    (typeof require.main !== 'undefined' && require.main?.filename &&
      require.main.filename.split(/[\\/]/).slice(0, -1).includes('test')); // node test/foo.js
}

function seedSandbox(sandboxDir) {
  for (const name of KNOWN_DATA_FILES) {
    try {
      fs.copyFileSync(path.join(LIVE_DATA_DIR, name), path.join(sandboxDir, name));
    } catch {
      // Live file may not exist yet (fresh install) — the sandbox starts empty
      // and readJson/writeJson will initialise it on demand.
    }
  }
}

function resolveDataDir() {
  if (process.env.NAVI_DATA_DIR) return path.resolve(process.env.NAVI_DATA_DIR);
  if (isTestEnvironment()) {
    const sandboxDir = fs.mkdtempSync(path.join(os.tmpdir(), 'navi-test-data-'));
    seedSandbox(sandboxDir);
    return sandboxDir;
  }
  return LIVE_DATA_DIR;
}

const DATA_DIR = resolveDataDir();

// HEART: open the SQLite mirror (no-op in json mode / tests). The db file lives
// next to the data it mirrors so the test sandbox gets its own private db too.
db.init(path.join(DATA_DIR, 'navi.db'));

const paths = {
  users: path.join(DATA_DIR, 'users.json'),
  loans: path.join(DATA_DIR, 'loans.json'),
  feedback: path.join(DATA_DIR, 'feedback.json'),
  dailyReportState: path.join(DATA_DIR, 'dailyReportState.json'),
  notifications: path.join(DATA_DIR, 'notifications.json')
};

let tmpCounter = 0;

// ─── Atomic write: write to a temp file, then rename over the target so a     ───
// ─── reader can never observe a truncated/0-byte file mid-write.              ───
// ─── After every successful save a `.bak` copy is refreshed, giving us a       ───
// ─── last-known-good snapshot for recovery.                                   ───
function writeJson(file, data) {
  const json = JSON.stringify(data, null, 2);
  const tmpFile = `${file}.${process.pid}.${tmpCounter++}.tmp`;
  try {
    fs.writeFileSync(tmpFile, json);
    fs.renameSync(tmpFile, file);
  } catch (err) {
    try { fs.rmSync(tmpFile, { force: true }); } catch { /* best effort */ }
    if (err.code === 'EPERM' || err.code === 'EBUSY' || err.code === 'EACCES') {
      // Target briefly locked by a reader on Windows — fall back to direct write.
      fs.writeFileSync(file, json);
    } else {
      throw err;
    }
  }
  try {
    fs.writeFileSync(`${file}.bak`, json);
  } catch (err) {
    logError(`BACKUP WRITE FAILED for ${path.basename(file)}: ${err.message}`);
  }
  // HEART dual-write: JSON is written FIRST (source of truth, .bak refreshed),
  // then mirrored to SQLite. A mirror failure only drops the db health flag —
  // reads then keep serving the JSON truth (degrade, never lose).
  try {
    db.setDocument(path.basename(file), data);
  } catch (err) {
    logError(`DB MIRROR FAILED for ${path.basename(file)}: ${err.message}`);
  }
}

// ─── Corruption recovery (non-destructive):                                   ───
//   1. preserve the broken bytes in `<file>.corrupt` (evidence for repair)     ───
//   2. restore the last-known-good snapshot from `<file>.bak` when valid       ───
//   3. only when no backup exists, materialise the in-memory fallback on disk  ───
//   Never again silently overwrite a damaged store with nothing.               ───
function recover(file, fallback, reason) {
  try {
    const broken = fs.readFileSync(file, 'utf8');
    if (broken.trim()) {
      fs.writeFileSync(`${file}.corrupt`, broken);
    }
  } catch { /* file missing — nothing to preserve */ }

  try {
    const backup = JSON.parse(fs.readFileSync(`${file}.bak`, 'utf8'));
    writeJson(file, backup);
    logError(`DATA RECOVERED from backup (${reason}): ${path.basename(file)}`);
    return backup;
  } catch { /* no usable backup */ }

  writeJson(file, fallback);
  logError(`DATA RECOVERED with empty fallback, no backup available (${reason}): ${path.basename(file)}`);
  return fallback;
}

function readJson(file, fallback, validate = () => true) {
  // HEART sqlite mode: read the mirrored document first; fall through to the
  // JSON path whenever the DB has no row, fails validation, or went unhealthy —
  // so JSON files remain a complete, always-usable fallback.
  if (db.getMode() === 'sqlite') {
    const mirrored = db.getDocument(path.basename(file));
    if (mirrored !== null && validate(mirrored)) {
      return mirrored;
    }
  }

  let raw;
  try {
    raw = fs.readFileSync(file, 'utf8');
  } catch (err) {
    if (err.code === 'ENOENT') return fallback;
    logError(`DATA READ FAILED for ${path.basename(file)}: ${err.message}`);
    return fallback;
  }

  if (!raw.trim()) {
    return recover(file, fallback, 'empty file');
  }

  try {
    const parsed = JSON.parse(raw);
    if (!validate(parsed)) {
      return recover(file, fallback, 'unexpected shape');
    }
    return parsed;
  } catch {
    return recover(file, fallback, 'malformed JSON');
  }
}

// ─── Startup integrity pass: validates every known data file before the       ───
// ─── server accepts traffic, repairing from backup where possible.            ───
function ensureDataIntegrity() {
  const report = [];
  for (const name of CORE_DATA_FILES) {
    const file = path.join(DATA_DIR, name);
    const backup = `${file}.bak`;

    // Seed a last-known-good backup when one is missing but the main file is
    // healthy, so recovery is possible from the very first run.
    try {
      fs.accessSync(backup);
    } catch {
      try {
        const json = fs.readFileSync(file, 'utf8');
        JSON.parse(json);
        fs.writeFileSync(backup, json);
        report.push(`${name}: initial backup created`);
      } catch { /* main file missing or damaged — recovery path below handles it */ }
    }

    const before = (() => {
      try { return fs.statSync(file).size; } catch { return -1; }
    })();
    readJson(file, []);
    let after;
    try { after = fs.statSync(file).size; } catch { after = -1; }
    if (before !== after) report.push(`${name}: repaired (${before} -> ${after} bytes)`);
  }
  if (report.length) {
    logError(`STARTUP DATA REPAIR: ${report.join('; ')}`);
  }
  // HEART boot reconcile (JSON wins): copy any JSON file newer than its kv row
  // into SQLite so a crash between the two writes can never serve stale data.
  try {
    const mirrorFiles = [...CORE_DATA_FILES, 'invites.json', 'notifications.json', 'dailyReportState.json']
      .map(name => ({ key: name, file: path.join(DATA_DIR, name) }));
    db.reconcileFromJson(readJson, mirrorFiles);
  } catch (err) {
    logError(`DB RECONCILE FAILED (JSON remains source of truth): ${err.message}`);
  }
  return report;
}

module.exports = { DATA_DIR, paths, readJson, writeJson, ensureDataIntegrity, db };