const fs = require('fs');
const path = require('path');
const ExcelJS = require('exceljs');
const PDFDocument = require('pdfkit');
const config = require('../config');
const { logError, logBreakage } = require('../middleware/logger');
const dataStore = require('../middleware/dataStore');
const { getFeedbackData } = require('./feedbackController');
const { getRecordStoreId, getRequestedStoreId, canAccessStore, isAdminRole } = require('../middleware/storeScope');
const { getEnrichedLoans, summarizeStore, searchLoansByReceipt, normalizeStatus } = require('./loanController');
const { buildTrackingSheet, persistTracking } = require('./reportTracking');
const R = require('../services/bmfReports');
const X = require('../services/bmfExcel');
const P = require('../services/bmfPdf');

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

// Optional period frame (?from=YYYY-MM-DD&to=YYYY-MM-DD) shared by portfolio reports.
function withinPeriod(dateValue, from, to) {
  if (!from && !to) return true;
  if (!dateValue) return false;
  const ts = new Date(dateValue).getTime();
  if (Number.isNaN(ts)) return false;
  if (from && ts < new Date(`${from}T00:00:00Z`).getTime()) return false;
  if (to && ts > new Date(`${to}T23:59:59Z`).getTime()) return false;
  return true;
}

/**
 * Narrow a loan list to a period: a loan is included when it was approved
 * (or created) inside the period OR has a payment inside the period, and its
 * payments are reduced to the ones received inside the period so every
 * "collected" figure reflects only that frame.
 */
function applyPeriodFilter(loans, from, to) {
  if (!from && !to) return loans;
  return loans
    .filter(loan =>
      withinPeriod(loan.approvedAt || loan.createdAt, from, to) ||
      (Array.isArray(loan.payments) ? loan.payments : []).some(p => withinPeriod(p.paymentDate || p.date, from, to)))
    .map(loan => {
      const filtered = {
        ...loan,
        payments: (Array.isArray(loan.payments) ? loan.payments : []).filter(p => withinPeriod(p.paymentDate || p.date, from, to))
      };
      filtered.paidTotal = sumPayments(filtered);
      return filtered;
    });
}

function readPeriod(req) {
  const from = String(req.query.from || '').trim();
  const to = String(req.query.to || '').trim();
  const valid = v => !v || /^\d{4}-\d{2}-\d{2}$/.test(v);
  if (!valid(from) || !valid(to)) return { invalid: true };
  return { from, to };
}

function getReportData(scope = config.DEFAULT_STORE_ID, from = '', to = '') {
  const users = readArray(USERS_FILE);
  const allLoans = applyPeriodFilter(readArray(LOANS_FILE), from, to);
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
    period: { from: from || null, to: to || null },
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
  const data = getReportData(scope);
  const enrichedById = new Map(getEnrichedLoans().map(loan => [loan.id, loan]));
  return data.loans.map(loan => ({
    ...loan,
    businessStatus: enrichedById.get(loan.id)?.businessStatus || categorizeLoan(loan),
    receiptNumber: loan.receiptNumber || enrichedById.get(loan.id)?.receiptNumber || null
  }));
}

// ─── Profit / loss tracking sheet (all-user portfolio) ─────────────────────────
function getTrackingAnalytics(req, res) {
  const scope = req.params.scope === 'franchise' ? 'all' : (req.params.scope || 'buraza');
  if (!isAuthorized(req, scope)) return res.status(403).json({ error: 'Admin access required for this report scope.' });

  const { from, to, invalid } = readPeriod(req);
  if (invalid) return res.status(400).json({ error: 'from/to must be YYYY-MM-DD dates.' });

  const enriched = getEnrichedLoans(new Date().toISOString().slice(0, 10));
  const loans = enriched.filter(loan => scope === 'all' || getRecordStoreId(loan) === scope);
  const customersByEmail = new Map();
  const usersData = dataStore.readJson(USERS_FILE, [], Array.isArray);
  usersData.forEach(u => customersByEmail.set(String(u.email || '').trim().toLowerCase(), u));

  const today = new Date().toISOString().slice(0, 10);
  const storeSummary = summarizeStore(loans, today);

  const netProfit = Number((storeSummary.totalInterestBooked - storeSummary.totalOutstanding).toFixed(2));
  const netProfitMargin = storeSummary.totalInterestBooked > 0
    ? Number(((storeSummary.totalInterestBooked - storeSummary.totalOutstanding) / storeSummary.totalInterestBooked * 100).toFixed(2))
    : 0;

  const loanRows = loans.map(loan => {
    return {
      receiptNumber: loan.receiptNumber,
      customer: customersByEmail.get(String(loan.email || '').trim().toLowerCase())?.username || loan.email,
      email: loan.email,
      phone: customersByEmail.get(String(loan.email || '').trim().toLowerCase())?.phone || null,
      product: loan.product,
      amount: Number(loan.amount || 0),
      interestBooked: Number(loan.interestAmount || 0),
      interestCollected: Number((loan.payments || []).reduce((sum, p) => sum + (Number(p.interestPortion) || 0), 0).toFixed(2)),
      totalCollected: Number(loan.paidTotal || 0),
      outstanding: Number(loan.outstanding || 0),
      interestOutstanding: Number(loan.interestOutstanding || 0),
      dueDate: loan.dueDate,
      status: loan.businessStatus
    };
  });

  const grouped = {};
  loanRows.forEach(row => {
    const key = !grouped[row.status] ? Object.assign({}, row) : row;
    if (!grouped[row.status]) grouped[row.status] = [];
    grouped[row.status].push(row);
  });

  const byStatus = {
    active: loanRows.filter(l => l.status === 'active'),
    grace: loanRows.filter(l => l.status === 'grace'),
    defaulted: loanRows.filter(l => l.status === 'defaulted'),
    liquidated: loanRows.filter(l => l.status === 'liquidated'),
    paid: loanRows.filter(l => l.status === 'paid')
  };

  return res.json({
    scope,
    generatedAt: new Date().toISOString(),
    period: { from: (from || null), to: (to || null), asOf: today },
    summary: {
      totalLoans: storeSummary.totalLoans,
      totalCapital: storeSummary.totalCapital,
      totalInterestBooked: storeSummary.totalInterestBooked,
      totalCollected: storeSummary.totalCollected,
      totalOutstanding: storeSummary.totalOutstanding,
      netProfit,
      netProfitMargin: Number(netProfitMargin.toFixed(2)),
      possibleLoss: storeSummary.defaulted.possibleLoss,
      defaulted: storeSummary.defaulted.count,
      grace: storeSummary.grace.count,
      liquidated: storeSummary.liquidated.count,
      paid: storeSummary.paid.count,
      active: storeSummary.active.count
    },
    byStatus,
    loans: loanRows
  });
}

// ─── Tracking-sheet CSV export (all-user portfolio) ───────────────────────────
function exportTrackingSheet(req, res) {
  try {
    const scope = req.params.scope === 'franchise' ? 'all' : (req.params.scope || 'buraza');
    if (!isAuthorized(req, scope)) return res.status(403).json({ error: 'Admin access required.' });

    const enriched = getEnrichedLoans(new Date().toISOString().slice(0, 10));
    const loans = enriched.filter(loan => scope === 'all' || getRecordStoreId(loan) === scope);
    const today = new Date().toISOString().slice(0, 10);
    const stats = summarizeStore(loans, today);
    const netProfit = Number((stats.totalInterestBooked - stats.totalOutstanding).toFixed(2));
    const netMargin = stats.totalInterestBooked > 0 ? Number(((stats.totalInterestBooked - stats.totalOutstanding) / stats.totalInterestBooked * 100).toFixed(2)) : 0;

    const header = ['Scope','Generated At','Total Loans','Total Capital','Total Interest Booked','Total Collected','Total Outstanding','Net Profit','Net Profit Margin %','Possible Loss','Defaulted','Grace','Liquidated','Paid','Active'];
    const rows = [
      ['all', new Date().toISOString(), stats.totalLoans, stats.totalCapital, stats.totalInterestBooked, stats.totalCollected, stats.totalOutstanding, netProfit, netMargin, stats.defaulted.possibleLoss, stats.defaulted.count, stats.grace.count, stats.liquidated.count, stats.paid.count, stats.active.count]
    ];

    const csv = [['Tracking Sheet — All Users (Portfolio Profit & Loss)']].map(r => r.join(',')).join('\n') + '\n\n' + [header.join(',')] + '\n' + rows.map(r => r.map(v => `"${String(v).replace(/"/g,'""')}"`).join(',')).join('\n');

    res.setHeader('Content-Type', 'text/csv; charset=utf-8');
    res.setHeader('Content-Disposition', 'attachment; filename="bmf-portfolio-tracking-sheet.csv"');
    res.send(csv);
  } catch (err) {
    logBreakage('reportController.js', 'exportTrackingSheet', err, 'TRACKING EXPORT FAILED');
    if (!res.headersSent) return res.status(503).json({ error: 'Tracking export is temporarily unavailable. Please try again shortly.' });
  }
}

// ─── Per-user tracking sheet (single customer) ────────────────────────────────
function getUserTracking(req, res) {
  const scope = req.params.scope === 'franchise' ? 'all' : (req.params.scope || 'buraza');
  const email = String(req.params.id || '').trim().toLowerCase();
  if (!email || !isAuthorized(req, scope)) return res.status(403).json({ error: 'Admin access required.' });

  const users = dataStore.readJson(USERS_FILE, [], Array.isArray);
  const customer = users.find(u => String(u.email || '').trim().toLowerCase() === email);
  if (!customer) return res.status(404).json({ error: 'Customer not found.' });

  const enriched = getEnrichedLoans();
  const loans = enriched.filter(loan => getRecordStoreId(loan) === scope && String(loan.email || '').trim().toLowerCase() === email);
  const loanRows = loans.map(loan => ({
    receiptNumber: loan.receiptNumber,
    product: loan.product,
    amount: Number(loan.amount || 0),
    interestAmount: Number(loan.interestAmount || 0),
    interestCollected: Number((loan.payments || []).reduce((sum, p) => sum + (Number(p.interestPortion) || 0), 0).toFixed(2)),
    totalCollected: Number(loan.paidTotal || 0),
    outstanding: Number(loan.outstanding || 0),
    interestOutstanding: Number(loan.interestOutstanding || 0),
    interestRate: loan.interestRate,
    tenureWeeks: loan.tenureWeeks,
    dueDate: loan.dueDate,
    status: loan.businessStatus
  }));

  const principal = loanRows.reduce((sum, l) => sum + (Number(l.amount) || 0), 0);
  const interestBooked = loanRows.reduce((sum, l) => sum + (Number(l.interestAmount) || 0), 0);
  const interestCollected = loanRows.reduce((sum, l) => sum + (Number(l.interestCollected) || 0), 0);
  const totalCollected = loanRows.reduce((sum, l) => sum + (Number(l.totalCollected) || 0), 0);
  const outstanding = loanRows.reduce((sum, l) => sum + (Number(l.outstanding) || 0), 0);
  const netProfit = Number((interestBooked - outstanding).toFixed(2));
  const netProfitMargin = interestBooked > 0 ? Number((netProfit / interestBooked * 100).toFixed(2)) : 0;

  return res.json({
    scope,
    generatedAt: new Date().toISOString(),
    customer: {
      id: customer.id,
      username: customer.username,
      email: customer.email,
      phone: customer.phone,
      role: customer.role,
      storeId: customer.storeId,
      nrc: customer.nrc,
      createdAt: customer.createdAt
    },
    loans: loanRows,
    summary: {
      principal,
      interestBooked,
      interestCollected,
      totalCollected,
      outstanding,
      netProfit,
      netProfitMargin,
      possibleLoss: outstanding,
      loanCount: loanRows.length
    }
  });
}



function getReportSummary(req, res) {
  const scope = req.params.scope === 'franchise' ? 'all' : req.params.scope;
  if (!isAuthorized(req, scope)) return res.status(403).json({ error: 'Admin access required for this report scope.' });
  const { from, to, invalid } = readPeriod(req);
  if (invalid) return res.status(400).json({ error: 'from/to must be YYYY-MM-DD dates.' });
  return res.json(getReportData(scope, from, to));
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

function getPaymentsLedger(req, res) {
  if (!isAdminRole(req.authUser?.role)) {
    return res.status(403).json({ error: 'Admin access required.' });
  }

  const storeId = getRequestedStoreId(req);
  if (!canAccessStore(req, storeId)) {
    return res.status(403).json({ error: 'Access to this store is not allowed.' });
  }

  const page = Math.max(1, parseInt(req.query.page || '1', 10));
  const pageSize = Math.min(500, Math.max(1, parseInt(req.query.pageSize || '100', 10)));
  const from = String(req.query.from || '').trim();
  const to = String(req.query.to || '').trim();
  const loanId = String(req.query.loanId || '').trim();
  const receiptId = String(req.query.receiptId || '').trim();

  const loans = getEnrichedLoans();
  const filtered = loans.filter(loan => {
    if (loanId && loan.id !== Number(loanId)) return false;
    if (receiptId && String(loan.receiptNumber || '').toLowerCase() !== receiptId.toLowerCase()) {
      return false;
    }
    if (storeId !== 'all' && getRecordStoreId(loan) !== storeId) return false;
    return true;
  });

  let payments = [];
  if (from || to) {
    const fromDate = from ? new Date(`${from}T00:00:00Z`).getTime() : 0;
    const toDate = to ? new Date(`${to}T23:59:59Z`).getTime() : Number.MAX_SAFE_INTEGER;
    payments = [];
    for (const loan of filtered) {
      const loanPayments = Array.isArray(loan.payments) ? loan.payments : [];
      for (const p of loanPayments) {
        const pDate = p.paymentDate || p.date || '';
        if (pDate) {
          const ts = new Date(pDate).getTime();
          if (ts >= fromDate && ts <= toDate) {
            payments.push({ loanId: loan.id, loanReceiptId: loan.receiptNumber, ...p });
          }
        }
      }
    }
  } else {
    payments = filtered.flatMap(loan =>
      (Array.isArray(loan.payments) ? loan.payments : []).map(p => ({ loanId: loan.id, loanReceiptId: loan.receiptNumber, ...p }))
    );
  }

  const total = payments.length;
  const start = (page - 1) * pageSize;
  const paginated = payments.slice(start, start + pageSize);

  return res.json({
    generatedAt: new Date().toISOString(),
    summary: {
      total,
      page,
      pageSize,
      totalPages: Math.ceil(total / pageSize)
    },
    payments: paginated.map(p => ({
      loanId: p.loanId,
      loanReceiptId: p.loanReceiptId,
      paymentReceiptId: p.paymentReceiptId || p.receiptNumber || null,
      email: p.email || null,
      amount: Number(p.amount || 0),
      paymentDate: p.paymentDate || p.date || null,
      balanceBefore: Number(p.balanceBefore || 0),
      balanceAfter: Number(p.balanceAfter || 0),
      mode: p.mode || 'Cash',
      note: p.note || p.description || null,
      recordedBy: p.recordedBy || null,
      screenshot: p.screenshot || null
    }))
  });
}

function buildPaymentsReportData(from, to, storeId = 'all') {
  const loans = getEnrichedLoans().filter(loan =>
    !storeId || storeId === 'all' || getRecordStoreId(loan) === storeId);
  let allPayments = [];
  for (const loan of loans) {
    const loanPayments = Array.isArray(loan.payments) ? loan.payments : [];
    for (const p of loanPayments) {
      const pDate = p.paymentDate || p.date || '';
      if (pDate) {
        const ts = new Date(pDate).getTime();
        const fromTs = from ? new Date(`${from}T00:00:00Z`).getTime() : 0;
        const toTs = to ? new Date(`${to}T23:59:59Z`).getTime() : Number.MAX_SAFE_INTEGER;
        if (ts >= fromTs && ts <= toTs) {
          allPayments.push({ loanId: loan.id, loanReceiptId: loan.receiptNumber, email: loan.email, product: loan.product, ...p });
        }
      }
    }
  }

  const totalPayments = allPayments.length;
  const totalAmount = allPayments.reduce((sum, p) => sum + (Number(p.amount) || 0), 0);
  const totalInterest = allPayments.reduce((sum, p) => sum + (Number(p.interestPortion) || 0), 0);
  const totalPrincipal = allPayments.reduce((sum, p) => sum + (Number(p.amount || 0) - Number(p.interestPortion) || 0), 0);
  const modes = [...new Set(allPayments.map(p => p.mode || 'Cash'))];
  const recordedBy = [...new Set(allPayments.map(p => p.recordedBy || 'admin'))];

  allPayments.sort((a, b) => new Date(a.paymentDate || a.date || 0).getTime() - new Date(b.paymentDate || b.date || 0).getTime());

  return {
    generatedAt: new Date().toISOString(),
    from,
    to,
    totalPayments,
    totalAmount: Number(totalAmount.toFixed(2)),
    totalInterest: Number(totalInterest.toFixed(2)),
    totalPrincipal: Number(totalPrincipal.toFixed(2)),
    modes,
    recordedBy,
    payments: allPayments
  };
}

async function buildPaymentsExcelReport(data) {
  const workbook = new ExcelJS.Workbook();
  workbook.creator = 'Pryme Vertex';
  workbook.created = new Date(data.generatedAt);

  const addSheet = (name, columns, rows) => {
    const sheet = workbook.addWorksheet(name);
    sheet.columns = columns;
    sheet.addRows(rows);
    sheet.getRow(1).font = { bold: true };
    sheet.views = [{ state: 'frozen', ySplit: 1 }];
    return sheet;
  };

  addSheet('Summary', [
    { header: 'Metric', key: 'metric', width: 40 },
    { header: 'Value', key: 'value', width: 24 }
  ], [
    { metric: 'Report date', value: data.generatedAt },
    { metric: 'From', value: data.from || 'All time' },
    { metric: 'To', value: data.to || 'All time' },
    { metric: 'Total payments', value: data.totalPayments },
    { metric: 'Total amount (K)', value: data.totalAmount },
    { metric: 'Total interest (K)', value: data.totalInterest },
    { metric: 'Total principal (K)', value: data.totalPrincipal }
  ]);
  addSheet('Payments', [
    { header: 'Payment Receipt ID', key: 'paymentReceiptId', width: 22 },
    { header: 'Loan ID', key: 'loanId', width: 10 },
    { header: 'Loan Receipt', key: 'loanReceiptId', width: 22 },
    { header: 'Customer', key: 'email', width: 32 },
    { header: 'Product', key: 'product', width: 28 },
    { header: 'Amount (K)', key: 'amount', width: 14 },
    { header: 'Mode', key: 'mode', width: 16 },
    { header: 'Date', key: 'paymentDate', width: 28 },
    { header: 'Balance Before', key: 'balanceBefore', width: 16 },
    { header: 'Balance After', key: 'balanceAfter', width: 16 },
    { header: 'Note', key: 'note', width: 40 },
    { header: 'Recorded By', key: 'recordedBy', width: 24 }
  ], data.payments);

  return Buffer.from(await workbook.xlsx.writeBuffer());
}

function buildPaymentsPdfReport(data) {
  const doc = new PDFDocument();
  doc.fontSize(16).text('BMF Payment Tracking Sheet', { align: 'center' });
  doc.fontSize(11).text(`Generated: ${data.generatedAt}`, { align: 'center' });
  doc.moveDown();
  doc.fontSize(11).text(`From: ${data.from || 'All time'}`);
  doc.text(`To: ${data.to || 'All time'}`);
  doc.text(`Total payments: ${data.totalPayments}`);
  doc.text(`Total amount: K${data.totalAmount.toFixed(2)}`);
  doc.text(`Total interest: K${data.totalInterest.toFixed(2)}`);
  doc.text(`Total principal: K${data.totalPrincipal.toFixed(2)}`);
  doc.moveDown();
  doc.fontSize(12).text('Payment Details');
  if (!data.payments.length) {
    doc.moveDown().fontSize(10).text('No payments found in the selected time frame.');
  } else {
    data.payments.forEach(p => {
      doc.fontSize(9).text(
        `${p.paymentReceiptId || 'n/a'} | loan ${p.loanReceiptId || 'n/a'} | ${p.email || 'n/a'} | ` +
        `K${Number(p.amount || 0).toFixed(2)} | ${p.mode || 'Cash'} | ${String(p.paymentDate || p.date || '').slice(0, 19)} | ` +
        `bal ${Number(p.balanceBefore || 0).toFixed(2)} -> ${Number(p.balanceAfter || 0).toFixed(2)} | by ${p.recordedBy || 'admin'}`
      );
    });
  }
  doc.end();
  return doc;
}

async function getPaymentsReportExport(req, res) {
  try {
    if (!isAdminRole(req.authUser?.role)) {
      return res.status(403).json({ error: 'Admin access required for this report.' });
    }
    const storeId = getRequestedStoreId(req);
    if (!canAccessStore(req, storeId)) {
      return res.status(403).json({ error: 'Access to this store is not allowed.' });
    }

    const from = String(req.query.from || '').trim();
    const to = String(req.query.to || '').trim();
    const format = String(req.query.format || 'xlsx').toLowerCase();
    const data = buildPaymentsReportData(from, to, storeId);

    if (format === 'pdf') {
      res.setHeader('Content-Type', 'application/pdf');
      res.setHeader('Content-Disposition', `attachment; filename="BMF-Payments-${data.from || 'AllTime'}-${data.to || 'AllTime'}.pdf"`);
      return buildPaymentsPdfReport(data).pipe(res);
    }
    if (format !== 'xlsx') {
      return res.status(400).json({ error: 'Report format must be pdf or xlsx.' });
    }
    const buffer = await buildPaymentsExcelReport(data);
    res.setHeader('Content-Type', 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet');
    res.setHeader('Content-Disposition', `attachment; filename="BMF-Payments-${data.from || 'AllTime'}-${data.to || 'AllTime'}.xlsx"`);
    return res.send(buffer);
  } catch (err) {
    logBreakage('reportController.js', 'getPaymentsReportExport', err, 'PAYMENTS REPORT EXPORT FAILED');
    if (!res.headersSent) return res.status(503).json({ error: 'Unable to export the payments report.' });
  }
}

// ─── Single-user report: loans + payments + balances for one borrower ────────
function getUserReport(req, res) {
  try {
  const email = String(req.params.email || req.query.email || '').trim().toLowerCase();
  if (!isAuthorizedUserReport(req, email)) {
    return res.status(403).json({ error: 'Access to this account report is not allowed.' });
  }

  const scope = isAdminRole(req.authUser?.role)
    ? getRequestedStoreId(req)
    : getRecordStoreId(req.authUser);
  const users = readArray(USERS_FILE);
  const profile = users.find(user =>
    String(user.email || '').trim().toLowerCase() === email &&
    (scope === 'all' || getRecordStoreId(user) === scope)) || null;
  const profileSafe = profile ? { ...profile } : null;
  if (profileSafe) {
    const trustedDevices = profileSafe.trustedDevices;
    if (Array.isArray(trustedDevices) && trustedDevices.length) {
      profileSafe._trustedDeviceCount = trustedDevices.length;
      profileSafe._trustedDeviceLastSeen = trustedDevices.map(device => device.lastSeen || device.createdAt).sort().pop();
    }
    delete profileSafe.password;
    delete profileSafe.tokens;
    delete profileSafe.trustedDevices;
  }

  const borrowersLoans = getEnrichedLoans()
    .filter(loan => String(loan.email || '').trim().toLowerCase() === email &&
      (scope === 'all' || getRecordStoreId(loan) === scope));

  if (!profile && !borrowersLoans.length) return res.status(404).json({ error: 'Customer not found in this store.' });

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
  } catch (err) {
    logBreakage('reportController.js', 'getUserReport', err, 'USER REPORT BUILD FAILED');
    if (!res.headersSent) return res.status(503).json({ error: 'User report is temporarily unavailable.' });
  }
}

// ─── Search by loan receipt ID or borrower email ─────────────────────────────
function searchReports(req, res) {
  if (!isAdminRole(req.authUser?.role)) {
    return res.status(403).json({ error: 'Admin access required.' });
  }
  const storeId = getRequestedStoreId(req);
  if (!canAccessStore(req, storeId)) return res.status(403).json({ error: 'Access to this store is not allowed.' });

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
    const { from, to, invalid } = readPeriod(req);
    if (invalid) return res.status(400).json({ error: 'from/to must be YYYY-MM-DD dates.' });
    const data = getReportData(scope, from, to);
    const label = scope === 'all' ? 'pryme-vertex' : 'buraza';
    const format = String(req.query.format || 'xlsx').toLowerCase();
    if (format === 'pdf') return buildPdfReport(data, res, label);
    if (format !== 'xlsx') return res.status(400).json({ error: 'Export format must be xlsx or pdf.' });
    const buffer = await buildExcelReport(data);
    res.setHeader('Content-Type', 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet');
    res.setHeader('Content-Disposition', `attachment; filename="${label}-ledger-${new Date().toISOString().slice(0, 10)}.xlsx"`);
    return res.send(Buffer.from(buffer));
  } catch (err) {
    logBreakage('reportController.js', 'exportReport', err, 'REPORT EXPORT FAILED');
    if (!res.headersSent) return res.status(503).json({ error: 'Unable to export the report.' });
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

function collectLoansForEmail(email, scope = config.DEFAULT_STORE_ID) {
  const target = String(email || '').trim().toLowerCase();
  return getEnrichedLoans().filter(loan =>
    String(loan.email || '').trim().toLowerCase() === target &&
    (scope === 'all' || getRecordStoreId(loan) === scope));
}

function interestPaidOf(loan) {
  return (Array.isArray(loan.payments) ? loan.payments : [])
    .reduce((sum, payment) => sum + (Number(payment.interestPortion) || 0), 0);
}

/** Shape one loan exactly as the Task 4 report spec requires. */
function shapeLoan(loan) {
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

function buildUserReportBody(email, from = '', to = '', scope = config.DEFAULT_STORE_ID) {
  const users = readArray(USERS_FILE).filter(user =>
    scope === 'all' || getRecordStoreId(user) === scope);
  const target = String(email || '').trim().toLowerCase();
  const profile = users.find(user => String(user.email || '').trim().toLowerCase() === target) || null;
  const profileSafe = profile ? { ...profile } : null;
  if (profileSafe) delete profileSafe.password;

  const loans = applyPeriodFilter(collectLoansForEmail(target, scope), from, to).map(shapeLoan);
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
    period: { from: from || null, to: to || null },
    loans,
    summary
  };
}

function getSingleUserReport(req, res) {
  try {
  if (!requireAdmin(req, res)) return;
  const scope = getRequestedStoreId(req);
  if (!canAccessStore(req, scope)) return res.status(403).json({ error: 'Access to this store is not allowed.' });
  const email = String(req.query.email || '').trim().toLowerCase();
  if (!email) return res.status(400).json({ error: 'email query parameter is required.' });
  const { from, to, invalid } = readPeriod(req);
  if (invalid) return res.status(400).json({ error: 'from/to must be YYYY-MM-DD dates.' });

  const body = buildUserReportBody(email, from, to, scope);
  const accountExists = readArray(USERS_FILE).some(user =>
    String(user.email || '').trim().toLowerCase() === email &&
    (scope === 'all' || getRecordStoreId(user) === scope));
  if (!accountExists && !body.loans.length) {
    return res.status(404).json({ error: `No account found for ${email}.` });
  }
  return res.json(body);
  } catch (err) {
    logBreakage('reportController.js', 'getSingleUserReport', err, 'SINGLE USER REPORT BUILD FAILED');
    if (!res.headersSent) return res.status(503).json({ error: 'User report is temporarily unavailable.' });
  }
}

function getAllUsersReport(req, res) {
  try {
  if (!requireAdmin(req, res)) return;
  const scope = getRequestedStoreId(req);
  if (!canAccessStore(req, scope)) return res.status(403).json({ error: 'Access to this store is not allowed.' });
  const { from, to, invalid } = readPeriod(req);
  if (invalid) return res.status(400).json({ error: 'from/to must be YYYY-MM-DD dates.' });

  const emails = [...new Set([
    ...readArray(USERS_FILE)
      .filter(user => scope === 'all' || getRecordStoreId(user) === scope)
      .map(user => String(user.email || '').trim().toLowerCase()),
    ...getEnrichedLoans()
      .filter(loan => scope === 'all' || getRecordStoreId(loan) === scope)
      .map(loan => String(loan.email || '').trim().toLowerCase())
  ].filter(Boolean))];

  const reports = emails.map(email => buildUserReportBody(email, from, to, scope));
  const allLoans = reports.flatMap(report => report.loans);

  const grandTotals = {
    grandTotalBorrowed: allLoans.reduce((sum, loan) => sum + loan.amount, 0),
    grandTotalPaid: allLoans.reduce((sum, loan) => sum + loan.totalPaid, 0),
    grandTotalOutstanding: allLoans.reduce((sum, loan) => sum + loan.outstanding, 0),
    grandTotalInterest: Number(allLoans.reduce((sum, loan) => sum + loan.interestPaid, 0).toFixed(2)),
    totalActiveLoans: allLoans.filter(loan => ['active', 'grace'].includes(loan.status)).length,
    totalOverdueLoans: allLoans.filter(loan => ['grace', 'defaulted'].includes(loan.status)).length,
    totalPaidLoans: allLoans.filter(loan => loan.status === 'paid').length,
    totalDefaulters: new Set(allLoans.filter(loan => loan.status === 'defaulted').map(loan => loan.email)).size
  };

  return res.json({ generatedAt: new Date().toISOString(), period: { from: from || null, to: to || null }, users: reports, grandTotals });
  } catch (err) {
    logBreakage('reportController.js', 'getAllUsersReport', err, 'ALL USERS REPORT BUILD FAILED');
    if (!res.headersSent) return res.status(503).json({ error: 'Portfolio report is temporarily unavailable.' });
  }
}

function getAnalyticsReport(req, res) {
  try {
  if (!requireAdmin(req, res)) return;
  const scope = getRequestedStoreId(req);
  if (!canAccessStore(req, scope)) return res.status(403).json({ error: 'Access to this store is not allowed.' });

  const enriched = getEnrichedLoans().filter(loan => scope === 'all' || getRecordStoreId(loan) === scope);
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
  } catch (err) {
    logBreakage('reportController.js', 'getAnalyticsReport', err, 'ANALYTICS REPORT BUILD FAILED');
    if (!res.headersSent) return res.status(503).json({ error: 'Analytics report is temporarily unavailable.' });
  }
}

// ─── Tracking sheet builder ────────────────────────────────────────────────────
// Admin-only. Delegates to reportTracking.buildTrackingSheet (the single source
// of truth for the portfolio profit/loss sheet), persists it to
// data/trackingSheet.json, and returns it. Rebuilds on every request so the
// sheet always reflects the latest loans/payments.
function getTrackingSheet(req, res) {
  try {
    const scope = req.params.scope === 'franchise' ? 'all' : (req.params.scope || 'buraza');
    if (!isAuthorized(req, scope)) return res.status(403).json({ error: 'Admin access required.' });

    const { from, to, invalid } = readPeriod(req);
    if (invalid) return res.status(400).json({ error: 'from/to must be YYYY-MM-DD dates.' });

    const sheet = buildTrackingSheet(scope);
    sheet.period = { from: from || null, to: to || null, asOf: sheet.asOf };
    persistTracking(sheet);

    return res.json(sheet);
  } catch (err) {
    logBreakage('reportController.js', 'getTrackingSheet', err, 'TRACKING SHEET BUILD FAILED');
    if (!res.headersSent) return res.status(503).json({ error: 'Tracking sheet is temporarily unavailable. Please try again shortly.' });
  }
}

// â”€â”€â”€ BMF typed-report handlers (GET /reports/:type) â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€
function getTypedReport(req, res) {
  try {
    const type = req.params.type;
    const scope = req.query.scope || 'buraza';
    const { from, to, invalid } = readPeriod(req);
    if (invalid) return res.status(400).json({ error: 'from/to must be YYYY-MM-DD dates.' });
    if (!isAuthorized(req, scope)) return res.status(403).json({ error: 'Admin access required for this report scope.' });

    const users = readArray(USERS_FILE);
    const today = new Date().toISOString().slice(0, 10);
    const loans = applyPeriodFilter(readArray(LOANS_FILE), from, to)
      .filter(l => scope === 'all' || getRecordStoreId(l) === scope);

    let data;
    switch (type) {
      case 'daily':
        data = R.dailySummaryRows(loans, users, from || today);
        break;
      case 'all-loans':
        data = R.allLoansRows(loans, users, from || today);
        break;
      case 'payments-today':
        data = R.paymentsTodayRows(loans, users, from || today);
        break;
      case 'overdue':
        data = R.overdueRows(loans, users, from || today);
        break;
      case 'defaulters':
        data = R.defaulterRows(loans, users, from || today);
        break;
      case 'monthly-collections':
        data = R.monthlyCollectionsRows(loans, users, (from || today).slice(0, 7));
        break;
      case 'borrower-statements':
        data = R.borrowerStatementRows(loans, users);
        break;
      case 'approval-log':
        data = R.approvalLogRows(loans, users);
        break;
      case 'interest-revenue':
        data = R.interestRevenueRows(loans, users, (from || today).slice(0, 7));
        break;
      case 'repayment-performance':
        data = R.repaymentPerformanceRows(loans, users, from || today);
        break;
      case 'repayment-tracker': {
        const loanId = req.query.loanId;
        if (!loanId) return res.status(400).json({ error: 'loanId query parameter is required for repayment-tracker.' });
        const loan = loans.find(l => String(l.id) === String(loanId) || String(l.receiptNumber) === String(loanId));
        if (!loan) return res.status(404).json({ error: 'Loan not found.' });
        const user = R.userByEmail(users, loan.email);
        data = R.repaymentTrackerRows(loan, user);
        break;
      }
      default:
        return res.status(400).json({ error: `Unknown report type: ${type}` });
    }

    const format = String(req.query.format || '').toLowerCase();
    if (format === 'xlsx') return getTypedReportExcel(req, res);
    if (format === 'pdf') return getTypedReportPdf(req, res);

    return res.json({
      type,
      scope,
      generatedAt: new Date().toISOString(),
      period: { from: from || null, to: to || null },
      ...data
    });
  } catch (err) {
    logBreakage('reportController.js', 'getTypedReport', err, 'TYPED REPORT FAILED');
    if (!res.headersSent) return res.status(503).json({ error: 'Report is temporarily unavailable.' });
  }
}

// Typed-report Excel export â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€
async function getTypedReportExcel(req, res) {
  try {
    const type = req.params.type;
    const scope = req.query.scope || 'buraza';
    const { from, to, invalid } = readPeriod(req);
    if (invalid) return res.status(400).json({ error: 'from/to must be YYYY-MM-DD dates.' });
    if (!isAuthorized(req, scope)) return res.status(403).json({ error: 'Admin access required for this report scope.' });

    const users = readArray(USERS_FILE);
    const today = new Date().toISOString().slice(0, 10);
    const loans = applyPeriodFilter(readArray(LOANS_FILE), from, to)
      .filter(l => scope === 'all' || getRecordStoreId(l) === scope);

    const wb = new (require('exceljs')).Workbook();
    wb.creator = 'BMF';

    if (type === 'daily') {
      const filled = await X.buildDailyWorkbook(loans, users, from || today);
      const buffer = await X.workbookToBuffer(filled);
      return sendTypedXlsx(res, buffer, `BMF-Daily-Report-${from || today}`);
    }

    if (type === 'repayment-tracker') {
      const loanId = req.query.loanId;
      if (!loanId) return res.status(400).json({ error: 'loanId query parameter is required for repayment-tracker.' });
      const loan = loans.find(l => String(l.id) === String(loanId) || String(l.receiptNumber) === String(loanId));
      if (!loan) return res.status(404).json({ error: 'Loan not found.' });
      const user = R.userByEmail(users, loan.email);
      const ws = X.buildTrackerSheet(wb, loan, user);
      const buffer = await X.workbookToBuffer(wb);
      const name = String(loan.username || loan.email || 'Borrower').replace(/[^A-Za-z0-9]+/g, '-').replace(/^-+|-+$/g, '') || 'Borrower';
      return sendTypedXlsx(res, buffer, `BMF-Report-${name}-${today}`);
    }

    let sheetName, headers, rows, title, fill, fontColor, emptyText;
    switch (type) {
      case 'all-loans': {
        const d = R.allLoansRows(loans, users, from || today);
        sheetName = 'All Loans'; headers = d.headers; rows = d.rows; title = 'BMF ALL LOANS'; break;
      }
      case 'payments-today': {
        const d = R.paymentsTodayRows(loans, users, from || today);
        sheetName = 'Payments Today'; headers = d.headers; rows = d.rows; title = 'BMF PAYMENTS TODAY'; emptyText = '(No payments recorded on this date)'; break;
      }
      case 'overdue': {
        const d = R.overdueRows(loans, users, from || today);
        sheetName = 'Overdue'; headers = d.headers; rows = d.rows; title = 'BMF OVERDUE LOANS'; fill = 'FFFF0000'; fontColor = 'FFFFFFFF'; emptyText = '(No overdue loans on this date)'; break;
      }
      case 'defaulters': {
        const d = R.defaulterRows(loans, users, from || today);
        sheetName = 'Defaulters'; headers = d.headers; rows = d.rows; title = 'BMF DEFAULTERS'; fill = 'FF8B0000'; fontColor = 'FFFFFFFF'; emptyText = '(No defaulters on this date)'; break;
      }
      case 'monthly-collections': {
        const d = R.monthlyCollectionsRows(loans, users, (from || today).slice(0, 7));
        sheetName = 'Monthly Collections'; headers = d.headers; rows = d.rows; title = 'BMF MONTHLY COLLECTIONS'; emptyText = '(No collections in this month)'; break;
      }
      case 'approval-log': {
        const d = R.approvalLogRows(loans, users);
        sheetName = 'Approval Log'; headers = d.headers; rows = d.rows; title = 'BMF LOAN APPROVAL LOG'; fill = 'FF006400'; fontColor = 'FFFFFFFF'; emptyText = '(No approvals in range)'; break;
      }
      case 'borrower-statements': {
        const d = R.borrowerStatementRows(loans, users);
        d.sections.forEach((s, i) => {
          const ws = wb.addWorksheet(`Statements ${i + 1}`);
          ws.columns = [22, 18, 16, 16, 16].map(w => ({ width: w }));
          X.titleBanner(ws, `${s.borrower} — ${s.email}`, 5);
          X.headerRow(ws, 4, ['Loan ID', 'Principal (K)', 'Interest (K)', 'Paid (K)', 'Outstanding (K)'], 'FFFFFF00');
          X.dataRows(ws, 5, s.loans);
        });
        const buffer = await X.workbookToBuffer(wb);
        return sendTypedXlsx(res, buffer, `BMF-Borrower-Statements-${today}`);
      }
      case 'interest-revenue': {
        const d = R.interestRevenueRows(loans, users, (from || today).slice(0, 7));
        const ws = wb.addWorksheet('Interest & Revenue');
        ws.columns = [30, 20, 20, 20, 20, 20].map(w => ({ width: w }));
        X.titleBanner(ws, 'BMF INTEREST & REVENUE', 6);
        X.headerRow(ws, 4, d.summaryHeaders, 'FF006400', 'FFFFFFFF');
        X.dataRows(ws, 5, d.summary);
        X.headerRow(ws, 5 + d.summary.length + 1, d.detailHeaders, 'FFFFFF00');
        X.dataRows(ws, 5 + d.summary.length + 2, d.detail);
        const buffer = await X.workbookToBuffer(wb);
        return sendTypedXlsx(res, buffer, `BMF-Interest-Revenue-${(from || today).slice(0, 7)}`);
      }
      case 'repayment-performance': {
        const d = R.repaymentPerformanceRows(loans, users, from || today);
        const ws = wb.addWorksheet('Repayment Performance');
        ws.columns = [26, 24, 12, 12, 12, 18, 14].map(w => ({ width: w }));
        X.titleBanner(ws, 'BMF REPAYMENT PERFORMANCE', 7);
        X.headerRow(ws, 4, d.summaryHeaders, 'FF6A0DAD', 'FFFFFFFF');
        X.dataRows(ws, 5, d.summary);
        X.headerRow(ws, 5 + d.summary.length + 1, d.tableHeaders, 'FFFFFF00');
        const start = 5 + d.summary.length + 2;
        X.dataRows(ws, start, d.table);
        const buffer = await X.workbookToBuffer(wb);
        return sendTypedXlsx(res, buffer, `BMF-Repayment-Performance-${today}`);
      }
      default:
        return res.status(400).json({ error: `Unknown report type: ${type}` });
    }

    if (!sheetName) return res.status(400).json({ error: `Unknown report type: ${type}` });

    X.genericSheet(wb, sheetName, headers, rows, { title, fill, fontColor, emptyText });
    const buffer = await X.workbookToBuffer(wb);
    return sendTypedXlsx(res, buffer, R.filenameFor(type, { date: from || today }));
  } catch (err) {
    logBreakage('reportController.js', 'getTypedReportExcel', err, 'TYPED REPORT EXCEL FAILED');
    if (!res.headersSent) return res.status(503).json({ error: 'Report export is temporarily unavailable.' });
  }
}

// â”€â”€â”€ Typed-report PDF export â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€
async function getTypedReportPdf(req, res) {
  try {
    const type = req.params.type;
    const scope = req.query.scope || 'buraza';
    const { from, to, invalid } = readPeriod(req);
    if (invalid) return res.status(400).json({ error: 'from/to must be YYYY-MM-DD dates.' });
    if (!isAuthorized(req, scope)) return res.status(403).json({ error: 'Admin access required for this report scope.' });

    const users = readArray(USERS_FILE);
    const today = new Date().toISOString().slice(0, 10);
    const loans = applyPeriodFilter(readArray(LOANS_FILE), from, to)
      .filter(l => scope === 'all' || getRecordStoreId(l) === scope);

    if (type === 'repayment-tracker') {
      const loanId = req.query.loanId;
      if (!loanId) return res.status(400).json({ error: 'loanId query parameter is required for repayment-tracker.' });
      const loan = loans.find(l => String(l.id) === String(loanId) || String(l.receiptNumber) === String(loanId));
      if (!loan) return res.status(404).json({ error: 'Loan not found.' });
      const user = R.userByEmail(users, loan.email);
      const pdf = await P.trackerPdf(loan, user);
      const name = String(loan.username || loan.email || 'Borrower').replace(/[^A-Za-z0-9]+/g, '-');
      return sendTypedPdf(res, pdf, `BMF-Report-${name}-${today}`);
    }

    let sections;
    switch (type) {
      case 'daily': {
        const d = R.dailySummaryRows(loans, users, from || today);
        sections = [{ title: 'DAILY SUMMARY', headers: d.headers, rows: d.rows }];
        break;
      }
      case 'all-loans': {
        const d = R.allLoansRows(loans, users, from || today);
        sections = [{ title: 'ALL LOANS', headers: d.headers, rows: d.rows }];
        break;
      }
      case 'payments-today': {
        const d = R.paymentsTodayRows(loans, users, from || today);
        sections = [{ title: 'PAYMENTS TODAY', headers: d.headers, rows: d.rows, emptyText: '(No payments recorded on this date)' }];
        break;
      }
      case 'overdue': {
        const d = R.overdueRows(loans, users, from || today);
        sections = [{ title: 'OVERDUE LOANS', headers: d.headers, rows: d.rows, emptyText: '(No overdue loans on this date)' }];
        break;
      }
      case 'defaulters': {
        const d = R.defaulterRows(loans, users, from || today);
        sections = [{ title: 'DEFAULTERS', headers: d.headers, rows: d.rows, emptyText: '(No defaulters on this date)' }];
        break;
      }
      case 'monthly-collections': {
        const d = R.monthlyCollectionsRows(loans, users, (from || today).slice(0, 7));
        sections = [{ title: 'MONTHLY COLLECTIONS', headers: d.headers, rows: d.rows, emptyText: '(No collections in this month)' }];
        break;
      }
      case 'approval-log': {
        const d = R.approvalLogRows(loans, users);
        sections = [{ title: 'LOAN APPROVAL LOG', headers: d.headers, rows: d.rows, emptyText: '(No approvals in range)' }];
        break;
      }
      case 'interest-revenue': {
        const d = R.interestRevenueRows(loans, users, (from || today).slice(0, 7));
        sections = [
          { title: `INTEREST & REVENUE (${d.meta.month})`, headers: d.summaryHeaders, rows: d.summary },
          { title: 'DETAIL', headers: d.detailHeaders, rows: d.detail }
        ];
        break;
      }
      case 'repayment-performance': {
        const d = R.repaymentPerformanceRows(loans, users, from || today);
        sections = [
          { title: 'REPAYMENT PERFORMANCE SUMMARY', headers: d.summaryHeaders, rows: d.summary },
          { title: 'BORROWER DETAIL', headers: d.tableHeaders, rows: d.table }
        ];
        break;
      }
      case 'borrower-statements': {
        const d = R.borrowerStatementRows(loans, users);
        sections = d.sections.map(s => ({
          title: `${s.borrower} — ${s.email}`,
          headers: ['Loan ID', 'Principal (K)', 'Interest (K)', 'Paid (K)', 'Outstanding (K)', 'Status', 'Due Date'],
          rows: s.loans.map(r => r.slice(0, 7))
        }));
        break;
      }
      default:
        return res.status(400).json({ error: `Unknown report type: ${type}` });
    }

    if (!sections) return res.status(400).json({ error: `Unknown report type: ${type}` });

    const pdf = await P.businessPdf(sections, { title: `BMF ${type.toUpperCase()} REPORT`, date: today });
    return sendTypedPdf(res, pdf, `BMF-${type}-${today}`);
  } catch (err) {
    logBreakage('reportController.js', 'getTypedReportPdf', err, 'TYPED REPORT PDF FAILED');
    if (!res.headersSent) return res.status(503).json({ error: 'Report export is temporarily unavailable.' });
  }
}

function sendTypedXlsx(res, buffer, filename) {
  res.setHeader('Content-Type', 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet');
  res.setHeader('Content-Disposition', `attachment; filename="${filename}.xlsx"`);
  return res.send(Buffer.from(buffer));
}

function sendTypedPdf(res, buffer, filename) {
  res.setHeader('Content-Type', 'application/pdf');
  res.setHeader('Content-Disposition', `attachment; filename="${filename}.pdf"`);
  return res.send(Buffer.from(buffer));
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
  buildDailyReportText,
  getPaymentsLedger,
  buildPaymentsReportData,
  buildPaymentsExcelReport,
  buildPaymentsPdfReport,
  getPaymentsReportExport,
  getTrackingAnalytics,
  getUserTracking,
  getTrackingSheet,
  exportTrackingSheet,
  getTypedReport,
  getTypedReportExcel,
  getTypedReportPdf,
  sendTypedXlsx,
  sendTypedPdf
};
