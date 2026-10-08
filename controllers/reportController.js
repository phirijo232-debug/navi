const fs = require('fs');
const path = require('path');
const ExcelJS = require('exceljs');
const PDFDocument = require('pdfkit');
const config = require('../config');
const { logError } = require('../middleware/logger');
const dataStore = require('../middleware/dataStore');
const { getFeedbackData } = require('./feedbackController');
const { getRecordStoreId, getRequestedStoreId, canAccessStore, isAdminRole } = require('../middleware/storeScope');

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

function isAuthorizedUserReport(req, email) {
  const normalized = String(email || '').trim().toLowerCase();
  if (!normalized) return false;
  if (isAdminRole(req.authUser?.role)) {
    return canAccessStore(req, getRequestedStoreId(req));
  }
  return String(req.authUser?.email || '').trim().toLowerCase() === normalized;
}

function analyticsScope(req) {
  const scope = req.params.scope === 'franchise' ? 'all' : (req.params.scope || 'buraza');
  return scope;
}

function getAnalyticsLoans(scope) {
  const { getEnrichedLoans } = require('./loanController');
  const data = getReportData(scope);
  const enrichedById = new Map(getEnrichedLoans().map(loan => [loan.id, loan]));
  return data.loans.map(loan => ({
    ...loan,
    businessStatus: enrichedById.get(loan.id)?.businessStatus || categorizeLoan(loan),
    receiptNumber: loan.receiptNumber || enrichedById.get(loan.id)?.receiptNumber || null
  }));
}

function getReportSummary(req, res) {
  const scope = req.params.scope === 'franchise' ? 'all' : req.params.scope;
  if (!isAuthorized(req, scope)) return res.status(403).json({ error: 'Admin access required for this report scope.' });
  return res.json(getReportData(scope));
}

// ─── BMF analytics endpoints (profits / defaulters / overdue / paid) ─────────
function getProfitAnalytics(req, res) {
  const scope = analyticsScope(req);
  if (!isAuthorized(req, scope)) return res.status(403).json({ error: 'Admin access required for this report scope.' });
  const loans = getAnalyticsLoans(scope);

  const profitRows = loans.map(loan => {
    const interestCollected = Number((loan.payments || [])
      .reduce((sum, p) => sum + (Number(p.interestPortion) || 0), 0).toFixed(2));
    return {
      receiptNumber: loan.receiptNumber,
      email: loan.email,
      principal: Number(loan.amount || 0),
      interestBooked: Number(loan.interestAmount || 0),
      interestCollected,
      totalCollected: Number(loan.paidTotal || 0),
      outstanding: Number(loan.outstanding || 0),
      businessStatus: loan.businessStatus
    };
  });

  return res.json({
    scope,
    generatedAt: new Date().toISOString(),
    totals: {
      principalIssued: profitRows.reduce((sum, r) => sum + r.principal, 0),
      grossInterestBooked: profitRows.reduce((sum, r) => sum + r.interestBooked, 0),
      interestCollected: Number(profitRows.reduce((sum, r) => sum + r.interestCollected, 0).toFixed(2)),
      totalCollected: profitRows.reduce((sum, r) => sum + r.totalCollected, 0)
    },
    loans: profitRows
  });
}

function getDefaulterAnalytics(req, res) {
  const scope = analyticsScope(req);
  if (!isAuthorized(req, scope)) return res.status(403).json({ error: 'Admin access required for this report scope.' });
  const defaulted = getAnalyticsLoans(scope).filter(loan => loan.businessStatus === 'defaulted');

  const byCustomer = new Map();
  defaulted.forEach(loan => {
    const key = String(loan.email || 'unknown').toLowerCase();
    if (!byCustomer.has(key)) {
      byCustomer.set(key, { email: loan.email, loans: [], outstanding: 0, capital: 0 });
    }
    const entry = byCustomer.get(key);
    entry.loans.push(loan.receiptNumber || loan.id);
    entry.outstanding += Number(loan.outstanding || 0);
    entry.capital += Number(loan.amount || 0);
  });

  const defaulters = [...byCustomer.values()]
    .map(entry => ({ ...entry, outstanding: Number(entry.outstanding.toFixed(2)) }));

  return res.json({
    scope,
    generatedAt: new Date().toISOString(),
    possibleLoss: Number(defaulted.reduce((sum, l) => sum + (Number(l.outstanding) || 0), 0).toFixed(2)),
    defaulters,
    loans: defaulted
  });
}

function getOverdueAnalytics(req, res) {
  const scope = analyticsScope(req);
  if (!isAuthorized(req, scope)) return res.status(403).json({ error: 'Admin access required for this report scope.' });
  const overdue = getAnalyticsLoans(scope).filter(loan =>
    ['grace', 'defaulted'].includes(loan.businessStatus) && Number(loan.outstanding || 0) > 0);

  return res.json({
    scope,
    generatedAt: new Date().toISOString(),
    totalOverdue: Number(overdue.reduce((sum, l) => sum + (Number(l.outstanding) || 0), 0).toFixed(2)),
    loans: overdue
  });
}

function getPaidAnalytics(req, res) {
  const scope = analyticsScope(req);
  if (!isAuthorized(req, scope)) return res.status(403).json({ error: 'Admin access required for this report scope.' });
  const settled = getAnalyticsLoans(scope).filter(loan => loan.businessStatus === 'paid');

  return res.json({
    scope,
    generatedAt: new Date().toISOString(),
    settledCount: settled.length,
    totalCollected: Number(settled.reduce((sum, l) => sum + (Number(l.paidTotal) || 0), 0).toFixed(2)),
    loans: settled
  });
}

// ─── Single-user report: loans + payments + balances for one borrower ────────
function getUserReport(req, res) {
  const email = String(req.params.email || req.query.email || '').trim().toLowerCase();
  if (!isAuthorizedUserReport(req, email)) {
    return res.status(403).json({ error: 'Access to this account report is not allowed.' });
  }

  const { getEnrichedLoans, summarizeStore } = require('./loanController');
  const users = readArray(USERS_FILE);
  const profile = users.find(user => String(user.email || '').trim().toLowerCase() === email) || null;
  const profileSafe = profile ? { ...profile } : null;
  if (profileSafe) delete profileSafe.password;

  const borrowersLoans = getEnrichedLoans()
    .filter(loan => String(loan.email || '').trim().toLowerCase() === email);

  return res.json({
    email,
    generatedAt: new Date().toISOString(),
    profile: profileSafe,
    totals: summarizeStore(borrowersLoans),
    loans: borrowersLoans,
    payments: borrowersLoans.flatMap(loan => (Array.isArray(loan.payments) ? loan.payments : []).map(payment => ({
      loanId: loan.id,
      loanReceiptNumber: loan.receiptNumber,
      paymentReceiptNumber: payment.receiptNumber,
      ...payment
    })))
  });
}

// ─── Search by loan receipt ID or borrower email ─────────────────────────────
function searchReports(req, res) {
  if (!isAdminRole(req.authUser?.role)) {
    return res.status(403).json({ error: 'Admin access required.' });
  }
  const storeId = getRequestedStoreId(req);
  if (!canAccessStore(req, storeId)) return res.status(403).json({ error: 'Access to this store is not allowed.' });

  const { searchLoansByReceipt } = require('./loanController');
  const scoped = getAnalyticsLoans(storeId === 'all' ? 'all' : analyticsScope(req))
    .filter(loan => storeId === 'all' || getRecordStoreId(loan) === storeId);
  return res.json({
    total: searchLoansByReceipt(scoped, req.query.receipt || req.query.q).length,
    loans: searchLoansByReceipt(scoped, req.query.receipt || req.query.q)
  });
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

// ─── TASK 4 — BMF report system (admin only) ─────────────────────────────────
// GET /reports/user?email=...   → one borrower: loans, payments, summary
// GET /reports/all              → every borrower + grand totals
// GET /reports/analytics        → profit, loss, overdue, paid, loyalty

function requireAdmin(req, res) {
  if (!isAdminRole(req.authUser?.role)) {
    res.status(403).json({ error: 'Admin access required for this report.' });
    return false;
  }
  return true;
}

function collectLoansForEmail(email) {
  const { getEnrichedLoans } = require('./loanController');
  const target = String(email || '').trim().toLowerCase();
  return getEnrichedLoans().filter(loan =>
    String(loan.email || '').trim().toLowerCase() === target);
}

function interestPaidOf(loan) {
  return (Array.isArray(loan.payments) ? loan.payments : [])
    .reduce((sum, payment) => sum + (Number(payment.interestPortion) || 0), 0);
}

/** Shape one loan exactly as the Task 4 report spec requires. */
function shapeLoan(loan) {
  const { normalizeStatus } = require('./loanController');
  const payments = (Array.isArray(loan.payments) ? loan.payments : []).map(payment => ({
    paymentReceiptId: payment.paymentReceiptId || payment.receiptNumber || null,
    amount: Number(payment.amount || 0),
    date: payment.paymentDate || payment.date || null,
    balanceBefore: Number(payment.balanceBefore || 0),
    balanceAfter: Number(payment.balanceAfter || 0),
    mode: payment.mode || 'Cash',
    note: payment.note || payment.description || null,
    recordedBy: payment.recordedBy || null
  }));

  return {
    loanReceiptId: loan.receiptNumber || null,
    id: loan.id,
    amount: Number(loan.amount || 0),
    tenure: Number(loan.tenureWeeks || 0),
    interestRate: Number(loan.interestRate || 0),
    interestAmount: Number(loan.interestAmount || 0),
    totalRepayment: Number(loan.totalRepayment || 0),
    outstanding: Number(loan.outstanding || 0),
    approvedAt: loan.approvedAt || loan.borrowedDate || null,
    borrowedDate: loan.borrowedDate || loan.approvedAt || null,
    dueDate: loan.dueDate || null,
    status: loan.businessStatus || normalizeStatus(loan.status),
    rawStatus: loan.status,
    urgency: loan.urgency || 'standard',
    createdAt: loan.createdAt || null,
    totalPaid: Number(loan.paidTotal || 0),
    interestPaid: Number(interestPaidOf(loan).toFixed(2)),
    payments
  };
}

function buildUserReportBody(email) {
  const users = readArray(USERS_FILE);
  const target = String(email || '').trim().toLowerCase();
  const profile = users.find(user => String(user.email || '').trim().toLowerCase() === target) || null;
  const profileSafe = profile ? { ...profile } : null;
  if (profileSafe) delete profileSafe.password;

  const loans = collectLoansForEmail(target).map(shapeLoan);
  const summary = {
    totalBorrowed: loans.reduce((sum, loan) => sum + loan.amount, 0),
    totalPaid: loans.reduce((sum, loan) => sum + loan.totalPaid, 0),
    totalOutstanding: loans.reduce((sum, loan) => sum + loan.outstanding, 0),
    totalInterestPaid: Number(loans.reduce((sum, loan) => sum + loan.interestPaid, 0).toFixed(2)),
    loanCount: loans.length
  };

  return {
    name: profileSafe?.username || target,
    email: target,
    loans,
    summary
  };
}

function getSingleUserReport(req, res) {
  if (!requireAdmin(req, res)) return;
  const email = String(req.query.email || '').trim().toLowerCase();
  if (!email) return res.status(400).json({ error: 'email query parameter is required.' });

  const body = buildUserReportBody(email);
  if (!body.loans.length && !body.name) {
    return res.status(404).json({ error: `No account found for ${email}.` });
  }
  return res.json(body);
}

function getAllUsersReport(req, res) {
  if (!requireAdmin(req, res)) return;

  const { getEnrichedLoans } = require('./loanController');
  const emails = [...new Set([
    ...readArray(USERS_FILE).map(user => String(user.email || '').trim().toLowerCase()),
    ...getEnrichedLoans().map(loan => String(loan.email || '').trim().toLowerCase())
  ].filter(Boolean))];

  const reports = emails.map(email => buildUserReportBody(email));
  const allLoans = reports.flatMap(report => report.loans);

  const grandTotals = {
    grandTotalBorrowed: allLoans.reduce((sum, loan) => sum + loan.amount, 0),
    grandTotalPaid: allLoans.reduce((sum, loan) => sum + loan.totalPaid, 0),
    grandTotalOutstanding: allLoans.reduce((sum, loan) => sum + loan.outstanding, 0),
    grandTotalInterest: Number(getEnrichedLoans().reduce((sum, loan) =>
      sum + interestPaidOf(loan), 0).toFixed(2)),
    totalActiveLoans: allLoans.filter(loan => ['active', 'grace'].includes(loan.status)).length,
    totalOverdueLoans: allLoans.filter(loan => ['grace', 'defaulted'].includes(loan.status)).length,
    totalPaidLoans: allLoans.filter(loan => loan.status === 'paid').length,
    totalDefaulters: new Set(allLoans.filter(loan => loan.status === 'defaulted').map(loan => loan.email)).size
  };

  return res.json({ generatedAt: new Date().toISOString(), users: reports, grandTotals });
}

function getAnalyticsReport(req, res) {
  if (!requireAdmin(req, res)) return;

  const { getEnrichedLoans } = require('./loanController');
  const enriched = getEnrichedLoans();
  const isOverdue = loan => ['grace', 'defaulted'].includes(loan.businessStatus);
  const isPaid = loan => loan.businessStatus === 'paid';
  const isDefaulted = loan => loan.businessStatus === 'defaulted';
  const isActive = loan => !['paid', 'declined'].includes(loan.businessStatus);

  const totalProfitEarned = Number(enriched.reduce((sum, loan) => sum + interestPaidOf(loan), 0).toFixed(2));
  const projectedProfit = Number(enriched.filter(isActive)
    .reduce((sum, loan) => sum + Math.max(0, Number(loan.interestAmount || 0) - interestPaidOf(loan)), 0)
    .toFixed(2));
  const possibleLoss = Number(enriched.filter(isDefaulted)
    .reduce((sum, loan) => sum + Number(loan.outstanding || 0), 0).toFixed(2));
  const totalDefaulters = new Set(enriched.filter(isDefaulted).map(loan => loan.email)).size;

  const overdueLoans = enriched.filter(isOverdue).map(loan => ({
    loanReceiptId: loan.receiptNumber,
    email: loan.email,
    amount: Number(loan.amount || 0),
    dueDate: loan.dueDate || null,
    daysOverdue: loan.dueDate
      ? Math.max(0, Math.round((Date.now() - new Date(`${String(loan.dueDate).slice(0, 10)}T00:00:00Z`).getTime()) / 86400000))
      : 0,
    outstanding: Number(loan.outstanding || 0)
  }));

  const paidLoans = enriched.filter(isPaid).map(loan => ({
    loanReceiptId: loan.receiptNumber,
    email: loan.email,
    amount: Number(loan.amount || 0),
    datePaid: loan.settledAt || (loan.payments || []).slice(-1)[0]?.paymentDate ||
      (loan.payments || []).slice(-1)[0]?.date || null,
    totalPaid: Number(loan.paidTotal || 0)
  }));

  // Loyal = settled loans and never overdue; slow payer = overdue at least
  // once but eventually settled.
  const byEmail = new Map();
  enriched.forEach(loan => {
    const key = String(loan.email || '').trim().toLowerCase();
    if (!key) return;
    if (!byEmail.has(key)) byEmail.set(key, []);
    byEmail.get(key).push(loan);
  });

  const loyalCustomers = [];
  const slowPayers = [];
  byEmail.forEach((loans, email) => {
    const everOverdue = loans.some(loan =>
      isOverdue(loan) || (loan.statusHistory || []).some(entry =>
        ['grace', 'defaulted', 'overdue'].includes(String(entry.status || '').toLowerCase())));
    const hasPaid = loans.some(isPaid);
    if (hasPaid && !everOverdue) loyalCustomers.push(email);
    else if (hasPaid && everOverdue) slowPayers.push(email);
  });

  return res.json({
    generatedAt: new Date().toISOString(),
    totalProfitEarned,
    projectedProfit,
    possibleLoss,
    totalDefaulters,
    overdueLoans,
    paidLoans,
    loyalCustomers,
    slowPayers,
    counts: {
      overdue: overdueLoans.length,
      paid: paidLoans.length,
      loyal: loyalCustomers.length,
      slowPayers: slowPayers.length
    }
  });
}

module.exports = {
  categorizeLoan,
  getReportData,
  getReportSummary,
  getSingleUserReport,
  getAllUsersReport,
  getAnalyticsReport,
  getProfitAnalytics,
  getDefaulterAnalytics,
  getOverdueAnalytics,
  getPaidAnalytics,
  getUserReport,
  searchReports,
  getAnalyticsLoans,
  exportReport,
  buildExcelReport,
  buildDailyReportText
};
