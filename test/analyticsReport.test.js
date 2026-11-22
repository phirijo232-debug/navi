'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const dataStore = require('../middleware/dataStore');
const { getAnalyticsReport } = require('../controllers/reportController');
const Reports = require('../services/bmfPromptReports');

const LOANS_FILE = dataStore.paths.loans;

function responseRecorder() {
  return {
    statusCode: 200,
    status(code) { this.statusCode = code; return this; },
    json(payload) { this.body = payload; return this; }
  };
}

test('analytics stays behind the admin check and accepts a period and officer', async () => {
  const original = fs.existsSync(LOANS_FILE) ? fs.readFileSync(LOANS_FILE, 'utf8') : '[]';
  fs.writeFileSync(LOANS_FILE, JSON.stringify([
    {
      id: 11, email: 'one@example.test', storeId: 'buraza', status: 'active', officer: 'Chipo Banda',
      amount: 1000, totalRepayment: 1160, interestAmount: 160, outstanding: 500,
      approvedAt: '2026-11-02', dueDate: '2026-11-16',
      payments: [{ amount: 660, interestPortion: 80, paymentDate: '2026-11-10' }]
    },
    {
      id: 12, email: 'two@example.test', storeId: 'buraza', status: 'defaulted', officer: 'Mwila Phiri',
      amount: 400, totalRepayment: 464, interestAmount: 64, outstanding: 200,
      approvedAt: '2026-10-01', dueDate: '2026-10-15', payments: []
    }
  ]));
  try {
    const denied = responseRecorder();
    getAnalyticsReport({ authUser: { role: 'user', storeId: 'buraza' }, query: {}, headers: {}, body: {} }, denied);
    assert.equal(denied.statusCode, 403);

    const badDate = responseRecorder();
    getAnalyticsReport({
      authUser: { role: 'store_admin', storeId: 'buraza', email: 'ops@example.test' },
      query: { from: '11/01/2026' }, headers: {}, body: {}
    }, badDate);
    assert.equal(badDate.statusCode, 400);

    const scoped = responseRecorder();
    getAnalyticsReport({
      authUser: { role: 'store_admin', storeId: 'buraza', email: 'ops@example.test' },
      query: { from: '2026-11-01', to: '2026-11-30', officer: 'Chipo Banda' },
      headers: {}, body: {}
    }, scoped);
    assert.equal(scoped.statusCode, 200);
    assert.equal(scoped.body.summary.disbursed, 1000);
    assert.equal(scoped.body.summary.collected, 660);
    assert.equal(scoped.body.summary.profit, 160);
    assert.equal(scoped.body.officer, 'chipo banda');
    assert.ok(Array.isArray(scoped.body.series));
    assert.ok(scoped.body.series.some(point => point.collected === 660));
    assert.ok(Array.isArray(scoped.body.arrearsBuckets));
    assert.ok(Array.isArray(scoped.body.statusBreakdown));
    assert.deepEqual(scoped.body.officers, ['Chipo Banda', 'Mwila Phiri']);

    const legacy = Reports.canonicalReportType('how-risky');
    assert.equal(legacy, 'loan-risk');
    assert.equal(Reports.canonicalReportType('loan-risk'), 'loan-risk');
    assert.equal(Reports.reportConfig('par').filename, 'bmf_loan_risk');
  } finally {
    fs.writeFileSync(LOANS_FILE, original);
  }
});
