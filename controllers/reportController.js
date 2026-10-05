const fs = require('fs');
const path = require('path');
const ExcelJS = require('exceljs');
const PDFDocument = require('pdfkit');
const config = require('../config');
const { logError } = require('../middleware/logger');
const dataStore = require('../middleware/dataStore');
const { getFeedbackData } = require('./feedbackController');
const { getRecordStoreId, canAccessStore, isAdminRole } = require('../middleware/storeScope');

const USERS_FILE = dataStore.paths.users;
const LOANS_FILE = dataStore.paths.loans;

function readArray(file) {
  return dataStore.readJson(file, [], Array.isArray);
}

function sumPayments(loan) {
  return (Array.isArray(loan.payments) ? loan.payments : [])
    .reduce((sum, payment) => sum + (Number(payment.amount) || 0), 0);
}

function getSettledAt(loan) {
  if (loan.settledAt) return loan.settledAt;
  const payments = Array.isArray(loan.payments) ? loan.payments : [];
  return payments.map(payment => payment.date).filter(Boolean).sort().at(-1) || null;
}

function categorizeLoan(loan, today = new Date().toISOString().slice(0, 10)) {
  const status = String(loan.status || 'pending').trim().toLowerCase().replace(/\s+/g, '_');
  const balance = Number(loan.outstanding || 0);
  const paid = sumPayments(loan);
  const dueDate = String(loan.dueDate || '').slice(0, 10);
  const settled = balance <= 0 || status === 'paid';
  const overdue = !settled && status !== 'declined' && dueDate && dueDate < today;
  const settledAt = getSettledAt(loan);
  const settledOnTime = settled && dueDate && settledAt && String(settledAt).slice(0, 10) <= dueDate;

  if (status === 'declined') return 'declined';
  if (status === 'pending') return 'pending_application';
  if (settledOnTime) return 'settled_on_time';
  if (settled) return 'settled';
  if (overdue || status === 'overdue') return 'defaulter';
  if (paid > 0) return 'partial_payment';
  if (['pending', 'approved', 'in_progress'].includes(status)) return 'pending_payment';
  return status;
}

function getReportData(scope = config.DEFAULT_STORE_ID) {
  const users = readArray(USERS_FILE);
  const allLoans = readArray(LOANS_FILE);
  const allFeedback = getFeedbackData();
  const loans = allLoans.filter(loan => scope === 'all' || getRecordStoreId(loan) === scope);
  const feedback = allFeedback.filter(item => scope === 'all' || getRecordStoreId(item) === scope);
  const scopedUsers = users.filter(user => scope === 'all' || getRecordStoreId(user) === scope);
  const today = new Date().toISOString().slice(0, 10);
  const loanRows = loans.map(loan => ({ ...loan, reportCategory: categorizeLoan(loan, today), paidTotal: sumPayments(loan) }));
  const activeLoans = loanRows.filter(loan => !['declined', 'pending'].includes(String(loan.status || '').toLowerCase()));
  const outstandingLoans = loanRows.filter(loan => Number(loan.outstanding || 0) > 0 && loan.reportCategory !== 'declined');
  const defaulterLoans = loanRows.filter(loan => loan.reportCategory === 'defaulter');
  const partialPaymentLoans = loanRows.filter(loan => loan.reportCategory === 'partial_payment');
  const settledLoans = loanRows.filter(loan => ['settled', 'settled_on_time'].includes(loan.reportCategory));
  const loyalEmails = new Set(loanRows.filter(loan => loan.reportCategory === 'settled_on_time').map(loan => String(loan.email || '').toLowerCase()));
  const customersByEmail = new Map(scopedUsers.map(user => [String(user.email || '').toLowerCase(), user]));
  const defaulterEmails = new Set(defaulterLoans.map(loan => String(loan.email || '').toLowerCase()).filter(Boolean));
  const defaulters = defaulterLoans.map(loan => ({
    loanId: loan.id,
    email: loan.email,
    username: customersByEmail.get(String(loan.email || '').toLowerCase())?.username || loan.email,
    product: loan.product,
    outstanding: loan.outstanding,
    dueDate: loan.dueDate
  }));
  const loyalSettlementLoans = loanRows.filter(loan => loan.reportCategory === 'settled_on_time')
    .map(loan => ({ ...loan, settledAt: getSettledAt(loan) }));
  const loyalCustomers = [...loyalEmails]
    .filter(Boolean)
    .map(email => ({ email, username: customersByEmail.get(email)?.username || email }));
  const cashCollected = loanRows.reduce((sum, loan) => sum + loan.paidTotal, 0);
  const totalOutstanding = outstandingLoans.reduce((sum, loan) => sum + (Number(loan.outstanding) || 0), 0);
  const grossInterestBooked = activeLoans.reduce((sum, loan) => sum + (Number(loan.interestAmount) || 0), 0);
  const principalIssued = activeLoans.reduce((sum, loan) => sum + (Number(loan.amount) || 0), 0);

  return {
    scope,
    generatedAt: new Date().toISOString(),
    note: 'Gross interest booked is contractual interest on non-declined loans. Principal reflects approved loan records because disbursement dates are not tracked. Net profit is not calculated because operating expenses are not recorded. On-time loyalty requires settlement on or before the due date.',
    summary: {
      customerAccounts: scopedUsers.filter(user => user.role === 'user').length,
      totalLoans: loanRows.length,
      pendingPayments: outstandingLoans.filter(loan => ['pending_payment', 'partial_payment'].includes(loan.reportCategory)).length,
      partialPayments: partialPaymentLoans.length,
      defaulters: defaulterEmails.size,
      settledLoans: settledLoans.length,
      loyalCustomers: loyalCustomers.length,
      cashCollected: Number(cashCollected.toFixed(2)),
      totalOutstanding: Number(totalOutstanding.toFixed(2)),
      grossInterestBooked: Number(grossInterestBooked.toFixed(2)),
      approvedLoanPrincipal: Number(principalIssued.toFixed(2)),
      feedback: {
        total: feedback.length,
        complaints: feedback.filter(item => item.category === 'complaint').length,
        experiences: feedback.filter(item => item.category === 'experience').length,
        improvements: feedback.filter(item => item.category === 'improvement').length,
        inquiries: feedback.filter(item => item.category === 'inquiry').length
      }
    },
    loans: loanRows,
    payments: loanRows.flatMap(loan => (Array.isArray(loan.payments) ? loan.payments : []).map(payment => ({
      loanId: loan.id,
      email: loan.email,
      product: loan.product,
      ...payment
    }))),
    defaulters,
    defaulterLoans,
    partialPaymentLoans,
    settledLoans,
    loyalCustomers,
    loyalSettlementLoans,
    feedback
  };
}

function isAuthorized(req, scope) {
  if (!isAdminRole(req.authUser?.role)) return false;
  if (scope === 'all' && req.authUser.role !== 'admin') return false;
  return canAccessStore(req, scope === 'all' ? config.DEFAULT_STORE_ID : scope);
}

function getReportSummary(req, res) {
  const scope = req.params.scope === 'franchise' ? 'all' : req.params.scope;
  if (!isAuthorized(req, scope)) return res.status(403).json({ error: 'Admin access required for this report scope.' });
  return res.json(getReportData(scope));
}

function addSheet(workbook, name, columns, rows) {
  const sheet = workbook.addWorksheet(name);
  sheet.columns = columns;
  sheet.addRows(rows);
  sheet.getRow(1).font = { bold: true };
  sheet.views = [{ state: 'frozen', ySplit: 1 }];
  return sheet;
}

async function buildExcelReport(data) {
  const workbook = new ExcelJS.Workbook();
  workbook.creator = 'Pryme Vertex';
  workbook.created = new Date(data.generatedAt);
  addSheet(workbook, 'Summary', [
    { header: 'Metric', key: 'metric', width: 32 },
    { header: 'Value', key: 'value', width: 22 }
  ], Object.entries(data.summary).filter(([, value]) => typeof value !== 'object').map(([metric, value]) => ({ metric, value })));
  addSheet(workbook, 'Loan ledger', [
    { header: 'Loan ID', key: 'id', width: 12 },
    { header: 'Customer', key: 'email', width: 32 },
    { header: 'Product', key: 'product', width: 28 },
    { header: 'Status', key: 'status', width: 16 },
    { header: 'Category', key: 'reportCategory', width: 22 },
    { header: 'Principal', key: 'amount', width: 16 },
    { header: 'Interest', key: 'interestAmount', width: 16 },
    { header: 'Total repayment', key: 'totalRepayment', width: 18 },
    { header: 'Paid', key: 'paidTotal', width: 16 },
    { header: 'Outstanding', key: 'outstanding', width: 16 },
    { header: 'Due date', key: 'dueDate', width: 16 }
  ], data.loans);
  addSheet(workbook, 'Payments', [
    { header: 'Loan ID', key: 'loanId', width: 12 },
    { header: 'Customer', key: 'email', width: 32 },
    { header: 'Product', key: 'product', width: 28 },
    { header: 'Amount', key: 'amount', width: 16 },
    { header: 'Mode', key: 'mode', width: 18 },
    { header: 'Date', key: 'date', width: 28 },
    { header: 'Note', key: 'note', width: 32 },
    { header: 'Proof file', key: 'screenshot', width: 36 }
  ], data.payments);
  addSheet(workbook, 'Defaulters', [
    { header: 'Loan ID', key: 'loanId', width: 12 },
    { header: 'Customer', key: 'username', width: 32 },
    { header: 'Email', key: 'email', width: 36 },
    { header: 'Product', key: 'product', width: 28 },
    { header: 'Outstanding', key: 'outstanding', width: 18 },
    { header: 'Due date', key: 'dueDate', width: 18 }
  ], data.defaulters);
  addSheet(workbook, 'Pending payments', [
    { header: 'Loan ID', key: 'id', width: 12 },
    { header: 'Customer', key: 'email', width: 36 },
    { header: 'Product', key: 'product', width: 28 },
    { header: 'Category', key: 'reportCategory', width: 22 },
    { header: 'Outstanding', key: 'outstanding', width: 18 },
    { header: 'Due date', key: 'dueDate', width: 18 }
  ], data.loans.filter(loan => ['pending_payment', 'partial_payment', 'defaulter'].includes(loan.reportCategory)));
  addSheet(workbook, 'Partial payments', [
    { header: 'Loan ID', key: 'id', width: 12 },
    { header: 'Customer', key: 'email', width: 32 },
    { header: 'Paid', key: 'paidTotal', width: 16 },
    { header: 'Outstanding', key: 'outstanding', width: 16 },
    { header: 'Due date', key: 'dueDate', width: 18 }
  ], data.partialPaymentLoans);
  addSheet(workbook, 'Settlements', [
    { header: 'Loan ID', key: 'id', width: 12 },
    { header: 'Customer', key: 'email', width: 32 },
    { header: 'Paid on', key: 'settledAt', width: 28 },
    { header: 'Due date', key: 'dueDate', width: 18 },
    { header: 'Category', key: 'reportCategory', width: 22 }
  ], data.settledLoans.map(loan => ({ ...loan, settledAt: getSettledAt(loan) })));
  addSheet(workbook, 'Loyal customers', [
    { header: 'Customer', key: 'username', width: 32 },
    { header: 'Email', key: 'email', width: 36 }
  ], data.loyalCustomers);
  addSheet(workbook, 'On-time settlements', [
    { header: 'Loan ID', key: 'id', width: 12 },
    { header: 'Customer', key: 'email', width: 36 },
    { header: 'Principal', key: 'amount', width: 16 },
    { header: 'Interest', key: 'interestAmount', width: 16 },
    { header: 'Settled at', key: 'settledAt', width: 28 },
    { header: 'Due date', key: 'dueDate', width: 18 }
  ], data.loyalSettlementLoans);
  addSheet(workbook, 'Feedback', [
    { header: 'Category', key: 'category', width: 18 },
    { header: 'Status', key: 'status', width: 18 },
    { header: 'Customer', key: 'email', width: 34 },
    { header: 'Message', key: 'message', width: 80 },
    { header: 'Submitted', key: 'createdAt', width: 28 }
  ], data.feedback);
  return workbook.xlsx.writeBuffer();
}

function buildPdfReport(data, res, label) {
  const doc = new PDFDocument({ margin: 48, size: 'A4' });
  res.setHeader('Content-Type', 'application/pdf');
  res.setHeader('Content-Disposition', `attachment; filename="${label}-ledger-${new Date().toISOString().slice(0, 10)}.pdf"`);
  doc.pipe(res);
  doc.fontSize(20).text(`${label} Portfolio Report`);
  doc.moveDown(0.5).fontSize(10).text(`Generated ${new Date(data.generatedAt).toLocaleString('en-GB')}`);
  doc.moveDown().fontSize(12).text(data.note, { width: 500 });
  doc.moveDown();
  doc.fontSize(15).text('Summary');
  Object.entries(data.summary).forEach(([key, value]) => {
    if (typeof value !== 'object') doc.fontSize(10).text(`${key}: ${value}`);
  });
  doc.addPage().fontSize(15).text('Loan ledger');
  data.loans.forEach(loan => {
    doc.moveDown(0.5).fontSize(9).text(
      `#${loan.id} ${loan.email} | ${loan.product || 'Loan'} | ${loan.reportCategory} | principal K${Number(loan.amount || 0).toFixed(2)} | interest K${Number(loan.interestAmount || 0).toFixed(2)} | paid K${Number(loan.paidTotal || 0).toFixed(2)} | outstanding K${Number(loan.outstanding || 0).toFixed(2)} | due ${loan.dueDate || 'n/a'}`,
      { width: 500 }
    );
  });
  for (const [title, loans] of [
    ['Defaulters', data.loans.filter(loan => loan.reportCategory === 'defaulter')],
    ['Partial payments', data.partialPaymentLoans],
    ['Settled loans', data.settledLoans]
  ]) {
    doc.addPage().fontSize(15).text(title);
    if (!loans.length) doc.moveDown().fontSize(10).text('No records.');
    loans.forEach(loan => {
      doc.moveDown(0.5).fontSize(10).text(
        `#${loan.id} ${loan.email} | ${loan.product || 'Loan'} | ${loan.reportCategory} | outstanding K${Number(loan.outstanding || 0).toFixed(2)} | due ${loan.dueDate || 'n/a'}`,
        { width: 500 }
      );
    });
  }
  doc.addPage().fontSize(15).text('Loyal customers - settled on time');
  if (!data.loyalCustomers.length) doc.moveDown().fontSize(10).text('No verified on-time settlements yet.');
  data.loyalCustomers.forEach(customer => doc.moveDown(0.5).fontSize(10).text(`${customer.username} | ${customer.email}`));
  doc.end();
}

async function exportReport(req, res) {
  try {
    const scope = req.params.scope === 'franchise' ? 'all' : req.params.scope;
    if (!isAuthorized(req, scope)) return res.status(403).json({ error: 'Admin access required for this report scope.' });
    const data = getReportData(scope);
    const label = scope === 'all' ? 'pryme-vertex' : 'buraza';
    const format = String(req.query.format || 'xlsx').toLowerCase();
    if (format === 'pdf') return buildPdfReport(data, res, label);
    if (format !== 'xlsx') return res.status(400).json({ error: 'Export format must be xlsx or pdf.' });
    const buffer = await buildExcelReport(data);
    res.setHeader('Content-Type', 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet');
    res.setHeader('Content-Disposition', `attachment; filename="${label}-ledger-${new Date().toISOString().slice(0, 10)}.xlsx"`);
    return res.send(Buffer.from(buffer));
  } catch (err) {
    logError(`REPORT EXPORT FAILED: ${err.message}`);
    if (!res.headersSent) return res.status(500).json({ error: 'Unable to export the report.' });
  }
}

function buildDailyReportText(data) {
  const { summary } = data;
  return [
    `Daily Buraza Micro Finance (BMF) report - ${new Date(data.generatedAt).toLocaleDateString('en-GB')}`,
    '',
    `Customer accounts: ${summary.customerAccounts}`,
    `Loan records: ${summary.totalLoans}`,
    `Cash collected: K${summary.cashCollected.toFixed(2)}`,
    `Gross interest booked: K${summary.grossInterestBooked.toFixed(2)}`,
    `Principal approved: K${summary.approvedLoanPrincipal.toFixed(2)}`,
    `Outstanding: K${summary.totalOutstanding.toFixed(2)}`,
    `Pending payments: ${summary.pendingPayments}`,
    `Partial payments: ${summary.partialPayments}`,
    `Defaulters: ${summary.defaulters}`,
    `Settled loans: ${summary.settledLoans}`,
    `Loyal customers (settled on time): ${summary.loyalCustomers}`,
    `Customer feedback: ${summary.feedback.total} (complaints ${summary.feedback.complaints}, experiences ${summary.feedback.experiences}, improvements ${summary.feedback.improvements}, inquiries ${summary.feedback.inquiries})`,
    '',
    data.note
  ].join('\n');
}

module.exports = { categorizeLoan, getReportData, getReportSummary, exportReport, buildExcelReport, buildDailyReportText };
