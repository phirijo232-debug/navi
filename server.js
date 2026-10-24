require('dotenv').config();
const express = require('express');
const path = require('path');
const config = require('./config');
const { logError, logAccess, replayPendingAlerts } = require('./middleware/logger');
const { helmet, deviceAuth, rateLimiter, authRateLimiter, getServerMode } = require('./middleware/security');
const { verifyOTP, sendOTP } = require('./middleware/otp');
const { trackSession } = require('./controllers/sessionController');
const { serveFile } = require('./controllers/fileController');
const routes = require('./routes');
const { startScheduler } = require('./scheduler');
const { ensureDataIntegrity } = require('./middleware/dataStore');
const { startHealthWatch } = require('./middleware/healthWatch');
const { errorAudit, captureOrigin, appendAudit } = require('./middleware/errorAudit');
const { isPrivateControlClient } = require('./middleware/localControl');
const { shareKeyGate } = require('./middleware/shareLinks');

const ADMIN_KEY = process.env.MASTER_KEY || config.SHUTDOWN_KEY || null;
const ADMIN_EMAIL = process.env.ADMIN_EMAILS || process.env.GMAIL_USER;

// DEPLOYMENT GATE (blocking): public deployment requires (a) signed-URL image
// serving — already implemented in middleware/signedUrl.js + fileController —
// and (b) hardened secrets: MASTER_KEY (vault/shutdown key, must no longer fall
// back to the hardcoded default) and SIGNING_SECRET (image-link signing; without
// it links die on every restart). Refuse to boot so a weak config can't go live.
if (String(process.env.PUBLIC_DEPLOY).toLowerCase() === 'true') {
  const missing = [];
  if (!process.env.MASTER_KEY || process.env.MASTER_KEY === 'phirii26') missing.push('MASTER_KEY');
  if (!process.env.SIGNING_SECRET) missing.push('SIGNING_SECRET');
  if (missing.length) {
    console.error(`Refusing to start: PUBLIC_DEPLOY=true needs ${missing.join(' and ')} set in .env (long random values).`);
    process.exit(1);
  }
}

const app = express();
app.disable('x-powered-by');
// PUBLIC: sit behind one reverse proxy (nginx/Caddy/cloudflare). Trust exactly
// one hop so req.ip / X-Forwarded-For resolve to the REAL client IP — rate
// limiting and audit logs are useless if everyone looks like the proxy. Never
// set `true` (trusts any spoofed X-Forwarded-For from the open internet).
app.set('trust proxy', 1);

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

// General limiter skips localhost AND /status: the dashboard polls status every
// 5s (per tab, forever) — on a public IP that would 429 itself away. /status is
// a tiny read-only public payload (PUBLIC_PATHS), so exempt it explicitly;
// auth-sensitive endpoints keep their stricter limits above.
app.use((req, res, next) => {
  const isLocalhost = ['127.0.0.1', '::1', '::ffff:127.0.0.1'].includes(req.ip);
  if (isLocalhost || req.path === '/status') return next();
  rateLimiter(req, res, next);
});

// Uploaded KYC / proof-of-payment images: served ONLY through the authenticated,
// ownership-checked handler below — NOT via the public static mount. Registered
// before express.static so a raw /uploads/<file> request never bypasses auth.
// Accepts either an x-device-token header user or a short-lived ?exp=&sig=
// signed link (public PCs open images via <a>, which cannot send headers).
// Raw ?token= is rejected inside serveFile.
app.get('/uploads/:filename', serveFile);

// Option A public share links: key gate MUST run before express.static —
// static answers publicly, so a gate after it would never fire. Only HTML
// page loads are checked; APIs, assets, /status, /health and invite
// validation pass through. /signin.html is an alias of login.html (no
// duplicate file). Both mount before deviceAuth so public visitors can
// reach the login page with a valid ?key=.
app.use(shareKeyGate);
app.get('/signin.html', (req, res) => {
  res.sendFile(path.join(__dirname, 'public', 'login.html'));
});
app.use(express.static(path.join(__dirname, 'public')));

function hasValidAdminKey(req) {
  const headerKey = req.headers['x-admin-key'] || req.headers['x-shutdown-key'];
  const bodyKey = req.body && (req.body.password || req.body.masterKey);
  return Boolean(headerKey && headerKey === ADMIN_KEY) || Boolean(bodyKey && bodyKey === ADMIN_KEY);
}

app.post('/vault/request', async (req, res) => {
  try {
    if (!isPrivateControlClient(req.ip)) {
      logError(`VAULT REQUEST BLOCKED — public-network request from ${req.ip}`);
      return res.status(403).json({ error: 'Vault access is available only from the private network.' });
    }
    const { password } = req.body || {};
    const submittedKey = password || req.headers['x-admin-key'] || req.headers['x-shutdown-key'];
    if (!ADMIN_KEY || !submittedKey || submittedKey !== ADMIN_KEY) {
      logError(`VAULT REQUEST BLOCKED — invalid master key from ${req.ip}`);
      return res.status(403).json({ error: 'Invalid master key.' });
    }
    await sendOTP('Vault Access', ADMIN_EMAIL);
    return res.json({ message: 'Vault OTP sent to the configured admin email.' });
  } catch (err) {
    logError(`VAULT REQUEST FAILED: ${err.message}`);
    return res.status(503).json({ error: 'Vault request failed.' });
  }
});

app.post('/vault/authorize', (req, res) => {
  try {
    if (!isPrivateControlClient(req.ip)) {
      logError(`VAULT AUTH BLOCKED — public-network request from ${req.ip}`);
      return res.status(403).json({ error: 'Vault access is available only from the private network.' });
    }
    const { password, otp } = req.body || {};
    const submittedKey = password || req.headers['x-admin-key'] || req.headers['x-shutdown-key'];
    if (!ADMIN_KEY || !submittedKey || submittedKey !== ADMIN_KEY) {
      return res.status(403).json({ error: 'Invalid master key.' });
    }
    const result = verifyOTP(otp, ADMIN_EMAIL, 'Vault Access');
    if (!result.valid) {
      return res.status(400).json({ error: result.message });
    }
    return res.json({ authorized: true, message: 'Vault access approved.' });
  } catch (err) {
    logError(`VAULT AUTH FAILED: ${err.message}`);
    return res.status(503).json({ error: 'Vault authorization failed.' });
  }
});

app.post('/internal-shutdown', (req, res) => {
  if (!isPrivateControlClient(req.ip)) {
    logError(`UNAUTHORIZED SHUTDOWN ATTEMPT from public IP ${req.ip}`);
    return res.status(403).send('Denied');
  }
  const key = req.headers['x-admin-key'] || req.headers['x-shutdown-key'];
  if (!ADMIN_KEY || key !== ADMIN_KEY) {
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
  const origin = captureOrigin(err);
  logError(`[${origin}] UNCAUGHT ERROR: ${err.stack || err.message}`, true);
  appendAudit(origin, err?.message || String(err), { source: 'uncaughtException' });
});

app.use((req, res) => {
  if (req.url === '/favicon.ico' || req.url.startsWith('/.well-known')) {
    return res.status(204).end();
  }
  const msg = `UNKNOWN ROUTE: ${req.method} ${req.url} from ${req.ip}`;
  logError(msg);
  res.status(404).send('Route not found');
});

// IMMUNE + provenance: every failure that reaches the error pipeline is logged
// with its origin (file:line handler) and a dedicated audit line, then returns
// the same user-facing 500. Registered last so it only catches unhandled errors.
app.use(errorAudit);

const startupRepairs = ensureDataIntegrity();
if (startupRepairs.length) {
  console.warn(`Navi Server data repair: ${startupRepairs.join('; ')}`);
}

app.listen(config.PORT, config.HOST, () => {
  console.log(`Navi Server running on port ${config.PORT}`);
  const mode = typeof getServerMode === 'function' ? getServerMode() : 'private';
  console.log(`[server-mode] started in ${mode.toUpperCase()} mode`);
  startScheduler();
  // IMMUNE: start heartbeat + outage detection (also fires the boot-time
  // "server was offline" catch-up alert if the previous run died).
  try {
    startHealthWatch();
  } catch (err) {
    console.error(`Health watch failed to start: ${err.message}`);
  }
  // Retry any breakage alerts queued during a prior SMTP outage (fire-and-forget).
  replayPendingAlerts().catch(() => {});
});
