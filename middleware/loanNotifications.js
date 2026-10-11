const path = require('path');
require('dotenv').config({ path: path.resolve(__dirname, '../.env') });
const dataStore = require('./dataStore');
const emailService = require('./email');
const { logError, logBreakage } = require('./logger');
const { getLoansData, deriveLoanStatus } = require('../controllers/loanController');

// ─── Automated borrower notifications (Task 7 — email channel) ───────────────
// Daily check at 23:58 (driven by scheduler.js), for each active loan:
//   3/2/1 days remaining → countdown reminder (day count interpolated)
//   0 days (due today)   → final reminder
//   past due date        → overdue notice
// Every message starts with a warm greeting. Dedupe: one message per loan
// PER CALENDAR DAY, stored in data/notifications.json. Every successful send
// is logged to errors.log with the prefix "NOTIFICATION SENT".
// Other channels (WhatsApp/SMS) are pasted manually by staff — the stored
// body is verbatim what should be pasted.

const TEMPLATES = {
  REMINDER: {
    key: 'reminder',
    subject: days => `BMF Loan Reminder — ${days} Day${days === 1 ? '' : 's'} Remaining`,
    body: days => days === 0
      ? 'Loan due today. Your BMF loan is due today. Kindly settle the outstanding balance now to continue enjoying the BMF loan service.'
      : `Loan still unsettled — ${days} day${days === 1 ? '' : 's'} remaining. Your BMF loan is not yet settled. You still have time to repay the outstanding balance and continue enjoying the BMF loan service.`
  },
  OVERDUE: {
    key: 'overdue',
    subject: () => 'BMF Loan Overdue Notice',
    body: () => 'Your BMF loan is now overdue. Kindly settle the outstanding balance as soon as possible to restore and continue your access to the BMF loan service.'
  }
};

const NOTIFICATIONS_FILE = dataStore.paths.notifications;

function getNotificationLog() {
  return dataStore.readJson(NOTIFICATIONS_FILE, [], Array.isArray);
}

function saveNotificationLog(entries) {
  dataStore.writeJson(NOTIFICATIONS_FILE, entries);
}

/** Task 7 dedupe: one notification per loan per calendar day. */
function buildDedupeKey({ loanId, day }) {
  return `${loanId}:${day}`;
}

/** Every client message opens with a warm greeting. */
function warmGreeting(loan) {
  const name = String(loan.email || 'valued customer').split('@')[0];
  return `Hello ${name},`;
}

async function sendTemplatedMessage({ loan, messageKey, days, day, context = 'scheduler' }) {
  const to = String(loan.email || '').trim().toLowerCase();
  if (!to) {
    return { ok: false, skipped: true, reason: 'Borrower has no registered email address.' };
  }
  const template = TEMPLATES[messageKey];
  if (!template) {
    return { ok: false, skipped: true, reason: `Unknown message template: ${messageKey}` };
  }

  const dedupeDay = day || new Date().toISOString().slice(0, 10);
  const dedupeKey = buildDedupeKey({ loanId: loan.id, day: dedupeDay });
  const log = getNotificationLog();
  if (log.some(entry => entry.dedupeKey === dedupeKey && entry.status !== 'failed')) {
    return { ok: true, skipped: true, reason: 'Already notified for this day.', dedupeKey };
  }

  const arg = messageKey === 'REMINDER' ? days : loan;
  const subject = template.subject(arg);
  const body = `${warmGreeting(loan)}\n\n${template.body(arg)}`;
  const record = {
    id: log.length ? Math.max(...log.map(e => Number(e.id) || 0)) + 1 : 1,
    dedupeKey,
    loanId: loan.id,
    receiptNumber: loan.receiptNumber || null,
    email: to,
    messageKey,
    channel: 'email',
    context,
    subject,
    body,
    days: messageKey === 'REMINDER' ? days : null,
    day: dedupeDay,
    dueDate: loan.dueDate || null,
    outstanding: Number(loan.outstanding || 0),
    status: 'pending',
    createdAt: new Date().toISOString()
  };

  try {
    const result = await emailService.sendCustomerEmail({ to, subject, text: body });
    if (result?.ok) {
      record.status = 'sent';
      record.providerMessageId = result.messageId || null;
    } else if (result?.skipped) {
      record.status = 'skipped';
      record.error = result.reason || 'Email delivery skipped.';
    } else {
      record.status = 'failed';
      record.error = result?.reason || 'Email delivery failed.';
    }
  } catch (err) {
    record.status = 'failed';
    record.error = err.message;
    logError(`BORROWER NOTIFICATION FAILED (${messageKey}, loan #${loan.id}): ${err.message}`);
  }

  record.sentAt = new Date().toISOString();
  saveNotificationLog([...log.filter(entry => entry.dedupeKey !== dedupeKey), record]);

  // Task 7: every sent notification is traceable in errors.log.
  if (record.status === 'sent') {
    logError(`NOTIFICATION SENT | ${record.messageKey}${record.days !== null ? ` (${record.days}d)` : ''} | loan ${loan.receiptNumber || loan.id} | to ${to}`);
  }

  return { ok: record.status !== 'failed', skipped: record.status === 'skipped', record };
}

/** Task 7 pass: countdown 3 → 2 → 1 → 0 → overdue for every active loan. */
async function runDueDatePass(today = new Date().toISOString().slice(0, 10)) {
  const summary = { date: today, sent: 0, reminders: 0, overdue: 0, skipped: 0, failed: 0 };

  for (const loan of getLoansData()) {
    const outstanding = Number(loan.outstanding || 0);
    if (outstanding <= 0 || !loan.email) continue;
    const businessStatus = deriveLoanStatus(loan, today);
    if (['paid', 'declined', 'liquidated'].includes(businessStatus)) continue;

    const dueDate = String(loan.dueDate || '').slice(0, 10);
    if (!/^\d{4}-\d{2}-\d{2}$/.test(dueDate)) continue;
    const daysRemaining = Math.round(
      (new Date(`${dueDate}T00:00:00Z`) - new Date(`${today}T00:00:00Z`)) / 86400000);

    let result;
    if (daysRemaining >= 0 && daysRemaining <= 3) {
      result = await sendTemplatedMessage({ loan, messageKey: 'REMINDER', days: daysRemaining, day: today });
      if (result.ok && !result.skipped) summary.reminders += 1;
    } else if (daysRemaining < 0) {
      result = await sendTemplatedMessage({ loan, messageKey: 'OVERDUE', day: today });
      if (result.ok && !result.skipped) summary.overdue += 1;
    } else {
      continue; // more than 3 days out — nothing to say yet
    }

    if (result.ok && !result.skipped) summary.sent += 1;
    if (result.skipped) summary.skipped += 1;
    if (!result.ok) summary.failed += 1;
  }

  return summary;
}

function startLoanNotificationScheduler(intervalMs = 60 * 60 * 1000) {
  const timer = setInterval(() => {
    runDueDatePass().catch(err => logBreakage('loanNotifications.js', 'startLoanNotificationScheduler', err, 'LOAN NOTIFICATION SCHEDULER FAILED'));
  }, intervalMs);
  timer.unref?.();
  return timer;
}

module.exports = {
  TEMPLATES,
  getNotificationLog,
  buildDedupeKey,
  sendTemplatedMessage,
  runDueDatePass,
  startLoanNotificationScheduler
};