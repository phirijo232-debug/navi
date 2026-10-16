const express = require('express');
const router = express.Router();
const config = require('../config');
const { logError } = require('../middleware/logger');
const { getStatus, getHealth } = require('../controllers/statusController');
const { getAccessLogs, getErrorLogs } = require('../controllers/logController');
const { getActiveSessions } = require('../controllers/sessionController');
const {
  upload, getLoans, requestLoan, getLoanById,
  updateLoanStatus, getAllLoans, recordPayment,
  notifyAllOverdue, searchByReceiptId, sendLoanNotification, notifyUser,
  createAdminLoan
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
  getTypedReport, getTypedReportExcel, getTypedReportPdf
} = require('../controllers/reportController');

const { healthRateLimiter, getServerMode, setServerMode, isFranchiseManager } = require('../middleware/security');
const { signUpload } = require('../controllers/fileController');

router.get('/', (req, res) => res.send('Navi Server is running!'));

router.get('/status', getStatus);
// IMMUNE: public tier returns {status, uptime} only; the admin tier (memory, db,
// heartbeat) activates only with a valid admin x-device-token in the same call.
router.get('/health', healthRateLimiter, getHealth);
router.get('/logs/access', getAccessLogs);
router.get('/logs/errors', getErrorLogs);
router.get('/sessions', getActiveSessions);

router.get('/reports/user', getSingleUserReport);
router.get('/reports/all', getAllUsersReport);
router.get('/reports/analytics', getAnalyticsReport);
router.get('/reports/search', searchReports);
router.get('/reports/user/:email', getUserReport);
router.get('/reports/analytics/tracking', getTrackingAnalytics);
router.get('/reports/analytics/tracking/export', exportTrackingSheet);
// Flat typed-report routes (static, must come before :scope dynamic routes)
router.get('/reports/:type', getTypedReport);
router.get('/reports/:type/export', (req, res, next) => {
  if (config.REPORTS.REPORT_TYPES.includes(req.params.type)) {
    return getTypedReportExcel(req, res, next);
  }
  return exportReport(req, res, next);
});
router.get('/reports/:type/pdf', getTypedReportPdf);

router.get('/reports/:scope/summary', getReportSummary);
router.get('/reports/:scope/export', exportReport);
router.get('/reports/:scope/profits', getProfitAnalytics);
router.get('/reports/:scope/defaulters', getDefaulterAnalytics);
router.get('/reports/:scope/overdue', getOverdueAnalytics);
router.get('/reports/:scope/paid', getPaidAnalytics);
router.get('/reports/:scope/tracking', getTrackingSheet);
router.get('/reports/:scope/users/:id', getUserTracking);

router.get('/users', getAllUsers);

router.get('/loans', getLoans);
router.get('/loans/all', getAllLoans);
router.get('/loans/search', searchByReceiptId);
router.get('/payments', getPaymentsLedger);
router.get('/payments/export', getPaymentsReportExport);
router.post('/loans/notify-overdue', notifyAllOverdue);
router.post('/loans/notify-user', notifyUser);
router.get('/loans/:id', getLoanById);
router.post('/loans/request', upload.fields([
  { name: 'collateralFront', maxCount: 1 },
  { name: 'collateralBack', maxCount: 1 }
]), requestLoan);
router.post('/loans/:id/action', updateLoanStatus);
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
router.post('/invites/create', createInvite);
router.get('/invites', listInvites);
router.post('/admin/users', createAdminUser);
router.post('/admin/loans', upload.fields([
  { name: 'collateralFront', maxCount: 1 },
  { name: 'collateralBack', maxCount: 1 }
]), createAdminLoan);
router.post('/admin/announcements', sendAdminAnnouncement);
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
router.post('/hr/employees/:id/restrictions', setEmployeeRestriction);
router.post('/hr/store-switch/request', requestStoreSwitch);
router.post('/hr/store-switch/verify', verifyStoreSwitch);
router.get('/invites/validate/:token', validateInvite);
router.post('/invites/validate', validateInvite);
router.post('/feedback', submitFeedback);
router.get('/feedback', getFeedback);
router.post('/feedback/:id/status', updateFeedbackStatus);

module.exports = router;
