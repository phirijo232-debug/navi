const fs = require('fs');
const path = require('path');
const { getLoansData } = require('./loanController');
const { findUserByDeviceToken } = require('../middleware/security');
const { canAccessRecord, isAdminRole } = require('../middleware/storeScope');
const { logError } = require('../middleware/logger');
const { verifyUploadSig, signUploadQuery, TTL_SECONDS } = require('../middleware/signedUrl');

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

// Resolve the requester: prefer the deviceAuth-populated req.authUser, else the
// x-device-token header. <a> navigation cannot attach headers, so files are
// opened through short-lived signed URLs (see signUpload) — raw ?token= is
// rejected (it leaked the session into URLs/logs/proxies).
function resolveAuthUser(req) {
  if (req.authUser && req.authUser.email) return req.authUser;
  const token = req.headers['x-device-token'];
  if (!token) return null;
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
      || loan.nrcFront === filename
      || loan.nrcBack === filename
      || (Array.isArray(loan.paymentSubmissions) && loan.paymentSubmissions.some(s => s.screenshot === filename))
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
    // Raw ?token= device tokens are rejected — the session must never travel in
    // a URL (it lands in router/browser/proxy logs). Open via POST /uploads/sign.
    if (req.query && req.query.token !== undefined) {
      logError(`FILE ACCESS BLOCKED: raw ?token= rejected for ${filename} from ${req.ip}`);
      return res.status(403).send('Access denied. Request a signed link instead.');
    }
    // Signed-link opening (no header user): possession of a fresh, valid
    // signature for THIS file authorizes this one open (S3 presigned model).
    const { exp, sig } = req.query || {};
    if (exp !== undefined || sig !== undefined) {
      if (!verifyUploadSig(filename, exp, sig)) {
        logError(`FILE ACCESS DENIED (bad/expired signature): ${filename} from ${req.ip}`);
        return res.status(403).send('Access denied. The link is invalid or expired.');
      }
      res.set('Cache-Control', 'private, no-store');
      res.set('Referrer-Policy', 'no-referrer');
      return res.sendFile(abs);
    }
    const user = resolveAuthUser(req);
    if (!canViewFile(user, filename)) {
      logError(`FILE ACCESS DENIED: ${filename} for ${user?.email || 'unknown'} from ${req.ip}`);
      return res.status(403).send('Access denied.');
    }
    res.set('Cache-Control', 'private, no-store');
    res.set('Referrer-Policy', 'no-referrer');
    return res.sendFile(abs);
  } catch (err) {
    logError(`FILE SERVE FAILED: ${err.message}`);
    return res.status(503).send('Unable to serve file.');
  }
}

// Issue a short-lived signed link for ONE file, only AFTER the caller's
// ownership/store-scope check passes. Requires the device token in the header
// (deviceAuth already ran for this route) — req.authUser or header user.
async function signUpload(req, res) {
  try {
    const filename = safeFilename(req.body?.filename || req.query?.filename);
    if (!filename) {
      return res.status(400).json({ error: 'Valid filename is required.' });
    }
    const user = resolveAuthUser(req);
    if (!canViewFile(user, filename)) {
      logError(`SIGNED LINK DENIED: ${filename} for ${user?.email || 'unknown'} from ${req.ip}`);
      return res.status(403).json({ error: 'Access denied.' });
    }
    const { exp, sig } = signUploadQuery(filename);
    return res.json({
      url: `/uploads/${encodeURIComponent(filename)}?exp=${exp}&sig=${sig}`,
      expiresIn: TTL_SECONDS
    });
  } catch (err) {
    logError(`SIGNED LINK FAILED: ${err.message}`);
    return res.status(503).json({ error: 'Unable to sign the file link.' });
  }
}

module.exports = { serveFile, signUpload, safeFilename, canViewFile };
