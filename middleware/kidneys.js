// ─── KIDNEYS — cleanup scheduler ─────────────────────────────────────────────
// One hourly sweep keeps the system from accumulating dead state:
//   • expired OTP codes            (middleware/otp.js store)
//   • dead pending signups/logins/resets + stale device tokens (authController)
//   • idle sessions older than 24h (sessionController)
//   • expired invite links         (authController cleanupExpiredInvites runs
//                                    lazily too — this is the scheduled belt)
// Every entry point is wrapped in its own try/catch: one failing sub-sweep can
// never abort the others, and NOTHING here logs user material — counts only.

const otpService = require('./otp');
const { logError } = require('./logger');
const { sweepExpiredAuth } = require('../controllers/authController');
const { pruneSessions } = require('../controllers/sessionController');

// cleanupExpiredInvites lives in authController but is not exported there
// (kept private on purpose); invites are re-validated on every use anyway, so
// the scheduled sweep covers the three stores above and leave invites to their
// lazy cleanup + on-use expiry checks.

function sweep() {
  const result = { otps: 0, auth: null, sessions: 0, errors: 0 };

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

  return result;
}

// Scheduled entry point: sweep + one counts-only log line.
function runKidneySweep() {
  try {
    const result = sweep();
    const authTotal = result.auth
      ? result.auth.deadSignups + result.auth.deadLogins + result.auth.deadResets + result.auth.staleDevices
      : 0;
    const total = (result.auth ? authTotal : 0) + result.sessions;
    if (total > 0 || result.errors > 0) {
      // Counts only — no emails, tokens, or IPs may ever appear here.
      logError(
        `KIDNEYS SWEEP: ${result.sessions} session(s), ${authTotal} auth/device entr(ies) pruned` +
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
