const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const { getRecordStoreId, canAccessStore, canAccessRecord } = require('../middleware/storeScope');
const {
  getReportData, getReportSummary, getSingleUserReport,
  getAllUsersReport, getAnalyticsReport, getUserReport
} = require('../controllers/reportController');
const { getLoans } = require('../controllers/loanController');
const { getFeedback } = require('../controllers/feedbackController');
const { updateLoanStatus } = require('../controllers/loanController');
const { createAdminUser } = require('../controllers/authController');

const USERS_FILE = require('../middleware/dataStore').paths.users;
const LOANS_FILE = require('../middleware/dataStore').paths.loans;
const FEEDBACK_FILE = require('../middleware/dataStore').paths.feedback;

function responseRecorder() {
  return {
    statusCode: 200,
    status(code) { this.statusCode = code; return this; },
    json(payload) { this.body = payload; return this; }
  };
}

test('legacy records default to BMF and store admins cannot cross subsidiary boundaries', () => {
  const bmfAdmin = { authUser: { role: 'store_admin', storeId: 'buraza' }, headers: {} };
  assert.equal(getRecordStoreId({}), 'buraza');
  assert.equal(canAccessRecord(bmfAdmin, {}), true);
  assert.equal(canAccessStore(bmfAdmin, 'future-store'), false);
  assert.equal(canAccessStore({ authUser: { role: 'admin' }, headers: {} }, 'all'), true);
});

test('BMF portfolio excludes other stores while the franchise report includes them', () => {
  const originals = [USERS_FILE, LOANS_FILE, FEEDBACK_FILE].map(file => fs.readFileSync(file, 'utf8'));
  fs.writeFileSync(USERS_FILE, JSON.stringify([
    { id: 1, email: 'bmf@example.test', role: 'user', storeId: 'buraza' },
    { id: 2, email: 'future@example.test', role: 'user', storeId: 'future-store' }
  ]));
  fs.writeFileSync(LOANS_FILE, JSON.stringify([
    { id: 1, email: 'bmf@example.test', storeId: 'buraza', status: 'approved', amount: 100, outstanding: 100 },
    { id: 2, email: 'future@example.test', storeId: 'future-store', status: 'approved', amount: 200, outstanding: 200 },
    { id: 3, email: 'legacy@example.test', status: 'approved', amount: 50, outstanding: 50 }
  ]));
  fs.writeFileSync(FEEDBACK_FILE, JSON.stringify([]));

  try {
    assert.deepEqual(getReportData('buraza').loans.map(loan => loan.id), [1, 3]);
    assert.deepEqual(getReportData('all').loans.map(loan => loan.id), [1, 2, 3]);
  } finally {
    [USERS_FILE, LOANS_FILE, FEEDBACK_FILE].forEach((file, index) => fs.writeFileSync(file, originals[index]));
  }
});

test('BMF store admins cannot request the franchise-wide report', () => {
  const req = {
    params: { scope: 'franchise' },
    authUser: { role: 'store_admin', storeId: 'buraza' },
    headers: {}
  };
  const res = responseRecorder();
  getReportSummary(req, res);
  assert.equal(res.statusCode, 403);
  assert.match(res.body.error, /Admin access required/);
});

test('legacy portfolio, analytics, and borrower reports honor the caller store scope', () => {
  const originals = [USERS_FILE, LOANS_FILE].map(file => fs.readFileSync(file, 'utf8'));
  fs.writeFileSync(USERS_FILE, JSON.stringify([
    {
      id: 1, email: 'bmf@example.test', username: 'BMF Borrower', role: 'user', storeId: 'buraza',
      password: 'hash', tokens: { laptop: 'legacy-token' }, trustedDevices: [{ token: 'live-token', lastSeen: '2026-10-15T10:00:00Z' }]
    },
    { id: 2, email: 'future@example.test', username: 'Future Borrower', role: 'user', storeId: 'future-store' }
  ]));
  fs.writeFileSync(LOANS_FILE, JSON.stringify([
    { id: 1, email: 'bmf@example.test', storeId: 'buraza', status: 'active', dueDate: '2026-10-01', amount: 100, totalRepayment: 100, outstanding: 100 },
    { id: 2, email: 'future@example.test', storeId: 'future-store', status: 'active', dueDate: '2026-10-01', amount: 200, totalRepayment: 200, outstanding: 200 }
  ]));

  try {
    const storeAdmin = {
      authUser: { role: 'store_admin', storeId: 'buraza', email: 'operator@example.test' },
      query: {}, headers: {}, body: {}
    };
    const allUsersResponse = responseRecorder();
    getAllUsersReport(storeAdmin, allUsersResponse);
    assert.deepEqual(allUsersResponse.body.users.map(user => user.email), ['bmf@example.test']);
    assert.equal(allUsersResponse.body.grandTotals.grandTotalOutstanding, 100);

    const analyticsResponse = responseRecorder();
    getAnalyticsReport(storeAdmin, analyticsResponse);
    assert.equal(analyticsResponse.body.possibleLoss, 100);
    assert.deepEqual(analyticsResponse.body.overdueLoans.map(loan => loan.email), ['bmf@example.test']);

    const borrowerResponse = responseRecorder();
    getSingleUserReport({ ...storeAdmin, query: { email: 'future@example.test' } }, borrowerResponse);
    assert.equal(borrowerResponse.statusCode, 404);

    const pathBorrowerResponse = responseRecorder();
    getUserReport({
      ...storeAdmin,
      params: { email: 'future@example.test' }
    }, pathBorrowerResponse);
    assert.equal(pathBorrowerResponse.statusCode, 404);

    const safeProfileResponse = responseRecorder();
    getUserReport({
      authUser: { role: 'admin', email: 'admin@example.test' },
      params: { email: 'bmf@example.test' }, query: {}, headers: {}, body: {}
    }, safeProfileResponse);
    assert.equal(safeProfileResponse.body.profile.password, undefined);
    assert.equal(safeProfileResponse.body.profile.tokens, undefined);
    assert.equal(safeProfileResponse.body.profile.trustedDevices, undefined);
    assert.equal(safeProfileResponse.body.profile._trustedDeviceCount, 1);

    const allScopeResponse = responseRecorder();
    getAllUsersReport({ ...storeAdmin, query: { storeId: 'all' } }, allScopeResponse);
    assert.equal(allScopeResponse.statusCode, 403);

    const franchiseResponse = responseRecorder();
    getAllUsersReport({
      authUser: { role: 'admin', email: 'admin@example.test' },
      query: { storeId: 'all' }, headers: {}, body: {}
    }, franchiseResponse);
    assert.deepEqual(franchiseResponse.body.users.map(user => user.email), ['bmf@example.test', 'future@example.test']);
  } finally {
    [USERS_FILE, LOANS_FILE].forEach((file, index) => fs.writeFileSync(file, originals[index]));
  }
});

test('BMF store admins only receive BMF loans and customer feedback', () => {
  const originals = [LOANS_FILE, FEEDBACK_FILE].map(file => fs.readFileSync(file, 'utf8'));
  fs.writeFileSync(LOANS_FILE, JSON.stringify([
    { id: 1, email: 'bmf@example.test', storeId: 'buraza', status: 'approved', amount: 100, outstanding: 100 },
    { id: 2, email: 'future@example.test', storeId: 'future-store', status: 'approved', amount: 200, outstanding: 200 }
  ]));
  fs.writeFileSync(FEEDBACK_FILE, JSON.stringify([
    { id: 1, email: 'bmf@example.test', storeId: 'buraza', category: 'complaint', status: 'new' },
    { id: 2, email: 'future@example.test', storeId: 'future-store', category: 'experience', status: 'new' }
  ]));

  try {
    const req = {
      authUser: { email: 'storeadmin@example.test', role: 'store_admin', storeId: 'buraza' },
      headers: {},
      query: {},
      body: {}
    };
    const loansRes = responseRecorder();
    const feedbackRes = responseRecorder();

    getLoans(req, loansRes);
    getFeedback(req, feedbackRes);

    assert.deepEqual(loansRes.body.loans.map(loan => loan.id), [1]);
    assert.deepEqual(feedbackRes.body.feedback.map(item => item.id), [1]);
  } finally {
    [LOANS_FILE, FEEDBACK_FILE].forEach((file, index) => fs.writeFileSync(file, originals[index]));
  }
});

test('franchise admins cannot alter BMF loan decisions through the API', async () => {
  const original = fs.readFileSync(LOANS_FILE, 'utf8');
  fs.writeFileSync(LOANS_FILE, JSON.stringify([
    { id: 88, email: 'borrower@example.test', storeId: 'buraza', status: 'pending', outstanding: 100 }
  ]));

  try {
    const req = {
      params: { id: '88' },
      body: { action: 'approve', reason: 'Test' },
      authUser: { email: 'franchise@example.test', role: 'admin' },
      headers: {}
    };
    const res = responseRecorder();
    await updateLoanStatus(req, res);
    assert.equal(res.statusCode, 403);
    assert.equal(JSON.parse(fs.readFileSync(LOANS_FILE, 'utf8'))[0].status, 'pending');
  } finally {
    fs.writeFileSync(LOANS_FILE, original);
  }
});

test('franchise admins can provision BMF store admins but store admins cannot elevate users', async () => {
  const original = fs.readFileSync(USERS_FILE, 'utf8');
  fs.writeFileSync(USERS_FILE, JSON.stringify([{ id: 1, email: 'existing@example.test' }]));

  try {
    const franchiseResponse = responseRecorder();
    await createAdminUser({
      authUser: { role: 'admin', email: 'franchise@example.test' },
      headers: { 'x-business-unit': 'buraza' },
      body: {
        username: 'BMF Operator',
        email: 'operator@example.test',
        password: 'StrongPass1!',
        confirmPassword: 'StrongPass1!',
        nrc: '123456/78/1',
        role: 'store_admin'
      }
    }, franchiseResponse);
    assert.equal(franchiseResponse.statusCode, 201);
    assert.equal(franchiseResponse.body.user.role, 'store_admin');
    assert.equal(franchiseResponse.body.user.storeId, 'buraza');

    const storeResponse = responseRecorder();
    await createAdminUser({
      authUser: { role: 'store_admin', storeId: 'buraza', email: 'operator@example.test' },
      headers: {},
      body: {
        username: 'Customer',
        email: 'newcustomer@example.test',
        password: 'StrongPass1!',
        confirmPassword: 'StrongPass1!',
        nrc: '123456/78/1',
        role: 'store_admin'
      }
    }, storeResponse);
    assert.equal(storeResponse.statusCode, 201);
    assert.equal(storeResponse.body.user.role, 'user');
  } finally {
    fs.writeFileSync(USERS_FILE, original);
  }
});
