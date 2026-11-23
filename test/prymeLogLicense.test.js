'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const crypto = require('crypto');
const license = require('../middleware/prymeLogLicense');

const INSTALL_ID = '11111111-1111-4111-8111-111111111111';
const NOW = 1732363200000;

function memoryStore(initial) {
  let state = JSON.parse(JSON.stringify(initial || { version: 1, installs: {}, company: null, logoFile: null }));
  return {
    read() { return JSON.parse(JSON.stringify(state)); },
    write(next) { state = JSON.parse(JSON.stringify(next)); },
    snapshot() { return JSON.parse(JSON.stringify(state)); }
  };
}

function responseFor(payload, status = payload && payload.ok === false ? 403 : 200) {
  const text = JSON.stringify(payload);
  return {
    ok: status >= 200 && status < 300,
    status,
    text: async () => text,
    json: async () => payload
  };
}

function licensedEnv(extra = {}) {
  return {
    PRYMELOG_LICENSE_ID: 'aaaaaaaa-bbbb-4ccc-8ddd-eeeeeeeeeeee',
    PRYMELOG_LICENSE_SECRET: 'test-license-secret',
    PRYMELOG_VALIDATE_URL: 'https://pryme-log.vercel.app/api/license/validate',
    ...extra
  };
}

function harness(options = {}) {
  const calls = [];
  const env = options.env || licensedEnv();
  let initial = options.state ? JSON.parse(JSON.stringify(options.state)) : undefined;
  if (initial && env.PRYMELOG_LICENSE_SECRET) {
    initial = license.sealState(initial, env.PRYMELOG_LICENSE_SECRET);
  }
  const store = options.store || memoryStore(initial);
  let clock = options.now || NOW;
  const fetchImpl = options.fetchImpl || (async (url, init) => {
    calls.push({ url: String(url), init });
    const payload = typeof options.payload === 'function' ? options.payload(calls.length) : options.payload;
    if (payload instanceof Error) throw payload;
    return responseFor(payload, options.status);
  });
  const client = license.createClient({
    env,
    enforce: options.enforce !== false,
    cacheLogo: options.cacheLogo === true,
    now: () => clock,
    store,
    fetchImpl
  });
  return {
    client,
    calls,
    store,
    setNow(value) { clock = value; }
  };
}

test('signBody is hex HMAC-SHA256 of the exact raw body', () => {
  const raw = '{"license_id":"abc","install_id":"11111111-1111-4111-8111-111111111111","ts":1732363200000,"nonce":"once"}';
  const secret = 'test-license-secret';
  const expected = crypto.createHmac('sha256', secret).update(raw).digest('hex');
  assert.equal(license.signBody(raw, secret), expected);
  assert.notEqual(license.signBody(`${raw} `, secret), expected);
  assert.match(license.signBody(raw, secret), /^[0-9a-f]{64}$/);
});

test('the signed request uses the raw body, millisecond ts, and X-Signature', async () => {
  const { client, calls } = harness({
    payload: { ok: true, company: { name: 'Acme Loans', logo_url: '', contact: {} }, warn: false, days_left: 40 }
  });
  const decision = await client.gateCredential(INSTALL_ID, 'Front desk');
  assert.equal(decision.allowed, true);
  assert.equal(calls.length, 1);
  const sent = calls[0].init.body;
  const parsed = JSON.parse(sent);
  assert.equal(parsed.license_id, 'aaaaaaaa-bbbb-4ccc-8ddd-eeeeeeeeeeee');
  assert.equal(parsed.install_id, INSTALL_ID);
  assert.equal(parsed.device_label, 'Front desk');
  assert.equal(parsed.ts, NOW);
  assert.ok(NOW > 1e12, 'timestamp is unix milliseconds');
  assert.match(parsed.nonce, /^[0-9a-f]{32}$/);
  assert.equal(calls[0].init.headers['x-signature'], license.signBody(sent, 'test-license-secret'));
  assert.equal(calls[0].init.headers['content-type'], 'application/json');
  assert.equal(calls[0].url, 'https://pryme-log.vercel.app/api/license/validate');
});

test('a valid license is cached for branding and a repeat credential check inside 60 seconds does not call again', async () => {
  const { client, calls } = harness({
    payload: {
      ok: true,
      company: { name: 'Acme Loans', logo_url: 'https://cdn.example/logo.png', contact: { phone: '+260777251160' } },
      warn: true,
      days_left: 12,
      expires_at: '2027-01-01T00:00:00.000Z'
    }
  });
  const first = await client.gateCredential(INSTALL_ID, '');
  const second = await client.gateCredential(INSTALL_ID, '');
  assert.equal(first.allowed, true);
  assert.equal(first.warn, true);
  assert.equal(first.daysLeft, 12);
  assert.equal(second.allowed, true);
  assert.equal(calls.length, 1);
  const sent = JSON.parse(calls[0].init.body);
  assert.equal(sent.device_label, undefined);
  assert.equal(client.publicBranding().name, 'Acme Loans');
  assert.equal(client.publicBranding().footer, 'Powered by PRYME LOAN');
  assert.equal(client.headerName(), 'ACME LOANS');
  const status = client.licenseStatus(INSTALL_ID);
  assert.equal(status.warn, true);
  assert.equal(status.daysLeft, 12);
});

test('EXPIRED and SEATS_FULL block with the exact product messages and do not issue access', async () => {
  const expired = harness({
    payload: { ok: false, code: 'EXPIRED', message: 'something else' }
  });
  const expiredDecision = await expired.client.gateCredential(INSTALL_ID, 'desk');
  assert.equal(expiredDecision.allowed, false);
  assert.equal(expiredDecision.code, 'EXPIRED');
  assert.equal(expiredDecision.message, license.EXPIRED_MESSAGE);

  const seats = harness({
    payload: { ok: false, code: 'SEATS_FULL', message: 'All seats on this license are in use.' }
  });
  const seatsDecision = await seats.client.gateCredential(INSTALL_ID, 'desk');
  assert.equal(seatsDecision.allowed, false);
  assert.equal(seatsDecision.code, 'SEATS_FULL');
  assert.equal(seatsDecision.message, license.SEATS_FULL_MESSAGE);
  assert.equal(seats.client.publicBranding().name, 'PRYME LOAN');
});

test('other license denials show the API message', async () => {
  const { client } = harness({
    payload: { ok: false, code: 'SUSPENDED', message: 'This license is suspended.' }
  });
  const decision = await client.gateCredential(INSTALL_ID, 'desk');
  assert.equal(decision.allowed, false);
  assert.equal(decision.code, 'SUSPENDED');
  assert.equal(decision.message, 'This license is suspended.');
});

test('missing license env fails closed and does not call PRYME LOG', async () => {
  const { client, calls } = harness({ env: {}, payload: { ok: true } });
  const decision = await client.gateCredential(INSTALL_ID, 'desk');
  assert.equal(decision.allowed, false);
  assert.equal(decision.code, 'NOT_CONFIGURED');
  assert.match(decision.message, /PRYMELOG_LICENSE_ID/);
  assert.match(decision.message, /PRYMELOG_LICENSE_SECRET/);
  assert.equal(calls.length, 0);
});

test('a credential check calls PRYME LOG even when a successful check is still inside six hours', async () => {
  const state = {
    version: 1,
    company: { name: 'Acme Loans', logo_url: '', contact: {} },
    installs: {
      [INSTALL_ID]: {
        lastResult: 'ok',
        lastSuccessAt: NOW - 60 * 60 * 1000,
        warn: false,
        daysLeft: 20,
        company: { name: 'Acme Loans', logo_url: '', contact: {} }
      }
    }
  };
  const { client, calls } = harness({
    state,
    payload: { ok: true, company: { name: 'Acme Loans' }, warn: false, days_left: 20 }
  });
  const decision = await client.gateCredential(INSTALL_ID, 'desk');
  assert.equal(decision.allowed, true);
  assert.equal(calls.length, 1);
});

test('device-token reuse skips PRYME LOG until the last success is six hours old', async () => {
  const fresh = {
    version: 1,
    company: { name: 'Acme Loans', logo_url: '', contact: {} },
    installs: {
      [INSTALL_ID]: {
        lastResult: 'ok',
        lastSuccessAt: NOW - (6 * 60 * 60 * 1000) + 1,
        warn: true,
        daysLeft: 3,
        company: { name: 'Acme Loans', logo_url: '', contact: {} }
      }
    }
  };
  const recent = harness({ state: fresh, payload: { ok: false, code: 'EXPIRED', message: 'no' } });
  const allowed = await recent.client.gateSession(INSTALL_ID, 'desk');
  assert.equal(allowed.allowed, true);
  assert.equal(allowed.daysLeft, 3);
  assert.equal(recent.calls.length, 0);

  fresh.installs[INSTALL_ID].lastSuccessAt = NOW - (6 * 60 * 60 * 1000);
  const stale = harness({
    state: fresh,
    payload: { ok: false, code: 'EXPIRED', message: 'ignored' }
  });
  const blocked = await stale.client.gateSession(INSTALL_ID, 'desk');
  assert.equal(blocked.allowed, false);
  assert.equal(blocked.code, 'EXPIRED');
  assert.equal(stale.calls.length, 1);
});

test('an unreachable license server allows a 72-hour grace period and then blocks', async () => {
  const state = {
    version: 1,
    company: { name: 'Acme Loans', logo_url: '', contact: {} },
    installs: {
      [INSTALL_ID]: {
        lastResult: 'ok',
        lastSuccessAt: NOW - (72 * 60 * 60 * 1000),
        company: { name: 'Acme Loans', logo_url: '', contact: {} }
      }
    }
  };
  const during = harness({ state, payload: new Error('connect ECONNREFUSED') });
  const allowed = await during.client.gateCredential(INSTALL_ID, 'desk');
  assert.equal(allowed.allowed, true);
  assert.equal(allowed.grace, true);
  assert.equal(allowed.code, 'GRACE');
  assert.equal(during.client.licenseStatus(INSTALL_ID).grace, true);

  state.installs[INSTALL_ID].lastSuccessAt = NOW - (72 * 60 * 60 * 1000) - 1;
  state.installs[INSTALL_ID].lastResult = 'ok';
  const after = harness({ state, payload: new Error('connect ECONNREFUSED') });
  const blocked = await after.client.gateCredential(INSTALL_ID, 'desk');
  assert.equal(blocked.allowed, false);
  assert.equal(blocked.code, 'UNREACHABLE');
});

test('a definitive denial is not turned into grace when the license server later goes away', async () => {
  let step = 0;
  const { client, calls, setNow } = harness({
    payload() {
      step += 1;
      if (step === 1) return { ok: false, code: 'EXPIRED', message: 'no' };
      throw new Error('connect ECONNREFUSED');
    }
  });
  const denied = await client.gateCredential(INSTALL_ID, 'desk');
  assert.equal(denied.code, 'EXPIRED');
  setNow(NOW + 61 * 1000);
  const again = await client.gateCredential(INSTALL_ID, 'desk');
  assert.equal(again.allowed, false);
  assert.equal(calls.length, 2);
  assert.notEqual(again.code, 'GRACE');
});

test('session middleware blocks a signed-in request when the license is expired', async () => {
  const { client } = harness({
    payload: { ok: false, code: 'SEATS_FULL', message: 'full' }
  });
  const middleware = license.createLicenseSession(client);
  const req = {
    authUser: { email: 'staff@example.test', role: 'store_admin' },
    headers: { 'x-install-id': INSTALL_ID, 'x-device-label': 'Front desk' },
    body: {}
  };
  const res = {
    statusCode: 200,
    headersSent: false,
    status(code) { this.statusCode = code; return this; },
    json(body) { this.body = body; return this; }
  };
  await new Promise((resolve, reject) => {
    middleware(req, res, (err) => (err ? reject(err) : resolve()));
    setTimeout(() => resolve(), 50);
  });
  assert.equal(res.statusCode, 403);
  assert.equal(res.body.license, true);
  assert.equal(res.body.code, 'SEATS_FULL');
  assert.equal(res.body.error, license.SEATS_FULL_MESSAGE);
});

test('a tampered license state cannot extend the offline grace period', async () => {
  const { client, store } = harness({
    state: {
      version: 1,
      installs: {
        [INSTALL_ID]: { lastResult: 'ok', lastSuccessAt: NOW - 60 * 1000 }
      },
      company: null,
      logoFile: null
    },
    payload: new Error('connect ECONNREFUSED')
  });
  const saved = store.snapshot();
  saved.installs[INSTALL_ID].lastSuccessAt = NOW;
  store.write(saved);
  const decision = await client.gateCredential(INSTALL_ID, 'desk');
  assert.equal(decision.allowed, false);
  assert.equal(decision.code, 'UNREACHABLE');
});

test('unsigned license state is not trusted for grace', async () => {
  const store = memoryStore({
    version: 1,
    installs: {
      [INSTALL_ID]: { lastResult: 'ok', lastSuccessAt: NOW - 60 * 1000 }
    },
    company: null,
    logoFile: null
  });
  const { client } = harness({ store, payload: new Error('connect ECONNREFUSED') });
  const decision = await client.gateCredential(INSTALL_ID, 'desk');
  assert.equal(decision.allowed, false);
  assert.equal(decision.code, 'UNREACHABLE');
});

test('the license logo is not fetched from a private or metadata address', async () => {
  const calls = [];
  const { client } = harness({
    cacheLogo: true,
    payload: {
      ok: true,
      company: { name: 'Acme Loans', logo_url: 'https://169.254.169.254/latest/meta-data', contact: {} },
      warn: false,
      days_left: 10
    },
    fetchImpl: async (url) => {
      calls.push(String(url));
      if (String(url).includes('169.254.169.254')) throw new Error('ssrf');
      return responseFor({
        ok: true,
        company: { name: 'Acme Loans', logo_url: 'https://169.254.169.254/latest/meta-data', contact: {} },
        warn: false,
        days_left: 10
      });
    }
  });
  const decision = await client.gateCredential(INSTALL_ID, 'desk');
  assert.equal(decision.allowed, true);
  assert.equal(calls.some(url => url.includes('169.254.169.254')), false);
  assert.equal(license.isBlockedIp('127.0.0.1'), true);
  assert.equal(license.isBlockedIp('10.1.2.3'), true);
  assert.equal(license.isBlockedIp('8.8.8.8'), false);
  assert.equal(await license.logoUrlAllowed('https://127.0.0.1/logo.png'), false);
  assert.equal(await license.logoUrlAllowed('http://example.com/logo.png'), false);
});

test('the test runner leaves the process-wide gate off so existing logins keep working', () => {
  assert.equal(license.enforcementEnabled(), false);
  assert.equal(license.publicBranding().name, 'PRYME LOAN');
  assert.equal(license.publicBranding().footer, 'Powered by PRYME LOAN');
});
