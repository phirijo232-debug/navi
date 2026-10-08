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
const { logError } = require('./middleware/logger');
const { runDueDatePass } = require('./middleware/loanNotifications');
const { getEnrichedLoans, deriveLoanStatus } = require('./controllers/loanController');

const TIMEZONE = process.env.DAILY_REPORT_TIMEZONE || 'Africa/Lusaka';
// Rule 8: report recipient. Env wins; default is the admin mailbox.
const REPORT_RECIPIENT = process.env.DAILY_REPORT_EMAIL || 'jophiri223@gmail.com';
const STATE_FILE = dataStore.paths.dailyReportState;

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

/** Everything the daily report email shows — single source for body/PDF/XLSX. */
function buildDailyReportData(reportDate = lusakaDate()) {
  const loans = getEnrichedLoans();
  const today = new Date().toISOString().slice(0, 10);

  const active = loans.filter(loan =>
    ['active', 'grace', 'defaulted'].includes(loan.businessStatus));
  const overdue = loans.filter(loan =>
    ['grace', 'defaulted'].includes(loan.businessStatus) && Number(loan.outstanding || 0) > 0);
  const defaulted = loans.filter(loan => loan.businessStatus === 'defaulted');

  const approvedToday = loans.filter(loan =>
    String(loan.approvedAt || loan.borrowedDate || '').slice(0, 10) === reportDate);

  let paymentsTodayAmount = 0;
  let interestToday = 0;
  let paymentsTodayCount = 0;
  loans.forEach(loan => {
    (Array.isArray(loan.payments) ? loan.payments : []).forEach(payment => {
      const when = String(payment.paymentDate || payment.date || '').slice(0, 10);
      if (when === reportDate) {
        paymentsTodayAmount += Number(payment.amount || 0);
        interestToday += Number(payment.interestPortion || 0);
        paymentsTodayCount += 1;
      }
    });
  });

  return {
    reportDate,
    generatedAt: new Date().toISOString(),
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
  return [
    `Daily Loan Report — ${data.reportDate}`,
    '',
    `Total active loans: ${data.activeLoans}`,
    `Outstanding on active loans: K${data.activeOutstanding.toFixed(2)}`,
    `New loans approved today: ${data.approvedTodayCount}${approved}`,
    `Payments received today: ${data.paymentsTodayCount} totaling K${data.paymentsTodayAmount.toFixed(2)}`,
    `Overdue loans: ${data.overdueCount} totaling K${data.overdueTotal.toFixed(2)}`,
    `Defaulters: ${data.defaultersCount}`,
    `Total interest earned today: K${data.interestToday.toFixed(2)}`
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
    doc.fontSize(11).text(`Date: ${data.reportDate}`, { align: 'center' });
    doc.moveDown(1.5);

    doc.fontSize(12).text('Portfolio Summary');
    doc.moveDown(0.5);
    doc.fontSize(10).text(`Total active loans: ${data.activeLoans}`);
    doc.text(`Outstanding on active loans: K${data.activeOutstanding.toFixed(2)}`);
    doc.text(`New loans approved today: ${data.approvedTodayCount}`);
    doc.text(`Payments received today: ${data.paymentsTodayCount} (K${data.paymentsTodayAmount.toFixed(2)})`);
    doc.text(`Overdue loans: ${data.overdueCount} (K${data.overdueTotal.toFixed(2)})`);
    doc.text(`Defaulters: ${data.defaultersCount}`);
    doc.text(`Total interest earned today: K${data.interestToday.toFixed(2)}`);

    if (data.overdueLoans.length) {
      doc.moveDown(1);
      doc.fontSize(12).text('Overdue Loans');
      doc.moveDown(0.5);
      doc.fontSize(9);
      data.overdueLoans.forEach(loan => {
        doc.text(`${loan.receipt || 'n/a'} | ${loan.email} | due ${loan.dueDate || 'n/a'} | outstanding K${Number(loan.outstanding || 0).toFixed(2)}`);
      });
    }
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
    { metric: 'New loans approved today', value: data.approvedTodayCount },
    { metric: 'Payments received today (count)', value: data.paymentsTodayCount },
    { metric: 'Payments received today (K)', value: data.paymentsTodayAmount },
    { metric: 'Overdue loans (count)', value: data.overdueCount },
    { metric: 'Overdue total (K)', value: data.overdueTotal },
    { metric: 'Defaulters', value: data.defaultersCount },
    { metric: 'Interest earned today (K)', value: data.interestToday }
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
  const subject = `Pryme Buraza Micro Finance — Daily Loan Report ${data.reportDate}`;
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
    logError(`DAILY LOAN REPORT FAILED: ${result?.reason || 'email delivery failed'}`);
    return { ok: false, data };
  }
  writeState(data.reportDate);
  console.log(`[scheduler] daily report sent to ${REPORT_RECIPIENT} for ${data.reportDate}`);
  return { ok: true, data };
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
  // Task 7 — notifications first, one minute before the report.
  cron.schedule('58 23 * * *', () => {
    runDueDatePass()
      .then(summary => console.log(`[scheduler] notifications: ${JSON.stringify(summary)}`))
      .catch(err => logError(`SCHEDULER NOTIFICATIONS FAILED: ${err.message}`));
  }, { timezone: TIMEZONE });

  // Task 5 — daily report at 23:59.
  cron.schedule('59 23 * * *', () => {
    sendDailyLoanReport().catch(err => logError(`SCHEDULER REPORT FAILED: ${err.message}`));
  }, { timezone: TIMEZONE });

  catchUpMissedReports().catch(err => logError(`SCHEDULER CATCH-UP FAILED: ${err.message}`));
  console.log(`[scheduler] started (tz ${TIMEZONE}) — notifications 23:58, report 23:59 → ${REPORT_RECIPIENT}`);
}

module.exports = {
  lusakaDate,
  buildDailyReportData,
  buildReportBody,
  buildReportPdf,
  buildReportXlsx,
  sendDailyLoanReport,
  catchUpMissedReports,
  startScheduler,
  REPORT_RECIPIENT
};

if (require.main === module) startScheduler();
