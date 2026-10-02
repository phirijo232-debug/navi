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
  return role === 'store_admin' && getRecordStoreId(req.authUser) === storeId;
}

function canAccessRecord(req, record) {
  return canAccessStore(req, getRecordStoreId(record));
}

function isAdminRole(role) {
  return role === 'admin' || role === 'store_admin';
}

module.exports = { getRecordStoreId, getRequestedStoreId, canAccessStore, canAccessRecord, isAdminRole };
