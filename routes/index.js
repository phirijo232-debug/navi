const express = require('express');
const router = express.Router();
const config = require('../config');
const { logError } = require('../middleware/logger');
const { getStatus, getHealth } = require('../controllers/statusController');
const { getAccessLogs, getErrorLogs } = require('../controllers/logController');
const { getActiveSessions } = require('../controllers/sessionController');
const {
  upload, getLoans, requestLoan, getLoanById,
  updateLoanStatus, getAllLoans, recordPayment, submitPaymentProof, decidePaymentSubmission,
  getNotifications, markNotificationRead,
  notifyAllOverdue, searchByReceiptId, sendLoanNotification, notifyUser,
  createAdminLoan, getLoanInterestPolicy, updateLoanInterestPolicy, getPublicLoanRates
} = require('../controllers/loanController');
const {
  requestSignup, confirmSignup, resendOTP,
  requestLogin, confirmLogin,
  requestPasswordReset, confirmPasswordReset,
  createInvite, createAdminUser, validateInvite,
  getAllUsers, sendAdminAnnouncement, listInvites,
  listEmployees, editEmployee, setEmployeeRestriction,
  requestStoreSwitch, verifyStoreSwitch
} = require('../controllers/authController');
const {
  submitFeedback, getFeedback, updateFeedbackStatus
} = require('../controllers/feedbackController');
const {
  createBackup, listBackups, restoreBackup
} = require('../controllers/backupController');
const {
  getReportSummary, exportReport, getSingleUserReport,
  getAllUsersReport, getAnalyticsReport, getProfitAnalytics,
  getDefaulterAnalytics, getOverdueAnalytics, getPaidAnalytics,
  getUserReport, searchReports, getPaymentsLedger,
  getPaymentsReportExport, getTrackingAnalytics, exportTrackingSheet,
  getTrackingSheet, getUserTracking,
  getTypedReport, getTypedReportExcel, getTypedReportPdf, isPromptReportType
} = require('../controllers/reportController');

const { healthRateLimiter, authRateLimiter, getServerMode, setServerMode, isFranchiseManager } = require('../middleware/security');
const { signUpload } = require('../controllers/fileController');
const {
  listPermissionGroups, createPermissionGroup, updatePermissionGroup, deletePermissionGroup,
  listEmployeeSecurity, getEmployeeSecurity, updateEmployeeSecurity, getMySecurity, setCustomerPremium
} = require('../controllers/securityController');
const { getAuditEntries } = require('../controllers/auditController');
const { requestApproval, listApprovals, decideApproval, checkApproval } = require('../controllers/accessApprovalController');
const { requireFeatures, requirePremiumReportVisibility } = require('../middleware/featurePermissions');

const viewRevenueGate = requireFeatures('view_revenue');
const reportBuildGate = requireFeatures(['view_revenue', 'generate_reports']);
const reportPremiumGate = [reportBuildGate, requirePremiumReportVisibility];
const inviteGate = requireFeatures('generate_invite');
const createUsersGate = requireFeatures('create_users');
const bulkNotifyGate = requireFeatures('bulk_notify');
const forceLoanCloseGate = (req, res, next) => {
  const action = String(req.body?.action || '').trim().toLowerCase().replace(/[\s-]+/g, '_');
  if (!['liquidate', 'force_close', 'write_off'].includes(action)) return next();
  return requireFeatures('force_loan_close')(req, res, next);
};

function dispatchReportExport(req, res, next) {
  const normalizedType = String(req.params.type).toLowerCase().replace(/_/g, '-');
  const isTypedReport = isPromptReportType(req.params.type)
    || config.REPORTS.REPORT_TYPES.includes(req.params.type)
    || config.REPORTS.REPORT_TYPES.includes(normalizedType);
  if (!isTypedReport) return exportReport(req, res, next);

  const format = String(req.query.format || 'xlsx').toLowerCase();
  if (format === 'pdf') return getTypedReportPdf(req, res, next);
  if (format === 'xlsx' || format === 'excel') return getTypedReportExcel(req, res, next);
  return res.status(400).json({ error: 'Export format must be xlsx or pdf.' });
}

router.get('/', (req, res) => res.send('Navi Server is running!'));

router.get('/status', getStatus);
// IMMUNE: public tier returns {status, uptime} only; the admin tier (memory, db,
// heartbeat) activates only with a valid admin x-device-token in the same call.
router.get('/health', healthRateLimiter, getHealth);
router.get('/logs/access', getAccessLogs);
router.get('/logs/errors', getErrorLogs);
router.get('/sessions', getActiveSessions);
router.get('/admin/audit-log', getAuditEntries);
router.get('/admin/security/me', getMySecurity);
router.patch('/admin/security/customers/:id/premium', setCustomerPremium);
router.post('/admin/access-approvals', requestApproval);
router.get('/admin/access-approvals/check', checkApproval);
router.get('/admin/access-approvals', listApprovals);
router.post('/admin/access-approvals/:id/decision', authRateLimiter, decideApproval);

router.get('/reports/user', getSingleUserReport);
router.get('/reports/all', viewRevenueGate, getAllUsersReport);
router.get('/reports/analytics', viewRevenueGate, getAnalyticsReport);
router.get('/reports/search', viewRevenueGate, searchReports);
router.get('/reports/user/:email', viewRevenueGate, getUserReport);
router.get('/reports/analytics/tracking', viewRevenueGate, getTrackingAnalytics);
router.get('/reports/analytics/tracking/export', ...reportPremiumGate, exportTrackingSheet);
// /api alias matches the admin-panel report prompt and keeps the legacy /reports
// routes working for existing clients.
router.get('/api/reports/:type', viewRevenueGate, getTypedReport);
router.get('/api/reports/:type/export', ...reportPremiumGate, dispatchReportExport);
router.get('/api/reports/:type/pdf', ...reportPremiumGate, getTypedReportPdf);
// Flat typed-report routes (static, must come before :scope dynamic routes)
router.get('/reports/:type', viewRevenueGate, getTypedReport);
router.get('/reports/:type/export', ...reportPremiumGate, dispatchReportExport);
router.get('/reports/:type/pdf', ...reportPremiumGate, getTypedReportPdf);

router.get('/reports/:scope/summary', viewRevenueGate, getReportSummary);
router.get('/reports/:scope/export', ...reportPremiumGate, exportReport);
router.get('/reports/:scope/profits', viewRevenueGate, getProfitAnalytics);
router.get('/reports/:scope/defaulters', viewRevenueGate, getDefaulterAnalytics);
router.get('/reports/:scope/overdue', viewRevenueGate, getOverdueAnalytics);
router.get('/reports/:scope/paid', viewRevenueGate, getPaidAnalytics);
router.get('/reports/:scope/tracking', viewRevenueGate, getTrackingSheet);
router.get('/reports/:scope/users/:id', viewRevenueGate, getUserTracking);

router.get('/users', getAllUsers);

router.patch('/admin/loan-interest-policy', updateLoanInterestPolicy);

router.get('/notifications', getNotifications);
router.patch('/notifications/:id/read', markNotificationRead);

router.get('/loans', getLoans);
router.get('/loans/all', getAllLoans);
router.get('/loans/search', searchByReceiptId);
router.get('/loans/interest-policy', getLoanInterestPolicy);
router.get('/loans/public-rates', getPublicLoanRates);
router.get('/payments', viewRevenueGate, getPaymentsLedger);
router.get('/payments/export', ...reportPremiumGate, getPaymentsReportExport);
router.post('/loans/notify-overdue', bulkNotifyGate, notifyAllOverdue);
router.post('/loans/notify-user', notifyUser);
router.post('/loans/:id/payment-submissions', upload.fields([
  { name: 'paymentProof', maxCount: 1 }
]), submitPaymentProof);
router.post('/loans/:id/payment-submissions/:submissionId/:decision', decidePaymentSubmission);
router.get('/loans/:id', getLoanById);
router.post('/loans/request', upload.fields([
  { name: 'collateralFront', maxCount: 1 },
  { name: 'collateralBack', maxCount: 1 },
  { name: 'nrcFront', maxCount: 1 },
  { name: 'nrcBack', maxCount: 1 }
]), requestLoan);
router.post('/loans/:id/action', forceLoanCloseGate, updateLoanStatus);
router.post('/loans/:id/notify-overdue', sendLoanNotification);
router.post('/loans/payment', upload.fields([
  { name: 'screenshot', maxCount: 1 }
]), recordPayment);

// Signed image links: issues a 10-minute HMAC URL for ONE file after the
// ownership/store-scope check passes (serveFile verifies the signature). This
// replaces the old ?token= image links — the device token never enters a URL.
// Static path, no params, so ordering is safe here.
router.post('/uploads/sign', signUpload);

router.post('/signup', requestSignup);
router.post('/signup/confirm', confirmSignup);
router.post('/signup/resend', resendOTP);
router.post('/login', requestLogin);
router.post('/login/confirm', confirmLogin);
router.post('/password-reset', requestPasswordReset);
router.post('/password-reset/confirm', confirmPasswordReset);
router.post('/invites/create', inviteGate, createInvite);
router.get('/invites', inviteGate, listInvites);
router.post('/admin/users', createUsersGate, createAdminUser);
router.post('/admin/loans', upload.fields([
  { name: 'collateralFront', maxCount: 1 },
  { name: 'collateralBack', maxCount: 1 }
]), createAdminLoan);
router.post('/admin/announcements', bulkNotifyGate, sendAdminAnnouncement);
router.post('/admin/backup', createBackup);
router.get('/admin/backups', listBackups);
router.post('/admin/restore', restoreBackup);

// Public/private server-mode toggle — franchise-manager admin only (jophiri223).
// PRIVATE = LAN-only; PUBLIC = internet-reachable but still device-token gated.
router.get('/admin/server-mode', (req, res) => {
  try {
    if (!isFranchiseManager(req.authUser)) {
      logError(`SERVER MODE READ BLOCKED — ${req.authUser?.email || 'unauthenticated'} from ${req.ip}`);
      return res.status(403).json({ error: 'Forbidden. Only the franchise manager admin may view the server mode.' });
    }
    return res.json({ mode: getServerMode() });
  } catch (err) {
    logError(`SERVER MODE READ FAILED: ${err.message}`);
    return res.status(503).json({ error: 'Server mode is temporarily unavailable.' });
  }
});

router.post('/admin/server-mode', (req, res) => {
  try {
    if (!isFranchiseManager(req.authUser)) {
      logError(`SERVER MODE CHANGE BLOCKED — ${req.authUser?.email || 'unauthenticated'} from ${req.ip}`);
      return res.status(403).json({ error: 'Forbidden. Only the franchise manager admin may change the server mode.' });
    }
    const mode = String(req.body?.mode || '').toLowerCase();
    if (mode !== 'public' && mode !== 'private') {
      return res.status(400).json({ error: "Invalid mode. Use 'public' or 'private'." });
    }
    setServerMode(mode);
    logError(`SERVER MODE CHANGED to ${mode.toUpperCase()} by ${req.authUser?.email} from ${req.ip}`, true);
    return res.json({ mode: getServerMode(), message: `Server mode set to ${mode}.` });
  } catch (err) {
    logError(`SERVER MODE CHANGE FAILED: ${err.message}`);
    return res.status(503).json({ error: 'Could not change the server mode.' });
  }
});
router.get('/hr/employees', listEmployees);
router.patch('/hr/employees/:id', editEmployee);
// Security groups are feature metadata and remain subordinate to hard role/store gates.
router.get('/admin/security/groups', listPermissionGroups);
router.post('/admin/security/groups', createPermissionGroup);
router.patch('/admin/security/groups/:id', updatePermissionGroup);
router.delete('/admin/security/groups/:id', deletePermissionGroup);
router.get('/admin/security/employees', listEmployeeSecurity);
router.get('/admin/security/employees/:id', getEmployeeSecurity);
router.patch('/admin/security/employees/:id', updateEmployeeSecurity);
router.post('/hr/employees/:id/restrictions', setEmployeeRestriction);
router.post('/hr/store-switch/request', requestStoreSwitch);
router.post('/hr/store-switch/verify', verifyStoreSwitch);
router.get('/invites/validate/:token', validateInvite);
router.post('/invites/validate', validateInvite);
router.post('/feedback', submitFeedback);
router.get('/feedback', getFeedback);
router.post('/feedback/:id/status', updateFeedbackStatus);

module.exports = router;