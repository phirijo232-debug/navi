'use strict';

const fs = require('fs');
const crypto = require('crypto');
const os = require('os');
const path = require('path');
const emailService = require('./email');
const { logError } = require('./logger');

const LIVE_LOG_FILE = path.join(__dirname, '..', 'logs', 'audit.log');
const MAX_BYTES = 10 * 1024 * 1024;
const ALERT_WINDOW_MS = 15 * 60 * 1000;
const BORROWER_ADVISORY_WINDOW_MS = 24 * 60 * 60 * 1000;
const BRUTE_WINDOW_MS = 10 * 60 * 1000;
const BRUTE_THRESHOLD = 5;
const SENSITIVE_KEY = /(password|passphrase|secret|token|otp|authorization|cookie|credential|file.?content|buffer)/i;

function isTestEnvironment() {
  return Boolean(process.env.NODE_TEST_CONTEXT) || process.argv.some(arg => /(?:^|[\\/])test(?:[\\/]|$)/i.test(arg));
}

function resolveAuditFile() {
  if (process.env.NAVI_AUDIT_LOG_FILE) return path.resolve(process.env.NAVI_AUDIT_LOG_FILE);
  if (process.env.NAVI_LOGS_DIR) return path.join(path.resolve(process.env.NAVI_LOGS_DIR), 'audit.log');
  if (isTestEnvironment()) {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'navi-audit-test-'));
    return path.join(dir, 'audit.log');
  }
  return LIVE_LOG_FILE;
}

const LOG_FILE = resolveAuditFile();
const alertSentAt = new Map();
const advisorySentAt = new Map();
const failedAttempts = new Map();
const reportedTamperStates = new Set();

const ACTIONS = Object.freeze({
  APPLICATION_SUBMITTED: 'APPLICATION_SUBMITTED',
  APPLICATION_APPROVED: 'APPLICATION_APPROVED',
  APPLICATION_REJECTED: 'APPLICATION_REJECTED',
  APPLICATION_INFO_REQUESTED: 'APPLICATION_INFO_REQUESTED',
  INVITE_LINK_GENERATED: 'INVITE_LINK_GENERATED',
  INVITE_LINK_SENT: 'INVITE_LINK_SENT',
  LOAN_CREATED: 'LOAN_CREATED',
  LOAN_STATUS_CHANGED: 'LOAN_STATUS_CHANGED',
  LOAN_APPROVED: 'LOAN_APPROVED',
  LOAN_DECLINED: 'LOAN_DECLINED',
  LOAN_CLOSED: 'LOAN_CLOSED',
  LOAN_DEFAULTED: 'LOAN_DEFAULTED',
  PAYMENT_SUBMITTED: 'PAYMENT_SUBMITTED',
  PAYMENT_RECORDED: 'PAYMENT_RECORDED',
  PAYMENT_REJECTED: 'PAYMENT_REJECTED',
  USER_CREATED: 'USER_CREATED',
  USER_RESTRICTED: 'USER_RESTRICTED',
  USER_UNRESTRICTED: 'USER_UNRESTRICTED',
  USER_LOGIN: 'USER_LOGIN',
  USER_LOGIN_FAILED: 'USER_LOGIN_FAILED',
  USER_LOGOUT: 'USER_LOGOUT',
  REPORT_GENERATED: 'REPORT_GENERATED',
  SERVER_STARTED: 'SERVER_STARTED',
  SYSTEM_ERROR: 'SYSTEM_ERROR',
  THREAT_UNAUTHORISED_ADMIN: 'THREAT_UNAUTHORISED_ADMIN',
  THREAT_BRUTE_FORCE: 'THREAT_BRUTE_FORCE',
  THREAT_RESTRICTED_LOGIN: 'THREAT_RESTRICTED_LOGIN',
  THREAT_DATA_CORRUPTION: 'THREAT_DATA_CORRUPTION',
  THREAT_FORBIDDEN_PROMOTION: 'THREAT_FORBIDDEN_PROMOTION',
  THREAT_UNKNOWN_ROUTE: 'THREAT_UNKNOWN_ROUTE',
  THREAT_AFTER_HOURS_MONEY: 'THREAT_AFTER_HOURS_MONEY',
  THREAT_TAMPER_DETECTED: 'THREAT_TAMPER_DETECTED'
});

const THREAT_ACTIONS = new Set(Object.values(ACTIONS).filter(action => action.startsWith('THREAT_')));

function redact(value, key = '', depth = 0) {
  if (SENSITIVE_KEY.test(key)) return '[redacted]';
  if (value == null || typeof value === 'boolean' || typeof value === 'number') return value;
  if (typeof value === 'string') return value.length > 1000 ? `${value.slice(0, 1000)}…[truncated]` : value;
  if (Buffer.isBuffer(value)) return `[binary data omitted: ${value.length} bytes]`;
  if (depth >= 5) return '[maximum detail depth reached]';
  if (Array.isArray(value)) return value.slice(0, 100).map(item => redact(item, '', depth + 1));
  if (typeof value === 'object') {
    const clean = {};
    for (const [childKey, childValue] of Object.entries(value).slice(0, 100)) {
      clean[childKey] = redact(childValue, childKey, depth + 1);
    }
    return clean;
  }
  return String(value);
}

function parseRecipients() {
  const configured = process.env.GUARDIAN_EMAILS || process.env.ADMIN_EMAILS || '';
  const sender = String(process.env.GMAIL_USER || '').trim().toLowerCase();
  return [...new Set(configured.split(',')
    .map(value => value.trim())
    .filter(value => value && value.toLowerCase() !== sender))];
}

function cleanupMap(map, now, maxAge) {
  for (const [key, time] of map) if (now - time >= maxAge) map.delete(key);
}

function auditHashPayload(record) {
  const { hash, ...payload } = record;
  return JSON.stringify(payload);
}

function hashAuditRecord(record) {
  return crypto.createHash('sha256').update(auditHashPayload(record)).digest('hex');
}

function readRawAuditLines() {
  try { return fs.readFileSync(LOG_FILE, 'utf8').split(/\r?\n/).filter(Boolean); }
  catch (err) { if (err.code === 'ENOENT') return []; throw err; }
}

function lastAuditHash() {
  const lines = readRawAuditLines();
  for (let i = lines.length - 1; i >= 0; i -= 1) {
    try {
      const record = JSON.parse(lines[i]);
      if (typeof record.hash === 'string') return record.hash;
    } catch { /* verification reports malformed lines; append still proceeds */ }
  }
  return null;
}

function verifyAuditLog() {
  try {
    const lines = readRawAuditLines();
    const issues = [];
    let previousHash = null;
    let verified = 0;
    lines.forEach((line, index) => {
      let record;
      try { record = JSON.parse(line); }
      catch { issues.push({ line: index + 1, reason: 'INVALID_JSON' }); return; }
      if (typeof record.hash !== 'string' || typeof record.previousHash !== 'string' && record.previousHash !== null) {
        issues.push({ line: index + 1, reason: 'UNHASHED_LEGACY_ENTRY' });
        return;
      }
      if (record.previousHash !== previousHash) {
        issues.push({ line: index + 1, reason: 'CHAIN_LINK_MISMATCH' });
      }
      if (hashAuditRecord(record) !== record.hash) {
        issues.push({ line: index + 1, reason: 'HASH_MISMATCH' });
      }
      previousHash = record.hash;
      verified += 1;
    });
    const result = { valid: issues.length === 0, verified, total: lines.length, issues };
    if (!result.valid) {
      const state = issues.map(issue => `${issue.line}:${issue.reason}:${crypto.createHash('sha256').update(lines[issue.line - 1] || '').digest('hex')}`).join('|');
      if (!reportedTamperStates.has(state)) {
        const event = writeAudit({
          action: ACTIONS.THREAT_TAMPER_DETECTED,
          actor: 'system',
          targetId: 'audit.log',
          detail: { issueCount: issues.length, issues: issues.slice(0, 50), state: crypto.createHash('sha256').update(state).digest('hex') }
        });
        if (event) reportedTamperStates.add(state);
      }
    }
    return result;
  } catch (err) {
    return { valid: false, verified: 0, total: 0, issues: [{ line: null, reason: 'READ_FAILED', message: err.message }] };
  }
}

function alertSignature(record) {
  const detail = record.detail || {};
  return [record.action, record.targetId || '', detail.issueType || '', detail.path || '', detail.message || ''].join('|');
}

async function sendGuardianAlert(record) {
  if (isTestEnvironment() && process.env.NAVI_TEST_AUDIT_EMAILS !== 'true') return;
  const recipients = parseRecipients();
  if (!recipients.length) return;
  const now = Date.now();
  cleanupMap(alertSentAt, now, ALERT_WINDOW_MS);
  const signature = alertSignature(record);
  if (alertSentAt.has(signature)) return;
  alertSentAt.set(signature, now);

  const localTime = new Date(record.timestamp).toLocaleString('en-ZM', {
    timeZone: 'Africa/Lusaka', dateStyle: 'medium', timeStyle: 'medium'
  });
  const subject = `[BMF SECURITY ALERT] ${record.action} — ${localTime}`;
  const text = [
    'BMF Security Alert',
    `Alert: ${record.action.replace(/_/g, ' ')}`,
    `Time (Lusaka): ${localTime}`,
    `Actor: ${record.actor}`,
    `Target: ${record.targetId || '—'}`,
    `IP: ${record.ip || '—'}`,
    `Details: ${JSON.stringify(record.detail || {})}`,
    '',
    'Review the audit log in NaviServer admin.'
  ].join('\n');
  const result = await emailService.sendCustomerEmail({ to: recipients, subject, text });
  if (!result?.ok && !result?.skipped) {
    logError(`[AUDIT GUARDIAN] Guardian email failed: ${result?.reason || 'delivery failed'}`, true);
  } else if (result?.skipped) {
    logError(`[AUDIT GUARDIAN] Guardian email skipped: ${result.reason || 'email configuration unavailable'}`, true);
  }
}

function rotateIfNeeded() {
  try {
    const stats = fs.statSync(LOG_FILE);
    if (stats.size < MAX_BYTES) return;
    const archive = path.join(path.dirname(LOG_FILE), `audit_${new Date().toISOString().slice(0, 10)}_${Date.now()}.log`);
    fs.renameSync(LOG_FILE, archive);
  } catch (err) {
    if (err.code !== 'ENOENT') throw err;
  }
}

function writeAudit(entry = {}) {
  try {
    const record = {
      timestamp: new Date().toISOString(),
      action: String(entry.action || 'UNKNOWN').slice(0, 100),
      actor: String(entry.actor || 'unknown').slice(0, 254),
      targetId: entry.targetId == null ? null : String(entry.targetId).slice(0, 254),
      ip: entry.ip == null ? null : String(entry.ip).slice(0, 64),
      detail: redact(entry.detail || {}),
      previousHash: lastAuditHash()
    };
    record.hash = hashAuditRecord(record);
    const line = `${JSON.stringify(record)}\n`;
    fs.mkdirSync(path.dirname(LOG_FILE), { recursive: true });
    fs.appendFileSync(LOG_FILE, line, 'utf8');
    rotateIfNeeded();
    if (THREAT_ACTIONS.has(record.action)) {
      sendGuardianAlert(record).catch(err => {
        try { logError(`[AUDIT GUARDIAN] Alert failed: ${err.message}`, true); } catch { /* audit must never stop business work */ }
      });
    }
    return record;
  } catch (err) {
    try { console.error('[AUDIT] Write failed:', err.message); } catch { /* never throw */ }
    return null;
  }
}

function readAuditLog(options = {}) {
  try {
    if (!fs.existsSync(LOG_FILE)) return { entries: [], total: 0 };
    const raw = fs.readFileSync(LOG_FILE, 'utf8');
    let entries = raw.split(/\r?\n/).filter(Boolean).map(line => {
      try { return JSON.parse(line); } catch { return null; }
    }).filter(Boolean).reverse();
    const exactFilters = ['action', 'actor', 'targetId'];
    for (const key of exactFilters) {
      const value = String(options[key] || '').trim();
      if (value) entries = entries.filter(entry => String(entry[key] || '') === value);
    }
    if (options.from) entries = entries.filter(entry => entry.timestamp >= options.from);
    if (options.to) entries = entries.filter(entry => entry.timestamp <= options.to);
    if (options.threats) entries = entries.filter(entry => THREAT_ACTIONS.has(entry.action));
    const total = entries.length;
    const limit = Math.max(1, Math.min(1000, Number(options.limit) || 200));
    return { entries: entries.slice(0, limit), total, integrity: verifyAuditLog() };
  } catch (err) {
    try { console.error('[AUDIT] Read failed:', err.message); } catch { /* never throw */ }
    return { entries: [], total: 0, integrity: verifyAuditLog() };
  }
}

function trackFailedLogin(ip) {
  const key = String(ip || 'unknown');
  const now = Date.now();
  const recent = (failedAttempts.get(key) || []).filter(time => now - time < BRUTE_WINDOW_MS);
  recent.push(now);
  failedAttempts.set(key, recent);
  return recent.length;
}

function clearFailedLogin(ip) {
  failedAttempts.delete(String(ip || 'unknown'));
}

function evaluateLoanIntegrity(loan = {}) {
  const payments = Array.isArray(loan.payments) ? loan.payments : [];
  const total = Number(loan.totalRepayment || (Number(loan.amount || 0) + Number(loan.interestAmount || 0)));
  const paid = Number(loan.paidTotal ?? payments.reduce((sum, payment) => sum + (Number(payment.amount) || 0), 0));
  const outstanding = Number(loan.outstanding);
  const issues = [];
  if (Number.isFinite(outstanding) && outstanding < -0.01) issues.push({ issueType: 'NEGATIVE_BALANCE', message: 'The current balance is below zero.' });
  if (Number.isFinite(total) && total > 0 && Number.isFinite(paid) && Number.isFinite(outstanding) && Math.abs((paid + outstanding) - total) > 0.01) {
    issues.push({ issueType: 'BALANCE_DISCREPANCY', message: 'Paid amount plus remaining balance differs from the total due.' });
  }
  const status = String(loan.businessStatus || loan.status || '').trim().toLowerCase();
  if (status === 'active' && Number.isFinite(total) && total > 0 && paid >= total - 0.01 && outstanding <= 0.01) {
    issues.push({ issueType: 'LOAN_SHOULD_BE_CLOSED', message: 'Payments cover the loan total but status is still active.' });
  }
  return issues;
}

function evaluatePaymentIntegrity(payment = {}, loan = {}, balanceBefore, balanceAfter) {
  const amount = Number(payment.amount);
  const before = Number(balanceBefore);
  const after = Number(balanceAfter);
  const issues = [];
  if (!Number.isFinite(amount) || amount <= 0) issues.push({ issueType: 'ZERO_PAYMENT', message: 'A payment record has no positive amount.' });
  if (!String(payment.paymentReceiptId || payment.receiptNumber || '').trim()) issues.push({ issueType: 'MISSING_RECEIPT', message: 'A payment record has no receipt reference.' });
  if (Number.isFinite(after) && after < -0.01) issues.push({ issueType: 'NEGATIVE_BALANCE', message: 'The payment leaves a balance below zero.' });
  if (Number.isFinite(amount) && amount > 0 && Number.isFinite(before) && Number.isFinite(after)) {
    const expected = Math.max(0, Number((before - amount).toFixed(2)));
    if (Math.abs(after - expected) > 0.01) issues.push({ issueType: 'PAYMENT_BALANCE_NOT_UPDATED', message: 'The saved payment and resulting balance do not reconcile.' });
  }
  return issues;
}

const ADVISORY_MESSAGES = Object.freeze({
  BALANCE_DISCREPANCY: {
    subject: 'Please check your BMF loan balance',
    body: 'Our team noticed that your recorded payments and remaining balance may not match the agreed total for this loan. We are checking the account. Please compare your portal balance with your receipts and contact BMF if anything looks incorrect. Our team has been notified.'
  },
  PAYMENT_BALANCE_NOT_UPDATED: {
    subject: 'BMF is reviewing a payment update',
    body: 'A payment appears in your account, but the balance may not have changed as expected. Please keep your transfer receipt and contact BMF if the balance still looks wrong. Our team has been notified and will review the account.'
  },
  NEGATIVE_BALANCE: {
    subject: 'BMF is checking your loan balance',
    body: 'Your account may show a balance below zero. Please keep your payment receipts and contact BMF before making another payment. Our team has been notified and will check the figures with you.'
  },
  MISSING_RECEIPT: {
    subject: 'A payment receipt reference is missing',
    body: 'A payment on this loan does not currently show a receipt reference in your account. Please keep your proof of payment and contact BMF so we can help verify and update your records.'
  },
  LOAN_SHOULD_BE_CLOSED: {
    subject: 'BMF is checking your loan settlement status',
    body: 'Your recorded payments appear to cover the total due, but the loan may not yet show as settled. Please keep your receipts and contact BMF if the portal still shows an outstanding loan. Our team has been notified.'
  },
  ZERO_PAYMENT: {
    subject: 'BMF is checking a payment entry',
    body: 'A payment entry on this loan may be incomplete. Please do not rely on that entry as proof of payment; keep your original receipt and contact BMF so we can verify your account.'
  }
});

function borrowerEmail(loan) {
  return String(loan.email || loan.userEmail || '').trim().toLowerCase();
}

function isValidEmail(value) {
  return /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(value);
}

async function sendBorrowerAdvisory(loan = {}, issue) {
  try {
    if (isTestEnvironment() && process.env.NAVI_TEST_AUDIT_EMAILS !== 'true') {
      return { ok: true, skipped: true, reason: 'Email delivery disabled in tests.' };
    }
    const recipient = borrowerEmail(loan);
    const message = ADVISORY_MESSAGES[issue.issueType];
    if (!message || !isValidEmail(recipient)) return { ok: false, skipped: true, reason: 'Borrower email is unavailable.' };
    const loanId = String(loan.receiptNumber || loan.loanId || loan.id || 'your loan').slice(0, 100);
    const key = `${recipient}|${loanId}|${issue.issueType}`;
    const now = Date.now();
    cleanupMap(advisorySentAt, now, BORROWER_ADVISORY_WINDOW_MS);
    if (advisorySentAt.has(key)) return { ok: true, skipped: true, reason: 'Advisory already sent for this issue today.' };
    advisorySentAt.set(key, now);
    const name = String(loan.borrowerName || loan.username || '').trim();
    const greeting = name ? `Dear ${name},` : 'Dear BMF customer,';
    const text = `${greeting}\n\n${message.body}\n\nLoan: ${loanId}\n\nRegards,\nBuraza Micro Finance (BMF)`;
    const result = await emailService.sendCustomerEmail({ to: recipient, subject: `[BMF] ${message.subject} — ${loanId}`, text });
    if (!result?.ok && !result?.skipped) {
      logError(`[AUDIT GUARDIAN] Borrower advisory failed for ${loanId}: ${result?.reason || 'delivery failed'}`);
    }
    return result;
  } catch (err) {
    try { logError(`[AUDIT GUARDIAN] Borrower advisory failed: ${err.message}`); } catch { /* never throw */ }
    return { ok: false, reason: err.message };
  }
}

async function checkIssues(loan, issues, { actor = 'system', ip = null, payment = null } = {}) {
  try {
    for (const issue of issues) {
      writeAudit({
        action: ACTIONS.THREAT_DATA_CORRUPTION,
        actor,
        targetId: loan.receiptNumber || loan.id || loan.loanId || null,
        ip,
        detail: {
          issueType: issue.issueType,
          message: issue.message,
          receiptNumber: loan.receiptNumber || null,
          loanId: loan.id || loan.loanId || null,
          borrowerEmail: borrowerEmail(loan) || null,
          totalRepayment: loan.totalRepayment ?? null,
          paidTotal: loan.paidTotal ?? null,
          outstanding: loan.outstanding ?? null,
          paymentReceiptId: payment?.paymentReceiptId || payment?.receiptNumber || null,
          paymentAmount: payment?.amount ?? null
        }
      });
      sendBorrowerAdvisory(loan, issue).catch(() => {});
    }
    return { ok: issues.length === 0, issues };
  } catch (err) {
    try { console.error('[AUDIT] Integrity check failed:', err.message); } catch { /* never throw */ }
    return { ok: false, issues, error: err.message };
  }
}

async function checkLoanIntegrity(loan, actor = 'system', ip = null) {
  return checkIssues(loan || {}, evaluateLoanIntegrity(loan || {}), { actor, ip });
}

async function checkPaymentIntegrity(payment, loan, balanceBefore, balanceAfter, actor = 'system', ip = null) {
  const safeLoan = loan || {};
  const issues = evaluatePaymentIntegrity(payment || {}, safeLoan, balanceBefore, balanceAfter);
  return checkIssues(safeLoan, issues, { actor, ip, payment: payment || {} });
}

function isAfterHours(now = new Date()) {
  const hour = Number(new Intl.DateTimeFormat('en-GB', {
    timeZone: process.env.BMF_BUSINESS_TIMEZONE || 'Africa/Lusaka',
    hour: '2-digit', hourCycle: 'h23'
  }).format(now));
  const start = Number(process.env.BMF_BUSINESS_START_HOUR || 6);
  const end = Number(process.env.BMF_BUSINESS_END_HOUR || 20);
  return hour < start || hour >= end;
}

module.exports = {
  writeAudit,
  readAuditLog,
  verifyAuditLog,
  trackFailedLogin,
  clearFailedLogin,
  evaluateLoanIntegrity,
  evaluatePaymentIntegrity,
  checkLoanIntegrity,
  checkPaymentIntegrity,
  sendBorrowerAdvisory,
  isAfterHours,
  ACTIONS,
  BRUTE_THRESHOLD,
  LOG_FILE
};
