// ─── KIDNEYS — cleanup scheduler ─────────────────────────────────────────────
// One hourly sweep keeps the system from accumulating dead state:
//   • expired OTP codes            (middleware/otp.js store)
//   • dead pending signups/logins/resets + stale device tokens (authController)
//   • idle sessions older than 24h (sessionController)
//   • expired invite links         (authController cleanupExpiredInvites)
// Every entry point is wrapped in its own try/catch: one failing sub-sweep can
// never abort the others, and NOTHING here logs user material — counts only.

const fs = require('fs');
const path = require('path');
const os = require('os');
const otpService = require('./otp');
const { logError } = require('./logger');
const { sweepExpiredAuth, cleanupExpiredInvites } = require('../controllers/authController');
const { pruneSessions } = require('../controllers/sessionController');

// Sweep counts are operational info, NOT errors — they must go to a dedicated
// maintenance log, never errors.log (which feeds alerts/security monitoring).
// logAccess() is Express middleware (not callable from cron) and logger.js is
// off-limits, so kidneys writes its own sandbox-aware line here. The test-env
// detection mirrors logger.resolveLogsDir() on purpose so the suite never
// pollutes the live logs/ dir.
function resolveLogsDir() {
  if (process.env.NAVI_LOGS_DIR) return path.resolve(process.env.NAVI_LOGS_DIR);
  const isTest =
    Boolean(process.env.NODE_TEST_CONTEXT) ||
    process.argv.some(arg => arg.includes('mocha')) ||
    (typeof require.main !== 'undefined' && require.main?.filename &&
      require.main.filename.split(/[\\/]/).slice(0, -1).includes('test'));
  if (isTest) return fs.mkdtempSync(path.join(os.tmpdir(), 'navi-test-logs-'));
  return path.resolve(__dirname, '../logs');
}
const MAINTENANCE_FILE = path.join(resolveLogsDir(), 'maintenance.log');

function logMaintenance(message) {
  const entry = `[${new Date().toISOString()}] ${message}\n`;
  try {
    fs.appendFileSync(MAINTENANCE_FILE, entry);
  } catch { /* best effort — never let a log write stop the sweep */ }
}

function sweep() {
  const result = { otps: 0, auth: null, sessions: 0, invites: 0, errors: 0 };

  try {
    otpService.cleanupExpiredOtps();
  } catch {
    result.errors++;
  }

  try {
    result.auth = sweepExpiredAuth();
  } catch {
    result.errors++;
  }

  try {
    result.sessions = pruneSessions();
  } catch {
    result.errors++;
  }

  // Expired invite links (authController cleanupExpiredInvites): on-demand
  // expiry already guards use, but the hourly belt reclaims disk so the file
  // can't grow forever between validations.
  try {
    result.invites = cleanupExpiredInvites() || 0;
  } catch {
    result.errors++;
  }

  return result;
}

// Scheduled entry point: sweep + one counts-only maintenance-log line.
function runKidneySweep() {
  try {
    const result = sweep();
    const authTotal = result.auth
      ? result.auth.deadSignups + result.auth.deadLogins + result.auth.deadResets + result.auth.staleDevices
      : 0;
    const total = authTotal + result.sessions + result.invites;
    if (total > 0 || result.errors > 0) {
      // Counts only — no emails, tokens, or IPs may ever appear here.
      logMaintenance(
        `JANITOR SWEEP: ${result.sessions} session(s), ${authTotal} auth/device entr(ies), ${result.invites} expired invite(s)` +
        (result.errors ? `, ${result.errors} sub-sweep error(s)` : '')
      );
    }
    return result;
  } catch (err) {
    // Sweep failures are hygiene-only — log (never notify) and move on.
    try { logError(`KIDNEYS SWEEP FAILED: ${err.message}`); } catch { /* best effort */ }
    return null;
  }
}

module.exports = { sweep, runKidneySweep };
