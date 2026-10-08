const path = require('path');
require('dotenv').config({ path: path.resolve(__dirname, '../.env') });
const nodemailer = require('nodemailer');

let _transporter = null;

function getTransporter() {
  if (!_transporter) {
    _transporter = nodemailer.createTransport({
      host: 'smtp.gmail.com',
      port: 465,
      secure: true,
      family: 4,
      auth: {
        user: process.env.GMAIL_USER,
        pass: process.env.GMAIL_APP_PASSWORD?.replace(/\s/g, '')
      }
    });
  }
  return _transporter;
}

function getGreetingByTime(now = new Date()) {
  const reference = typeof now === 'number'
    ? new Date().setHours(now, 0, 0, 0)
    : now;
  const hour = new Date(reference).getHours();
  if (hour < 12) return 'Good morning';
  if (hour < 17) return 'Good afternoon';
  return 'Good evening';
}

function getCommunicationChannelNote() {
  return 'Please note that future communication may be switched to WhatsApp, SMS, or direct call. For WhatsApp updates, a valid WhatsApp number is required at signup and must be active so we can reach you promptly.';
}

function buildWelcomeMessage(email, firmName = 'BMF') {
  const greeting = getGreetingByTime();
  const subject = `Welcome to ${firmName}`;
  const body = `${greeting}, ${email || 'friend'},\n\n` +
    `Thank you for contacting ${firmName}. We deeply value your association and are committed to delivering an experience worthy of your trust. Welcome to a partnership built on integrity and excellence.\n\n` +
    `We are delighted to have you with us and look forward to serving you with professionalism, care, and excellence.\n\n` +
    `${getCommunicationChannelNote()}\n\n` +
    'Warm regards,\n' +
    `The BMF Team`;
  return { subject, body };
}

function formatCurrency(value) {
  const amount = Number(value || 0);
  if (!Number.isFinite(amount)) return 'K 0.00';
  return `K ${amount.toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;
}

function buildLoanSummaryText(loanData = {}) {
  const productName = loanData.product || 'your requested loan';
  const amount = loanData.amount ?? loanData.requestedAmount ?? 0;
  const totalRepayment = loanData.totalRepayment ?? loanData.total ?? loanData.totalAmount ?? amount;
  const interestAmount = loanData.interestAmount ?? loanData.interest ?? Math.max(0, totalRepayment - amount);
  const tenureWeeks = loanData.tenureWeeks ?? loanData.tenure ?? null;
  const dueDate = loanData.dueDate || loanData.due_date || 'To be confirmed';
  const urgency = loanData.urgency || 'standard';

  const lines = [
    'Loan summary:',
    `- Product: ${productName}`,
    `- Requested amount: ${formatCurrency(amount)}`,
    `- Interest amount: ${formatCurrency(interestAmount)}`,
    `- Total repayment: ${formatCurrency(totalRepayment)}`
  ];

  if (tenureWeeks) {
    lines.push(`- Tenure: ${tenureWeeks} week${Number(tenureWeeks) === 1 ? '' : 's'}`);
  }
  if (dueDate) {
    lines.push(`- Due date: ${String(dueDate).slice(0, 10)}`);
  }
  lines.push(`- Urgency: ${String(urgency).toLowerCase()}`);
  return `${lines.join('\n')}\n\n`;
}

function buildRequestReceivedMessage(product, urgency, email, loanData = {}) {
  const amount = Number(loanData.amount ?? loanData.requestedAmount ?? 0);
  const activeUrgency = (loanData.urgency || urgency || 'standard').toString().toLowerCase();
  const subject = `${product || 'Loan'} request received — ${formatCurrency(amount)} — ${activeUrgency}`;
  const summary = buildLoanSummaryText({ ...loanData, product, urgency: activeUrgency });
  const body = `Good day,\n\nDear valued BMF customer,\n\n` +
    `We have received your request for ${product || 'your requested loan'} and it is currently being reviewed by our team.\n\n` +
    `Your selected urgency is ${activeUrgency}. We will respond and follow up according to that urgency while keeping you informed throughout the review process.\n\n` +
    summary +
    `${getCommunicationChannelNote()}\n\n` +
    'Thank you for your patience and trust in BMF.\n\n' +
    'Warm regards,\nThe BMF Team';
  return { subject, body };
}

function getNotificationRecipients(primaryEmail, extraEmails = []) {
  const configured = (process.env.ADMIN_EMAILS || process.env.ADMIN_EMAIL || 'phirijo232@gmail.com')
    .split(',')
    .map(item => String(item).trim())
    .filter(Boolean);
  // Rule 8: the BMF report mailbox always receives admin notifications too.
  const reportMailbox = process.env.DAILY_REPORT_EMAIL || 'jophiri223@gmail.com';

  const uniqueValues = new Set();
  for (const value of [primaryEmail, ...extraEmails, ...configured, reportMailbox]) {
    const normalized = String(value || '').trim();
    if (!normalized) continue;
    const lower = normalized.toLowerCase();
    if (!uniqueValues.has(lower)) uniqueValues.add(lower);
  }
  return [...uniqueValues].map(value => value.toLowerCase());
}

function buildLoanStatusNotification(action, product, reason, email, loanData = {}) {
  const normalizedAction = String(action || '').trim().toLowerCase();
  const reasonText = reason && String(reason).trim()
    ? String(reason).trim()
    : 'We are pleased to continue supporting your application with the required review.';
  const summary = buildLoanSummaryText({ ...loanData, product, urgency: loanData.urgency || 'standard' });
  const amount = Number(loanData.amount ?? loanData.requestedAmount ?? 0);
  const urgencyLabel = (loanData.urgency || 'standard').toString().toLowerCase();

  if (normalizedAction.includes('approve')) {
    return {
      subject: `${product || 'Loan'} approved — ${formatCurrency(amount)} — ${urgencyLabel}`,
      body: `Good day,\n\nDear valued BMF customer,\n\n` +
        `We are pleased to confirm that your request for ${product || 'the loan'} has been approved.\n\n` +
        summary +
        `Reason: ${reasonText}\n\n` +
        `${getCommunicationChannelNote()}\n\n` +
        'Thank you for trusting BMF.\n\nWarm regards,\nThe BMF Team'
    };
  }

  if (normalizedAction.includes('decline')) {
    return {
      subject: `${product || 'Loan'} declined — ${formatCurrency(amount)} — ${urgencyLabel}`,
      body: `Good day,\n\nDear valued BMF customer,\n\n` +
        `We regret to inform you that your request for ${product || 'the loan'} has been declined at this time.\n\n` +
        summary +
        `Reason: ${reasonText}\n\n` +
        `${getCommunicationChannelNote()}\n\n` +
        'You are welcome to reach out so we can guide you on next steps.\n\nWarmly,\nThe BMF Team'
    };
  }

  return {
    subject: `${product || 'Loan'} in progress — ${formatCurrency(amount)} — ${urgencyLabel}`,
    body: `Good day,\n\nDear valued BMF customer,\n\n` +
      `Your request for ${product || 'the loan'} is now in progress.\n\n` +
      summary +
      `Reason: ${reasonText}\n\n` +
      `${getCommunicationChannelNote()}\n\n` +
      'Thank you for your patience.\n\nWarm regards,\nThe BMF Team'
  };
}

async function sendCustomerEmail({ to, subject, text, attachments }) {
  const recipients = Array.isArray(to)
    ? to
    : typeof to === 'string'
      ? to.split(',')
      : [];

  const normalizedRecipients = recipients
    .map(item => String(item || '').trim())
    .filter(Boolean);

  if (!normalizedRecipients.length || !subject || !text) {
    return { ok: false, skipped: true, reason: 'Missing email recipients or content.' };
  }

  if (!process.env.GMAIL_USER || !process.env.GMAIL_APP_PASSWORD) {
    return { ok: false, skipped: true, reason: 'Email credentials are not configured.' };
  }

  try {
    const transporter = getTransporter();
    const info = await transporter.sendMail({
      from: process.env.GMAIL_USER,
      to: normalizedRecipients.length === 1 ? normalizedRecipients[0] : normalizedRecipients,
      subject,
      text,
      ...(Array.isArray(attachments) && attachments.length ? { attachments } : {})
    });
    return { ok: true, messageId: info.messageId };
  } catch (error) {
    console.error('Customer email send failed:', error.message);
    return { ok: false, skipped: false, reason: error.message };
  }
}

module.exports = {
  getGreetingByTime,
  buildWelcomeMessage,
  buildRequestReceivedMessage,
  buildLoanSummaryText,
  getNotificationRecipients,
  buildLoanStatusNotification,
  sendCustomerEmail
};