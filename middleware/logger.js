const path = require('path');
require('dotenv').config({ path: path.resolve(__dirname, '../.env') });
const fs = require('fs');
const os = require('os');
const nodemailer = require('nodemailer');
const config = require('../config');

const emailTransporter = nodemailer.createTransport({
  host: 'smtp.gmail.com',
  port: 465,
  secure: true,
  auth: {
    user: process.env.GMAIL_USER,
    pass: process.env.GMAIL_APP_PASSWORD?.replace(/\s/g, '')
  }
});

const alertCooldowns = new Map();
const ALERT_COOLDOWN_MS = 15 * 60 * 1000;
// Gmail-down fallback: when the alert email itself cannot be sent, the incident
// is queued as a JSON line here so an SMTP outage never silently loses a
// breakage alert — the file can be reviewed (or replayed) after recovery.
//
// ─── Sandbox the log directory too ──────────────────────────────────────────
// dataStore.js redirects data/ to a private temp sandbox under the test runner
// so the suite can never touch live user/loan files. The logger was NOT part of
// that isolation, so every test run appended its noise (@example.test,
// DATA RECOVERED, circuit-trip dry-runs) straight into the LIVE logs/. This
// mirrors dataStore's behaviour for logs/. logger.js must not require dataStore
// (dataStore requires logger → circular), so the tiny test-env check is
// duplicated here on purpose.
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
const LOGS_DIR = resolveLogsDir();
const ERRORS_FILE = path.join(LOGS_DIR, 'errors.log');
const ACCESS_FILE = path.join(LOGS_DIR, 'access.log');
const HR_AUDIT_FILE = path.join(LOGS_DIR, 'hr-audit.log');
const PENDING_ALERTS_FILE = path.join(LOGS_DIR, 'pending-alerts.log');

function persistPendingAlert(subject, body) {
  try {
    const entry = JSON.stringify({ queuedAt: new Date().toISOString(), subject, body }) + '\n';
    fs.appendFileSync(PENDING_ALERTS_FILE, entry);
  } catch (err) {
    console.error('Pending alert write failed:', err.message);
  }
}

// Replay breakage alerts queued during an SMTP outage (logs/pending-alerts.log).
// Called after a successful send and on boot: drains oldest-first, caps the batch
// and the run frequency, rewrites the file with only the still-unsent remainder,
// and removes it entirely once empty — so a queued alert is never silently lost.
const PENDING_REPLAY_COOLDOWN_MS = 5 * 60 * 1000;
let lastPendingReplay = 0;

async function replayPendingAlerts(maxEntries = 20) {
  if (!process.env.GMAIL_USER || !process.env.GMAIL_APP_PASSWORD) return;
  const recipient = resolveAlertRecipient();
  if (!recipient) return;

  // Throttle so a queueing crash-loop cannot spin a send storm.
  const now = Date.now();
  if (now - lastPendingReplay < PENDING_REPLAY_COOLDOWN_MS) return;
  lastPendingReplay = now;

  let lines;
  try {
    if (!fs.existsSync(PENDING_ALERTS_FILE)) return;
    lines = fs.readFileSync(PENDING_ALERTS_FILE, 'utf8')
      .split('\n').map(line => line.trim()).filter(Boolean);
  } catch (err) {
    console.error('Pending alert read failed:', err.message);
    return;
  }
  if (!lines.length) return;

  const batch = lines.slice(0, maxEntries);
  const leftover = [];
  let transportDown = false;

  for (const line of batch) {
    if (transportDown) { leftover.push(line); continue; }
    let entry;
    try {
      entry = JSON.parse(line);
    } catch {
      continue; // malformed line — drop it rather than retry forever
    }
    try {
      await emailTransporter.sendMail({
        from: process.env.GMAIL_USER,
        to: recipient,
        subject: entry.subject,
        text: entry.body
      });
    } catch (err) {
      console.error('Pending alert replay failed:', err.message);
      transportDown = true;
      leftover.push(line); // keep this one to retry next time
    }
  }

  // Untried tail beyond the batch stays queued in original order.
  const finalQueue = [...leftover, ...lines.slice(batch.length)];
  try {
    if (finalQueue.length) {
      fs.writeFileSync(PENDING_ALERTS_FILE, finalQueue.map(line => line + '\n').join(''));
    } else {
      fs.unlinkSync(PENDING_ALERTS_FILE);
    }
  } catch (err) {
    console.error('Pending alert rewrite failed:', err.message);
  }
}

// Breakage alerts go to the admin inbox: explicit override first, then the
// ADMIN_EMAILS reports inbox (first address wins). Never the sender account.
function resolveAlertRecipient() {
  const raw = process.env.ERROR_EMAIL_RECIPIENT || process.env.ADMIN_EMAILS || process.env.ADMIN_EMAIL || '';
  const first = String(raw).split(',').map(entry => entry.trim()).filter(Boolean)[0];
  return first || null;
}

async function sendErrorAlert(subject, body) {
  if (!process.env.GMAIL_USER || !process.env.GMAIL_APP_PASSWORD) {
    return;
  }
  const recipient = resolveAlertRecipient();
  if (!recipient) {
    return;
  }

  // Flood protection: one email per incident signature every 15 minutes, so a
  // mail outage with dozens of login attempts does not spam the admin inbox.
  // The signature strips the leading timestamp so the same incident repeating
  // across seconds still collapses into one alert, while the [file → handler]
  // prefix inside the body keeps different handlers as distinct incidents.
  const signature = String(body).replace(/^\[[^\]]+\]\s*/, '');
  const key = `${subject}::${signature.slice(0, 120)}`;
  const now = Date.now();
  if (alertCooldowns.get(key) > now) {
    return;
  }
  alertCooldowns.set(key, now + ALERT_COOLDOWN_MS);

  try {
    await emailTransporter.sendMail({
      from: process.env.GMAIL_USER,
      to: recipient,
      subject,
      text: body
    });
    // A fresh alert just went out, so the transport is healthy again — drain any
    // breakage alerts queued while it was down (e.g. during an SMTP outage).
    replayPendingAlerts().catch(() => {});
  } catch (err) {
    console.error('Error alert failed:', err.message);
    persistPendingAlert(subject, body);
  }
}

// ─── Breakage-alert wrapper ──────────────────────────────────────────────────
// Formats "[file → handler] LABEL: message" and notifies the admin inbox via
// logError(msg, true). Use it only on money/silence-critical circuit breaks.
function logBreakage(file, handler, err, label = 'CIRCUIT TRIPPED') {
  const message = err?.message || String(err);
  logError(`[${file} → ${handler}] ${label}: ${message}`, true);
}

function logError(message, notify = false) {
  const time = new Date().toISOString();
  const entry = `[${time}] ${message}\n`;
  fs.appendFileSync(ERRORS_FILE, entry);
  console.error(entry);
  if (notify) {
    sendErrorAlert('Navi Server Error Alert', `${entry}\nCheck the server logs for more details.`).catch(() => {});
  }
}

function logAccess(req, res, next) {
  const skip = ['/status', '/sessions', '/logs/access', '/logs/errors'];
  if (!skip.includes(req.url)) {
    const time = new Date().toISOString();
    // Redact any device token in the query string so it never lands in the
    // access log (KYC/payment image links carry a scoped ?token= that plain
    // <a> navigation needs). LAN mitigation only — full fix is signed URLs.
    const safeUrl = String(req.url).replace(/([?&])token=[^&]*/gi, '$1token=REDACTED');
    const entry = `[${time}] ${req.method} ${safeUrl} - ${req.ip}\n`;
    fs.appendFileSync(ACCESS_FILE, entry);
  }
  next();
}

// HR audit trail: every employee-management action (create admin, edit employee,
// restrict permissions, approve a store switch) is written with the acting
// admin's id/email so the change is attributable.
function logHr(action, actor = {}) {
  const time = new Date().toISOString();
  const actorId = actor.id ?? 'unknown';
  const actorEmail = actor.email || 'unknown';
  const entry = `[${time}] HR ${action} | by id=${actorId} email=${actorEmail}\n`;
  try {
    fs.appendFileSync(HR_AUDIT_FILE, entry);
  } catch (err) {
    console.error('HR audit log write failed:', err.message);
  }
  console.log(entry);
}

module.exports = {
  logError,
  logAccess,
  logHr,
  logBreakage,
  resolveAlertRecipient,
  sendErrorAlert,
  replayPendingAlerts,
  emailTransporter,
  // Resolved log locations (sandboxed under the test runner so the suite never
  // writes to the live logs/). Exported so tests read from wherever the logger
  // actually writes instead of hardcoding the production path.
  LOGS_DIR,
  ERRORS_FILE,
  ACCESS_FILE,
  HR_AUDIT_FILE,
  PENDING_ALERTS_FILE,
  clearAlertCooldowns: () => alertCooldowns.clear(),
  clearPendingReplayThrottle: () => { lastPendingReplay = 0; }
};