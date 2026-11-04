const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const vm = require('node:vm');

const userPage = fs.readFileSync(require.resolve('../public/user.html'), 'utf8');
const adminPage = fs.readFileSync(require.resolve('../public/admin.html'), 'utf8');
const adminScript = fs.readFileSync(require.resolve('../public/admin.js'), 'utf8');

test('customer portal follows the demo navigation and keeps each support task in its own tab', () => {
  assert.match(userPage, /class="portal-topbar"/);
  assert.match(userPage, /data-tab="payments">Payments &amp; Support/);
  for (const tab of ['payment-history', 'inquiries', 'record-payment', 'due-schedule']) {
    assert.match(userPage, new RegExp(`data-support-tab="${tab}"`));
    assert.match(userPage, new RegExp(`data-support-panel="${tab}"`));
  }
  assert.match(userPage, /data-support-tab="record-payment">💸 Record Payment/);
  assert.match(userPage, /function setSupportPanel\(panelKey/);
  assert.match(userPage, /button\.addEventListener\('click', \(\) => setSupportPanel\(button\.dataset\.supportTab\)\)/);
  assert.match(userPage, /id="paymentSummary"/);
  assert.match(userPage, /data-payment-range="today"/);
  assert.match(userPage, /Payments &amp; Support<\/h2>/);
  assert.doesNotMatch(userPage, /data-support-(?:view|submenu)/);
  assert.doesNotMatch(userPage, /fonts\.googleapis\.com/);
});

test('customer payments are chart-free and the admin collections chart is role-gated', () => {
  assert.doesNotMatch(userPage, /<canvas\b|Chart\.js|new Chart\s*\(/i);
  assert.doesNotMatch(userPage, /id="collectionsChart"|collections-svg/i);
  assert.match(adminPage, /id="collectionsChart"/);
  const accessCheck = adminScript.slice(
    adminScript.indexOf('function ensureAdminAccess()'),
    adminScript.indexOf('function applyRolePermissions()')
  );
  assert.match(accessCheck, /role === 'admin'/);
  assert.match(accessCheck, /role === 'franchise_admin'/);
  assert.match(accessCheck, /role === 'store_admin'/);
  assert.doesNotMatch(accessCheck, /role === 'user'/);
});

test('loan details modal has reliable accessible close controls', () => {
  assert.match(userPage, /id="loanModal" class="modal" role="dialog" aria-modal="true" aria-hidden="true"/);
  assert.match(userPage, /type="button" class="modal-close" data-modal-close="loanModal" aria-label="Close loan details"/);
  assert.match(userPage, /loanModalCloseButton\?\.addEventListener\('click', closeLoanModal\)/);
  assert.match(userPage, /if \(event\.target === loanModal\) closeLoanModal\(\)/);
  assert.match(userPage, /event\.key === 'Escape' && loanModal\?\.classList\.contains\('active'\)/);
  assert.match(userPage, /m\.setAttribute\('aria-hidden', 'true'\)/);
  assert.match(userPage, /modal\.setAttribute\('aria-hidden', 'false'\)/);
  assert.match(userPage, /\.customer-portal \.modal-content \{[^}]*max-height:90vh[^}]*background:var\(--portal-card\)/s);
});

test('payment selection shows the selected loan balance read-only and submits only the proof', () => {
  assert.match(userPage, /<output\b[^>]*id="recordPaymentExpectedBalance"/);
  assert.doesNotMatch(userPage, /<input\b[^>]*id="recordPaymentExpectedBalance"/);
  assert.match(userPage, /balanceOutput\.textContent = formatKwacha\(outstanding\)/);
  assert.match(userPage, /recordPaymentLoanId'\)\?\.addEventListener\('change', updateRecordPaymentBalance\)/);
  assert.match(userPage, /amountInput\.max = outstanding\.toFixed\(2\)/);
  assert.match(userPage, /\/loans\/\$\{encodeURIComponent\(loanId\)\}\/payment-submissions/);
  assert.match(userPage, /fetch\('\/feedback'/);
  assert.doesNotMatch(userPage, /formData\.append\(['"]expectedBalance['"]/);
});

test('My Loans Record Payment opens the payment panel for that exact loan', () => {
  const start = userPage.indexOf('function openRecordPayment(loanId)');
  const end = userPage.indexOf('function updateStandingBadge', start);
  const handler = userPage.slice(start, end);
  assert.match(handler, /setActiveLoanTab\('payments'\)/);
  assert.match(handler, /loanSelect\.value = String\(loan\.id\)/);
  assert.match(handler, /updateRecordPaymentBalance\(\)/);
  assert.match(handler, /setSupportPanel\('record-payment'\)/);
  assert.match(handler, /scrollIntoView/);
  assert.match(userPage, /data-record-payment="\$\{Number\(loan\.id\)\}">Record Payment/);
  assert.match(userPage, /if \(paymentButton\)[\s\S]*openRecordPayment\(Number\(paymentButton\.dataset\.recordPayment\)\)[\s\S]*return;[\s\S]*openLoanDetails\(Number\(loanCard\.dataset\.loanId\)\)/);
  assert.doesNotMatch(userPage, /data-record-payment="[^"]+" onclick=/);

  const inlineScripts = [...userPage.matchAll(/<script\b(?![^>]*\bsrc=)[^>]*>([\s\S]*?)<\/script>/gi)];
  assert.ok(inlineScripts.length > 0, 'customer page should contain its application script');
  for (const [, script] of inlineScripts) new vm.Script(script);
});
