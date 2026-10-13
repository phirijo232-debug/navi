const path = require('path');
const fs = require('fs');
const { logError } = require('./logger');

// ─── HEART — SQLite document store behind the dataStore API ──────────────────
// Storage model: a single `documents(key, json, updated_at)` kv table. Each JSON
// data file is mirrored under its filename as the key (e.g. "users.json"), which
// preserves the exact whole-document readJson/writeJson semantics with zero
// caller changes. Normalised per-entity tables can be added later without an
// API change.
//
// DB_MODE (env):
//   json   (default) — JSON files only (behaviour identical to pre-Heart)
//   dual   — write JSON + SQLite, read JSON (verification phase)
//   sqlite — write JSON + SQLite, read SQLite with JSON fallback
// Tests always run in `json` mode unless NAVI_TEST_DB_MODE opts in, so the
// suite can never touch the live data/navi.db.
//
// Degrade-not-lose rule: any SQLite failure drops the health flag and reads
// transparently fall back to the JSON files — a DB hiccup can never take the
// server down or lose data (JSON is written first, always).

let db = null;
let dbPath = null;
let mode = 'json';
let healthy = false;

function resolveMode() {
  if (process.env.NODE_TEST_CONTEXT && !process.env.NAVI_TEST_DB_MODE) return 'json';
  const raw = String(process.env.DB_MODE || 'json').trim().toLowerCase();
  if (raw === 'dual' || raw === 'sqlite') return raw;
  return 'json';
}

// Open (or create) the SQLite database. Safe to call repeatedly — idempotent.
function init(filePath) {
  dbPath = filePath;
  mode = resolveMode();
  if (mode === 'json') {
    healthy = false; // not needed in json mode
    return { mode, opened: false };
  }
  return openConnection();
}

function openConnection() {
  if (db) return { mode, opened: true };
  try {
    const Database = require('better-sqlite3');
    db = new Database(dbPath);
    db.pragma('journal_mode = WAL');
    db.pragma('synchronous = NORMAL');
    db.exec(`
      CREATE TABLE IF NOT EXISTS documents (
        key        TEXT PRIMARY KEY,
        json       TEXT NOT NULL,
        updated_at INTEGER NOT NULL
      );
    `);
    healthy = true;
    return { mode, opened: true };
  } catch (err) {
    healthy = false;
    db = null;
    // Log-only: server must still boot on JSON fallback if the driver/file fails.
    logError(`DB OPEN FAILED (falling back to JSON files): ${err.message}`);
    return { mode, opened: false };
  }
}

function isHealthy() {
  if (mode === 'json') return null; // not applicable
  return healthy && Boolean(db);
}

function getMode() {
  return mode;
}

// Read a mirrored document. Returns parsed value or null when absent/unusable.
// Never throws — a DB read problem yields null so callers fall back to JSON.
function getDocument(key) {
  if (mode === 'json' || !db || !healthy) return null;
  try {
    const row = db.prepare('SELECT json FROM documents WHERE key = ?').get(key);
    if (!row) return null;
    return JSON.parse(row.json);
  } catch (err) {
    healthy = false;
    logError(`DB READ FAILED for ${key} (JSON fallback active): ${err.message}`);
    return null;
  }
}

// Mirror a document. The JSON file has ALREADY been written by dataStore when
// this runs, so on failure we only drop the health flag — no data is lost and
// reads keep serving the JSON truth.
function setDocument(key, data) {
  if (mode === 'json') return true;
  if (!db || !healthy) {
    // Connection previously failed — attempt one reopen before giving up.
    if (!db) openConnection();
    if (!db || !healthy) return false;
  }
  try {
    const json = JSON.stringify(data);
    db.prepare(`
      INSERT INTO documents (key, json, updated_at) VALUES (?, ?, ?)
      ON CONFLICT(key) DO UPDATE SET json = excluded.json, updated_at = excluded.updated_at
    `).run(key, json, Date.now());
    return true;
  } catch (err) {
    healthy = false;
    logError(`DB WRITE FAILED for ${key} (JSON remains source of truth): ${err.message}`);
    return false;
  }
}

// ─── Boot reconcile (JSON wins) ──────────────────────────────────────────────
// If the process died between the JSON write and the SQLite mirror, the kv row
// is stale. Any JSON file newer than its kv row is copied INTO SQLite at boot,
// so the sqlite-mode read path can never serve stale data after a crash.
function reconcileFromJson(readJson, files) {
  if (mode === 'json' || !db || !healthy) return [];
  const fixed = [];
  for (const { key, file } of files) {
    try {
      // Missing file (fresh install / not yet created) — nothing to reconcile.
      if (!fs.existsSync(file)) continue;
      const jsonMtime = fs.statSync(file).mtimeMs;
      const row = db.prepare('SELECT updated_at FROM documents WHERE key = ?').get(key);
      if (!row || jsonMtime > row.updated_at) {
        const data = readJson(file, [], () => true);
        setDocument(key, data);
        fixed.push(key);
      }
    } catch (err) {
      // Transient read issue — skip this key, never block startup.
      try { logError(`DB RECONCILE skipped ${key}: ${err.message}`); } catch { /* log best effort */ }
    }
  }
  if (fixed.length) {
    logError(`DB RECONCILE (JSON newer, copied to SQLite): ${fixed.join(', ')}`);
  }
  return fixed;
}

function stats() {
  if (mode === 'json' || !db || !healthy) return null;
  try {
    const row = db.prepare('SELECT COUNT(*) AS n FROM documents').get();
    return { documents: row.n, file: dbPath ? path.basename(dbPath) : null };
  } catch {
    return null;
  }
}

function close() {
  try { if (db) db.close(); } catch { /* best effort */ }
  db = null;
  healthy = false;
}

module.exports = { init, getMode, isHealthy, getDocument, setDocument, reconcileFromJson, stats, close };
