const config = require('../config');

function getRecordStoreId(record = {}) {
  return record.storeId || config.DEFAULT_STORE_ID;
}

function getRequestedStoreId(req) {
  return String(
    req.headers?.['x-business-unit'] ||
    req.query?.storeId ||
    req.body?.storeId ||
    req.authUser?.storeId ||
    config.DEFAULT_STORE_ID
  ).trim().toLowerCase();
}

function canAccessStore(req, storeId = getRequestedStoreId(req)) {
  const role = req.authUser?.role;
  if (role === 'admin') return true;
  // Franchise Employee Admin and the restricted store admin are both scoped to
  // the store they belong to; only the main admin spans every subsidiary.
  if (role === 'franchise_admin' || role === 'store_admin') {
    return getRecordStoreId(req.authUser) === storeId;
  }
  return false;
}

function canAccessRecord(req, record) {
  return canAccessStore(req, getRecordStoreId(record));
}

function isAdminRole(role) {
  return role === 'admin' || role === 'franchise_admin' || role === 'store_admin';
}

// Roles permitted to perform HR / employee-management actions and to receive the
// store-switch OTP: the main admin and the Franchise Employee Admin. The
// restricted store_admin is deliberately excluded.
function isFranchiseAdmin(role) {
  return role === 'admin' || role === 'franchise_admin';
}

module.exports = { getRecordStoreId, getRequestedStoreId, canAccessStore, canAccessRecord, isAdminRole, isFranchiseAdmin };
