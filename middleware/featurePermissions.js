'use strict';

const { getEffectivePermissions } = require('../controllers/securityController');
const { hasActiveApproval } = require('../controllers/accessApprovalController');
const dataStore = require('./dataStore');
const { getRecordStoreId } = require('./storeScope');

function requireFeatures(features) {
  const required = [...new Set(Array.isArray(features) ? features : [features])];
  return function featurePermissionGate(req, res, next) {
    try {
      const role = req.authUser?.role;
      // Main and Franchise Admin permissions are fixed and unrestricted within
      // the scope already enforced by the target controller.
      if (role === 'admin' || role === 'franchise_admin') return next();
      // Permission groups never grant base access to another role.
      if (role !== 'store_admin') return next();

      const permissions = getEffectivePermissions(req.authUser);
      const blocked = required.filter(feature => !permissions[feature] && !hasActiveApproval(req, feature));
      if (blocked.length) {
        const feature = blocked[0];
        return res.status(403).json({
          error: 'This feature is restricted for your account. Request temporary access from your Franchise Admin.',
          accessRequestRequired: true,
          feature,
          blockedFeatures: blocked
        });
      }
      return next();
    } catch {
      return res.status(503).json({ error: 'Unable to verify your feature permissions.' });
    }
  };
}

function requirePremiumReportVisibility(req, res, next) {
  try {
    if (req.authUser?.role !== 'store_admin') return next();
    const permissions = getEffectivePermissions(req.authUser);
    if (permissions.view_premium_customers || hasActiveApproval(req, 'view_premium_customers')) return next();
    const storeId = getRecordStoreId(req.authUser);
    const users = dataStore.readJson(dataStore.paths.users, [], Array.isArray);
    const hasPremiumCustomer = users.some(user => user.premiumProtected === true && getRecordStoreId(user) === storeId);
    if (!hasPremiumCustomer) return next();
    return res.status(403).json({
      error: 'This export includes restricted premium customer information. Request temporary access from your Franchise Admin.',
      accessRequestRequired: true,
      feature: 'view_premium_customers'
    });
  } catch {
    return res.status(503).json({ error: 'Unable to verify premium customer visibility.' });
  }
}

module.exports = { requireFeatures, requirePremiumReportVisibility };
