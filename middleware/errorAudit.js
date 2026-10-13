// ─── Error provenance / audit trail ─────────────────────────────────────────
// Surfaces WHERE an error came from. Two problems this fixes:
//   1. Controller circuit breakers log `logError('X CIRCUIT TRIPPED: ...')`
//      with no file/handler/stack — the origin is lost.
//   2. The Express global safety net logs the full `err.stack`, but the real
//      origin is buried under framework frames.
// captureOrigin() pulls the first *application* frame to the front as
// `path/file.js:line function`, and errorAudit() writes a clean, browsable
// `logs/error-audit.log` line for every failure that reaches the pipeline.
//
// Sandbox-aware (mirrors dataStore.js): under the test runner the audit log is
// redirected to a private temp dir so the suite can NEVER append audit noise to
// the live logs — the exact pollution we fixed before.

const fs = require('fs');
const os = require('os');
const path = require('path');
const { logError } = require('./logger');

const LIVE_LOGS_DIR = path.join(__dirname, '..', 'logs');

function isTestEnvironment() {
  return Boolean(process.env.NODE_TEST_CONTEXT) ||
    process.argv.some(arg => arg.includes('mocha')) ||
    (typeof require.main !== 'undefined' && require.main?.filename &&
      require.main.filename.split(/[\\/]/).slice(0, -1).includes('test'));
}

function resolveLogsDir() {
  if (process.env.NAVI_LOGS_DIR) return path.resolve(process.env.NAVI_LOGS_DIR);
  if (isTestEnvironment()) {
    return fs.mkdtempSync(path.join(os.tmpdir(), 'navi-test-logs-'));
  }
  return LIVE_LOGS_DIR;
}

const LOGS_DIR = resolveLogsDir();
const ERROR_AUDIT_FILE = path.join(LOGS_DIR, 'error-audit.log');

// First application frame from an error stack as `relative/path.js:line fn`,
// skipping Node internals, node_modules, express (in node_modules) and this
// file — so the logged origin points at the real source, not framework plumbing.
function captureOrigin(err, depth = 0) {
  const stack = (err && (err.stack || err.message)) || '';
  const lines = String(stack).split('\n');
  let skipped = 0;
  for (const line of lines) {
    const m = line.match(/^\s*at\s+(?:(.+?)\s+\()?([^()]+?):(\d+):(\d+)\)?\s*$/);
    if (!m) continue;
    const fn = m[1];
    const file = m[2];
    const lineNo = m[3];
    if (!file) continue;
    if (file.startsWith('node:') || file.includes('node_modules')) continue;
    if (file.includes(path.sep + 'errorAudit.js')) continue;
    if (skipped < depth) { skipped++; continue; }
    const rel = path.relative(path.join(__dirname, '..'), file).replace(/\\/g, '/');
    const name = (fn && fn !== 'Object.<anonymous>' && fn !== '<anonymous>') ? ` ${fn}` : '';
    return `${rel}:${lineNo}${name}`;
  }
  return 'unknown';
}

// Append a structured provenance line to the (sandbox-aware) audit log.
function appendAudit(origin, message, context = {}) {
  const time = new Date().toISOString();
  const ctx = context && Object.keys(context).length ? ` | ${JSON.stringify(context)}` : '';
  const entry = `[${time}] [${origin}] ${message}${ctx}\n`;
  try {
    fs.appendFileSync(ERROR_AUDIT_FILE, entry);
  } catch (err) {
    console.error('Error audit write failed:', err.message);
  }
  return entry;
}

// Express error-handling middleware (4-arg so Express treats it as an error
// handler). Keeps the existing admin alert + user-facing 500, and adds the
// origin prefix to the alert plus a dedicated audit-log line. Observes failures
// only — it never alters the auth flow or any route.
function errorAudit(err, req, res, next) {
  const origin = captureOrigin(err);
  const message = err?.message || String(err);
  const context = {
    method: req?.method,
    url: req?.originalUrl || req?.url,
    ip: req?.ip,
    actor: req?.authUser?.email || 'anonymous'
  };
  const enriched = `[${origin}] GLOBAL SAFETY NET: ${err?.stack || message} on ${req?.method} ${req?.originalUrl || req?.url}`;
  try {
    logError(enriched, true);
  } catch {
    console.error(enriched);
  }
  appendAudit(origin, message, context);
  res.status(500).json({ error: 'Something went wrong. Please try again.' });
}

module.exports = {
  errorAudit,
  captureOrigin,
  appendAudit,
  ERROR_AUDIT_FILE,
  LOGS_DIR
};
