'use strict';

const dataStore = require('./dataStore');
const { getRecordStoreId } = require('./storeScope');
const { getEffectivePermissions } = require('../controllers/securityController');
const { hasActiveApproval } = require('../controllers/accessApprovalController');

const MONEY_KEYS = Object.freeze([
  'amount', 'totalAmount', 'principal', 'totalPrincipal', 'interest', 'interestAmount', 'totalRepayment', 'totalPayable',
  'outstanding', 'balance', 'balanceBefore', 'balanceAfter', 'paid', 'paidAmount', 'paidTotal', 'totalPaid',
  'totalRequested', 'totalBorrowed', 'totalInterest', 'totalInterestAdded', 'totalInterestBooked', 'totalInterestPaid',
  'graceAccrued', 'graceInterestBefore', 'graceInterestAfter', 'graceInterestAdded',
  'totalOutstanding', 'totalCapital', 'totalCollected', 'totalOverdue', 'totalProfitEarned', 'totalRevenue', 'revenue', 'profit'
]);
const HISTORY_KEYS = new Set(['payments', 'paymentHistory', 'repaymentHistory', 'ledger', 'paymentRecords', 'paymentSubmissions', 'statusHistory']);
const PRIVATE_DETAIL_KEYS = new Set(['adminReason', 'nrc', 'nrcNumber', 'phone', 'collateralDescription', 'collateralFront', 'collateralBack', 'nrcFront', 'nrcBack']);
const AGGREGATE_KEYS = new Set(['summary', 'summaries', 'totals', 'total', 'analytics', 'metrics', 'statistics', 'stats', 'overview']);

function key(value) { return String(value ?? '').trim().toLowerCase(); }

function buildPremiumContext(req) {
  const users = dataStore.readJson(dataStore.paths.users, [], Array.isArray);
  const loans = dataStore.readJson(dataStore.paths.loans, [], Array.isArray);
  const premiumEmails = new Set(users.filter(user => user.premiumProtected === true).map(user => key(user.email)).filter(Boolean));
  const premiumLoanIds = new Set(loans.filter(loan => premiumEmails.has(key(loan.email || loan.userEmail)))
    .flatMap(loan => [loan.id, loan.loanId, loan.receiptNumber].map(value => String(value ?? '')).filter(Boolean)));
  const isPremium = record => {
    if (!record || typeof record !== 'object') return false;
    const email = record.email || record.userEmail || record.borrowerEmail || record.customerEmail || record.user?.email || record.borrower?.email;
    if (record.premiumProtected === true || premiumEmails.has(key(email))) return true;
    const recordLoanId = record.loanId || record.loanReceiptId || record.receiptNumber || record.loan?.id || record.loan?.receiptNumber;
    return recordLoanId != null && premiumLoanIds.has(String(recordLoanId));
  };
  return { isPremium };
}

function containsPremium(value, context) {
  if (Array.isArray(value)) return value.some(item => containsPremium(item, context));
  if (!value || typeof value !== 'object' || Buffer.isBuffer(value)) return false;
  if (context.isPremium(value)) return true;
  return Object.values(value).some(child => containsPremium(child, context));
}

function maskAggregateAmounts(value) {
  if (Array.isArray(value)) return value.map(maskAggregateAmounts);
  if (!value || typeof value !== 'object' || Buffer.isBuffer(value)) return value;
  const result = {};
  for (const [field, child] of Object.entries(value)) {
    if (HISTORY_KEYS.has(field.toLowerCase())) result[field] = [];
    else if (MONEY_KEYS.includes(field)) result[field] = null;
    else result[field] = maskAggregateAmounts(child);
  }
  result.masked = true;
  return result;
}

function maskPremiumResponse(value, context, inheritedPremium = false) {
  if (Array.isArray(value)) return value.map(item => maskPremiumResponse(item, context, inheritedPremium));
  if (!value || typeof value !== 'object' || Buffer.isBuffer(value)) return value;
  const premium = inheritedPremium || context.isPremium(value);
  const containsPremiumData = premium || containsPremium(value, context);
  const result = {};
  for (const [field, child] of Object.entries(value)) {
    if (containsPremiumData && HISTORY_KEYS.has(field.toLowerCase())) {
      result[field] = [];
      continue;
    }
    if (premium && PRIVATE_DETAIL_KEYS.has(field)) {
      result[field] = null;
      continue;
    }
    if (containsPremiumData && MONEY_KEYS.includes(field)) {
      result[field] = null;
      continue;
    }
    if (containsPremiumData && AGGREGATE_KEYS.has(field.toLowerCase())) {
      result[field] = maskAggregateAmounts(child);
      continue;
    }
    result[field] = maskPremiumResponse(child, context, premium);
  }
  if (containsPremiumData) {
    result.masked = true;
    if (premium) result.paymentsMasked = true;
  }
  return result;
}

function premiumPrivacy(req, res, next) {
  try {
    // Customer-owned portal responses remain intact. Main and Franchise Admin
    // are unrestricted; only store_admin responses receive customer masking.
    if (req.authUser?.role !== 'store_admin') return next();
    if (getEffectivePermissions(req.authUser).view_premium_customers || hasActiveApproval(req, 'view_premium_customers')) return next();
    const context = buildPremiumContext(req);
    const originalJson = res.json;
    res.json = function maskPremiumJson(body) {
      return originalJson.call(this, maskPremiumResponse(body, context));
    };
    return next();
  } catch {
    // Fail closed for premium detail rather than returning an unmasked record.
    if (req.authUser?.role === 'store_admin') return res.status(503).json({ error: 'Unable to verify premium customer visibility.' });
    return next();
  }
}

module.exports = { premiumPrivacy, buildPremiumContext, maskPremiumResponse, containsPremium };
