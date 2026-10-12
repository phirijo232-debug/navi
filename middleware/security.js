const fs = require('fs');
const path = require('path');
const helmet = require('helmet');
const rateLimit = require('express-rate-limit');
const { logError } = require('./logger');
const config = require('../config');
const dataStore = require('./dataStore');

const USERS_FILE = dataStore.paths.users;

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
const PUBLIC_PATHS = new Set([
  '/signup',
  '/signup/confirm',
  '/signup/resend',
  '/login',
  '/login/confirm',
  '/password-reset',
  '/password-reset/confirm',
  '/status',
  '/favicon.ico'
]);

function deviceAuth(req, res, next) {
  if (PUBLIC_PATHS.has(req.path)) {
    return next();
  }

  const ip = req.ip;
  const token = req.headers['x-device-token'];
  const isPrivate = isPrivateIp(ip);

  if (!isPrivate) {
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

module.exports = { helmet, deviceAuth, rateLimiter, authRateLimiter, checkMasterPassword, findUserByDeviceToken };