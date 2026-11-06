'use strict';

// Permission groups are feature metadata only. They never change req.authUser.role,
// store scope, or any of the existing authorization gates.
const path = require('path');
const crypto = require('crypto');
const config = require('../config');
const dataStore = require('../middleware/dataStore');
const { logError } = require('../middleware/logger');
const { getRecordStoreId, getRequestedStoreId, canAccessStore, isFranchiseAdmin } = require('../middleware/storeScope');
const auditGuardian = require('../middleware/auditLog');

const GROUPS_FILE = path.join(dataStore.DATA_DIR, 'permissionGroups.json');
const PERMISSION_KEYS = Object.freeze([
  'bulk_notify', 'generate_invite', 'view_revenue', 'generate_reports',
  'create_users', 'view_premium_customers', 'force_loan_close'
]);
const BUILTIN_GROUP = Object.freeze({
  id: 'builtin:franchise_admin', name: 'Franchise Admin', description: 'Built-in franchise administration group.',
  builtIn: true, locked: true, role: 'franchise_admin', storeId: null,
  permissions: Object.freeze(Object.fromEntries(PERMISSION_KEYS.map(key => [key, true])))
});
const STORE_ADMIN_DEFAULTS = Object.freeze({
  bulk_notify: true, generate_invite: true, view_revenue: false, generate_reports: true,
  create_users: false, view_premium_customers: false, force_loan_close: false
});
const CUSTOMER_DEFAULTS = Object.freeze(Object.fromEntries(PERMISSION_KEYS.map(key => [key, false])));

function readGroups() {
  const raw = dataStore.readJson(GROUPS_FILE, [], value => Array.isArray(value));
  // The fixed group is canonical in code, so it cannot be edited or removed by
  // a malformed/stale file. Keep only valid custom group records from storage.
  return [BUILTIN_GROUP, ...raw.filter(group => group && group.id !== BUILTIN_GROUP.id &&
    typeof group.id === 'string' && typeof group.name === 'string' && group.permissions &&
    PERMISSION_KEYS.every(key => typeof group.permissions[key] === 'boolean'))];
}

function writeGroups(groups) {
  dataStore.writeJson(GROUPS_FILE, groups.filter(group => group.id !== BUILTIN_GROUP.id));
}

function normalizePermissions(input, { partial = false } = {}) {
  if (!input || typeof input !== 'object' || Array.isArray(input)) return null;
  const keys = Object.keys(input);
  if (keys.some(key => !PERMISSION_KEYS.includes(key))) return null;
  if (!partial && PERMISSION_KEYS.some(key => !Object.prototype.hasOwnProperty.call(input, key))) return null;
  if (keys.some(key => typeof input[key] !== 'boolean')) return null;
  return Object.fromEntries(keys.map(key => [key, input[key]]));
}

function isReservedGroupName(name) {
  return String(name || '').toLowerCase().replace(/[^a-z]/g, '') === 'franchiseadmin';
}

function actorAllowed(req, res) {
  if (!isFranchiseAdmin(req.authUser?.role)) {
    res.status(403).json({ error: 'Only admin or franchise_admin can manage permission groups.' });
    return false;
  }
  return true;
}

function scopedStore(req, res, requested) {
  const storeId = String(requested || getRequestedStoreId(req) || '').trim().toLowerCase();
  if (!storeId || storeId === 'all' || !config.STORES.some(store => store.id === storeId) || !canAccessStore(req, storeId)) {
    res.status(403).json({ error: 'Access to this store is not allowed.' });
    return null;
  }
  return storeId;
}

function readUsers() {
  return dataStore.readJson(dataStore.paths.users, [], value => Array.isArray(value));
}

function getEffectivePermissions(user) {
  if (user?.role === 'admin' || user?.role === 'franchise_admin') {
    return Object.fromEntries(PERMISSION_KEYS.map(key => [key, true]));
  }
  const base = user?.role === 'store_admin' ? STORE_ADMIN_DEFAULTS : CUSTOMER_DEFAULTS;
  const groups = readGroups();
  const group = groups.find(item => item.id === user?.permissionGroupId && item.storeId === getRecordStoreId(user));
  const storedOverrides = user?.permissionOverrides && typeof user.permissionOverrides === 'object' ? user.permissionOverrides : {};
  const effectivePermissions = { ...base, ...(group?.permissions || {}), ...storedOverrides };
  return Object.fromEntries(PERMISSION_KEYS.map(key => [key, effectivePermissions[key] === true]));
}

function safeEmployee(user, groups) {
  const base = user.role === 'store_admin' ? STORE_ADMIN_DEFAULTS : CUSTOMER_DEFAULTS;
  const group = groups.find(item => item.id === user.permissionGroupId && item.storeId === getRecordStoreId(user));
  const effectivePermissions = { ...base, ...(group?.permissions || {}), ...(user.permissionOverrides || {}) };
  return {
    id: user.id, username: user.username, email: user.email, role: user.role,
    storeId: getRecordStoreId(user), permissionGroupId: group?.id || null,
    permissionGroupName: group?.name || null,
    permissions: Object.fromEntries(PERMISSION_KEYS.map(key => [key, effectivePermissions[key] === true]))
  };
}

function getMySecurity(req, res) {
  try {
    if (!req.authUser) return res.status(401).json({ error: 'Sign in to view your security settings.' });
    const user = readUsers().find(item => String(item.email || '').toLowerCase() === String(req.authUser.email || '').toLowerCase());
    const permissions = getEffectivePermissions(user || req.authUser);
    return res.json({ role: req.authUser.role, storeId: getRecordStoreId(user || req.authUser), permissions });
  } catch (err) {
    logError(`SECURITY GET MY PERMISSIONS FAILED: ${err.message}`);
    return res.status(503).json({ error: 'Unable to load your security settings.' });
  }
}

function setCustomerPremium(req, res) {
  try {
    if (!isFranchiseAdmin(req.authUser?.role)) return res.status(403).json({ error: 'Only admin or franchise_admin can manage premium customer status.' });
    if (typeof req.body?.premiumProtected !== 'boolean') return res.status(400).json({ error: 'premiumProtected must be true or false.' });
    const users = readUsers();
    const index = users.findIndex(user => String(user.id) === String(req.params.id) || String(user.email || '').toLowerCase() === String(req.params.id).toLowerCase());
    if (index < 0) return res.status(404).json({ error: 'Customer not found.' });
    const target = users[index];
    if (target.role !== 'user') return res.status(400).json({ error: 'Premium protection can only be set on customer accounts.' });
    if (!canAccessStore(req, getRecordStoreId(target))) return res.status(403).json({ error: 'Access to this customer is not allowed.' });
    target.premiumProtected = req.body.premiumProtected;
    users[index] = target;
    dataStore.writeJson(dataStore.paths.users, users);
    auditGuardian.writeAudit({ action: 'PREMIUM_CUSTOMER_UPDATED', actor: req.authUser.email || req.authUser.username, targetId: target.id || target.email, ip: req.ip, detail: { storeId: getRecordStoreId(target), premiumProtected: target.premiumProtected } });
    return res.json({ customer: { id: target.id, username: target.username, email: target.email, storeId: getRecordStoreId(target), premiumProtected: target.premiumProtected } });
  } catch (err) {
    logError(`SECURITY UPDATE PREMIUM CUSTOMER FAILED: ${err.message}`);
    return res.status(503).json({ error: 'Unable to update premium customer status.' });
  }
}

function listPermissionGroups(req, res) {
  try {
    if (!actorAllowed(req, res)) return;
    const storeId = scopedStore(req, res, req.query?.storeId);
    if (!storeId) return;
    res.json({ groups: readGroups().filter(group => group.builtIn || group.storeId === storeId) });
  } catch (err) {
    logError(`SECURITY LIST GROUPS FAILED: ${err.message}`);
    res.status(503).json({ error: 'Unable to load permission groups.' });
  }
}

function createPermissionGroup(req, res) {
  try {
    if (!actorAllowed(req, res)) return;
    const body = req.body || {};
    const storeId = scopedStore(req, res, body.storeId);
    if (!storeId) return;
    if (Object.keys(body).some(key => !['name', 'description', 'permissions', 'storeId'].includes(key))) {
      return res.status(400).json({ error: 'Group contains unsupported fields.' });
    }
    const name = String(body.name || '').trim();
    if (!name || name.length > 60 || isReservedGroupName(name)) {
      return res.status(400).json({ error: 'Enter a group name up to 60 characters. The built-in Franchise Admin name is reserved.' });
    }
    const permissions = normalizePermissions(body.permissions);
    if (!permissions) return res.status(400).json({ error: 'Provide boolean values for exactly the supported permission keys.' });
    const description = String(body.description || '').trim();
    if (description.length > 240) return res.status(400).json({ error: 'Description must be 240 characters or fewer.' });
    const groups = readGroups();
    if (groups.some(group => group.storeId === storeId && group.name.toLowerCase() === name.toLowerCase())) {
      return res.status(409).json({ error: 'A permission group with that name already exists in this store.' });
    }
    const group = { id: `group:${crypto.randomUUID()}`, name, description, builtIn: false, locked: false, role: 'store_admin', storeId, permissions, createdAt: new Date().toISOString(), createdBy: req.authUser.email || req.authUser.username };
    groups.push(group);
    writeGroups(groups);
    auditGuardian.writeAudit({ action: 'PERMISSION_GROUP_CREATED', actor: req.authUser.email || req.authUser.username, targetId: group.id, ip: req.ip, detail: { storeId, groupName: name } });
    res.status(201).json({ group });
  } catch (err) {
    logError(`SECURITY CREATE GROUP FAILED: ${err.message}`);
    res.status(503).json({ error: 'Unable to create permission group.' });
  }
}

function updatePermissionGroup(req, res) {
  try {
    if (!actorAllowed(req, res)) return;
    const groups = readGroups();
    const index = groups.findIndex(group => group.id === String(req.params.id));
    if (index < 0) return res.status(404).json({ error: 'Permission group not found.' });
    const current = groups[index];
    if (current.builtIn || current.id === BUILTIN_GROUP.id) return res.status(403).json({ error: 'The built-in Franchise Admin group is locked and cannot be edited.' });
    if (!scopedStore(req, res, current.storeId)) return;
    const body = req.body || {};
    if (Object.keys(body).some(key => !['name', 'description', 'permissions'].includes(key))) return res.status(400).json({ error: 'Group contains unsupported fields.' });
    if (body.name !== undefined) {
      const name = String(body.name).trim();
      if (!name || name.length > 60 || isReservedGroupName(name)) return res.status(400).json({ error: 'Invalid or reserved group name.' });
      if (groups.some((group, i) => i !== index && group.storeId === current.storeId && group.name.toLowerCase() === name.toLowerCase())) return res.status(409).json({ error: 'A permission group with that name already exists in this store.' });
      current.name = name;
    }
    if (body.description !== undefined) {
      const description = String(body.description).trim();
      if (description.length > 240) return res.status(400).json({ error: 'Description must be 240 characters or fewer.' });
      current.description = description;
    }
    if (body.permissions !== undefined) {
      const permissions = normalizePermissions(body.permissions);
      if (!permissions || PERMISSION_KEYS.some(key => !(key in permissions))) return res.status(400).json({ error: 'Provide boolean values for exactly the supported permission keys.' });
      current.permissions = permissions;
    }
    current.updatedAt = new Date().toISOString();
    current.updatedBy = req.authUser.email || req.authUser.username;
    groups[index] = current;
    writeGroups(groups);
    auditGuardian.writeAudit({ action: 'PERMISSION_GROUP_UPDATED', actor: req.authUser.email || req.authUser.username, targetId: current.id, ip: req.ip, detail: { storeId: current.storeId, groupName: current.name } });
    res.json({ group: current });
  } catch (err) {
    logError(`SECURITY UPDATE GROUP FAILED: ${err.message}`);
    res.status(503).json({ error: 'Unable to update permission group.' });
  }
}

function deletePermissionGroup(req, res) {
  try {
    if (!actorAllowed(req, res)) return;
    const groups = readGroups();
    const group = groups.find(item => item.id === String(req.params.id));
    if (!group) return res.status(404).json({ error: 'Permission group not found.' });
    if (group.builtIn || group.id === BUILTIN_GROUP.id) return res.status(403).json({ error: 'The built-in Franchise Admin group is locked and cannot be deleted.' });
    if (!scopedStore(req, res, group.storeId)) return;
    const users = readUsers();
    if (users.some(user => user.permissionGroupId === group.id)) return res.status(409).json({ error: 'Move employees to another group before deleting this group.' });
    writeGroups(groups.filter(item => item.id !== group.id));
    auditGuardian.writeAudit({ action: 'PERMISSION_GROUP_DELETED', actor: req.authUser.email || req.authUser.username, targetId: group.id, ip: req.ip, detail: { storeId: group.storeId, groupName: group.name } });
    res.json({ message: 'Permission group deleted.' });
  } catch (err) {
    logError(`SECURITY DELETE GROUP FAILED: ${err.message}`);
    res.status(503).json({ error: 'Unable to delete permission group.' });
  }
}

function getEmployeeSecurity(req, res) {
  try {
    if (!actorAllowed(req, res)) return;
    const id = String(req.params.id);
    const users = readUsers();
    const target = users.find(user => String(user.id) === id || String(user.email || '').toLowerCase() === id.toLowerCase());
    if (!target) return res.status(404).json({ error: 'Employee not found.' });
    if (!canAccessStore(req, getRecordStoreId(target))) return res.status(403).json({ error: 'Access to this employee is not allowed.' });
    res.json({ employee: safeEmployee(target, readGroups()) });
  } catch (err) {
    logError(`SECURITY GET EMPLOYEE FAILED: ${err.message}`);
    res.status(503).json({ error: 'Unable to load employee security settings.' });
  }
}

function listEmployeeSecurity(req, res) {
  try {
    if (!actorAllowed(req, res)) return;
    const storeId = scopedStore(req, res, req.query?.storeId);
    if (!storeId) return;
    const groups = readGroups();
    const employees = readUsers()
      .filter(user => ['admin', 'franchise_admin', 'store_admin'].includes(user.role))
      .filter(user => req.authUser.role === 'admin' || getRecordStoreId(user) === storeId)
      .map(user => safeEmployee(user, groups));
    res.json({ employees, groups: groups.filter(group => group.builtIn || group.storeId === storeId) });
  } catch (err) {
    logError(`SECURITY LIST EMPLOYEES FAILED: ${err.message}`);
    res.status(503).json({ error: 'Unable to load employee security settings.' });
  }
}

function updateEmployeeSecurity(req, res) {
  try {
    if (!actorAllowed(req, res)) return;
    const body = req.body || {};
    if (Object.keys(body).some(key => !['permissionGroupId', 'permissionOverrides'].includes(key))) return res.status(400).json({ error: 'Only permissionGroupId and permissionOverrides can be updated.' });
    const users = readUsers();
    const index = users.findIndex(user => String(user.id) === String(req.params.id) || String(user.email || '').toLowerCase() === String(req.params.id).toLowerCase());
    if (index < 0) return res.status(404).json({ error: 'Employee not found.' });
    const target = users[index];
    if (!canAccessStore(req, getRecordStoreId(target))) return res.status(403).json({ error: 'Access to this employee is not allowed.' });
    if (target.role !== 'store_admin') return res.status(403).json({ error: 'Permission groups are only assignable to store_admin employees. Account roles are managed separately.' });
    const groups = readGroups();
    if (body.permissionGroupId !== undefined) {
      if (body.permissionGroupId === null || body.permissionGroupId === '') delete target.permissionGroupId;
      else {
        const group = groups.find(item => item.id === String(body.permissionGroupId));
        if (!group || group.builtIn || group.storeId !== getRecordStoreId(target)) return res.status(400).json({ error: 'Choose a custom group assigned to this employee’s store.' });
        target.permissionGroupId = group.id;
      }
    }
    if (body.permissionOverrides !== undefined) {
      const overrides = normalizePermissions(body.permissionOverrides, { partial: true });
      if (!overrides) return res.status(400).json({ error: 'Permission overrides may contain only supported keys with boolean values.' });
      target.permissionOverrides = overrides;
    }
    users[index] = target;
    dataStore.writeJson(dataStore.paths.users, users);
    auditGuardian.writeAudit({ action: 'PERMISSION_GROUP_ASSIGNED', actor: req.authUser.email || req.authUser.username, targetId: target.id || target.email, ip: req.ip, detail: { storeId: getRecordStoreId(target), groupId: target.permissionGroupId || null } });
    res.json({ employee: safeEmployee(target, groups) });
  } catch (err) {
    logError(`SECURITY UPDATE EMPLOYEE FAILED: ${err.message}`);
    res.status(503).json({ error: 'Unable to update employee security settings.' });
  }
}

module.exports = {
  PERMISSION_KEYS, BUILTIN_GROUP, getEffectivePermissions, getMySecurity, setCustomerPremium,
  listPermissionGroups, createPermissionGroup, updatePermissionGroup, deletePermissionGroup,
  listEmployeeSecurity, getEmployeeSecurity, updateEmployeeSecurity
};
