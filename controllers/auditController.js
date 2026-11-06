'use strict';

const { logError } = require('../middleware/logger');
const { isFranchiseAdmin } = require('../middleware/storeScope');
const auditGuardian = require('../middleware/auditLog');

function getAuditEntries(req, res) {
  try {
    if (!isFranchiseAdmin(req.authUser?.role)) return res.status(403).json({ error: 'Only admin or franchise_admin can view the audit log.' });
    const requestedLimit = Math.max(1, Math.min(1000, Number(req.query.limit) || 200));
    const filters = {
      action: req.query.action, actor: req.query.actor, targetId: req.query.targetId,
      from: req.query.from, to: req.query.to, threats: req.query.threats === 'true',
      limit: 1000
    };
    const result = auditGuardian.readAuditLog(filters);
    const storeId = req.authUser.role === 'admin' ? String(req.query.storeId || '').toLowerCase() : String(req.authUser.storeId || 'buraza').toLowerCase();
    if (storeId && storeId !== 'all') result.entries = result.entries.filter(entry => !entry.detail?.storeId || String(entry.detail.storeId).toLowerCase() === storeId);
    result.total = result.entries.length;
    result.entries = result.entries.slice(0, requestedLimit);
    return res.json(result);
  } catch (err) {
    logError(`AUDIT LOG READ FAILED: ${err.message}`);
    return res.status(503).json({ error: 'Unable to load the audit log.' });
  }
}

module.exports = { getAuditEntries };
