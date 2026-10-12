const fs = require('fs');
const path = require('path');
const { getLoansData } = require('./loanController');
const { findUserByDeviceToken } = require('../middleware/security');
const { canAccessRecord, isAdminRole } = require('../middleware/storeScope');
const { logError } = require('../middleware/logger');

const UPLOAD_DIR = path.join(__dirname, '../public/uploads');
const ALLOWED_EXT = new Set(['.jpg', '.jpeg', '.png', '.webp', '.gif']);

// Strict allowlist: reject traversal, separators, and non-image extensions.
function safeFilename(raw) {
  if (!raw || typeof raw !== 'string') return null;
  let name;
  try { name = decodeURIComponent(raw); } catch { return null; }
  if (name.includes('/') || name.includes('\\') || name.includes('..')) return null;
  if (path.basename(name) !== name) return null;
  const ext = path.extname(name).toLowerCase();
  if (!ALLOWED_EXT.has(ext)) return null;
  return name;
}

// Resolve the requester: prefer the deviceAuth-populated req.authUser, else fall
// back to a header token or a scoped ?token= (needed because <a> navigation
// cannot attach an x-device-token header).
function resolveAuthUser(req) {
  if (req.authUser && req.authUser.email) return req.authUser;
  const token = req.headers['x-device-token'] || req.query?.token;
  return findUserByDeviceToken(token);
}

// A file may only be viewed if it is referenced by a loan the requester may see:
// the borrower who owns it, or an admin whose store scope covers it.
function canViewFile(user, filename) {
  if (!user) return false;
  const requester = String(user.email || '').trim().toLowerCase();
  const admin = isAdminRole(user.role);
  return getLoansData().some(loan => {
    const referenced = loan.collateralFront === filename
      || loan.collateralBack === filename
      || (Array.isArray(loan.payments) && loan.payments.some(p => p.screenshot === filename));
    if (!referenced) return false;
    if (admin) return canAccessRecord({ authUser: user, headers: {} }, loan);
    return String(loan.email || '').trim().toLowerCase() === requester;
  });
}

function serveFile(req, res) {
  try {
    const filename = safeFilename(req.params.filename);
    if (!filename) {
      return res.status(400).send('Invalid file.');
    }
    const abs = path.join(UPLOAD_DIR, filename);
    if (!abs.startsWith(UPLOAD_DIR + path.sep) || !fs.existsSync(abs)) {
      return res.status(404).send('Not found.');
    }
    const user = resolveAuthUser(req);
    if (!canViewFile(user, filename)) {
      logError(`FILE ACCESS DENIED: ${filename} for ${user?.email || 'unknown'} from ${req.ip}`);
      return res.status(403).send('Access denied.');
    }
    // Mitigate URL leakage of the scoped ?token=: never cache the response and
    // don't leak the URL via Referer. (Full fix = signed URLs before public deploy.)
    res.set('Cache-Control', 'private, no-store');
    res.set('Referrer-Policy', 'no-referrer');
    if (req.query?.token) {
      logError(`FILE ACCESS VIA URL TOKEN: ${filename} for ${user?.email || 'unknown'} from ${req.ip} (LAN-only mitigation; replace ?token= with signed URLs before public deploy)`);
    }
    return res.sendFile(abs);
  } catch (err) {
    logError(`FILE SERVE FAILED: ${err.message}`);
    return res.status(500).send('Unable to serve file.');
  }
}

module.exports = { serveFile, safeFilename, canViewFile };
