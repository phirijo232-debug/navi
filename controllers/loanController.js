const fs = require('fs');
const path = require('path');
const multer = require('multer');
const { logError, logBreakage } = require('../middleware/logger');
const emailService = require('../middleware/email');
const config = require('../config');
const dataStore = require('../middleware/dataStore');
const { getRecordStoreId, getRequestedStoreId, canAccessStore, canAccessRecord, isAdminRole } = require('../middleware/storeScope');

const LOANS_FILE = dataStore.paths.loans;
const USERS_FILE = dataStore.paths.users;

// ─── Receipt IDs (Task 1) ────────────────────────────────────────────────────
// Loan receipts:   BMF-YYYYMMDD-XXXX  (creation date + 4 random digits)
// Payment receipts: PAY-YYYYMMDD-XXXX (payment date + 4 random digits)
// Generated once when the request/payment is made; unique across the store.

const LOAN_RECEIPT_PREFIX = 'BMF';
const PAYMENT_RECEIPT_PREFIX = 'PAY';

function compactDate(date = new Date()) {
  const d = date instanceof Date ? date : new Date(date);
  const y = d.getUTCFullYear();
  const m = String(d.getUTCMonth() + 1).padStart(2, '0');
  const day = String(d.getUTCDate()).padStart(2, '0');
  return `${y}${m}${day}`;
}

function randomBlock() {
  return String(Math.floor(Math.random() * 10000)).padStart(4, '0');
}

function generateLoanReceiptId(existingIds = new Set(), date = new Date()) {
  const stamp = compactDate(date);
  let id;
  do {
    id = `${LOAN_RECEIPT_PREFIX}-${stamp}-${randomBlock()}`;
  } while (existingIds.has(id));
  return id;
}

function generatePaymentReceiptId(existingIds = new Set(), date = new Date()) {
  const stamp = compactDate(date);
  let id;
  do {
    id = `${PAYMENT_RECEIPT_PREFIX}-${stamp}-${randomBlock()}`;
  } while (existingIds.has(id));
  return id;
}

// Task 2 — canonical payment modes (BMF repayment sheet options).
const PAYMENT_MODES = ['Airtel Money', 'MTN MoMo', 'Cash', 'Bank Transfer', 'Other'];

function normalizePaymentMode(mode) {
  const raw = String(mode || '').trim().toLowerCase().replace(/[\s_-]+/g, '_');
  const aliases = {
    airtel: 'Airtel Money',
    airtel_money: 'Airtel Money',
    airtelmoney: 'Airtel Money',
    mtn: 'MTN MoMo',
    mtn_momo: 'MTN MoMo',
    mtnmomo: 'MTN MoMo',
    momo: 'MTN MoMo',
    mobile_money: 'MTN MoMo',
    cash: 'Cash',
    bank: 'Bank Transfer',
    bank_transfer: 'Bank Transfer',
    transfer: 'Bank Transfer',
    other: 'Other'
  };
  if (!raw) return 'Cash';
  if (PAYMENT_MODES.includes(mode)) return mode;
  return aliases[raw] || 'Other';
}

/** Backfill receipts for loans created before the receipt system existed. */
function ensureReceiptNumbers(loans) {
  const used = new Set(loans.map(loan => String(loan.receiptNumber || '')).filter(Boolean));
  let changed = false;
  loans.forEach((loan) => {
    if (!loan.receiptNumber) {
      loan.receiptNumber = generateLoanReceiptId(used, new Date(loan.createdAt || Date.now()));
      used.add(loan.receiptNumber);
      changed = true;
    }
  });
  return changed;
}

// ─── Loan lifecycle ──────────────────────────────────────────────────────────
// Business statuses: active | grace | defaulted | liquidated | paid
// Legacy stored statuses (pending, approved, in_progress, declined, paid,
// overdue) are mapped onto these so old records keep reporting correctly.

const LEGACY_STATUS_MAP = {
  pending: 'pending',
  awaiting_approval: 'pending',
  approved: 'active',
  in_progress: 'active',
  'in-progress': 'active',
  running: 'active',
  active: 'active',
  grace: 'grace',
  overdue: 'grace',
  defaulted: 'defaulted',
  default: 'defaulted',
  liquidated: 'liquidated',
  liquidation: 'liquidated',
  recovered: 'liquidated',
  paid: 'paid',
  settled: 'paid',
  closed: 'paid',
  declined: 'declined',
  rejected: 'declined'
};

function normalizeStatus(status) {
  const key = String(status || '').trim().toLowerCase().replace(/\s+/g, '_');
  return LEGACY_STATUS_MAP[key] || key || 'pending';
}

function daysBetween(fromDate, toDate) {
  const from = new Date(`${String(fromDate).slice(0, 10)}T00:00:00Z`);
  const to = new Date(`${String(toDate).slice(0, 10)}T00:00:00Z`);
  return Math.round((to - from) / 86400000);
}

/**
 * Derive the live business status from the due date, balance and any manual
 * override (liquidated is always set by an admin decision, never by the clock).
 */
function deriveLoanStatus(loan, today = new Date().toISOString().slice(0, 10)) {
  const stored = normalizeStatus(loan.status);
  if (stored === 'liquidated') return 'liquidated';
  if (stored === 'declined' || stored === 'pending') return stored;

  const outstanding = Number(loan.outstanding || 0);
  if (outstanding <= 0) return 'paid';

  // Manual "verify overdue" is a durable admin decision — the clock must not undo it.
  if (stored === 'defaulted' && loan.verifiedOverdueAt) return 'defaulted';

  const dueDate = String(loan.dueDate || '').slice(0, 10);
  if (!/^\d{4}-\d{2}-\d{2}$/.test(dueDate)) return stored === 'paid' ? 'paid' : 'active';

  // An agreed manual grace window wins over the default clock window.
  const agreedGraceUntil = String(loan.graceUntil || '').slice(0, 10);
  if (/^\d{4}-\d{2}-\d{2}$/.test(agreedGraceUntil)) {
    return today <= agreedGraceUntil ? 'grace' : 'defaulted';
  }

  const daysToDue = daysBetween(today, dueDate);
  if (daysToDue < -config.DEFAULT_GRACE_DAYS) return 'defaulted';
  if (daysToDue < 0) return 'grace';
  if (daysToDue <= config.GRACE_PERIOD_DAYS) return 'grace';
  return 'active';
}

// ─── Grace penalty (agreed 1.8%/day) ─────────────────────────────────────────
const GRACE_DAILY_RATE = 0.018;
const PENALTY_CAP_RATIO = 0.5; // cap: 50% additional on the original principal

/** Accepts YYYY-MM-DD or DD/MM/YYYY; returns YYYY-MM-DD or null. */
function parseDateInput(value) {
  const raw = String(value || '').trim();
  if (/^\d{4}-\d{2}-\d{2}$/.test(raw)) return raw;
  const match = raw.match(/^(\d{2})\/(\d{2})\/(\d{4})$/);
  if (match) return `${match[3]}-${match[2]}-${match[1]}`;
  return null;
}

/**
 * Accrue the agreed 1.8%/day grace penalty idempotently. The base is pinned the
 * first time accrual runs (no retroactive penalties), then 1.8% x elapsed days
 * is added to the interest/repayment totals so rebuildPaymentLedger pushes it
 * onto the outstanding. Capped at 50% of the original principal (BMF cap).
 * Pure mutator: the scheduler persists daily; read-only callers re-derive the
 * same value on every load, so un-persisted reads stay idempotent.
 */
function applyGraceAccrual(loan, today = new Date().toISOString().slice(0, 10)) {
  try {
    if (!loan || Number(loan.outstanding || 0) <= 0) return loan;
    if (normalizeStatus(loan.status) === 'liquidated') return loan;

    const live = deriveLoanStatus(loan, today);
    if (live !== 'grace' && live !== 'defaulted') return loan;

    const rate = Number(loan.graceDailyRate) > 0 ? Number(loan.graceDailyRate) : GRACE_DAILY_RATE;

    // First pass pins the accrual window — nothing is charged before today.
    if (!/^\d{4}-\d{2}-\d{2}$/.test(String(loan.graceAccrualStart || ''))) {
      loan.graceDailyRate = rate;
      loan.graceAccrualBase = Number(loan.outstanding || 0);
      loan.graceAccrualStart = today;
      loan.graceLastAccrual = today;
      loan.graceAccrued = Number(loan.graceAccrued || 0);
      return loan;
    }

    const anchor = /^\d{4}-\d{2}-\d{2}$/.test(String(loan.graceLastAccrual || ''))
      ? String(loan.graceLastAccrual).slice(0, 10)
      : String(loan.graceAccrualStart).slice(0, 10);
    const days = daysBetween(anchor, today);
    if (days <= 0) return loan;

    const base = Number(loan.graceAccrualBase || 0);
    if (base <= 0) return loan;

    const cap = Number(loan.amount || base) * PENALTY_CAP_RATIO;
    const already = Number(loan.graceAccrued || 0);
    const add = Number(Math.min(days * base * rate, Math.max(0, cap - already)).toFixed(2));
    loan.graceDailyRate = rate;
    loan.graceLastAccrual = today;
    if (add <= 0) return loan;

    loan.graceAccrued = Number((already + add).toFixed(2));
    loan.interestAmount = Number((Number(loan.interestAmount || 0) + add).toFixed(2));
    loan.totalRepayment = Number((Number(loan.totalRepayment || loan.amount || 0) + add).toFixed(2));
    return loan;
  } catch (err) {
    logError(`GRACE ACCRUAL SKIPPED | loan ${loan?.receiptNumber || loan?.id || '?'} | ${err.message}`);
    return loan;
  }
}

/** Persist grace accrual across every grace/defaulted loan (idempotent). */
function accrueAllGrace(today = new Date().toISOString().slice(0, 10)) {
  const loans = getLoansData();
  let changedCount = 0;
  loans.forEach(loan => {
    const before = `${Number(loan.graceAccrued || 0)}|${loan.graceLastAccrual || ''}`;
    applyGraceAccrual(loan, today);
    const after = `${Number(loan.graceAccrued || 0)}|${loan.graceLastAccrual || ''}`;
    if (before !== after) changedCount += 1;
  });
  if (changedCount) saveLoansData(loans);
  return { changed: changedCount, total: loans.length };
}

// ─── Balances & payments ─────────────────────────────────────────────────────

function sumPayments(loan) {
  return (Array.isArray(loan.payments) ? loan.payments : [])
    .reduce((sum, payment) => sum + (Number(payment.amount) || 0), 0);
}

/**
 * Replay the payment ledger so balanceBefore/balanceAfter always reconcile.
 * Payments are applied interest-first (as is standard in micro-finance),
 * then against principal.
 */
function rebuildPaymentLedger(loan) {
  const payments = Array.isArray(loan.payments) ? loan.payments : [];
  // totalRepayment is authoritative; fall back to amount, then to the recorded
  // outstanding so legacy rows without computed totals still reconcile.
  let running = Number(loan.totalRepayment || loan.amount || loan.outstanding || 0);
  let interestOutstanding = Number(loan.interestAmount || 0);

  payments.forEach((payment, index) => {
    payment.balanceBefore = Number(running.toFixed(2));

    const amount = Number(payment.amount) || 0;
    const interestPortion = Math.min(amount, interestOutstanding);
    interestOutstanding = Number((interestOutstanding - interestPortion).toFixed(2));

    payment.interestPortion = Number(interestPortion.toFixed(2));
    payment.principalPortion = Number((amount - interestPortion).toFixed(2));
    payment.balanceAfter = Number(Math.max(0, running - amount).toFixed(2));

    running = payment.balanceAfter;
    payment.paymentReceiptId = payment.paymentReceiptId ||
      generatePaymentReceiptId(undefined, payment.paymentDate || payment.date || new Date());
    payment.receiptNumber = payment.receiptNumber || payment.paymentReceiptId;
    payment.recordedBy = payment.recordedBy || loan.updatedBy || loan.reviewedBy || 'system';
    payment.paymentDate = payment.paymentDate || payment.date || loan.createdAt || null;
  });

  loan.paidTotal = Number(sumPayments(loan).toFixed(2));
  loan.interestOutstanding = interestOutstanding;
  loan.outstanding = Number(Math.max(0, running).toFixed(2));
  return loan;
}
const UPLOAD_DIR = path.join(__dirname, '../public/uploads');

if (!fs.existsSync(UPLOAD_DIR)) {
  fs.mkdirSync(UPLOAD_DIR, { recursive: true });
}

const storage = multer.diskStorage({
  destination: (req, file, cb) => cb(null, UPLOAD_DIR),
  filename: (req, file, cb) => {
    const safe = path.basename(String(file.originalname || 'upload'))
      .replace(/[^a-zA-Z0-9._-]/g, '_')
      .replace(/_{2,}/g, '_')
      .slice(-60);
    cb(null, `${Date.now()}-${Math.random().toString(36).slice(2, 8)}-${safe}`);
  }
});
const ALLOWED_UPLOAD_MIME = /^image\/(jpeg|jpg|png|webp|gif)$/i;
const upload = multer({
  storage,
  limits: { fileSize: 5 * 1024 * 1024 },
  fileFilter: (req, file, cb) => {
    if (ALLOWED_UPLOAD_MIME.test(file.mimetype)) return cb(null, true);
    cb(new Error('Only image files (JPG, PNG, WEBP, GIF) are allowed.'));
  }
});

function getLoansData() {
  return dataStore.readJson(LOANS_FILE, [], Array.isArray);
}

/** Loans enriched for reading: receipts backfilled, ledgers rebuilt, status derived. */
function getEnrichedLoans(today = new Date().toISOString().slice(0, 10)) {
  const loans = getLoansData();
  return loans.map(loan => {
    const copy = { ...loan, payments: (loan.payments || []).map(p => ({ ...p })) };
    applyGraceAccrual(copy, today); // read-only view: un-persisted accrual re-derives identically
    rebuildPaymentLedger(copy);
    return {
      ...copy,
      businessStatus: deriveLoanStatus(copy, today),
      legacyStatus: normalizeLoanStatus(loan.status)
    };
  });
}

/** One-time migration: receipts + borrowedDate + ledger balances (idempotent). */
function migrateLoans() {
  const loans = getLoansData();
  let receiptsChanged = ensureReceiptNumbers(loans);

  let changed = receiptsChanged;
  loans.forEach(loan => {
    if (!loan.borrowedDate && loan.approvedAt) {
      loan.borrowedDate = String(loan.approvedAt).slice(0, 10);
      changed = true;
    }
    const before = JSON.stringify(loan.payments || []);
    rebuildPaymentLedger(loan);
    if (JSON.stringify(loan.payments || []) !== before) changed = true;
    const live = deriveLoanStatus(loan);
    if (!['pending', 'declined', 'paid'].includes(live) &&
        ['approved', 'in_progress'].includes(normalizeLoanStatus(loan.status))) {
      if (loan.status !== live) { loan.status = live; changed = true; }
    }
  });

  if (changed) saveLoansData(loans);
  return { receiptsChanged, changed };
}

function normalizeLoanStatus(status) {
  return String(status || '').trim().toLowerCase().replace(/\s+/g, '_');
}

function ensureStatusHistory(loan) {
  if (!Array.isArray(loan.statusHistory)) {
    loan.statusHistory = [];
  }
  return loan.statusHistory;
}

function recordStatusHistory(loan, status, reason, actor = 'system', source = 'system') {
  const history = ensureStatusHistory(loan);
  history.push({
    status: normalizeLoanStatus(status),
    reason: reason || 'No note provided.',
    actor: actor || 'system',
    source,
    updatedAt: new Date().toISOString()
  });
  loan.statusHistory = history.slice(-25);
}

function calculateSummary(loans) {
  const total = loans.length;
  const outstanding = loans.reduce((sum, loan) => sum + (loan.outstanding || 0), 0);
  return { total, outstanding };
}

// ─── Portfolio analytics (all-users view) ────────────────────────────────────
// total loans, total capital deployed, total interest booked, total defaults,
// plus the overdue / paid / liquidated splits the BMF analytics sheet needs.
function summarizeStore(loans, today = new Date().toISOString().slice(0, 10)) {
  const enriched = loans.map(loan => ({
    ...loan,
    businessStatus: deriveLoanStatus(loan, today)
  }));
  const byStatus = status => enriched.filter(loan => loan.businessStatus === status);
  const principal = loans => loans.reduce((sum, l) => sum + (Number(l.amount) || 0), 0);
  const interest = loans => loans.reduce((sum, l) => sum + (Number(l.interestAmount) || 0), 0);
  const outstandingOf = loans => loans.reduce((sum, l) => sum + (Number(l.outstanding) || 0), 0);
  const collected = loans => loans.reduce((sum, l) => sum + (Number(l.paidTotal ?? sumPayments(l)) || 0), 0);

  const defaulted = byStatus('defaulted');
  const overdueGrace = byStatus('grace');
  const paid = byStatus('paid');
  const active = byStatus('active');
  const liquidated = byStatus('liquidated');

  return {
    totalLoans: enriched.length,
    totalCapital: principal(enriched),
    totalInterestBooked: interest(enriched),
    totalCollected: Number(collected(enriched).toFixed(2)),
    totalOutstanding: Number(outstandingOf(enriched).toFixed(2)),
    active: { count: active.length, capital: principal(active), outstanding: outstandingOf(active) },
    grace: { count: overdueGrace.length, outstanding: outstandingOf(overdueGrace) },
    defaulted: {
      count: defaulted.length,
      capital: principal(defaulted),
      outstanding: outstandingOf(defaulted),
      possibleLoss: outstandingOf(defaulted)
    },
    liquidated: { count: liquidated.length, outstanding: outstandingOf(liquidated) },
    paid: { count: paid.length, collected: Number(collected(paid).toFixed(2)) }
  };
}

// ─── Search by loan receipt ID or payment receipt ID (Task 1) ────────────────
function searchLoansByReceipt(loans, query) {
  const q = String(query || '').trim().toLowerCase();
  if (!q) return [];
  return loans.map(loan => ({
    ...rebuildPaymentLedger({ ...loan, payments: (loan.payments || []).map(p => ({ ...p })) }),
    businessStatus: deriveLoanStatus(loan),
    legacyStatus: normalizeLoanStatus(loan.status)
  })).filter(loan => {
    // Prefix match on the loan receipt (BMF-YYYYMMDD-XXXX) so partial
    // queries like "bmf-20261006" or "BMF-2026" still find their loans.
    const receipt = String(loan.receiptNumber || '').toLowerCase();
    if (receipt && receipt.startsWith(q)) return true;
    if (String(loan.id) === q) return true;
    // Payment receipt IDs (PAY-YYYYMMDD-XXXX) pull up their parent loan too.
    return (Array.isArray(loan.payments) ? loan.payments : []).some(payment =>
      String(payment.paymentReceiptId || payment.receiptNumber || '').toLowerCase().startsWith(q));
  });
}

function getLoanTimeframeWindow(filter) {
  const normalized = String(filter || '').trim().toLowerCase().replace(/\s+/g, '-');
  const now = new Date();
  const end = new Date(now.getTime());

  if (!normalized || normalized === 'all') return null;

  if (normalized === 'today') {
    const start = new Date(now.getFullYear(), now.getMonth(), now.getDate());
    return { start, end };
  }

  if (normalized === 'yesterday') {
    const start = new Date(now.getFullYear(), now.getMonth(), now.getDate() - 1);
    const endOfYesterday = new Date(now.getFullYear(), now.getMonth(), now.getDate());
    return { start, end: endOfYesterday };
  }

  if (['7', '7-days', 'last-7-days'].includes(normalized)) {
    const start = new Date(now.getTime() - 7 * 24 * 60 * 60 * 1000);
    return { start, end };
  }

  if (['30', '30-days', 'last-30-days'].includes(normalized)) {
    const start = new Date(now.getTime() - 30 * 24 * 60 * 60 * 1000);
    return { start, end };
  }

  if (normalized === 'month' || normalized === 'this-month') {
    const start = new Date(now.getFullYear(), now.getMonth(), 1);
    const endOfMonth = new Date(now.getFullYear(), now.getMonth() + 1, 0, 23, 59, 59, 999);
    return { start, end: endOfMonth };
  }

  if (normalized === 'year' || normalized === 'this-year') {
    const start = new Date(now.getFullYear(), 0, 1);
    const endOfYear = new Date(now.getFullYear(), 11, 31, 23, 59, 59, 999);
    return { start, end: endOfYear };
  }

  const days = parseInt(normalized, 10);
  if (!Number.isNaN(days) && days > 0) {
    const start = new Date(now.getTime() - days * 24 * 60 * 60 * 1000);
    return { start, end };
  }

  return null;
}

function filterLoansByTimeframe(loans, filter) {
  const window = getLoanTimeframeWindow(filter);
  if (!window) return loans;

  return loans.filter(loan => {
    // A settled loan is grouped by its settlement date (settledAt, else the
    // latest payment date); everything else by the borrowed/approval date. Keeps
    // the portfolio endpoint consistent with the admin modal timeframe filter.
    const payments = Array.isArray(loan?.payments) ? loan.payments : [];
    const lastPayment = payments
      .map(p => p.paymentDate || p.date)
      .filter(Boolean)
      .sort()
      .at(-1) || null;
    const source = deriveLoanStatus(loan) === 'paid'
      ? (loan?.settledAt || lastPayment)
      : (loan?.approvedAt || loan?.createdAt);
    const ts = new Date(source || 0).getTime();
    if (Number.isNaN(ts)) return false;
    return ts >= window.start.getTime() && ts <= window.end.getTime();
  });
}

function saveLoansData(loans) {
  try {
    dataStore.writeJson(LOANS_FILE, loans);
  } catch (err) {
    logError(`LOANS WRITE FAILED: ${err.message}`);
    throw err;
  }
}

function formatCurrency(value) {
  const amount = Number(value || 0);
  return `K ${amount.toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;
}

function calculateInterest(amount, tenureWeeks) {
  const rates = { 1: 0.10, 2: 0.16, 3: 0.24, 4: 0.32 };
  const rate = rates[parseInt(tenureWeeks)] || 0.10;
  const interest = Number(amount) * rate;
  return {
    rate: rate * 100,
    interest: Number(interest.toFixed(2)),
    total: Number((Number(amount) + interest).toFixed(2))
  };
}

function getApprovalDeadline(urgency) {
  const normalized = (urgency || 'standard').toLowerCase();
  const hours = { low: 72, standard: 48, urgent: 24, emergency: 4 };
  const ms = (hours[normalized] || hours.standard) * 60 * 60 * 1000;
  return new Date(Date.now() + ms).toISOString();
}

async function requestLoan(req, res) {
  try {
    const {
      email, product, amount, dueDate,
      tenureWeeks, urgency, paymentMode,
      nextPayment, collateralDescription, collateralGrade, agreedToTerms
    } = req.body;

    const authEmail = req.authUser?.email;
    const storeId = req.authUser?.storeId || config.DEFAULT_STORE_ID;

    if (!config.STORES.some(store => store.id === storeId && store.active)) {
      return res.status(403).json({ error: 'Loan requests are not enabled for this store.' });
    }

    if (!email || !product || !amount || !dueDate) {
      return res.status(400).json({ error: 'All loan request fields are required.' });
    }

    if (!authEmail || authEmail !== email) {
      return res.status(403).json({ error: 'Request denied. Device token does not match this account.' });
    }

    if (agreedToTerms !== 'true' && agreedToTerms !== true) {
      return res.status(400).json({ error: 'You must agree to the terms and conditions.' });
    }

    const requestedAmount = Number(amount);
    if (!requestedAmount || requestedAmount <= 0) {
      return res.status(400).json({ error: 'Loan amount must be a positive number.' });
    }

    const weeks = parseInt(tenureWeeks, 10) || 1;
    if (![1, 2, 3, 4].includes(weeks)) {
      return res.status(400).json({ error: 'Tenure must be between 1 and 4 weeks.' });
    }

    const normalizedUrgency = (urgency || 'standard').toLowerCase();
    if (!['low', 'standard', 'urgent', 'emergency'].includes(normalizedUrgency)) {
      return res.status(400).json({ error: 'Urgency must be low, standard, urgent, or emergency.' });
    }

    const { rate, interest, total } = calculateInterest(requestedAmount, weeks);
    const approvalDeadline = getApprovalDeadline(normalizedUrgency);

    const files = req.files || {};
    const collateralFront = files.collateralFront?.[0]?.filename || null;
    const collateralBack = files.collateralBack?.[0]?.filename || null;

    const loans = getLoansData();
    const nextId = loans.length ? Math.max(...loans.map(l => l.id)) + 1 : 1;

    const createdAt = new Date().toISOString();
    const loanReceiptIds = new Set(loans.map(l => String(l.receiptNumber || '')).filter(Boolean));
    const newLoan = {
      id: nextId,
      receiptNumber: generateLoanReceiptId(loanReceiptIds, new Date()),
      email,
      storeId,
      product,
      amount: requestedAmount,
      tenureWeeks: weeks,
      interestRate: rate,
      interestAmount: interest,
      totalRepayment: total,
      outstanding: total || requestedAmount,
      dueDate,
      urgency: normalizedUrgency,
      paymentMode: paymentMode || null,
      nextPayment: nextPayment || null,
      collateralDescription: collateralDescription || null,
      collateralFront,
      collateralBack,
      collateralGrade: collateralGrade || null,
      collateralVerified: false,
      agreedToTerms: true,
      status: 'pending',
      approvalDeadline,
      payments: [],
      statusHistory: [{
        status: 'pending',
        reason: 'Loan request submitted by borrower.',
        actor: email,
        source: 'borrower',
        updatedAt: createdAt
      }],
      createdAt
    };

    loans.push(newLoan);
    saveLoansData(loans);

    const requestEmail = emailService.buildRequestReceivedMessage(product, normalizedUrgency, email, newLoan);
    await emailService.sendCustomerEmail({
      to: email,
      subject: requestEmail.subject,
      text: requestEmail.body
    });

    const adminRecipients = emailService.getNotificationRecipients(email).filter(recipient => recipient.toLowerCase() !== String(email).trim().toLowerCase());
    if (adminRecipients.length) {
      const adminSummary = emailService.buildLoanSummaryText(newLoan);
      const adminAlert = {
        subject: `New loan request alert: ${product} — ${formatCurrency(newLoan.amount)} — ${String(newLoan.urgency || 'standard').toLowerCase()}`,
        text: `A new loan request has been submitted by ${email}.\n\n` +
          adminSummary +
          `Created: ${new Date().toISOString()}\n\n` +
          'Please review the request in the admin dashboard.'
      };

      await emailService.sendCustomerEmail({
        to: adminRecipients,
        subject: adminAlert.subject,
        text: adminAlert.text
      });
    }

    res.json({
      message: 'Loan request submitted successfully.',
      loan: {
        id: newLoan.id,
        amount: requestedAmount,
        interestRate: rate,
        interestAmount: interest,
        totalRepayment: total,
        approvalDeadline
      }
    });
  } catch (err) {
    logBreakage('loanController.js', 'requestLoan', err, 'LOANS REQUEST FAILED');
    res.status(500).json({ error: 'Unable to submit loan request.' });
  }
}

function getLoans(req, res) {
  try {
    const email = req.query.email;
    const filter = req.query.filter;
    const authEmail = req.authUser?.email;
    const isAdmin = isAdminRole(req.authUser?.role);
    const storeId = getRequestedStoreId(req);

    if (isAdmin && !canAccessStore(req, storeId)) {
      return res.status(403).json({ error: 'Access to this store is not allowed.' });
    }

    if (!email && !isAdmin) {
      return res.status(400).json({ error: 'Email is required to retrieve loans.' });
    }

    if (email && authEmail && authEmail !== email && !isAdmin) {
      return res.status(403).json({ error: 'Request denied. Device token does not match this account.' });
    }

    let loans = getLoansData().filter(loan => storeId === 'all' || getRecordStoreId(loan) === storeId);
    if (email) {
      loans = loans.filter(loan => loan.email === email);
    }

    if (filter && filter !== 'all') {
      loans = filterLoansByTimeframe(loans, filter);
    }

    // Always present payments with a reconciled ledger (paidTotal, outstanding,
    // balance before/after) so recorded payments show up identically for users
    // and admins — never depend on stale persisted balances.
    loans = loans.map(loan => rebuildPaymentLedger({ ...loan, payments: (loan.payments || []).map(p => ({ ...p })) }));

    const summary = calculateSummary(loans);
    const totalRequested = loans.reduce((sum, l) => sum + (l.amount || 0), 0);
    const totalInterest = loans.reduce((sum, l) => sum + (Number(l.interestAmount) || 0), 0);
    const totalRepayment = loans.reduce((sum, l) => sum + (Number(l.totalRepayment) || Number(l.amount) || 0), 0);

    res.json({
      loans,
      summary: {
        ...summary,
        totalRequested,
        totalInterest,
        totalRepayment
      }
    });
  } catch (err) {
    logError(`LOANS ROUTE FAILED: ${err.message}`);
    res.status(500).json({ error: 'Unable to load loan information.' });
  }
}

// ─── GET /loans/search?receiptId=... (Task 1: any authenticated user) ────────
function searchByReceiptId(req, res) {
  try {
    const receiptId = String(req.query.receiptId || req.query.q || '').trim();
    if (!receiptId) {
      return res.status(400).json({ error: 'receiptId query parameter is required.' });
    }

    const loans = searchLoansByReceipt(getEnrichedLoans(), receiptId);
    if (!loans.length) {
      return res.status(404).json({ error: `No loan found for receipt ID "${receiptId}".` });
    }

    // Non-admins may only pull up their own loans.
    const isAdmin = isAdminRole(req.authUser?.role);
    const requester = String(req.authUser?.email || '').trim().toLowerCase();
    const visible = isAdmin ? loans : loans.filter(loan =>
      String(loan.email || '').trim().toLowerCase() === requester);

    if (!visible.length) {
      return res.status(404).json({ error: `No loan found for receipt ID "${receiptId}".` });
    }

    return res.json({
      query: receiptId,
      total: visible.length,
      loans: visible,
      payments: visible.flatMap(loan =>
        (Array.isArray(loan.payments) ? loan.payments : [])
          .filter(payment => String(payment.paymentReceiptId || '').toLowerCase() === receiptId.toLowerCase())
          .map(payment => ({ loanId: loan.id, loanReceiptId: loan.receiptNumber, ...payment })))
    });
  } catch (err) {
    logError(`RECEIPT SEARCH FAILED: ${err.message}`);
    return res.status(500).json({ error: 'Unable to search receipts.' });
  }
}

function getLoanById(req, res) {
  try {
    const id = Number(req.params.id);
    const authEmail = req.authUser?.email;
    const isAdmin = isAdminRole(req.authUser?.role);
    const loans = getLoansData();
    const loan = loans.find(l => l.id === id);

    if (!loan) return res.status(404).json({ error: 'Loan not found.' });

    if (!authEmail && !isAdmin) {
      return res.status(403).json({ error: 'Access denied.' });
    }

    if (authEmail !== loan.email && !isAdmin) {
      return res.status(403).json({ error: 'Access denied.' });
    }

    if (isAdmin && !canAccessRecord(req, loan)) {
      return res.status(403).json({ error: 'Access to this store is not allowed.' });
    }

    // Rebuild the ledger here too (not just in getLoans) so the single-loan
    // detail view can never show stale paidTotal/outstanding — recorded
    // payments must appear identically on the list and the detail panel.
    const today = new Date().toISOString().slice(0, 10);
    const detail = { ...loan, payments: (loan.payments || []).map(p => ({ ...p })) };
    applyGraceAccrual(detail, today); // read-only; same value re-derives on every load
    rebuildPaymentLedger(detail);
    res.json({ loan: { ...detail, businessStatus: deriveLoanStatus(detail, today) } });
  } catch (err) {
    logError(`GET LOAN FAILED: ${err.message}`);
    res.status(500).json({ error: 'Unable to load loan.' });
  }
}

async function updateLoanStatus(req, res) {
  try {
    // Loan DECISIONS stay restricted to the assigned store admin (tested
    // franchise-scoping policy); payments/notifications use isAdminRole instead.
    if (req.authUser?.role !== 'store_admin') {
      return res.status(403).json({ error: 'Loan decisions are restricted to the assigned store admin.' });
    }
    const id = Number(req.params.id);
    const { action, amount, collateralGrade, collateralVerified, nextPayment, reason, graceUntil } = req.body;
    const authEmail = req.authUser?.email;
    const isAdmin = req.authUser?.role === 'store_admin';
    const normalizedAction = String(action || '').trim().toLowerCase().replace(/\s+/g, '_');

    const loans = getLoansData();
    const idx = loans.findIndex(l => l.id === id);
    if (idx < 0) return res.status(404).json({ error: 'Loan not found.' });
    const loan = loans[idx];

    if (isAdmin && !canAccessRecord(req, loan)) {
      return res.status(403).json({ error: 'Access to this store is not allowed.' });
    }

    if (!isAdmin && authEmail !== loan.email) {
      return res.status(403).json({ error: 'Access denied.' });
    }

    if (['approve', 'approved'].includes(normalizedAction) && isAdmin) {
      // Canonical status is 'active' — 'approved' is a legacy value that only
      // exists in LEGACY_STATUS_MAP for old records (AGENTS.md canonical list).
      loan.status = 'active';
      loan.adminReason = reason || loan.adminReason || 'Approved by admin.';
      const approvedAt = new Date();
      const approvalDelayDays = Math.max(0, Math.ceil((approvedAt - new Date(loan.createdAt || Date.now())) / (1000 * 60 * 60 * 24)));
      const adjustedWeeks = Math.max(Number(loan.tenureWeeks) || 1, 1);
      const approvalWindow = approvedAt.getTime() + (adjustedWeeks * 7 + Math.max(0, approvalDelayDays)) * 24 * 60 * 60 * 1000;
      loan.approvedAt = approvedAt.toISOString();
      // Borrowed date IS the approval date (BMF loan contract rule).
      loan.borrowedDate = approvedAt.toISOString().slice(0, 10);
      loan.dueDate = new Date(approvalWindow).toISOString().slice(0, 10);
      rebuildPaymentLedger(loan);
    } else if (['in_progress', 'in-progress', 'start', 'started'].includes(normalizedAction) && isAdmin) {
      loan.status = 'active'; // canonical — 'in_progress' is legacy-mapped only
      loan.adminReason = reason || loan.adminReason || 'Loan is now in progress.';
    } else if (['decline', 'declined', 'reject', 'rejected'].includes(normalizedAction) && isAdmin) {
      loan.status = 'declined';
      loan.adminReason = reason || loan.adminReason || 'Loan declined by admin.';
    } else if (['enter_grace', 'enter-grace', 'start_grace', 'grace'].includes(normalizedAction) && isAdmin) {
      const agreed = parseDateInput(graceUntil);
      if (!agreed) {
        return res.status(400).json({ error: 'Entering grace requires an agreed grace-until date (YYYY-MM-DD or DD/MM/YYYY).' });
      }
      const today = new Date().toISOString().slice(0, 10);
      if (agreed <= today) {
        return res.status(400).json({ error: 'The agreed grace date must be in the future.' });
      }
      loan.status = 'grace';
      loan.graceUntil = agreed;
      loan.graceDailyRate = GRACE_DAILY_RATE;
      loan.adminReason = reason ||
        `Grace entered by admin — agreed until ${agreed}; 1.8% per day accrues on the outstanding balance.`;
    } else if (['verify_overdue', 'verify-overdue', 'mark_overdue', 'confirm_overdue'].includes(normalizedAction) && isAdmin) {
      if (Number(loan.outstanding || 0) <= 0) {
        return res.status(400).json({ error: 'Loan is already settled — nothing to verify.' });
      }
      loan.status = 'defaulted';
      loan.verifiedOverdueAt = new Date().toISOString();
      loan.verifiedOverdueBy = req.authUser?.email || 'admin';
      loan.adminReason = reason || 'Overdue verified by admin — loan moved to defaulted.';
    } else if (['default', 'defaulted', 'mark_default'].includes(normalizedAction) && isAdmin) {
      loan.status = 'defaulted';
      // Stamp the manual decision so the clock cannot flip the loan back.
      loan.verifiedOverdueAt = loan.verifiedOverdueAt || new Date().toISOString();
      loan.verifiedOverdueBy = loan.verifiedOverdueBy || req.authUser?.email || 'admin';
      loan.adminReason = reason || loan.adminReason || 'Marked as defaulted by admin.';
    } else if (['liquidate', 'liquidated', 'recover', 'recovered'].includes(normalizedAction) && isAdmin) {
      if (!String(reason || '').trim()) {
        return res.status(400).json({ error: 'Liquidation requires a reason — confirm what happened to the collateral.' });
      }
      loan.status = 'liquidated';
      loan.liquidatedAt = new Date().toISOString();
      loan.adminReason = reason;
    } else if (action === 'grade' && isAdmin) {
      loan.collateralGrade = collateralGrade;
      loan.collateralVerified = collateralVerified === 'true';
    } else if (action === 'next-payment') {
      loan.nextPayment = nextPayment;
    } else {
      return res.status(400).json({ error: 'Invalid action or insufficient permissions.' });
    }

    const decisionText = loan.adminReason || reason || 'Reviewed by our team.';
    recordStatusHistory(loan, loan.status, decisionText, req.authUser?.email || 'admin', isAdmin ? 'admin' : 'customer');

    loan.updatedAt = new Date().toISOString();
    loan.reviewedBy = req.authUser?.email || null;
    loan.reviewedAt = new Date().toISOString();
    loans[idx] = loan;
    saveLoansData(loans);

    const decisionEmail = emailService.buildLoanStatusNotification(normalizedAction, loan.product, decisionText, loan.email, loan);
    await emailService.sendCustomerEmail({
      to: loan.email,
      subject: decisionEmail.subject,
      text: decisionEmail.body
    });

    const adminRecipients = emailService.getNotificationRecipients(loan.email).filter(recipient => recipient.toLowerCase() !== String(loan.email).trim().toLowerCase());
    if (adminRecipients.length) {
      const reportLines = getLoansData()
        .map(item => {
          const history = Array.isArray(item.statusHistory) && item.statusHistory.length ? item.statusHistory[item.statusHistory.length - 1].status : item.status || 'pending';
          return `- Loan #${item.id}: ${item.email} | ${item.product || 'Loan'} | ${formatCurrency(item.amount || 0)} | status: ${history} | reason: ${item.adminReason || 'No reason provided'} | updated: ${item.updatedAt || item.createdAt || 'unknown'}`;
        })
        .join('\n');

      await emailService.sendCustomerEmail({
        to: adminRecipients,
        subject: `Loan audit report — ${new Date().toISOString().slice(0, 10)}`,
        text: `Loan audit report for Pryme Vertex\n\n${reportLines || 'No loan activity recorded.'}`
      });
    }

    res.json({ message: 'Loan updated.', loan });
  } catch (err) {
    logBreakage('loanController.js', 'updateLoanStatus', err, 'UPDATE LOAN FAILED');
    res.status(500).json({ error: 'Unable to update loan.' });
  }
}

function getAllLoans(req, res) {
  try {
    const isAdmin = isAdminRole(req.authUser?.role);
    if (!isAdmin) return res.status(403).json({ error: 'Admin access required.' });

    const storeId = getRequestedStoreId(req);
    if (!canAccessStore(req, storeId)) return res.status(403).json({ error: 'Access to this store is not allowed.' });
    const loans = getLoansData().filter(loan => storeId === 'all' || getRecordStoreId(loan) === storeId);
    // Canonical buckets only (pending/active/grace/defaulted/liquidated/paid/
    // declined). Legacy stored values (approved, in_progress, overdue…) are
    // counted under the live status deriveLoanStatus maps them onto.
    const summary = {
      total: loans.length,
      pending: loans.filter(l => deriveLoanStatus(l) === 'pending').length,
      active: loans.filter(l => deriveLoanStatus(l) === 'active').length,
      grace: loans.filter(l => deriveLoanStatus(l) === 'grace').length,
      defaulted: loans.filter(l => deriveLoanStatus(l) === 'defaulted').length,
      liquidated: loans.filter(l => deriveLoanStatus(l) === 'liquidated').length,
      paid: loans.filter(l => deriveLoanStatus(l) === 'paid').length,
      declined: loans.filter(l => deriveLoanStatus(l) === 'declined').length,
      totalOutstanding: loans.reduce((sum, l) => sum + (l.outstanding || 0), 0)
    };
    res.json({ summary, loans });
  } catch (err) {
    logError(`ADMIN LOANS FETCH ERROR: ${err.message}`);
    res.status(500).json({ error: 'Could not load loans.' });
  }
}

function recordPayment(req, res) {
  try {
    const { id, amount, mode, note } = req.body;
    if (!isAdminRole(req.authUser?.role)) return res.status(403).json({ error: 'BMF store admin access required.' });

    const screenshot = req.files?.screenshot?.[0]?.filename || null;
    const loans = getLoansData();
    const index = loans.findIndex(l => l.id === Number(id));
    if (index === -1) return res.status(404).json({ error: 'Loan not found.' });
    if (!canAccessRecord(req, loans[index])) return res.status(403).json({ error: 'Access to this store is not allowed.' });

    const paymentAmount = Number(amount);
    if (!Number.isFinite(paymentAmount) || paymentAmount <= 0 || paymentAmount > Number(loans[index].outstanding || 0)) {
      return res.status(400).json({ error: 'Payment must be positive and cannot exceed the outstanding balance.' });
    }

    if (!loans[index].payments) loans[index].payments = [];

    const balanceBefore = Number(loans[index].outstanding || 0);
    const recordedAt = new Date().toISOString();
    const usedPaymentIds = new Set(
      loans.flatMap(l => (l.payments || []).map(p => String(p.paymentReceiptId || '')).filter(Boolean))
    );
    const payment = {
      // Task 2 — every field the BMF repayment tracking sheet needs.
      paymentReceiptId: generatePaymentReceiptId(usedPaymentIds, new Date()),
      amount: paymentAmount,
      paymentDate: recordedAt,
      balanceBefore,
      balanceAfter: Number(Math.max(0, balanceBefore - paymentAmount).toFixed(2)),
      mode: normalizePaymentMode(mode),
      note: note || null,
      description: note || null,
      screenshot,
      date: recordedAt,
      recordedBy: req.authUser?.email || 'admin',
      receiptNumber: `${loans[index].receiptNumber || `BMF-${loans[index].id}`}-P${String(loans[index].payments.length + 1).padStart(2, '0')}`
    };

    loans[index].payments.push(payment);
    rebuildPaymentLedger(loans[index]);
    loans[index].updatedBy = req.authUser?.email || 'admin';
    if (loans[index].outstanding === 0) {
      loans[index].status = 'paid';
      loans[index].settledAt = recordedAt;
    }
    recordStatusHistory(loans[index], loans[index].status, `Payment of ${formatCurrency(payment.amount)} recorded.`, req.authUser?.email || 'admin', 'admin');
    loans[index].updatedAt = recordedAt;

    saveLoansData(loans);
    res.json({ message: 'Payment recorded.', outstanding: loans[index].outstanding, payment });
  } catch (err) {
    logBreakage('loanController.js', 'recordPayment', err, 'PAYMENT RECORD ERROR');
    res.status(500).json({ error: 'Could not record payment.' });
  }
}

async function sendLoanNotification(req, res) {
  try {
    const id = Number(req.params.id);
    const { messageType } = req.body; // e.g., 'overdue', 'reminder'
    if (!isAdminRole(req.authUser?.role)) return res.status(403).json({ error: 'BMF store admin access required.' });

    const loans = getLoansData();
    const loan = loans.find(l => l.id === id);
    if (!loan) return res.status(404).json({ error: 'Loan not found.' });
    if (!canAccessRecord(req, loan)) return res.status(403).json({ error: 'Access to this store is not allowed.' });

    let subject = 'Loan Update - Pryme Vertex';
    let text = '';

    if (messageType === 'overdue') {
      subject = 'URGENT: Your Loan is Overdue';
      text = `Dear customer,\n\nThis is a notification that your loan for ${loan.product} is currently overdue. \n\nOutstanding Amount: ${formatCurrency(loan.outstanding)}\nDue Date: ${loan.dueDate}\n\nPlease make a payment as soon as possible to avoid further penalties.`;
    } else {
      text = `Hello,\n\nThis is a reminder regarding your loan for ${loan.product}.\n\nOutstanding Amount: ${formatCurrency(loan.outstanding)}\nDue Date: ${loan.dueDate}\n\nThank you.`;
    }

    const result = await emailService.sendCustomerEmail({
      to: loan.email,
      subject,
      text
    });
    logError(`NOTIFICATION SENT | loan ${loan.receiptNumber || `#${loan.id}`} | ${messageType || 'reminder'} | to ${loan.email} | result ${result?.ok ? 'ok' : (result?.skipped ? 'skipped' : (result?.reason || 'failed'))}`);
    if (!result?.ok && !result?.skipped) {
      return res.status(502).json({ error: result?.reason || 'Notification email could not be delivered.' });
    }

    res.json({ message: 'Notification sent successfully.' });
  } catch (err) {
    logBreakage('loanController.js', 'sendLoanNotification', err, 'NOTIFICATION SEND ERROR');
    res.status(500).json({ error: 'Could not send notification.' });
  }
}

async function notifyUser(req, res) {
  try {
    const { email } = req.body || {};
    const authRole = req.authUser?.role;
    if (authRole !== 'admin' && authRole !== 'store_admin') {
      return res.status(403).json({ error: 'Admin access required.' });
    }
    const target = String(email || '').trim().toLowerCase();
    if (!target) {
      return res.status(400).json({ error: 'Customer email is required.' });
    }

    const storeId = getRequestedStoreId(req);
    if (!canAccessStore(req, storeId)) {
      return res.status(403).json({ error: 'Access to this store is not allowed.' });
    }

    const loans = getLoansData().filter(loan =>
      (storeId === 'all' || getRecordStoreId(loan) === storeId) &&
      String(loan.email || '').trim().toLowerCase() === target
    );
    if (!loans.length) {
      return res.status(404).json({ error: 'No loans found for that customer in this store.' });
    }

    const activeLoans = loans.filter(loan => Number(loan.outstanding || 0) > 0);
    const outstandingTotal = activeLoans.reduce((sum, loan) => sum + Number(loan.outstanding || 0), 0);
    const loanDetails = activeLoans.map(loan =>
      `- ${loan.product || 'Loan'} ${loan.receiptNumber || `#${loan.id}`}: ` +
      `outstanding ${formatCurrency(loan.outstanding)}, due ${loan.dueDate || 'date unavailable'}`
    ).join('\n');

    const subject = 'BMF Loan Reminder';
    const text = `Hello,\n\nThis is a reminder from Buraza Micro Finance (BMF) regarding your loan account.\n\n` +
      (activeLoans.length
        ? `Open balance(s):\n${loanDetails}\n\nTotal outstanding: ${formatCurrency(outstandingTotal)}\n\nKindly settle the outstanding balance to continue enjoying the BMF loan service.\n`
        : `Our records show no open balance on your account. Thank you for staying up to date.\n`) +
      `\nRegards,\nBuraza Micro Finance (BMF), a Pryme Vertex subsidiary.`;

    const result = await emailService.sendCustomerEmail({ to: target, subject, text });
    logError(`NOTIFICATION SENT | user | to ${target} | loans ${loans.length} | outstanding ${formatCurrency(outstandingTotal)}`);
    if (!result?.ok && !result?.skipped) {
      return res.status(502).json({ error: result?.reason || 'Notification email could not be delivered.' });
    }

    return res.json({
      message: `Notification sent to ${target}.`,
      email: target,
      loans: loans.length,
      openLoans: activeLoans.length,
      outstandingTotal: Number(outstandingTotal.toFixed(2)),
      skipped: Boolean(result?.skipped)
    });
  } catch (err) {
    logError(`NOTIFY USER FAILED: ${err.message}`);
    return res.status(500).json({ error: 'Unable to send the notification.' });
  }
}

async function notifyAllOverdue(req, res) {
  try {
    if (!isAdminRole(req.authUser?.role)) {
      return res.status(403).json({ error: 'BMF store admin access required.' });
    }
    if (Array.isArray(req.authUser?.restrictions) && req.authUser.restrictions.includes('notifyAll')) {
      return res.status(403).json({ error: 'You are not permitted to send notifications to all customers. Ask the franchise admin to lift this restriction.' });
    }

    const storeId = getRequestedStoreId(req);
    if (!canAccessStore(req, storeId)) return res.status(403).json({ error: 'Access to this store is not allowed.' });
    const today = new Date().toISOString().slice(0, 10);
    const overdueLoans = getLoansData().filter(loan => (storeId === 'all' || getRecordStoreId(loan) === storeId)).filter(loan => {
      const status = normalizeLoanStatus(loan.status);
      const outstanding = Number(loan.outstanding || 0);
      const dueDate = String(loan.dueDate || '');
      const pastDue = /^\d{4}-\d{2}-\d{2}$/.test(dueDate) && dueDate < today;
      // Liquidated (and its legacy 'recovered' wording) is closed-off via
      // collateral — never chase those customers for an overdue balance.
      return outstanding > 0 && !['declined', 'paid', 'liquidated', 'recovered'].includes(status) && (status === 'overdue' || pastDue);
    });

    const loansByEmail = new Map();
    overdueLoans.forEach(loan => {
      const email = String(loan.email || '').trim().toLowerCase();
      if (!email) return;
      if (!loansByEmail.has(email)) loansByEmail.set(email, []);
      loansByEmail.get(email).push(loan);
    });

    let sent = 0;
    let failed = 0;
    for (const [email, customerLoans] of loansByEmail) {
      const loanDetails = customerLoans.map(loan =>
        `- ${loan.product || 'Loan'} #${loan.id}: outstanding ${formatCurrency(loan.outstanding)}, due ${loan.dueDate || 'date unavailable'}`
      ).join('\n');
      const result = await emailService.sendCustomerEmail({
        to: email,
        subject: 'Buraza Micro Finance (BMF): overdue loan notice',
        text: `Dear customer,\n\nOur records show the following Buraza loan balance(s) are overdue:\n${loanDetails}\n\nPlease contact Buraza Micro Finance to arrange payment. If you have already paid, please disregard this notice.\n\nRegards,\nBuraza Micro Finance (BMF), a Pryme Vertex subsidiary.`
      });
      if (result?.ok) sent += 1;
      else failed += 1;
    }

    return res.status(failed ? 207 : 200).json({
      message: loansByEmail.size
        ? `Overdue notices sent to ${sent} customer${sent === 1 ? '' : 's'}${failed ? `; ${failed} failed` : ''}.`
        : 'No customers currently have overdue loan balances.',
      sent,
      failed,
      overdueLoans: overdueLoans.length,
      customers: loansByEmail.size
    });
  } catch (err) {
    logBreakage('loanController.js', 'notifyAllOverdue', err, 'BULK OVERDUE NOTIFICATION FAILED');
    return res.status(500).json({ error: 'Unable to send overdue notices.' });
  }
}

// Admin manual loan entry — creates an already-disbursed (active) loan for a
// registered customer, bypassing the borrower-only guard on requestLoan. No
// customer email is sent (admin is recording an agreed, in-person loan).
async function createAdminLoan(req, res) {
  try {
    if (!isAdminRole(req.authUser?.role)) return res.status(403).json({ error: 'Admin access required to create loans.' });

    const {
      email, product, amount, dueDate, tenureWeeks,
      urgency, paymentMode, collateralDescription, collateralGrade, adminReason
    } = req.body;

    const storeId = getRequestedStoreId(req);
    if (!canAccessStore(req, storeId)) return res.status(403).json({ error: 'Access to this store is not allowed.' });

    if (!email || !product || !amount) {
      return res.status(400).json({ error: 'Customer email, product, and loan amount are required.' });
    }

    const users = dataStore.readJson(USERS_FILE, [], Array.isArray);
    const customer = users.find(u => String(u.email || '').trim().toLowerCase() === String(email).trim().toLowerCase());
    if (!customer) return res.status(400).json({ error: 'No registered customer matches that email.' });

    const requestedAmount = Number(amount);
    if (!Number.isFinite(requestedAmount) || requestedAmount <= 0) {
      return res.status(400).json({ error: 'Loan amount must be a positive number.' });
    }

    const weeks = parseInt(tenureWeeks, 10) || 1;
    if (![1, 2, 3, 4].includes(weeks)) {
      return res.status(400).json({ error: 'Tenure must be between 1 and 4 weeks.' });
    }

    const normalizedUrgency = (urgency || 'standard').toLowerCase();
    if (!['low', 'standard', 'urgent', 'emergency'].includes(normalizedUrgency)) {
      return res.status(400).json({ error: 'Urgency must be low, standard, urgent, or emergency.' });
    }

    const { rate, interest, total } = calculateInterest(requestedAmount, weeks);
    const now = new Date();
    const approvedAt = now.toISOString();
    const borrowedDate = approvedAt.slice(0, 10);
    const computedDueDate = dueDate
      ? String(dueDate).slice(0, 10)
      : new Date(now.getTime() + weeks * 7 * 24 * 60 * 60 * 1000).toISOString().slice(0, 10);

    const files = req.files || {};
    const collateralFront = files.collateralFront?.[0]?.filename || null;
    const collateralBack = files.collateralBack?.[0]?.filename || null;

    const loans = getLoansData();
    const nextId = loans.length ? Math.max(...loans.map(l => l.id)) + 1 : 1;
    const loanReceiptIds = new Set(loans.map(l => String(l.receiptNumber || '')).filter(Boolean));

    const activatingAdmin = req.authUser?.email || 'admin';
    const reason = adminReason || `Loan created and activated by ${activatingAdmin}.`;
    const newLoan = {
      id: nextId,
      receiptNumber: generateLoanReceiptId(loanReceiptIds, now),
      email: String(email).trim().toLowerCase(),
      storeId,
      product,
      amount: requestedAmount,
      tenureWeeks: weeks,
      interestRate: rate,
      interestAmount: interest,
      totalRepayment: total,
      outstanding: total || requestedAmount,
      dueDate: computedDueDate,
      urgency: normalizedUrgency,
      paymentMode: paymentMode || null,
      nextPayment: null,
      collateralDescription: collateralDescription || null,
      collateralFront,
      collateralBack,
      collateralGrade: collateralGrade || null,
      collateralVerified: false,
      agreedToTerms: true,
      status: 'active',
      adminReason: reason,
      graceUntil: null,
      graceDailyRate: GRACE_DAILY_RATE,
      graceAccrued: 0,
      graceAccrualBase: null,
      graceAccrualStart: null,
      graceLastAccrual: null,
      verifiedOverdueAt: null,
      verifiedOverdueBy: null,
      approvalDeadline: null,
      approvedAt,
      borrowedDate,
      reviewedBy: req.authUser?.email || 'admin',
      reviewedAt: approvedAt,
      updatedBy: req.authUser?.email || 'admin',
      payments: [],
      statusHistory: [{
        status: 'active',
        reason,
        actor: req.authUser?.email || 'admin',
        source: 'admin',
        updatedAt: approvedAt
      }],
      createdAt: approvedAt,
      updatedAt: approvedAt
    };

    rebuildPaymentLedger(newLoan);
    loans.push(newLoan);
    saveLoansData(loans);

    res.status(201).json({
      message: 'Loan created and marked active.',
      loan: {
        id: newLoan.id,
        receiptNumber: newLoan.receiptNumber,
        amount: requestedAmount,
        interestRate: rate,
        interestAmount: interest,
        totalRepayment: total,
        outstanding: newLoan.outstanding,
        status: newLoan.status
      }
    });
  } catch (err) {
    logBreakage('loanController.js', 'createAdminLoan', err, 'ADMIN LOAN CREATE FAILED');
    res.status(500).json({ error: 'Unable to create the loan.' });
  }
}

module.exports = {
  upload,
  getLoans,
  requestLoan,
  getLoanById,
  updateLoanStatus,
  getAllLoans,
  recordPayment,
  sendLoanNotification,
  notifyUser,
  notifyAllOverdue,
  createAdminLoan,
  calculateInterest,
  getApprovalDeadline,
  filterLoansByTimeframe,
  getLoanTimeframeWindow,
  getLoansData,
  saveLoansData,
  migrateLoans,
  getEnrichedLoans,
  rebuildPaymentLedger,
  sumPayments,
  generateLoanReceiptId,
  generatePaymentReceiptId,
  ensureReceiptNumbers,
  normalizeStatus,
  deriveLoanStatus,
  applyGraceAccrual,
  accrueAllGrace,
  GRACE_DAILY_RATE,
  parseDateInput,
  calculateSummary,
  summarizeStore,
  searchLoansByReceipt,
  searchByReceiptId,
  normalizePaymentMode,
  PAYMENT_MODES,
  daysBetween
};