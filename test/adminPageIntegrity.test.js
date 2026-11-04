const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

// ─── FILE INTEGRITY GUARD ────────────────────────────────────────────────────
// public/admin.html was once corrupted down to a single byte with no working
// copy left in git history. These tests make that class of corruption
// impossible to go unnoticed: every future `node --test` run re-verifies the
// page structure and every DOM id admin.js binds to.

const ROOT = path.join(__dirname, '..');
const PUBLIC_DIR = path.join(ROOT, 'public');

const html = fs.readFileSync(path.join(PUBLIC_DIR, 'admin.html'), 'utf8');
const js = fs.readFileSync(path.join(PUBLIC_DIR, 'admin.js'), 'utf8');
const server = fs.readFileSync(path.join(ROOT, 'server.js'), 'utf8');

test('admin.html is structurally intact (not corrupted or truncated)', () => {
  assert.ok(html.length > 15000, `admin.html is suspiciously small (${html.length} chars)`);
  assert.match(html.slice(0, 64), /^\s*<!DOCTYPE html>/i, 'admin.html must start with <!DOCTYPE html>');
  assert.equal((html.match(/<!DOCTYPE/gi) || []).length, 1, 'admin.html must contain exactly one DOCTYPE');
  assert.equal((html.match(/<script[^>]*src="admin\.js(?:\?[^\"]*)?"/g) || []).length, 1, 'admin.html must load admin.js exactly once');
  assert.ok(!html.includes('@@APPEND@@'), 'leftover append marker found — rebuild was incomplete');
  assert.match(html, /<\/html>\s*$/, 'admin.html must end with </html>');
});

test('every id bound by admin.js exists in admin.html', () => {
  const allIds = [...html.matchAll(/\bid="([^"]+)"/g)].map((match) => match[1]);
  const duplicateIds = [...new Set(allIds.filter((id, index) => allIds.indexOf(id) !== index))];
  assert.deepEqual(duplicateIds, [], `admin.html contains duplicate ids: ${duplicateIds.join(', ')}`);

  const ids = new Set();

  // document.getElementById('someId') — literal targets
  for (const match of js.matchAll(/getElementById\(\s*['"]([^'"]+)['"]\s*\)/g)) {
    ids.add(match[1]);
  }

  // ['a', 'b', 'c'].forEach(id => ... getElementById(id)) — array-driven targets
  for (const match of js.matchAll(/\[([^\]]*)\]\.forEach\(\s*id\s*=>/g)) {
    for (const literal of match[1].matchAll(/['"]([^'"]+)['"]/g)) {
      ids.add(literal[1]);
    }
  }

  assert.ok(ids.size >= 50, `expected many id bindings in admin.js, found ${ids.size}`);

  const missing = [...ids].filter((id) => !html.includes(`id="${id}"`));
  assert.deepEqual(missing, [], `admin.html is missing ids bound by admin.js: ${missing.join(', ')}`);
});

test('every data-attribute selector used by admin.js exists in admin.html', () => {
  const attrs = new Set();
  for (const match of js.matchAll(/querySelectorAll\(\s*['"]\[([a-zA-Z0-9_-]+)\]['"]/g)) {
    attrs.add(match[1]);
  }
  assert.ok(attrs.size > 0, 'expected data-attribute selectors in admin.js');
  const generatedByReportLibrary = new Set(['data-report-action']);
  const missing = [...attrs].filter((attr) =>
    !html.includes(attr) && !generatedByReportLibrary.has(attr)
  );
  assert.deepEqual(missing, [], `admin.html is missing data attributes used by admin.js: ${missing.join(', ')}`);
  assert.match(js, /data-report-action data-report-type=.*data-report-format=/);
});

test('customer cards render before unrelated report, feedback, and loan requests finish', () => {
  const start = js.indexOf('async function fetchUsers()');
  const end = js.indexOf('// ─── New Requests', start);
  const fetchUsers = js.slice(start, end);
  const renderIndex = fetchUsers.indexOf('applyUserFilterAndSort();');
  const enrichmentIndex = fetchUsers.indexOf('Promise.allSettled([');
  assert.ok(start >= 0 && end > start, 'fetchUsers function must exist');
  assert.ok(renderIndex >= 0 && enrichmentIndex > renderIndex,
    'the customer directory must render before secondary API requests are awaited');
});

test('HR employee loading has a timeout and a visible timeout message', () => {
  const start = js.indexOf('async function fetchHrEmployees()');
  const end = js.indexOf('const HR_ROLE_LABELS', start);
  const fetchHr = js.slice(start, end);
  assert.match(fetchHr, /setTimeout\(\(\) => controller\.abort\(\), 12000\)/);
  assert.match(fetchHr, /Employee records took too long to load/);
});

test('public Quick Screen submission stays public while application review is device-authenticated', () => {
  const publicSubmission = server.indexOf("app.use('/api/apply', (req, res, next) =>");
  const deviceAuth = server.indexOf('app.use(deviceAuth)');
  const protectedApplications = server.indexOf("app.use('/api/apply', applyRouter)", deviceAuth);
  assert.ok(publicSubmission >= 0 && publicSubmission < deviceAuth, 'Quick Screen submissions must be mounted before deviceAuth');
  assert.ok(protectedApplications > deviceAuth, 'application reads and reviews must be mounted after deviceAuth');
  assert.match(server.slice(publicSubmission, deviceAuth), /if \(req\.method !== 'POST'\) return next\(\)/);
  assert.match(server.slice(publicSubmission, deviceAuth), /return applyRouter\(req, res, next\)/);
});

test('Quick Screen application cards use the application API field names', () => {
  const start = js.indexOf('function renderApplications()');
  const end = js.indexOf('async function reviewApplication(', start);
  const render = js.slice(start, end);
  for (const field of ['app.amount', 'app.tenureWeeks', 'app.product', 'app.nrcNumber', 'app.collateralFront', 'app.collateralBack']) {
    assert.ok(render.includes(field), `application cards must render ${field}`);
  }
});

test('admin directories expose wired filters, bounded paging, and application bell actions', () => {
  for (const id of [
    'userDateFrom', 'userDateTo', 'customerDateBasis', 'customerPagination',
    'hrSearch', 'hrRoleFilter', 'hrDateFrom', 'hrDateTo', 'hrPagination',
    'applicationSearch', 'applicationStatusFilter', 'applicationDateFrom',
    'applicationDateTo', 'applicationsPagination'
  ]) {
    assert.ok(html.includes(`id="${id}"`), `${id} must exist in the admin page`);
  }
  assert.match(js, /function getDirectoryPage\(items, page, pageSize/);
  assert.match(js, /async function fetchCustomerApplications\(\)/);
  assert.match(js, /quickScreenApplicant: true/);
  assert.match(js, /Quick Screen applicant · not registered/);
  assert.match(js, /function goBackAdminPage\(\)/);
  assert.match(js, /data-admin-back/);
  assert.match(js, /addLoanFromLoansBtn/);
  assert.match(js, /data-notification-application-action="approve"/);
  assert.match(js, /data-notification-application-action="reject"/);
  assert.match(js, /data-notification-application-action="view"/);
  assert.match(js, /function dateMatchesRange\(value, from, to\)/);
});

test('admin dashboard controls are present, wired, and remain dark without shared theme preferences', () => {
  for (const id of [
    'adminSidebar', 'portfolioOverview', 'portfolioKpis', 'collectionsChart',
    'collectionCustomRange', 'collectionRangeFrom', 'collectionRangeTo',
    'applyCollectionRange', 'collectionRangeError',
    'loanManagementPanel', 'loanStatusFilter', 'loanTablePagination',
    'loyalBorrowersPanel', 'portfolioReports', 'allLoansView', 'customersView',
    'paymentsView', 'overdueView', 'defaultersView', 'hrView', 'applicationsView',
    'announcementView', 'inviteView', 'createUserView', 'serverSettingsView'
  ]) {
    assert.ok(html.includes(`id="${id}"`), `${id} must exist in the dashboard`);
  }
  for (const attribute of [
    'data-admin-page', 'data-dashboard-action', 'data-collection-range'
  ]) {
    assert.ok(html.includes(attribute), `${attribute} dashboard controls must exist`);
  }
  assert.match(js, /function setDashboardNavActive\(activeButton\)/);
  assert.match(js, /function showReportsView\(\)/);
  assert.match(js, /showAdminPage\('portfolioReports'\)/);
  assert.doesNotMatch(html, /id="adminMenuReports"/);
  assert.match(js, /data-admin-page/);
  const pageTargets = [...html.matchAll(/data-admin-page="([^"]+)"/g)].map((match) => match[1]);
  assert.equal(new Set(pageTargets).size, pageTargets.length, 'each sidebar page target must be unique');
  for (const pageId of pageTargets) {
    assert.match(html, new RegExp(`<section id="${pageId}" class="[^"]*admin-page`),
      `${pageId} must resolve to a standalone admin page`);
  }
  assert.match(js, /data-loan-page/);
  assert.match(js, /activeCollectionRange = button\.dataset\.collectionRange/);
  assert.match(html, /data-collection-range="CUSTOM"[^>]*>Custom<\/button>/);
  assert.match(js, /getElementById\('applyCollectionRange'\)\?\.addEventListener\('click'/);
  assert.match(js, /The start date must be on or before the end date/);
  assert.match(js, /The end date cannot be in the future/);
  assert.match(js, /applyCollectionRange/);
  assert.match(js, /applyTheme\('dark'\)/);
  assert.doesNotMatch(js, /getElementById\(['"]modeBtn['"]\)/);
  assert.doesNotMatch(js, /localStorage\.getItem\(['"]mode['"]\)/);
});

test('all public HTML pages are non-trivial and start with a doctype', () => {
  const pages = ['admin.html', 'dashboard.html', 'index.html', 'login.html', 'signup.html', 'forgot-password.html', 'user.html'];
  for (const page of pages) {
    const file = path.join(PUBLIC_DIR, page);
    assert.ok(fs.existsSync(file), `${page} is missing`);
    const content = fs.readFileSync(file, 'utf8');
    assert.ok(content.length > 1000, `${page} is suspiciously small (${content.length} chars)`);
    assert.match(content.slice(0, 64), /^\s*<!DOCTYPE html>/i, `${page} must start with <!DOCTYPE html>`);
  }
});
