const express = require('express');
const router = express.Router();
const { getStatus } = require('../controllers/statusController');
const { getAccessLogs, getErrorLogs } = require('../controllers/logController');
const { getActiveSessions } = require('../controllers/sessionController');
const {
  upload, getLoans, requestLoan, getLoanById,
  updateLoanStatus, getAllLoans, recordPayment,
  notifyAllOverdue, searchByReceiptId, sendLoanNotification
} = require('../controllers/loanController');
const {
  requestSignup, confirmSignup, resendOTP,
  requestLogin, confirmLogin,
  requestPasswordReset, confirmPasswordReset,
  createInvite, createAdminUser, validateInvite,
  getAllUsers, sendAdminAnnouncement
} = require('../controllers/authController');
const {
  submitFeedback, getFeedback, updateFeedbackStatus
} = require('../controllers/feedbackController');
const {
  getReportSummary, exportReport, getSingleUserReport,
  getAllUsersReport, getAnalyticsReport, getProfitAnalytics,
  getDefaulterAnalytics, getOverdueAnalytics, getPaidAnalytics,
  getUserReport, searchReports
} = require('../controllers/reportController');

router.get('/', (req, res) => res.send('Navi Server is running!'));

router.get('/status', getStatus);
router.get('/logs/access', getAccessLogs);
router.get('/logs/errors', getErrorLogs);
router.get('/sessions', getActiveSessions);

router.get('/reports/user', getSingleUserReport);
router.get('/reports/all', getAllUsersReport);
router.get('/reports/analytics', getAnalyticsReport);
router.get('/reports/:scope/summary', getReportSummary);
router.get('/reports/:scope/export', exportReport);
router.get('/reports/:scope/profits', getProfitAnalytics);
router.get('/reports/:scope/defaulters', getDefaulterAnalytics);
router.get('/reports/:scope/overdue', getOverdueAnalytics);
router.get('/reports/:scope/paid', getPaidAnalytics);
router.get('/reports/search', searchReports);
router.get('/reports/user/:email', getUserReport);

router.get('/users', getAllUsers);

router.get('/loans', getLoans);
router.get('/loans/all', getAllLoans);
router.get('/loans/search', searchByReceiptId);
router.post('/loans/notify-overdue', notifyAllOverdue);
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

router.post('/signup', requestSignup);
router.post('/signup/confirm', confirmSignup);
router.post('/signup/resend', resendOTP);
router.post('/login', requestLogin);
router.post('/login/confirm', confirmLogin);
router.post('/password-reset', requestPasswordReset);
router.post('/password-reset/confirm', confirmPasswordReset);
router.post('/invites/create', createInvite);
router.post('/admin/users', createAdminUser);
router.post('/admin/announcements', sendAdminAnnouncement);
router.get('/invites/validate/:token', validateInvite);
router.post('/invites/validate', validateInvite);
router.post('/feedback', submitFeedback);
router.get('/feedback', getFeedback);
router.post('/feedback/:id/status', updateFeedbackStatus);

module.exports = router;