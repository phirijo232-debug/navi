const path = require('path');
require('dotenv').config({ path: path.resolve(__dirname, '../.env') });
const dataStore = require('./dataStore');
const { logError } = require('./logger');
const { normalizeZambianPhone } = require('./phoneNumber');

// ─── WhatsApp notification service ───────────────────────────────────────────
// Provider is pluggable:
//   meta      → WhatsApp Business Cloud API (real delivery)
//   log       → default when no credentials are configured: records the message
//               as "logged" so the pipeline, dedupe and audit trail are testable
//               end-to-end without sending anything.
// Every send is recorded in data/notifications.json with a dedupe key so a
// borrower is never messaged twice about the same trigger for the same cycle.

// ─── Message catalogue (wording fixed by the BMF operations spec) ─────────────
const MESSAGES = {
  THREE_DAYS_UNSETTLED: {
    key: 'three_days_unsettled',
    body: 'Loan still unsettled — 3 days remaining. Your BMF loan is not yet settled. You still have time to repay the outstanding balance and continue enjoying the BMF loan service.'
  },
  DUE_IN_THREE_DAYS: {
    key: 'due_in_three_days',
    body: loan => `Loan due in 3 days. Please note that your BMF loan is due in three days, on ${loan.dueDate}. Kindly settle the outstanding balance by the due date to continue enjoying the BMF loan service.`
  },
  OVERDUE: {
    key: 'overdue',
    body: 'Final notification — loan overdue. Your BMF loan is now overdue. Kindly settle the outstanding balance as soon as possible to restore and continue your access to the BMF loan service.'
  }
};

const NOTIFICATIONS_FILE = dataStore.paths.notifications;

function getNotificationLog() {
  return dataStore.readJson(NOTIFICATIONS_FILE, [], Array.isArray);
}

function saveNotificationLog(entries) {
  dataStore.writeJson(NOTIFICATIONS_FILE, entries);
}

/** Stable dedupe key: one message per loan + trigger + due date cycle. */
function buildDedupeKey({ loanId, messageKey, cycle }) {
  return `${loanId}:${messageKey}:${cycle}`;
}

function getProvider() {
  if (process.env.WHATSAPP_ACCESS_TOKEN && process.env.WHATSAPP_PHONE_NUMBER_ID) return 'meta';
  return 'log';
}

async function deliverViaMeta(to, body) {
  const version = process.env.WHATSAPP_API_VERSION || 'v19.0';
  const url = `https://graph.facebook.com/${version}/${process.env.WHATSAPP_PHONE_NUMBER_ID}/messages`;
  const response = await fetch(url, {
    method: 'POST',
    headers: {
      Authorization: `Bearer ${process.env.WHATSAPP_ACCESS_TOKEN}`,
      'Content-Type': 'application/json'
    },
    body: JSON.stringify({
      messaging_product: 'whatsapp',
      recipient_type: 'individual',
      to: to.replace('+', ''),
      type: 'text',
      text: { preview_url: false, body }
    })
  });
  const payload = await response.json().catch(() => ({}));
  if (!response.ok) {
    throw new Error(payload?.error?.message || `WhatsApp API error ${response.status}`);
  }
  return payload;
}

/**
 * Send one templated WhatsApp message to a borrower.
 * Skips silently when the message was already sent for this cycle.
 */
async function sendTemplatedMessage({ loan, phone, messageKey, cycle, context = 'scheduler' }) {
  const to = normalizeZambianPhone(phone);
  if (!to) {
    return { ok: false, skipped: true, reason: 'No valid Zambian WhatsApp number on file.' };
  }

  const template = MESSAGES[messageKey];
  if (!template) {
    return { ok: false, skipped: true, reason: `Unknown message template: ${messageKey}` };
  }

  const dedupeKey = buildDedupeKey({ loanId: loan.id, messageKey, cycle });
  const log = getNotificationLog();
  if (log.some(entry => entry.dedupeKey === dedupeKey && entry.status !== 'failed')) {
    return { ok: true, skipped: true, reason: 'Already sent for this cycle.', dedupeKey };
  }

  const body = typeof template.body === 'function' ? template.body(loan) : template.body;
  const provider = getProvider();
  const record = {
    id: log.length ? Math.max(...log.map(e => Number(e.id) || 0)) + 1 : 1,
    dedupeKey,
    loanId: loan.id,
    email: loan.email || null,
    phone: to,
    messageKey,
    channel: 'whatsapp',
    provider,
    context,
    body,
    cycle,
    dueDate: loan.dueDate || null,
    outstanding: Number(loan.outstanding || 0),
    status: 'pending',
    createdAt: new Date().toISOString()
  };

  try {
    if (provider === 'meta') {
      const result = await deliverViaMeta(to, body);
      record.status = 'sent';
      record.providerMessageId = result?.messages?.[0]?.id || null;
    } else {
      // No WhatsApp credentials yet: record the message so the automation is
      // fully testable, without delivering anything.
      record.status = 'logged';
    }
  } catch (err) {
    record.status = 'failed';
    record.error = err.message;
    logError(`WHATSAPP SEND FAILED (${messageKey}, loan #${loan.id}): ${err.message}`);
  }

  record.sentAt = new Date().toISOString();
  saveNotificationLog([...log.filter(entry => entry.dedupeKey !== dedupeKey), record]);
  return { ok: record.status !== 'failed', skipped: false, record, provider };
}

module.exports = {
  MESSAGES,
  getProvider,
  getNotificationLog,
  buildDedupeKey,
  sendTemplatedMessage
};