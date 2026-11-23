'use strict';

const { logError } = require('../middleware/logger');
const { findUserByDeviceToken } = require('../middleware/security');
const { isAdminRole } = require('../middleware/storeScope');
const license = require('../middleware/prymeLogLicense');

function getBranding(req, res) {
  try {
    res.set('Cache-Control', 'no-store');
    return res.json(license.publicBranding());
  } catch (err) {
    logError(`BRANDING CIRCUIT TRIPPED: ${err.message}`);
    return res.status(503).json({ error: 'Branding is temporarily unavailable.' });
  }
}

function getBrandingLogo(req, res) {
  try {
    const file = license.cachedLogoFile();
    if (!file) return res.status(404).json({ error: 'No company logo is cached yet.' });
    res.set('Cache-Control', 'private, max-age=300');
    return res.sendFile(file);
  } catch (err) {
    logError(`LICENSE LOGO CIRCUIT TRIPPED: ${err.message}`);
    return res.status(503).json({ error: 'Company logo is temporarily unavailable.' });
  }
}

async function resumeLogin(req, res) {
  try {
    const token = req.headers['x-device-token'] || (req.body && req.body.deviceToken);
    const user = findUserByDeviceToken(token);
    if (!user) return res.status(401).json({ error: 'Sign in again.' });
    const decision = await license.gateSession(license.readInstallId(req), license.readDeviceLabel(req));
    if (!decision.allowed) {
      logError(`LICENSE BLOCKED: ${decision.code || 'UNKNOWN'}`);
      return res.status(403).json({ error: decision.message, code: decision.code, license: true });
    }
    return res.json({
      ok: true,
      role: user.role,
      email: user.email,
      username: user.username,
      storeId: user.storeId || null,
      warn: Boolean(decision.warn),
      daysLeft: Number.isFinite(Number(decision.daysLeft)) ? Number(decision.daysLeft) : null
    });
  } catch (err) {
    logError(`RESUME LOGIN CIRCUIT TRIPPED: ${err.message}`);
    return res.status(503).json({ error: 'Sign-in is temporarily unavailable.' });
  }
}

function getLicenseStatus(req, res) {
  try {
    if (!isAdminRole(req.authUser && req.authUser.role)) {
      return res.status(403).json({ error: 'Forbidden.' });
    }
    return res.json(license.licenseStatus(license.readInstallId(req)));
  } catch (err) {
    logError(`LICENSE STATUS CIRCUIT TRIPPED: ${err.message}`);
    return res.status(503).json({ error: 'License status is temporarily unavailable.' });
  }
}

module.exports = { getBranding, getBrandingLogo, resumeLogin, getLicenseStatus };
