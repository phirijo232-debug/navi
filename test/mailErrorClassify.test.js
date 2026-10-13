const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const bcrypt = require('bcryptjs');
const otpService = require('../middleware/otp');
const {
  resolveAlertRecipient,
  clearAlertCooldowns,
  clearPendingReplayThrottle,
  logBreakage,
  sendErrorAlert,
  replayPendingAlerts,
  emailTransporter,
  PENDING_ALERTS_FILE
} = require('../middleware/logger');
const { requestLogin, requestPasswordReset, classifyMailError } = require('../controllers/authController');

const USERS_FILE = require('../middleware/dataStore').paths.users;

function responseRecorder() {
  return {
    statusCode: 200,
    status(code) { this.statusCode = code; return this; },
    json(payload) { this.body = payload; return this; }
  };
}

// Never send real alert emails from tests: the controller now notifies the
// admin inbox on circuit trips, so drop the sender credentials while the
// notify path runs, then restore them.
async function withoutAlertSends(fn) {
  const savedUser = process.env.GMAIL_USER;
  const savedPass = process.env.GMAIL_APP_PASSWORD;
  delete process.env.GMAIL_USER;
  delete process.env.GMAIL_APP_PASSWORD;
  try {
    return await fn();
  } finally {
    if (savedUser !== undefined) process.env.GMAIL_USER = savedUser;
    if (savedPass !== undefined) process.env.GMAIL_APP_PASSWORD = savedPass;
  }
}

test('classifyMailError separates unreachable, rejected, and unconfigured mail faults', () => {
  assert.match(classifyMailError(new Error('getaddrinfo ENOTFOUND smtp.gmail.com'), 'send the login OTP').error, /unreachable/i);
  assert.match(classifyMailError(new Error('Invalid login: 535-5.7.8 Username and Password not accepted'), 'send the login OTP').error, /rejected|credentials/i);
  assert.match(classifyMailError(new Error('OTP email configuration is incomplete.'), 'send the login OTP').error, /not configured/i);
  const fallback = classifyMailError(new Error('something unexpected'), 'send the login OTP');
  assert.equal(fallback.status, 503);
  assert.match(fallback.error, /try again shortly/i);
});

test('requestLogin reports an unreachable mail server instead of blaming credentials', async (t) => {
  const original = fs.readFileSync(USERS_FILE, 'utf8');
  const hash = await bcrypt.hash('TestPass1!', 10);
  fs.writeFileSync(USERS_FILE, JSON.stringify([{
    id: 1, username: 'Login User', email: 'login-user@example.test',
    password: hash, role: 'admin', storeId: 'buraza', trustedDevices: []
  }], null, 2));

  try {
    t.mock.method(otpService, 'sendOTP', async () => {
      throw new Error('getaddrinfo ENOTFOUND smtp.gmail.com');
    });
    const res = responseRecorder();
    await withoutAlertSends(() => requestLogin({ body: { email: 'login-user@example.test', password: 'TestPass1!' } }, res));
    assert.equal(res.statusCode, 503);
    assert.match(res.body.error, /unreachable/i);
  } finally {
    fs.writeFileSync(USERS_FILE, original);
  }
});

test('requestLogin reports rejected mailbox credentials distinctly', async (t) => {
  const original = fs.readFileSync(USERS_FILE, 'utf8');
  const hash = await bcrypt.hash('TestPass1!', 10);
  fs.writeFileSync(USERS_FILE, JSON.stringify([{
    id: 1, username: 'Login User', email: 'login-user@example.test',
    password: hash, role: 'admin', storeId: 'buraza', trustedDevices: []
  }], null, 2));

  try {
    t.mock.method(otpService, 'sendOTP', async () => {
      throw new Error('Invalid login: 535-5.7.8 Username and Password not accepted');
    });
    const res = responseRecorder();
    await withoutAlertSends(() => requestLogin({ body: { email: 'login-user@example.test', password: 'TestPass1!' } }, res));
    assert.equal(res.statusCode, 503);
    assert.match(res.body.error, /rejected|credentials/i);
  } finally {
    fs.writeFileSync(USERS_FILE, original);
  }
});

test('requestPasswordReset reports an unreachable mail server distinctly', async (t) => {
  const original = fs.readFileSync(USERS_FILE, 'utf8');
  const hash = await bcrypt.hash('OldPass1!', 10);
  fs.writeFileSync(USERS_FILE, JSON.stringify([{
    id: 1, username: 'Reset User', email: 'reset-user@example.test',
    password: hash, role: 'user', storeId: 'buraza', trustedDevices: []
  }], null, 2));

  try {
    t.mock.method(otpService, 'sendOTP', async () => {
      throw new Error('connect ETIMEDOUT 74.125.0.0:465');
    });
    const res = responseRecorder();
    await withoutAlertSends(() => requestPasswordReset({ body: { email: 'reset-user@example.test' } }, res));
    assert.equal(res.statusCode, 503);
    assert.match(res.body.error, /unreachable/i);
  } finally {
    fs.writeFileSync(USERS_FILE, original);
  }
});

test('breakage alerts resolve to the admin inbox, preferring the explicit override', () => {
  const saved = {
    ERROR_EMAIL_RECIPIENT: process.env.ERROR_EMAIL_RECIPIENT,
    ADMIN_EMAILS: process.env.ADMIN_EMAILS,
    ADMIN_EMAIL: process.env.ADMIN_EMAIL
  };
  try {
    clearAlertCooldowns();
    process.env.ERROR_EMAIL_RECIPIENT = 'override@example.test';
    process.env.ADMIN_EMAILS = 'reports@example.test';
    assert.equal(resolveAlertRecipient(), 'override@example.test');
    delete process.env.ERROR_EMAIL_RECIPIENT;
    process.env.ADMIN_EMAILS = 'reports@example.test, second@example.test';
    assert.equal(resolveAlertRecipient(), 'reports@example.test');
    delete process.env.ADMIN_EMAILS;
    delete process.env.ADMIN_EMAIL;
    assert.equal(resolveAlertRecipient(), null);
  } finally {
    clearAlertCooldowns();
    for (const [key, value] of Object.entries(saved)) {
      if (value === undefined) delete process.env[key];
      else process.env[key] = value;
    }
  }
});

test('logBreakage writes "[file → handler] LABEL: message" to the error log', (t) => {
  const appended = [];
  t.mock.method(fs, 'appendFileSync', (file, entry) => { appended.push(String(entry)); });
  t.mock.method(console, 'error', () => {});
  const savedUser = process.env.GMAIL_USER;
  const savedPass = process.env.GMAIL_APP_PASSWORD;
  delete process.env.GMAIL_USER;
  delete process.env.GMAIL_APP_PASSWORD;
  try {
    clearAlertCooldowns();
    logBreakage('authController.js', 'confirmLogin', new Error('boom'), 'LOGIN CONFIRM CIRCUIT TRIPPED');
  } finally {
    if (savedUser !== undefined) process.env.GMAIL_USER = savedUser;
    if (savedPass !== undefined) process.env.GMAIL_APP_PASSWORD = savedPass;
  }
  assert.ok(
    appended.some(line => /\[authController\.js → confirmLogin\] LOGIN CONFIRM CIRCUIT TRIPPED: boom/.test(line)),
    `expected breakage line, got: ${appended.join(' | ')}`
  );
});

test('identical breakage incidents alert once per 15 minutes; new handlers alert separately', async (t) => {
  const saved = {
    GMAIL_USER: process.env.GMAIL_USER,
    GMAIL_APP_PASSWORD: process.env.GMAIL_APP_PASSWORD,
    ERROR_EMAIL_RECIPIENT: process.env.ERROR_EMAIL_RECIPIENT
  };
  // Isolate from any real queued outage alerts: the post-send replay must not
  // add spurious sends here (and must not consume the real pending queue).
  const pendingFile = PENDING_ALERTS_FILE;
  const pendingBefore = fs.existsSync(pendingFile) ? fs.readFileSync(pendingFile, 'utf8') : null;
  try {
    process.env.GMAIL_USER = 'alerts@example.test';
    process.env.GMAIL_APP_PASSWORD = 'test-app-password';
    process.env.ERROR_EMAIL_RECIPIENT = 'admin@example.test';
    clearAlertCooldowns();
    clearPendingReplayThrottle();
    fs.writeFileSync(pendingFile, '');
    t.mock.method(console, 'error', () => {});
    const sendMail = t.mock.method(emailTransporter, 'sendMail', async () => ({ accepted: ['admin@example.test'] }));
    await sendErrorAlert('Navi Server Error Alert', '[2026-01-01T00:00:00.000Z] [authController.js → requestLogin] LOGIN CIRCUIT TRIPPED: ENOTFOUND\nCheck the server logs for more details.');
    await sendErrorAlert('Navi Server Error Alert', '[2026-01-01T00:07:00.000Z] [authController.js → requestLogin] LOGIN CIRCUIT TRIPPED: ENOTFOUND\nCheck the server logs for more details.');
    assert.equal(sendMail.mock.callCount(), 1, 'same incident must not re-alert within the window');
    await sendErrorAlert('Navi Server Error Alert', '[2026-01-01T00:08:00.000Z] [loanController.js → recordPayment] PAYMENT RECORD ERROR: disk full\nCheck the server logs for more details.');
    assert.equal(sendMail.mock.callCount(), 2, 'a different handler is a distinct incident');
  } finally {
    if (pendingBefore === null) {
      try { fs.unlinkSync(pendingFile); } catch { /* already gone */ }
    } else {
      fs.writeFileSync(pendingFile, pendingBefore);
    }
    clearAlertCooldowns();
    for (const [key, value] of Object.entries(saved)) {
      if (value === undefined) delete process.env[key];
      else process.env[key] = value;
    }
  }
});

test('alert emails that fail to send are queued in logs/pending-alerts.log', async (t) => {
  const pendingFile = PENDING_ALERTS_FILE;
  const before = fs.existsSync(pendingFile) ? fs.readFileSync(pendingFile, 'utf8') : null;
  const saved = {
    GMAIL_USER: process.env.GMAIL_USER,
    GMAIL_APP_PASSWORD: process.env.GMAIL_APP_PASSWORD,
    ERROR_EMAIL_RECIPIENT: process.env.ERROR_EMAIL_RECIPIENT
  };
  try {
    process.env.GMAIL_USER = 'alerts@example.test';
    process.env.GMAIL_APP_PASSWORD = 'test-app-password';
    process.env.ERROR_EMAIL_RECIPIENT = 'admin@example.test';
    clearAlertCooldowns();
    t.mock.method(console, 'error', () => {});
    t.mock.method(emailTransporter, 'sendMail', async () => {
      throw new Error('getaddrinfo ENOTFOUND smtp.gmail.com');
    });
    await sendErrorAlert('Navi Server Error Alert', `[${new Date().toISOString()}] [scheduler.js → cron:dailyReport] SCHEDULER REPORT FAILED: ENOTFOUND\nCheck the server logs for more details.`);
    const after = fs.readFileSync(pendingFile, 'utf8');
    assert.match(after, /cron:dailyReport/);
    const lastLine = after.trim().split('\n').at(-1);
    const queued = JSON.parse(lastLine);
    assert.equal(queued.subject, 'Navi Server Error Alert');
    assert.match(queued.body, /SCHEDULER REPORT FAILED/);
  } finally {
    if (before === null) {
      try { fs.unlinkSync(pendingFile); } catch { /* already gone */ }
    } else {
      fs.writeFileSync(pendingFile, before);
    }
    clearAlertCooldowns();
    for (const [key, value] of Object.entries(saved)) {
      if (value === undefined) delete process.env[key];
      else process.env[key] = value;
    }
  }
});

test('replayPendingAlerts drains queued alerts to the admin inbox and clears the file on recovery', async (t) => {
  const pendingFile = PENDING_ALERTS_FILE;
  const before = fs.existsSync(pendingFile) ? fs.readFileSync(pendingFile, 'utf8') : null;
  const saved = {
    GMAIL_USER: process.env.GMAIL_USER,
    GMAIL_APP_PASSWORD: process.env.GMAIL_APP_PASSWORD,
    ERROR_EMAIL_RECIPIENT: process.env.ERROR_EMAIL_RECIPIENT
  };
  try {
    process.env.GMAIL_USER = 'alerts@example.test';
    process.env.GMAIL_APP_PASSWORD = 'test-app-password';
    process.env.ERROR_EMAIL_RECIPIENT = 'admin@example.test';
    clearPendingReplayThrottle();
    // Seed the queue with two alerts as if an SMTP outage had blocked them.
    fs.writeFileSync(pendingFile, [
      JSON.stringify({ queuedAt: new Date().toISOString(), subject: 'Navi Server Error Alert', body: '[a] [loanController.js → recordPayment] PAYMENT RECORD ERROR: disk full' }),
      JSON.stringify({ queuedAt: new Date().toISOString(), subject: 'Navi Server Error Alert', body: '[b] [scheduler.js → cron:dailyReport] SCHEDULER REPORT FAILED: ENOTFOUND' })
    ].join('\n') + '\n');
    t.mock.method(console, 'error', () => {});
    const sendMail = t.mock.method(emailTransporter, 'sendMail', async () => ({ accepted: ['admin@example.test'] }));

    await replayPendingAlerts();

    assert.ok(sendMail.mock.callCount() >= 2, 'both queued alerts should be replayed');
    assert.ok(!fs.existsSync(pendingFile), 'queue file is removed once fully drained');
  } finally {
    if (before === null) {
      try { fs.unlinkSync(pendingFile); } catch { /* already gone */ }
    } else {
      fs.writeFileSync(pendingFile, before);
    }
    clearPendingReplayThrottle();
    for (const [key, value] of Object.entries(saved)) {
      if (value === undefined) delete process.env[key];
      else process.env[key] = value;
    }
  }
});

test('replayPendingAlerts keeps the unsent remainder when the transport is still down', async (t) => {
  const pendingFile = PENDING_ALERTS_FILE;
  const before = fs.existsSync(pendingFile) ? fs.readFileSync(pendingFile, 'utf8') : null;
  const saved = {
    GMAIL_USER: process.env.GMAIL_USER,
    GMAIL_APP_PASSWORD: process.env.GMAIL_APP_PASSWORD,
    ERROR_EMAIL_RECIPIENT: process.env.ERROR_EMAIL_RECIPIENT
  };
  try {
    process.env.GMAIL_USER = 'alerts@example.test';
    process.env.GMAIL_APP_PASSWORD = 'test-app-password';
    process.env.ERROR_EMAIL_RECIPIENT = 'admin@example.test';
    clearPendingReplayThrottle();
    fs.writeFileSync(pendingFile, [
      JSON.stringify({ queuedAt: new Date().toISOString(), subject: 'Navi Server Error Alert', body: '[a] [loanController.js → recordPayment] PAYMENT RECORD ERROR: disk full' }),
      JSON.stringify({ queuedAt: new Date().toISOString(), subject: 'Navi Server Error Alert', body: '[b] [scheduler.js → cron:dailyReport] SCHEDULER REPORT FAILED: ENOTFOUND' })
    ].join('\n') + '\n');
    t.mock.method(console, 'error', () => {});
    t.mock.method(emailTransporter, 'sendMail', async () => {
      throw new Error('getaddrinfo ENOTFOUND smtp.gmail.com');
    });

    await replayPendingAlerts();

    const remaining = fs.readFileSync(pendingFile, 'utf8').trim().split('\n').filter(Boolean);
    assert.equal(remaining.length, 2, 'no queued alert is lost while the transport is down');
    assert.doesNotThrow(() => remaining.forEach(line => JSON.parse(line)), 'remainder stays valid JSON lines');
  } finally {
    if (before === null) {
      try { fs.unlinkSync(pendingFile); } catch { /* already gone */ }
    } else {
      fs.writeFileSync(pendingFile, before);
    }
    clearPendingReplayThrottle();
    for (const [key, value] of Object.entries(saved)) {
      if (value === undefined) delete process.env[key];
      else process.env[key] = value;
    }
  }
});

test('admin.js resumes a valid session on refresh and groups paid loans by settlement date', () => {
  const src = fs.readFileSync(path.join(__dirname, '../public/admin.js'), 'utf8');
  // Refresh must validate the token and re-enter the store instead of always
  // dumping the admin back at the store picker.
  assert.match(src, /async function restoreSession\(\)/, 'restoreSession helper must exist');
  assert.match(src, /window\.onload[\s\S]*?restoreSession\(\);/, 'window.onload must call restoreSession');
  assert.match(src, /restoreSession\(\)\s*\{[\s\S]*?fetch\('\/users'[\s\S]*?response\.ok[\s\S]*?enterStore\(/,
    'a valid token should re-enter the store; a rejected token should show login');
  // Paid loans must be grouped by settlement date so "Today + Paid" works.
  assert.match(src, /function getLoanPeriodDate\(loan\)\s*\{[\s\S]*?getSettledAt\(loan\)/,
    'getLoanPeriodDate must fall back to settlement date for paid loans');
});

