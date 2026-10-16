const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

function readPublic(name) { return fs.readFileSync(path.join(__dirname, '..', 'public', name), 'utf8'); }

test('customer portal requires distinct NRC images and never renders the device credential', () => {
  const page = readPublic('user.html');
  assert.match(page, /id="loanNrcFront"[^>]*required/);
  assert.match(page, /id="loanNrcBack"[^>]*required/);
  assert.match(page, /name="paymentProof"/);
  assert.match(page, /data-customer-payment/);
  assert.match(page, /customerNotifications/);
  assert.doesNotMatch(page, /Device token:<\/strong>|user\.deviceToken/);
});

test('admin portal exposes portfolio overview and proof review controls without third-party chart scripts', () => {
  const page = readPublic('admin.html');
  const script = readPublic('admin.js');
  assert.match(page, /portfolioKpis/);
  assert.match(page, /collectionsChart/);
  assert.match(page, /recentActivity/);
  assert.match(script, /data-payment-review="approve"/);
  assert.match(script, /\['NRC front', loan\.nrcFront\]/);
  assert.doesNotMatch(page, /https:\/\/cdn\.jsdelivr\.net\/npm\/chart\.js/i);
});

test('inline scripts in the touched portals parse cleanly', () => {
  for (const name of ['user.html', 'login.html', 'signup.html', 'forgot-password.html', 'admin.html']) {
    const page = readPublic(name);
    for (const match of page.matchAll(/<script(?:\s[^>]*)?>([\s\S]*?)<\/script>/gi)) {
      if (match[1].trim()) assert.doesNotThrow(() => new Function(match[1]), `${name} contains invalid inline JavaScript`);
    }
  }
});
