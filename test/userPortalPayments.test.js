const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const vm = require('node:vm');

const userPage = fs.readFileSync(require.resolve('../public/user.html'), 'utf8');

test('customer payment portal uses simple sections and displays a locked, server-verified balance', () => {
  assert.doesNotMatch(userPage, /data-support-(?:view|panel)/);
  assert.doesNotMatch(userPage, /<canvas\b|Chart\.js|new Chart\s*\(/i);
  assert.match(userPage, /<output\b[^>]*id="recordPaymentExpectedBalance"/);
  assert.doesNotMatch(userPage, /<input\b[^>]*id="recordPaymentExpectedBalance"/);
  assert.match(userPage, /balanceOutput\.textContent = formatKwacha\(outstanding\)/);
  assert.match(userPage, /recordPaymentLoanId'\)\?\.addEventListener\('change', updateRecordPaymentBalance\)/);
  assert.match(userPage, /amountInput\.max = outstanding\.toFixed\(2\)/);
  assert.match(userPage, /\/loans\/\$\{encodeURIComponent\(loanId\)\}\/payment-submissions/);
  assert.match(userPage, /fetch\('\/feedback'/);
  assert.doesNotMatch(userPage, /formData\.append\(['"]expectedBalance['"]/);

  const inlineScripts = [...userPage.matchAll(/<script\b(?![^>]*\bsrc=)[^>]*>([\s\S]*?)<\/script>/gi)];
  assert.ok(inlineScripts.length > 0, 'customer page should contain its application script');
  for (const [, script] of inlineScripts) new vm.Script(script);
});
