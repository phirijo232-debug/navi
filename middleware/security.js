const fs = require('fs');
const path = require('path');
const helmet = require('helmet');
const rateLimit = require('express-rate-limit');
const { logError } = require('./logger');
const config = require('../config');
const dataStore = require('./dataStore');
const { isFranchiseAdmin } = require('./storeScope');

const USERS_FILE = dataStore.paths.users;

// ─── Public/private server-mode toggle ───────────────────────────────────────
// PRIVATE (default): deviceAuth only accepts LAN IPs. PUBLIC: the server is
// internet-reachable, but device-token auth STILL applies to every non-public
// route — public mode widens reach, it never drops authentication. Only a
// franchise-manager admin (isFranchiseManager) may flip it; the choice is
// persisted to data/serverMode.json so it survives restarts.
const SERVER_MODE_FILE = path.join(dataStore.DATA_DIR, 'serverMode.json');
let serverMode = 'private';

function loadServerMode() {
  try {
    const saved = dataStore.readJson(
      SERVER_MODE_FILE,
      null,
      value => value && (value.mode === 'public' || value.mode === 'private')
    );
    if (saved && (saved.mode === 'public' || saved.mode === 'private')) {
      serverMode = saved.mode;
      return serverMode;
    }
  } catch { /* fall through to env/default */ }
  serverMode = String(process.env.SERVER_MODE).toLowerCase() === 'public' ? 'public' : 'private';
  return serverMode;
}

function getServerMode() {
  return serverMode;
}

function setServerMode(mode) {
  if (mode !== 'public' && mode !== 'private') return false;
  serverMode = mode;
  try {
    dataStore.writeJson(SERVER_MODE_FILE, { mode, updatedAt: new Date().toISOString() });
  } catch (err) {
    logError(`SERVER MODE SAVE FAILED: ${err.message}`);
  }
  return true;
}

// Only a franchise-manager admin — email in the allow-list AND an admin/franchise
// role — may flip the public/private server mode. A bare trusted-device token
// (no user) never qualifies.
function isFranchiseManager(user) {
  if (!user || !user.email) return false;
  const email = String(user.email).toLowerCase();
  return config.FRANCHISE_MANAGER_EMAILS.includes(email) && isFranchiseAdmin(user.role);
}

loadServerMode();

function getUsers() {
  return dataStore.readJson(USERS_FILE, [], Array.isArray);
}

function saveUsers(users) {
  try {
    dataStore.writeJson(USERS_FILE, users);
  } catch (err) {
    logError(`USER SAVE FAILED: ${err.message}`);
  }
}

function normalizeIp(ip) {
  if (!ip) return '';
  if (ip.startsWith('::ffff:')) {
    return ip.slice(7);
  }
  return ip;
}

function isPrivateIp(ip) {
  const normalized = normalizeIp(ip);
  if (normalized === '127.0.0.1' || normalized === '::1') return true;
  if (/^10\./.test(normalized)) return true;
  if (/^192\.168\./.test(normalized)) return true;
  if (/^172\.(1[6-9]|2[0-9]|3[0-1])\./.test(normalized)) return true;
  if (/^fc00:/i.test(normalized) || /^fd00:/i.test(normalized)) return true;
  return false;
}

function findUserByDeviceToken(token) {
  if (!token) return null;
  const users = getUsers();
  return users.find(user => user.trustedDevices?.some(device => device.token === token));
}

function updateDeviceActivity(token, ip) {
  const users = getUsers();
  const userIndex = users.findIndex(user => user.trustedDevices?.some(device => device.token === token));
  if (userIndex < 0) return null;
  const device = users[userIndex].trustedDevices.find(device => device.token === token);
  if (!device) return null;

  device.lastSeen = new Date().toISOString();
  device.ip = ip;
  saveUsers(users);
  return users[userIndex];
}

// ─── Failed attempts tracker ───────────
const failedAttempts = {};

// ─── Master password check ─────────────
function checkMasterPassword(password) {
  const now = Date.now();
  const record = failedAttempts['master'] || { count: 0, lockedUntil: 0 };

  if (record.lockedUntil > now) {
    const minutesLeft = Math.ceil((record.lockedUntil - now) / 60000);
    return { allowed: false, message: `Locked. Try again in ${minutesLeft} minutes.` };
  }

  if (password !== process.env.MASTER_KEY) {
    record.count += 1;
    if (record.count >= 3) {
      record.lockedUntil = now + 45 * 60 * 1000;
      record.count = 0;
      logError('MASTER PASSWORD LOCKED — too many failed attempts');
    }
    failedAttempts['master'] = record;
    return { allowed: false, message: 'Wrong password.' };
  }

  failedAttempts['master'] = { count: 0, lockedUntil: 0 };
  return { allowed: true };
}

// ─── Token + IP check ──────────────────
const PUBLIC_PATHS = new Set(config.PUBLIC_PATHS || [
  '/signup',
  '/signup/confirm',
  '/signup/resend',
  '/login',
  '/login/confirm',
  '/password-reset',
  '/password-reset/confirm',
  '/status',
  '/health',
  '/favicon.ico',
  '/invites/validate'
]);

function isPublicPath(path) {
  if (PUBLIC_PATHS.has(path)) return true;
  if (path.startsWith('/invites/validate/')) return true;
  return false;
}

function deviceAuth(req, res, next) {
  if (isPublicPath(req.path)) {
    return next();
  }

  const ip = req.ip;
  const token = req.headers['x-device-token'];
  const isPrivate = isPrivateIp(ip);

  // PRIVATE (default): only LAN IPs may reach authenticated routes. PUBLIC: the
  // server is internet-reachable, but device-token auth still applies below —
  // public mode widens reach, it never drops authentication.
  if (!isPrivate && getServerMode() !== 'public') {
    logError(`BLOCKED — non-local IP access attempt from ${ip}`);
    return res.status(403).send('Access denied. Connect from the local network or use a registered device token.');
  }

  if (!token) {
    logError(`BLOCKED — missing token from IP: ${ip}`);
    return res.status(403).send('Access denied. Device token is required.');
  }

  const user = findUserByDeviceToken(token);
  const tokenAllowed = Boolean(user) || config.TRUSTED_TOKENS.includes(token);

  if (!tokenAllowed) {
    logError(`BLOCKED — invalid token from IP: ${ip}`);
    return res.status(403).send('Access denied.');
  }

  if (user) {
    req.authUser = updateDeviceActivity(token, ip);
  }

  next();
}

// ─── Rate limiter ──────────────────────
const rateLimiter = rateLimit({
  windowMs: 15 * 60 * 1000,
  max: 100,
  message: 'Too many requests. Slow down.',
  handler: (req, res) => {
    logError(`RATE LIMIT HIT: ${req.ip}`);
    res.status(429).send('Too many requests. Slow down.');
  }
});

// Strict limiter for brute-force-sensitive endpoints (login, signup, password
// reset, vault OTP). Applied to EVERY source IP — including localhost — so a
// local process cannot hammer these flows unchecked. Kept separate from the
// global limiter so the dashboard's frequent status polling is never throttled.
const authRateLimiter = rateLimit({
  windowMs: 15 * 60 * 1000,
  limit: 20,
  standardHeaders: true,
  legacyHeaders: false,
  handler: (req, res) => {
    logError(`AUTH RATE LIMIT HIT: ${req.method} ${req.path} from ${req.ip}`);
    res.status(429).json({ error: 'Too many attempts. Please wait a few minutes and try again.' });
  }
});

// Dedicated limiter for the public, unauthenticated GET /health endpoint.
// /health lives in PUBLIC_PATHS (deviceAuth skips it), so without its own cap a
// local/network actor could hammer it thousands of times a second and load the
// CPU. 60 requests per minute per IP is generous for an uptime monitor while
// still bounding floods. Kept separate from the global limiter so the
// dashboard's /status polling is unaffected.
const healthRateLimiter = rateLimit({
  windowMs: 60 * 1000,
  limit: 60,
  standardHeaders: true,
  legacyHeaders: false,
  handler: (req, res) => {
    res.status(429).json({ error: 'Too many health checks. Slow down.' });
  }
});

module.exports = { helmet, deviceAuth, rateLimiter, authRateLimiter, healthRateLimiter, checkMasterPassword, findUserByDeviceToken, getServerMode, setServerMode, isFranchiseManager, isPublicPath };