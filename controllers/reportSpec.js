'use strict';

// Compatibility facade for the retired report-spec API. The live HTTP routes
// use reportController.js and the shared BMF report services directly.
const ExcelJS = require('exceljs');
const config = require('../config');
const dataStore = require('../middleware/dataStore');
const { getEnrichedLoans } = require('./loanController');
const { getRecordStoreId } = require('../middleware/storeScope');
const R = require('../services/bmfReports');
const X = require('../services/bmfExcel');
const P = require('../services/bmfPdf');

function todayIso() {
  const parts = new Intl.DateTimeFormat('en-CA', {
    timeZone: config.REPORTS.TIME_ZONE,
    year: 'numeric',
    month: '2-digit',
    day: '2-digit'
  }).formatToParts(new Date());
  const values = Object.fromEntries(parts.filter(p => p.type !== 'literal').map(p => [p.type, p.value]));
  return `${values.year}-${values.month}-${values.day}`;
}

function displayStatus(loan, today = todayIso()) {
  const status = R.displayStatus(loan, today);
  const labels = {
    pending: 'Pending', active: 'Active', overdue: 'Overdue', default: 'Defaulted',
    repaid: 'Paid', liquidated: 'Liquidated', declined: 'Declined'
  };
  return { label: labels[status] || status, group: status };
}

function scopedRecords(scope = config.DEFAULT_STORE_ID, reportDate = todayIso()) {
  const users = dataStore.readJson(dataStore.paths.users, [], Array.isArray);
  const loans = getEnrichedLoans(reportDate).filter(loan =>
    scope === 'all' || getRecordStoreId(loan) === scope);
  return { users: users.filter(user => scope === 'all' || getRecordStoreId(user) === scope), loans };
}

function buildReportDataset(scope = config.DEFAULT_STORE_ID, reportDate = todayIso()) {
  const { users, loans } = scopedRecords(scope, reportDate);
  const daily = R.dailySummaryRows(loans, users, reportDate);
  const all = R.allLoansRows(loans, users, reportDate);
  const payments = R.paymentsTodayRows(loans, users, reportDate);
  const overdue = R.overdueRows(loans, users, reportDate);
  const defaulters = R.defaulterRows(loans, users, reportDate);
  const monthly = R.monthlyCollectionsRows(loans, users, reportDate.slice(0, 7));
  const statements = R.borrowerStatementRows(loans, users);
  const approvals = R.approvalLogRows(loans, users);
  const revenue = R.interestRevenueRows(loans, users, reportDate.slice(0, 7));
  const performance = R.repaymentPerformanceRows(loans, users, reportDate);
  return {
    scope, reportDate, users, loans,
    summary: {
      totalLoans: loans.length,
      activeLoans: loans.filter(loan => ['active', 'grace'].includes(loan.businessStatus)).length,
      overdueLoans: overdue.rows.length,
      defaulters: defaulters.rows.length,
      cashCollected: payments.rows.reduce((sum, row) => sum + Number(row[2] || 0), 0),
      pendingPayments: loans.filter(loan => Number(loan.outstanding || 0) > 0).length
    },
    dailySummaryRows: daily.rows,
    allLoanRows: all.rows,
    paymentsTodayRows: payments.rows,
    overdueRows: overdue.rows,
    defaulterRows: defaulters.rows,
    monthlyRows: monthly.rows,
    borrowerStatements: statements.sections,
    approvalLogRows: approvals.rows,
    revenueMonthly: revenue.detail,
    performanceRows: performance.table,
    repaymentTracker: null
  };
}

function searchBorrowers(query, scope = config.DEFAULT_STORE_ID) {
  const needle = String(query || '').trim().toLowerCase();
  if (!needle) return [];
  const { users, loans } = scopedRecords(scope);
  return users.filter(user => user.role === 'user' && [user.username, user.email, user.phone, user.nrc]
    .some(value => String(value || '').toLowerCase().includes(needle)))
    .slice(0, 20)
    .map(user => ({
      email: user.email,
      username: user.username,
      storeId: getRecordStoreId(user),
      loans: loans.filter(loan => String(loan.email || '').toLowerCase() === String(user.email || '').toLowerCase())
    }));
}

function buildWorkbook(dataset, type = 'all-loans') {
  if (type === 'daily' || type === 'daily-report') {
    return X.buildDailyWorkbook(dataset.loans || [], dataset.users || [], dataset.reportDate || todayIso());
  }
  if (type === 'repayment-tracker' && dataset.trackerLoan) {
    const workbook = new ExcelJS.Workbook();
    X.buildTrackerSheet(workbook, dataset.trackerLoan, dataset.trackerUser || null);
    return workbook;
  }
  const source = {
    'all-loans': ['All Loans', ['Loan Receipt', 'Borrower', 'Email', 'Product', 'Principal', 'Interest', 'Total', 'Paid', 'Outstanding', 'Status', 'Loan Date', 'Due Date'], 'allLoanRows'],
    'payments-today': ['Payments Today', ['Loan Receipt', 'Borrower', 'Amount', 'Date', 'Mode', 'Receipt', 'Recorded By'], 'paymentsTodayRows'],
    overdue: ['Overdue', ['Loan Receipt', 'Borrower', 'Amount', 'Due Date', 'Days Overdue', 'Outstanding'], 'overdueRows'],
    defaulters: ['Defaulters', ['Loan Receipt', 'Borrower', 'Amount', 'Due Date', 'Days Overdue', 'Outstanding'], 'defaulterRows'],
    'monthly-collections': ['Monthly Collections', ['Month', 'Collected', 'Outstanding'], 'monthlyRows'],
    'borrower-statements': ['Borrower Statements', ['Borrower', 'Email', 'Loan Count', 'Outstanding'], 'borrowerStatements'],
    'approval-log': ['Approval Log', ['Loan Receipt', 'Borrower', 'Approved At', 'Approved By', 'Amount'], 'approvalLogRows'],
    'loan-approval-log': ['Approval Log', ['Loan Receipt', 'Borrower', 'Approved At', 'Approved By', 'Amount'], 'approvalLogRows'],
    'interest-revenue': ['Interest Revenue', ['Month', 'Interest Booked', 'Interest Paid'], 'revenueMonthly'],
    'repayment-performance': ['Repayment Performance', ['Borrower', 'Email', 'Loan Count', 'Outstanding', 'Risk'], 'performanceRows']
  }[type];
  if (!source) throw new Error(`Unknown report type: ${type}`);
  const rows = dataset[source[2]] || [];
  const workbook = new ExcelJS.Workbook();
  X.genericSheet(workbook, source[0], source[1], rows.map(row => Array.isArray(row) ? row : Object.values(row)));
  return workbook;
}

function buildDailyWorkbook(dataset) {
  return X.buildDailyWorkbook(dataset.loans || [], dataset.users || [], dataset.reportDate || todayIso());
}

function buildBusinessPdf(dataset, reportDate = dataset.reportDate || todayIso()) {
  return P.businessPdf([
    { title: 'Portfolio Summary', headers: ['Metric', 'Value'], rows: Object.entries(dataset.summary || {}) },
    { title: 'Loans', headers: ['Loan Receipt', 'Borrower', 'Amount', 'Outstanding', 'Status', 'Due Date'], rows: dataset.allLoanRows || [] },
    { title: 'Payments Today', headers: ['Loan Receipt', 'Borrower', 'Amount', 'Date', 'Mode', 'Receipt', 'Recorded By'], rows: dataset.paymentsTodayRows || [] }
  ], { title: 'Daily Business Report', date: reportDate });
}

function buildTablePdf(dataset, type = 'all-loans', reportDate = dataset.reportDate || todayIso()) {
  const headers = type === 'payments-today'
    ? ['Loan Receipt', 'Borrower', 'Amount', 'Date', 'Mode', 'Receipt', 'Recorded By']
    : ['Loan Receipt', 'Borrower', 'Amount', 'Outstanding', 'Status', 'Due Date'];
  const rows = type === 'payments-today' ? dataset.paymentsTodayRows : dataset.allLoanRows;
  return P.businessPdf([{ title: type, headers, rows: rows || [] }], { title: 'BMF Report', date: reportDate });
}

function pdfToBuffer(value) {
  if (Buffer.isBuffer(value)) return Promise.resolve(value);
  return new Promise((resolve, reject) => {
    const chunks = [];
    value.on('data', chunk => chunks.push(chunk));
    value.on('end', () => resolve(Buffer.concat(chunks)));
    value.on('error', reject);
    value.end();
  });
}

function buildEmailSummary(type, dataset) {
  return [`${type} report for ${dataset.reportDate || todayIso()}`, '',
    ...Object.entries(dataset.summary || {}).map(([key, value]) => `${key}: ${value}`)
  ].join('\n');
}

const legacyReportTypes = ['daily-report', 'loan-approval-log'];
const REPORT_TYPES = Object.fromEntries([...config.REPORTS.REPORT_TYPES, ...legacyReportTypes].map(type => [type, {
  key: type,
  title: type,
  type,
  buildXlsx: dataset => buildWorkbook(dataset, type),
  buildPdf: dataset => buildTablePdf(dataset, type),
  summary: dataset => buildEmailSummary(type, dataset)
}]));

module.exports = {
  REPORT_TYPES,
  displayStatus,
  buildReportDataset,
  searchBorrowers,
  buildWorkbook,
  buildDailyWorkbook,
  buildBusinessPdf,
  buildTablePdf,
  pdfToBuffer,
  buildEmailSummary,
  todayIso
};
