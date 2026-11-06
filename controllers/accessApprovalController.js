'use strict';

const path = require('path');
const crypto = require('crypto');
const dataStore = require('../middleware/dataStore');
const emailService = require('../middleware/email');
const otpService = require('../middleware/otp');
const { logError } = require('../middleware/logger');
const config = require('../config');
const { getRecordStoreId, canAccessStore, isFranchiseAdmin } = require('../middleware/storeScope');
const auditGuardian = require('../middleware/auditLog');

const FILE = path.join(dataStore.DATA_DIR, 'accessApprovals.json');
const TTL = 15 * 60 * 1000;
const REQUEST_TTL = 7 * 24 * 60 * 60 * 1000;
const FEATURES = Object.freeze([
  'bulk_notify', 'generate_invite', 'view_revenue', 'generate_reports',
  'create_users', 'view_premium_customers', 'force_loan_close'
]);

const identity = user => String(user?.email || user?.username || '').trim().toLowerCase();
const storeOf = user => getRecordStoreId(user || {});
const read = () => dataStore.readJson(FILE, [], Array.isArray);
const write = items => dataStore.writeJson(FILE, items);

function expire(items, now = Date.now()) {
  let changed = false;
  for (const item of items) {
    if ((item.status === 'approved' && Date.parse(item.expiresAt) <= now) ||
        (item.status === 'pending' && Date.parse(item.requestExpiresAt) <= now)) {
      item.status = 'expired';
      item.expiredAt = new Date(now).toISOString();
      changed = true;
    }
  }
  return changed;
}

function safe(item) {
  return {
    id: item.id, feature: item.feature, status: item.status, storeId: item.storeId,
    requesterId: item.requesterId, requesterName: item.requesterName,
    requestedAt: item.requestedAt, requestExpiresAt: item.requestExpiresAt,
    decidedAt: item.decidedAt || null, decidedBy: item.decidedBy || null,
    expiresAt: item.expiresAt || null, reason: item.reason || '',
    decisionReason: item.decisionReason || ''
  };
}

function recipients(storeId) {
  const users = dataStore.readJson(dataStore.paths.users, [], Array.isArray);
  return [...new Set(users
    .filter(user => user.role === 'franchise_admin' && storeOf(user) === storeId)
    .map(user => String(user.email || '').trim().toLowerCase())
    .filter(Boolean))];
}

async function send(to, subject, text) {
  if (!to || (Array.isArray(to) && !to.length)) return { ok: false, reason: 'No authorized recipient is configured.' };
  try {
    const result = await emailService.sendCustomerEmail({ to, subject, text });
    if (!result?.ok && !result?.skipped) logError(`ACCESS APPROVAL EMAIL FAILED: ${result?.reason || 'unknown mail error'}`);
    return result || { ok: false, reason: 'Email service returned no result.' };
  } catch (err) {
    logError(`ACCESS APPROVAL EMAIL FAILED: ${err.message}`);
    return { ok: false, reason: err.message };
  }
}

async function requestApproval(req, res) {
  try {
    if (!req.authUser) return res.status(401).json({ error: 'Sign in to request temporary access.' });
    const feature = String(req.body?.feature || '').trim();
    if (!FEATURES.includes(feature)) return res.status(400).json({ error: 'Choose one of the supported permission keys.' });
    const requesterId = identity(req.authUser);
    if (!requesterId) return res.status(400).json({ error: 'Your account needs an email or username to request access.' });
    const now = Date.now();
    const items = read();
    if (expire(items, now)) write(items);
    const storeId = storeOf(req.authUser);
    if (!config.STORES.some(store => store.id === storeId)) return res.status(403).json({ error: 'Your account is not assigned to a configured store.' });
    const admins = recipients(storeId);
    if (!admins.length) return res.status(503).json({ error: 'No Franchise Admin is configured for this store. The request was not submitted.' });
    const existing = items.find(item => item.requesterId === requesterId && item.storeId === storeId &&
      item.feature === feature && ['pending', 'approved'].includes(item.status));
    if (existing) return res.status(409).json({ error: 'An active request or approval already exists for this permission.', approval: safe(existing) });
    const item = {
      id: `approval:${crypto.randomUUID()}`, feature, status: 'pending', storeId, requesterId,
      requesterEmail: req.authUser.email || null,
      requesterName: String(req.authUser.username || req.authUser.email || requesterId),
      requestedAt: new Date(now).toISOString(), requestExpiresAt: new Date(now + REQUEST_TTL).toISOString(),
      reason: String(req.body?.reason || '').trim().slice(0, 500)
    };
    items.push(item);
    write(items);
    auditGuardian.writeAudit({ action: 'ACCESS_APPROVAL_REQUESTED', actor: requesterId, targetId: item.id, ip: req.ip, detail: { feature, storeId, status: item.status } });
    const delivery = await send(admins, `Temporary access request: ${feature}`,
      `Requester: ${item.requesterName} (${requesterId})\nStore: ${storeId}\nPermission: ${feature}\nReason: ${item.reason || 'Not provided'}\nRequest ID: ${item.id}\n\nA Franchise Admin must review this request in NaviServer.`);
    return res.status(201).json({ approval: safe(item), notification: { success: delivery?.ok === true, reason: delivery?.ok ? '' : (delivery?.reason || (delivery?.skipped ? 'Email delivery is not configured.' : 'Email delivery failed.')) } });
  } catch (err) {
    logError(`ACCESS APPROVAL REQUEST FAILED: ${err.message}`);
    return res.status(503).json({ error: 'Unable to submit access request.' });
  }
}

function listApprovals(req, res) {
  try {
    if (!req.authUser) return res.status(401).json({ error: 'Sign in to view access requests.' });
    const items = read();
    if (expire(items)) write(items);
    const requestedStore = String(req.query?.storeId || '').trim().toLowerCase();
    if (requestedStore === 'all' && req.authUser.role !== 'admin') return res.status(403).json({ error: 'Only the main admin can view all stores.' });
    if (requestedStore && requestedStore !== 'all') {
      const permitted = isFranchiseAdmin(req.authUser.role)
        ? canAccessStore(req, requestedStore)
        : requestedStore === storeOf(req.authUser);
      if (!permitted) return res.status(403).json({ error: 'Access to this store is not allowed.' });
    }
    const staff = isFranchiseAdmin(req.authUser.role);
    const visible = items.filter(item => {
      if (requestedStore && requestedStore !== 'all' && item.storeId !== requestedStore) return false;
      if (req.authUser.role === 'admin') return true;
      if (staff) return canAccessStore(req, item.storeId);
      return item.requesterId === identity(req.authUser) && item.storeId === storeOf(req.authUser);
    }).map(safe);
    return res.json({ approvals: visible });
  } catch (err) {
    logError(`ACCESS APPROVAL LIST FAILED: ${err.message}`);
    return res.status(503).json({ error: 'Unable to load access requests.' });
  }
}

async function decideApproval(req, res) {
  try {
    if (!isFranchiseAdmin(req.authUser?.role)) return res.status(403).json({ error: 'Only admin or franchise_admin can decide access requests.' });
    const items = read();
    const now = Date.now();
    if (expire(items, now)) write(items);
    const index = items.findIndex(item => item.id === String(req.params.id));
    if (index < 0) return res.status(404).json({ error: 'Access request not found.' });
    const item = items[index];
    if (!canAccessStore(req, item.storeId)) return res.status(403).json({ error: 'Access to this store is not allowed.' });
    if (item.requesterId === identity(req.authUser)) return res.status(403).json({ error: 'You cannot approve your own request.' });
    if (item.status !== 'pending' || Date.parse(item.requestExpiresAt) <= now) return res.status(409).json({ error: 'This access request is no longer pending.' });
    const decision = String(req.body?.decision || '').toLowerCase();
    if (!['approve', 'deny'].includes(decision)) return res.status(400).json({ error: 'Decision must be approve or deny.' });
    const approverEmail = String(req.authUser.email || '').trim().toLowerCase();
    if (!approverEmail) return res.status(400).json({ error: 'Your Franchise Admin account needs a registered email to approve requests.' });
    const otpPurpose = `Access Approval ${item.id}`;
    if (!req.body?.otp) {
      try {
        await otpService.sendOTP(otpPurpose, approverEmail, false);
        return res.json({ otpRequired: true, otpSentTo: approverEmail, message: 'Verification code sent to your registered Franchise Admin email.' });
      } catch (err) {
        logError(`ACCESS APPROVAL OTP SEND FAILED: ${err.message}`);
        return res.status(503).json({ error: 'Unable to send the approval verification code.' });
      }
    }
    const otpResult = otpService.verifyOTP(String(req.body.otp), approverEmail, otpPurpose);
    if (!otpResult.valid) return res.status(400).json({ error: otpResult.message || 'Approval verification failed.' });
    item.status = decision === 'approve' ? 'approved' : 'denied';
    item.decidedAt = new Date(now).toISOString();
    item.decidedBy = identity(req.authUser);
    item.decisionReason = String(req.body?.reason || '').trim().slice(0, 500);
    if (decision === 'approve') item.expiresAt = new Date(now + TTL).toISOString();
    items[index] = item;
    write(items);
    auditGuardian.writeAudit({ action: `ACCESS_APPROVAL_${item.status.toUpperCase()}`, actor: item.decidedBy, targetId: item.id, ip: req.ip, detail: { feature: item.feature, storeId: item.storeId, requesterId: item.requesterId, reason: item.decisionReason } });
    await send(item.requesterEmail, `Access request ${item.status}: ${item.feature}`,
      `Your temporary access request was ${item.status}.\nPermission: ${item.feature}\nStore: ${item.storeId}\n${item.decisionReason ? `Reason: ${item.decisionReason}\n` : ''}${item.expiresAt ? `Approved until: ${item.expiresAt}\n` : ''}Request ID: ${item.id}`);
    return res.json({ approval: safe(item) });
  } catch (err) {
    logError(`ACCESS APPROVAL DECISION FAILED: ${err.message}`);
    return res.status(503).json({ error: 'Unable to decide access request.' });
  }
}

function hasActiveApproval(req, feature) {
  try {
    if (!req?.authUser || !FEATURES.includes(feature)) return false;
    const items = read();
    if (expire(items)) write(items);
    const requesterId = identity(req.authUser);
    const storeId = storeOf(req.authUser);
    return items.some(item => item.status === 'approved' && item.feature === feature &&
      item.requesterId === requesterId && item.storeId === storeId && Date.parse(item.expiresAt) > Date.now());
  } catch (err) {
    logError(`ACCESS APPROVAL CHECK FAILED: ${err.message}`);
    return false;
  }
}

function checkApproval(req, res) {
  try {
    if (!req.authUser) return res.status(401).json({ error: 'Sign in to check temporary access.' });
    const feature = String(req.query?.feature || '').trim();
    if (!FEATURES.includes(feature)) return res.status(400).json({ error: 'Choose one of the supported permission keys.' });
    const items = read();
    if (expire(items)) write(items);
    const requesterId = identity(req.authUser);
    const storeId = storeOf(req.authUser);
    const item = items.filter(record => record.requesterId === requesterId && record.storeId === storeId &&
      record.feature === feature && ['approved', 'denied', 'pending'].includes(record.status))
      .sort((a, b) => Date.parse(b.requestedAt) - Date.parse(a.requestedAt))[0];
    return res.json({
      approved: item?.status === 'approved' && Date.parse(item.expiresAt) > Date.now(),
      approval: item ? safe(item) : null,
      note: 'Temporary approvals do not replace the route role and store authorization checks.'
    });
  } catch (err) {
    logError(`ACCESS APPROVAL CHECK HANDLER FAILED: ${err.message}`);
    return res.status(503).json({ error: 'Unable to check temporary access.' });
  }
}

module.exports = { FEATURES, APPROVAL_TTL_MS: TTL, requestApproval, listApprovals, decideApproval, checkApproval, hasActiveApproval };

