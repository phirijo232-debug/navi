'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const ExcelJS = require('exceljs');
const Reports = require('../services/bmfPromptReports');
const { buildPromptWorkbook } = require('../services/bmfPromptExcel');
const { businessPdf, statementPdf } = require('../services/bmfPdf');
const dataStore = require('../middleware/dataStore');
const {
  getTypedReport,
  getTypedReportExcel,
  getTypedReportPdf,
  isPromptReportType
} = require('../controllers/reportController');

const loanFixture = () => ({
  id: 17,
  receiptNumber: 'BMF-20260401-0017',
  email: 'borrower@example.test',
  username: 'Test Borrower',
  storeId: 'buraza',
  status: 'active',
  amount: 200,
  interestAmount: 32,
  totalRepayment: 232,
  outstanding: 152,
  interestRate: 16,
  approvedAt: '2026-04-01',
  dueDate: '2026-05-06',
  tenureWeeks: 4,
  officer: 'Officer A',
  payments: [{
    paymentReceiptId: 'PAY-20260430-0001',
    amount: 80,
    paymentDate: '2026-05-01',
    recordedBy: 'Officer A'
  }],
  installments: [
    { dueDate: '2026-04-15', amountDue: 58, amountPaid: 58, datePaid: '2026-05-01', status: 'paid' },
    { dueDate: '2026-04-22', amountDue: 58, amountPaid: 22, status: 'partial' },
    { dueDate: '2026-04-29', amountDue: 58, amountPaid: 0 },
    { dueDate: '2026-05-06', amountDue: 58, amountPaid: 0 }
  ]
});

function reportFixture() {
  return Reports.buildReportData({
    loans: [loanFixture()],
    users: [{
      email: 'borrower@example.test',
      username: 'Test Borrower',
      nrc: 'TEST-NRC',
      phone: '+260970000000',
      storeId: 'buraza'
    }],
    loanId: '17',
    today: '2026-05-03',
    generatedAt: '2026-05-03T10:00:00.000Z'
  });
}

test('Version 3 builders calculate ledger validation, arrears buckets and statement balances', () => {
  const report = reportFixture();
  const loan = loanFixture();

  assert.equal(Reports.validateLoanLedgers([loan]), true);
  assert.deepEqual(report.agingRows[0].buckets, [58, 58, 36, 0, 0, 0, 0]);
  assert.equal(report.agingRows[0].arrears, 94);
  assert.equal(report.parRows[0].riskBucket, '1–30 days');
  assert.equal(report.statement.interestRate, 16);
  assert.equal(report.statement.transactions.at(-1).balance, 152);
  assert.ok(report.statement.transactions.some(row => row.kind === 'upcoming'));
});

test('Version 3 ledger validation stops on mismatched or negative balances', () => {
  const mismatch = loanFixture();
  mismatch.outstanding = 151.98;
  assert.throws(
    () => Reports.validateLoanLedgers([mismatch]),
    error => error instanceof Reports.ReportDataError &&
      error.status === 422 &&
      /Numbers do not add up on loan BMF-20260401-0017/.test(error.message)
  );

  const negative = loanFixture();
  negative.outstanding = -1;
  assert.throws(
    () => Reports.validateLoanLedgers([negative]),
    error => error instanceof Reports.ReportDataError && /Outstanding balance is negative/.test(error.message)
  );
});

test('Version 3 workbook has 10 sheets and valid formula cells after XLSX round-trip', async () => {
  const workbook = buildPromptWorkbook(reportFixture());
  const buffer = await workbook.xlsx.writeBuffer();
  const opened = new ExcelJS.Workbook();
  await opened.xlsx.load(buffer);

  assert.equal(opened.worksheets.length, 10);
  assert.equal(opened.getWorksheet('Loan Statement').getCell('I26').value.formula, 'MAX(0,I24-I25)');
  assert.match(opened.getWorksheet('Repayment Schedule').getCell('G13').value.formula, /MAX\(0,C13-IF\(E13="",0,E13\)\)/);
});

test('Version 3 borrower statement PDF is exactly two A4 pages', async () => {
  const report = reportFixture();
  const pdf = await statementPdf(report.statement, report.today);
  const pdfText = pdf.toString('latin1');
  const pageCount = (pdfText.match(/\/Type\s*\/Page\b/g) || []).length;

  assert.equal(pageCount, 2);
  assert.match(pdfText, /MediaBox\s*\[0\s+0\s+595\.28\s+841\.89\]/);
});

test('business PDF buffers every page before adding page-number footers', async () => {
  const rows = Array.from({ length: 100 }, (_, index) => [index + 1, `Collection record ${index + 1}`]);
  const pdf = await businessPdf([{
    title: 'Multi-page report',
    headers: ['No.', 'Description'],
    rows
  }]);

  assert.ok((pdf.toString('latin1').match(/\/Type\s*\/Page\b/g) || []).length > 1);
});

test('Version 3 filenames use the report generation date and selected receipt ID', () => {
  assert.equal(
    Reports.filenameFor('statement', 'pdf', '20260503', 'BMF-20260401-0017'),
    'bmf_full_history_BMF-20260401-0017_20260503.pdf'
  );
  assert.equal(
    Reports.filenameFor('par', 'xlsx', '20260503'),
    'bmf_how_risky_20260503.xlsx'
  );
});

test('typed-report endpoint dispatches Version 3 aliases with safe, store-scoped data', async t => {
  const loans = [loanFixture()];
  const users = [{
    email: 'borrower@example.test',
    username: 'Test Borrower',
    storeId: 'buraza'
  }];
  t.mock.method(dataStore, 'readJson', file => file === dataStore.paths.loans ? loans : users);
  const response = {
    statusCode: 200,
    status(code) { this.statusCode = code; return this; },
    json(body) { this.body = body; return this; }
  };
  const request = {
    params: { type: 'par' },
    query: { scope: 'buraza' },
    headers: { 'x-business-unit': 'buraza' },
    authUser: { role: 'admin', storeId: 'buraza' }
  };

  assert.equal(isPromptReportType('par'), true);
  await getTypedReport(request, response);

  assert.equal(response.statusCode, 200);
  assert.equal(response.body.type, 'how-risky');
  assert.equal(response.body.rows.length, 1);
  assert.equal('loans' in response.body, false);
});

test('typed-report exports return the complete workbook and two-page selected-loan PDF', async t => {
  const loans = [loanFixture()];
  const users = [{
    email: 'borrower@example.test',
    username: 'Test Borrower',
    nrc: 'TEST-NRC',
    phone: '+260970000000',
    storeId: 'buraza'
  }];
  t.mock.method(dataStore, 'readJson', file => file === dataStore.paths.loans ? loans : users);
  const createResponse = () => ({
    statusCode: 200,
    headers: {},
    status(code) { this.statusCode = code; return this; },
    setHeader(name, value) { this.headers[name] = value; return this; },
    send(body) { this.body = body; return this; },
    json(body) { this.body = body; return this; }
  });
  const baseRequest = {
    query: { scope: 'buraza' },
    headers: { 'x-business-unit': 'buraza' },
    authUser: { role: 'admin', storeId: 'buraza' }
  };
  const workbookResponse = createResponse();
  await getTypedReportExcel({
    ...baseRequest,
    params: { type: 'aging' }
  }, workbookResponse);
  const workbook = new ExcelJS.Workbook();
  await workbook.xlsx.load(workbookResponse.body);

  assert.equal(workbookResponse.statusCode, 200);
  assert.match(workbookResponse.headers['Content-Disposition'], /bmf_who_owes_\d{8}\.xlsx/);
  assert.equal(workbook.worksheets.length, 10);

  const pdfResponse = createResponse();
  await getTypedReportPdf({
    ...baseRequest,
    params: { type: 'statement' },
    query: { ...baseRequest.query, loanId: '17' }
  }, pdfResponse);
  const pdfText = pdfResponse.body.toString('latin1');

  assert.equal(pdfResponse.statusCode, 200);
  assert.match(pdfResponse.headers['Content-Disposition'], /bmf_full_history_BMF-20260401-0017_\d{8}\.pdf/);
  assert.equal((pdfText.match(/\/Type\s*\/Page\b/g) || []).length, 2);
});

test('typed-report export returns 422 and no file when a live loan ledger fails validation', async t => {
  const loans = [loanFixture()];
  t.mock.method(dataStore, 'readJson', file => file === dataStore.paths.loans ? loans : []);
  const response = {
    statusCode: 200,
    status(code) { this.statusCode = code; return this; },
    setHeader() {},
    send(body) { this.body = body; return this; },
    json(body) { this.body = body; return this; }
  };
  loans[0].outstanding -= 1;

  await getTypedReportExcel({
    params: { type: 'par' },
    query: { scope: 'buraza' },
    headers: { 'x-business-unit': 'buraza' },
    authUser: { role: 'admin', storeId: 'buraza' }
  }, response);

  assert.equal(response.statusCode, 422);
  assert.match(response.body.error, /Numbers do not add up on loan BMF-20260401-0017/);
});
