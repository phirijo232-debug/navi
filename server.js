require('dotenv').config();
const express = require('express');
const path = require('path');
const config = require('./config');
const { logError, logAccess, replayPendingAlerts } = require('./middleware/logger');
const { helmet, deviceAuth, rateLimiter, authRateLimiter } = require('./middleware/security');
const { verifyOTP, sendOTP } = require('./middleware/otp');
const { trackSession } = require('./controllers/sessionController');
const routes = require('./routes');
const { startScheduler } = require('./scheduler');
const { ensureDataIntegrity } = require('./middleware/dataStore');

const ADMIN_KEY = process.env.MASTER_KEY || config.SHUTDOWN_KEY || 'phirii26';
const ADMIN_EMAIL = process.env.ADMIN_EMAILS || process.env.GMAIL_USER;

const app = express();
app.disable('x-powered-by');

app.use(helmet({
  hsts: false,
  contentSecurityPolicy: {
    directives: {
      defaultSrc: ["'self'"],
      scriptSrc: ["'self'", "'unsafe-inline'"],
      styleSrc: ["'self'", "'unsafe-inline'"],
      connectSrc: ["'self'"],
    }
  }
}));

app.use(express.json());

// Brute-force-sensitive endpoints (auth + vault OTP) get a strict limiter for
// EVERY source IP — including localhost — so a local process can't hammer them.
const AUTH_SENSITIVE_PATHS = new Set([
  '/login', '/login/confirm', '/signup', '/signup/confirm', '/signup/resend',
  '/password-reset', '/password-reset/confirm', '/vault/request', '/vault/authorize'
]);

app.use((req, res, next) => {
  if (AUTH_SENSITIVE_PATHS.has(req.path)) {
    return authRateLimiter(req, res, next);
  }
  next();
});

// General limiter still skips localhost so the dashboard's frequent status
// polling (every 5s) is never throttled.
app.use((req, res, next) => {
  const isLocalhost = ['127.0.0.1', '::1', '::ffff:127.0.0.1'].includes(req.ip);
  if (isLocalhost) return next();
  rateLimiter(req, res, next);
});

app.use(express.static(path.join(__dirname, 'public')));

function hasValidAdminKey(req) {
  const headerKey = req.headers['x-admin-key'] || req.headers['x-shutdown-key'];
  const bodyKey = req.body && (req.body.password || req.body.masterKey);
  return Boolean(headerKey && headerKey === ADMIN_KEY) || Boolean(bodyKey && bodyKey === ADMIN_KEY);
}

app.post('/vault/request', async (req, res) => {
  try {
    const { password } = req.body || {};
    const submittedKey = password || req.headers['x-admin-key'] || req.headers['x-shutdown-key'];
    if (!submittedKey || submittedKey !== ADMIN_KEY) {
      logError(`VAULT REQUEST BLOCKED — invalid master key from ${req.ip}`);
      return res.status(403).json({ error: 'Invalid master key.' });
    }
    await sendOTP('Vault Access', ADMIN_EMAIL);
    return res.json({ message: 'Vault OTP sent to the configured admin email.' });
  } catch (err) {
    logError(`VAULT REQUEST FAILED: ${err.message}`);
    return res.status(500).json({ error: 'Vault request failed.' });
  }
});

app.post('/vault/authorize', (req, res) => {
  try {
    const { password, otp } = req.body || {};
    const submittedKey = password || req.headers['x-admin-key'] || req.headers['x-shutdown-key'];
    if (!submittedKey || submittedKey !== ADMIN_KEY) {
      return res.status(403).json({ error: 'Invalid master key.' });
    }
    const result = verifyOTP(otp, ADMIN_EMAIL, 'Vault Access');
    if (!result.valid) {
      return res.status(400).json({ error: result.message });
    }
    return res.json({ authorized: true, message: 'Vault access approved.' });
  } catch (err) {
    logError(`VAULT AUTH FAILED: ${err.message}`);
    return res.status(500).json({ error: 'Vault authorization failed.' });
  }
});

app.post('/internal-shutdown', (req, res) => {
  const key = req.headers['x-admin-key'] || req.headers['x-shutdown-key'];
  if (key !== ADMIN_KEY) {
    logError(`UNAUTHORIZED SHUTDOWN ATTEMPT from ${req.ip}`);
    return res.status(403).send('Denied');
  }
  res.send('Navi Server shutting down...');
  logError('SERVER SHUTDOWN VIA CMD');
  setTimeout(() => process.exit(0), 500);
});

app.use(deviceAuth);
app.use(logAccess);
app.use(trackSession);
app.use('/', routes);

process.on('uncaughtException', (err) => {
  logError(`UNCAUGHT ERROR: ${err.stack || err.message}`, true);
});

app.use((req, res) => {
  if (req.url === '/favicon.ico' || req.url.startsWith('/.well-known')) {
    return res.status(204).end();
  }
  const msg = `UNKNOWN ROUTE: ${req.method} ${req.url} from ${req.ip}`;
  logError(msg);
  res.status(404).send('Route not found');
});

app.use((err, req, res, next) => {
  try {
    logError(`GLOBAL SAFETY NET: ${err.stack || err.message} on ${req.method} ${req.url}`, true);
  } catch {
    console.error(`GLOBAL SAFETY NET: ${err.stack || err.message}`);
  }
  res.status(500).json({ error: 'Something went wrong. Please try again.' });
});

const startupRepairs = ensureDataIntegrity();
if (startupRepairs.length) {
  console.warn(`Navi Server data repair: ${startupRepairs.join('; ')}`);
}

app.listen(config.PORT, config.HOST, () => {
  console.log(`Navi Server running on port ${config.PORT}`);
  startScheduler();
  // Retry any breakage alerts queued during a prior SMTP outage (fire-and-forget).
  replayPendingAlerts().catch(() => {});
});