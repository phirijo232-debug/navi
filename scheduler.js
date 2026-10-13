// ─── BMF scheduler (Task 5 + Task 7 timing) ──────────────────────────────────
// node-cron jobs, both anchored to Africa/Lusaka (UTC+2):
//   23:58 — borrower notifications (countdown 3/2/1/0 + overdue)
//   23:59 — daily admin report email with PDF + Excel attachments
// On startup: if a scheduled day was missed while the server was down, the
// report is sent once as a catch-up before normal scheduling resumes.

require('dotenv').config();
const path = require('path');
const cron = require('node-cron');
const PDFDocument = require('pdfkit');
const ExcelJS = require('exceljs');
const emailService = require('./middleware/email');
const dataStore = require('./middleware/dataStore');
const { logError, logBreakage } = require('./middleware/logger');
const { runDueDatePass } = require('./middleware/loanNotifications');
const { getEnrichedLoans, deriveLoanStatus, accrueAllGrace } = require('./controllers/loanController');
const { runKidneySweep } = require('./middleware/kidneys');
const { buildPaymentsReportData, buildPaymentsExcelReport, buildPaymentsPdfReport } = require('./controllers/reportController');

const TIMEZONE = process.env.DAILY_REPORT_TIMEZONE || 'Africa/Lusaka';
// Rule 8: report recipient. Env wins; default is the admin mailbox.
const REPORT_RECIPIENT = process.env.DAILY_REPORT_EMAIL || 'jophiri223@gmail.com';
const STATE_FILE = dataStore.paths.dailyReportState;
// Flexible payment tracking sheet time frame - adjust anytime via .env without code changes.
// Example: PAYMENTS_SHEET_FROM=2026-10-01, PAYMENTS_SHEET_TO=2026-10-31 (empty = all time).
const TRACKING_FROM = process.env.PAYMENTS_SHEET_FROM || '';
const TRACKING_TO = process.env.PAYMENTS_SHEET_TO || '';
const TRACKING_STATE_FILE = path.join(dataStore.DATA_DIR, 'paymentsReportState.json');
// Flexible portfolio report frame - empty = daily (today) behaviour, as spec'd.
// Example: PORTFOLIO_SHEET_FROM=2026-10-01, PORTFOLIO_SHEET_TO=2026-10-31
const PORTFOLIO_FROM = process.env.PORTFOLIO_SHEET_FROM || '';
const PORTFOLIO_TO = process.env.PORTFOLIO_SHEET_TO || '';

function lusakaDate(date = new Date()) {
  return new Intl.DateTimeFormat('en-CA', { timeZone: TIMEZONE }).format(date);
}

function shiftDays(dateString, days) {
  const [y, m, d] = dateString.split('-').map(Number);
  return new Intl.DateTimeFormat('en-CA', { timeZone: 'UTC' })
    .format(new Date(Date.UTC(y, m - 1, d + days)));
}

function readState() {
  return dataStore.readJson(STATE_FILE, {}, obj => typeof obj === 'object' && obj !== null);
}

function writeState(lastSentDate) {
  dataStore.writeJson(STATE_FILE, { lastSentDate });
}

function readTrackingState() {
  return dataStore.readJson(TRACKING_STATE_FILE, {}, obj => typeof obj === 'object' && obj !== null);
}

function writeTrackingState(lastSentDate, frame) {
  dataStore.writeJson(TRACKING_STATE_FILE, { lastSentDate, frame });
}

/** Tracking sheet data for the currently configured (env-adjustable) time frame. */
function buildPaymentsLeadersData() {
  return buildPaymentsReportData(TRACKING_FROM || null, TRACKING_TO || null);
}

/** Plain-text body for the payment tracking sheet email. */
function buildPaymentsReportBody(data) {
  const range = `${data.from || 'All time'}${data.to ? ` to ${data.to}` : ''}`;
  const lines = [
    'Pryme Buraza Micro Finance (BMF) - Payment Tracking Sheet',
    `Time frame: ${range}`,
    `Generated: ${data.generatedAt}`,
    '',
    `Total payments: ${data.totalPayments}`,
    `Total amount collected: K${data.totalAmount.toFixed(2)}`,
    `Total interest collected: K${data.totalInterest.toFixed(2)}`,
    `Total principal collected: K${data.totalPrincipal.toFixed(2)}`,
    `Payment modes: ${data.modes.join(', ') || 'n/a'}`,
    `Recorded by: ${data.recordedBy.join(', ') || 'n/a'}`,
    '',
    'Most recent payments:'
  ];
  const recent = data.payments.slice(-10).reverse();
  if (!recent.length) lines.push('- No payments in this time frame.');
  recent.forEach(p => {
    lines.push(
      `- ${p.paymentReceiptId || 'n/a'} | loan ${p.loanReceiptId || 'n/a'} | ${p.email || 'n/a'} | ` +
      `K${Number(p.amount || 0).toFixed(2)} | ${p.mode || 'Cash'} | ${String(p.paymentDate || p.date || '').slice(0, 10)} | by ${p.recordedBy || 'admin'}`
    );
  });
  return lines.join('\n');
}

/** Everything the daily report email shows — single source for body/PDF/XLSX. */
function buildDailyReportData(reportDate = lusakaDate()) {
  const loans = getEnrichedLoans();
  const today = new Date().toISOString().slice(0, 10);
  const usePeriod = Boolean(PORTFOLIO_FROM || PORTFOLIO_TO);

  // Counts a date value against the active frame: the configured period when
  // PORTFOLIO_SHEET_FROM/TO are set, otherwise the single report day.
  const inFrame = (value) => {
    if (!value) return false;
    if (!usePeriod) return String(value).slice(0, 10) === reportDate;
    const ts = new Date(value).getTime();
    if (Number.isNaN(ts)) return false;
    if (PORTFOLIO_FROM && ts < new Date(`${PORTFOLIO_FROM}T00:00:00Z`).getTime()) return false;
    if (PORTFOLIO_TO && ts > new Date(`${PORTFOLIO_TO}T23:59:59Z`).getTime()) return false;
    return true;
  };

  const active = loans.filter(loan =>
    ['active', 'grace', 'defaulted'].includes(loan.businessStatus));
  const overdue = loans.filter(loan =>
    ['grace', 'defaulted'].includes(loan.businessStatus) && Number(loan.outstanding || 0) > 0);
  const defaulted = loans.filter(loan => loan.businessStatus === 'defaulted');

  const approvedToday = loans.filter(loan => inFrame(loan.approvedAt || loan.borrowedDate));

  let paymentsTodayAmount = 0;
  let interestToday = 0;
  let paymentsTodayCount = 0;
  loans.forEach(loan => {
    (Array.isArray(loan.payments) ? loan.payments : []).forEach(payment => {
      if (inFrame(payment.paymentDate || payment.date)) {
        paymentsTodayAmount += Number(payment.amount || 0);
        interestToday += Number(payment.interestPortion || 0);
        paymentsTodayCount += 1;
      }
    });
  });

  return {
    reportDate,
    generatedAt: new Date().toISOString(),
    period: usePeriod ? { from: PORTFOLIO_FROM || null, to: PORTFOLIO_TO || null } : null,
    activeLoans: active.length,
    activeOutstanding: Number(active.reduce((sum, l) => sum + Number(l.outstanding || 0), 0).toFixed(2)),
    approvedToday: approvedToday.map(l => ({ receipt: l.receiptNumber, email: l.email, amount: l.amount })),
    approvedTodayCount: approvedToday.length,
    paymentsTodayCount,
    paymentsTodayAmount: Number(paymentsTodayAmount.toFixed(2)),
    overdueCount: overdue.length,
    overdueTotal: Number(overdue.reduce((sum, l) => sum + Number(l.outstanding || 0), 0).toFixed(2)),
    overdueLoans: overdue.map(l => ({
      receipt: l.receiptNumber, email: l.email, dueDate: l.dueDate, outstanding: l.outstanding
    })),
    defaultersCount: defaulted.length,
    interestToday: Number(interestToday.toFixed(2)),
    today
  };
}

function buildReportBody(data) {
  const approved = data.approvedToday.length
    ? ` (${data.approvedToday.map(l => `${l.receipt} ${l.email} K${Number(l.amount || 0).toFixed(2)}`).join('; ')})`
    : '';
  const frame = data.period ? ` (${data.period.from || 'start'} to ${data.period.to || 'today'})` : '';
  const label = data.period ? 'in period' : 'today';
  return [
    `Daily Loan Report — ${data.reportDate}${frame}`,
    '',
    `Total active loans: ${data.activeLoans}`,
    `Outstanding on active loans: K${data.activeOutstanding.toFixed(2)}`,
    `New loans approved ${label}: ${data.approvedTodayCount}${approved}`,
    `Payments received ${label}: ${data.paymentsTodayCount} totaling K${data.paymentsTodayAmount.toFixed(2)}`,
    `Overdue loans: ${data.overdueCount} totaling K${data.overdueTotal.toFixed(2)}`,
    `Defaulters: ${data.defaultersCount}`,
    `Total interest earned ${label}: K${data.interestToday.toFixed(2)}`
  ].join('\n');
}

/** Plain-text PDF of the same report (first attachment). */
function buildReportPdf(data) {
  return new Promise((resolve, reject) => {
    const doc = new PDFDocument({ margin: 50, size: 'A4' });
    const chunks = [];
    doc.on('data', chunk => chunks.push(chunk));
    doc.on('end', () => resolve(Buffer.concat(chunks)));
    doc.on('error', reject);

    doc.fontSize(16).text('Pryme Buraza Micro Finance — Daily Loan Report', { align: 'center' });
    doc.moveDown(0.5);
    doc.fontSize(11).text(`Date: ${data.reportDate}${data.period ? ` (${data.period.from || 'start'} to ${data.period.to || 'today'})` : ''}`, { align: 'center' });
    doc.moveDown(1.5);
    const label = data.period ? 'in period' : 'today';

    doc.fontSize(12).text('Portfolio Summary');
    doc.moveDown(0.5);
    doc.fontSize(10).text(`Total active loans: ${data.activeLoans}`);
    doc.text(`Outstanding on active loans: K${data.activeOutstanding.toFixed(2)}`);
    doc.text(`New loans approved ${label}: ${data.approvedTodayCount}`);
    doc.text(`Payments received ${label}: ${data.paymentsTodayCount} (K${data.paymentsTodayAmount.toFixed(2)})`);
    doc.text(`Overdue loans: ${data.overdueCount} (K${data.overdueTotal.toFixed(2)})`);
    doc.text(`Defaulters: ${data.defaultersCount}`);
    doc.text(`Total interest earned ${label}: K${data.interestToday.toFixed(2)}`);

    if (data.overdueLoans.length) {
      doc.moveDown(1);
      doc.fontSize(12).text('Overdue Loans');
      doc.moveDown(0.5);
      doc.fontSize(9);
      data.overdueLoans.forEach(loan => {
        doc.text(`${loan.receipt || 'n/a'} | ${loan.email} | due ${loan.dueDate || 'n/a'} | outstanding K${Number(loan.outstanding || 0).toFixed(2)}`);
      });
    }
    // Close the stream so the 'end' event fires and the Buffer resolves.
    doc.end();
  });
}

/** Excel version of the same report (second attachment). */
async function buildReportXlsx(data) {
  const workbook = new ExcelJS.Workbook();
  const summary = workbook.addWorksheet('Daily Report');
  summary.columns = [
    { header: 'Metric', key: 'metric', width: 45 },
    { header: 'Value', key: 'value', width: 30 }
  ];
  summary.addRows([
    { metric: 'Report date', value: data.reportDate },
    { metric: 'Total active loans', value: data.activeLoans },
    { metric: 'Outstanding on active loans (K)', value: data.activeOutstanding },
    { metric: `New loans approved ${data.period ? 'in period' : 'today'}`, value: data.approvedTodayCount },
    { metric: `Payments received ${data.period ? 'in period' : 'today'} (count)`, value: data.paymentsTodayCount },
    { metric: `Payments received ${data.period ? 'in period' : 'today'} (K)`, value: data.paymentsTodayAmount },
    { metric: 'Overdue loans (count)', value: data.overdueCount },
    { metric: 'Overdue total (K)', value: data.overdueTotal },
    { metric: 'Defaulters', value: data.defaultersCount },
    { metric: `Interest earned ${data.period ? 'in period' : 'today'} (K)`, value: data.interestToday }
  ]);
  summary.getRow(1).font = { bold: true };

  const overdue = workbook.addWorksheet('Overdue');
  overdue.columns = [
    { header: 'Receipt', key: 'receipt', width: 22 },
    { header: 'Email', key: 'email', width: 35 },
    { header: 'Due date', key: 'dueDate', width: 15 },
    { header: 'Outstanding (K)', key: 'outstanding', width: 18 }
  ];
  data.overdueLoans.forEach(loan => overdue.addRow(loan));
  overdue.getRow(1).font = { bold: true };

  const buffer = await workbook.xlsx.writeBuffer();
  return Buffer.from(buffer);
}

async function sendDailyLoanReport() {
  const data = buildDailyReportData();
  const subject = `Pryme Buraza Micro Finance — Daily Loan Report ${data.reportDate}` + (data.period ? ` (${data.period.from || 'start'} to ${data.period.to || 'today'})` : '');
  const [pdf, xlsx] = await Promise.all([buildReportPdf(data), buildReportXlsx(data)]);

  const result = await emailService.sendCustomerEmail({
    to: REPORT_RECIPIENT,
    subject,
    text: buildReportBody(data),
    attachments: [
      { filename: `BMF-Daily-Report-${data.reportDate}.pdf`, content: pdf },
      { filename: `BMF-Daily-Report-${data.reportDate}.xlsx`, content: xlsx }
    ]
  });

  if (!result?.ok) {
    logBreakage('scheduler.js', 'sendDailyLoanReport', result?.reason || 'email delivery failed', 'DAILY LOAN REPORT FAILED');
    return { ok: false, data };
  }
  writeState(data.reportDate);
  console.log(`[scheduler] daily report sent to ${REPORT_RECIPIENT} for ${data.reportDate}`);
  return { ok: true, data };
}

/** Collect a readable stream (pdfkit doc) into a Buffer for email attachments. */
function streamToBuffer(stream) {
  return new Promise((resolve, reject) => {
    const chunks = [];
    stream.on('data', chunk => chunks.push(chunk));
    stream.on('end', () => resolve(Buffer.concat(chunks)));
    stream.on('error', reject);
  });
}

/** Daily payment tracking sheet email - time frame adjustable via PAYMENTS_SHEET_FROM / PAYMENTS_SHEET_TO. */
async function sendPaymentsTrackingEmail() {
  const data = buildPaymentsLeadersData();
  const range = `${data.from || 'AllTime'}${data.to ? `-${data.to}` : ''}`;
  const subject = `Pryme Buraza Micro Finance — Daily Payment Tracking Sheet ${lusakaDate()}`;
  const pdf = await streamToBuffer(buildPaymentsPdfReport(data));
  const xlsx = await buildPaymentsExcelReport(data);

  const result = await emailService.sendCustomerEmail({
    to: REPORT_RECIPIENT,
    subject,
    text: buildPaymentsReportBody(data),
    attachments: [
      { filename: `BMF-Payments-${range}.pdf`, content: pdf },
      { filename: `BMF-Payments-${range}.xlsx`, content: xlsx }
    ]
  });

  if (!result?.ok) {
    logBreakage('scheduler.js', 'sendPaymentsTrackingEmail', result?.reason || 'email delivery failed', 'PAYMENTS TRACKING REPORT FAILED');
    return { ok: false, data };
  }
  writeTrackingState(lusakaDate(), `${data.from || 'all'}:${data.to || 'all'}`);
  console.log(`[scheduler] payments tracking report sent to ${REPORT_RECIPIENT}`);
  return { ok: true, data };
}

/** Startup catch-up for the tracking sheet: send once if a scheduled day was missed (or the frame changed). */
async function catchUpPaymentsTracking() {
  const state = readTrackingState();
  const today = lusakaDate();
  const frame = `${TRACKING_FROM || 'all'}:${TRACKING_TO || 'all'}`;
  if (!state.lastSentDate) {
    writeTrackingState(today, frame);
    return { ok: true, skipped: true, reason: 'first run - tracking state initialised' };
  }
  if (state.lastSentDate >= today && state.frame === frame) {
    return { ok: true, skipped: true, reason: 'already sent for today' };
  }
  console.log(`[scheduler] tracking report ${state.lastSentDate} - catching up...`);
  return sendPaymentsTrackingEmail();
}

/** Startup catch-up: send once if a scheduled day was missed while offline. */
async function catchUpMissedReports() {
  const state = readState();
  const today = lusakaDate();
  if (!state.lastSentDate) {
    writeState(today);
    return { ok: true, skipped: true, reason: 'first run — state initialised' };
  }
  if (state.lastSentDate >= today) {
    return { ok: true, skipped: true, reason: 'already sent for today' };
  }
  console.log(`[scheduler] last report ${state.lastSentDate} — catching up missed day(s)...`);
  return sendDailyLoanReport();
}

function startScheduler() {
  // KIDNEYS — hourly hygiene sweep (expired OTPs, dead pending-auth entries,
  // stale device tokens, idle sessions). Counts-only logging, never an alert.
  cron.schedule('20 * * * *', () => {
    runKidneySweep();
  }, { timezone: TIMEZONE });
  // One sweep shortly after boot clears anything that accrued while the
  // server was down (delayed so startup data repair finishes first).
  setTimeout(() => runKidneySweep(), 60 * 1000).unref?.();

  // Grace penalty — 1.8%/day accrual on grace/defaulted loans, once per day.
  // Idempotent (loanController accrues by graceLastAccrual), so a restart or a
  // missed day never double-charges; it simply catches up on the next run.
  cron.schedule('5 0 * * *', () => {
    try {
      const result = accrueAllGrace(lusakaDate());
      if (result.changed) {
        console.log(`[scheduler] grace accrual applied to ${result.changed} loan(s)`);
      }
    } catch (err) {
      logBreakage('scheduler.js', 'grace-accrual', err, 'GRACE ACCRUAL ERROR');
    }
  }, { timezone: TIMEZONE });

  // Task 7 — notifications first, one minute before the report.
  cron.schedule('58 23 * * *', () => {
    runDueDatePass()
      .then(summary => console.log(`[scheduler] notifications: ${JSON.stringify(summary)}`))
      .catch(err => logBreakage('scheduler.js', 'cron:notifications', err, 'SCHEDULER NOTIFICATIONS FAILED'));
  }, { timezone: TIMEZONE });

  // Task 5 — daily report at 23:59. Guarded so a morning catch-up + evening
  // cron never double-sends the same day's report.
  cron.schedule('59 23 * * *', () => {
    const today = lusakaDate();
    if (readState().lastSentDate >= today) {
      console.log(`[scheduler] daily report for ${today} already sent — skipping duplicate run`);
      return;
    }
    sendDailyLoanReport().catch(err => logBreakage('scheduler.js', 'cron:dailyReport', err, 'SCHEDULER REPORT FAILED'));
  }, { timezone: TIMEZONE });

  // Flexible payment tracking sheet - same 23:59 slot, time frame set via env.
  // Same once-per-day guard as the daily report above.
  cron.schedule('59 23 * * *', () => {
    const today = lusakaDate();
    const frame = `${TRACKING_FROM || 'all'}:${TRACKING_TO || 'all'}`;
    const state = readTrackingState();
    if (state.lastSentDate >= today && state.frame === frame) {
      console.log(`[scheduler] payments tracking sheet for ${today} already sent — skipping duplicate run`);
      return;
    }
    sendPaymentsTrackingEmail().catch(err => logBreakage('scheduler.js', 'cron:paymentsTracking', err, 'SCHEDULER TRACKING FAILED'));
  }, { timezone: TIMEZONE });

  catchUpMissedReports().catch(err => logBreakage('scheduler.js', 'catchUpMissedReports', err, 'SCHEDULER CATCH-UP FAILED'));
  catchUpPaymentsTracking().catch(err => logBreakage('scheduler.js', 'catchUpPaymentsTracking', err, 'SCHEDULER TRACKING CATCH-UP FAILED'));
  console.log(`[scheduler] started (tz ${TIMEZONE}) — notifications 23:58, report 23:59 → ${REPORT_RECIPIENT}`);
}

module.exports = {
  lusakaDate,
  buildDailyReportData,
  buildPaymentsLeadersData,
  buildPaymentsReportBody,
  buildReportBody,
  buildReportPdf,
  buildReportXlsx,
  sendDailyLoanReport,
  sendPaymentsTrackingEmail,
  catchUpMissedReports,
  catchUpPaymentsTracking,
  startScheduler,
  REPORT_RECIPIENT,
  TRACKING_FROM,
  TRACKING_TO,
  PORTFOLIO_FROM,
  PORTFOLIO_TO
};

if (require.main === module) startScheduler();
