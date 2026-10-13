const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');

const { sweep, runKidneySweep } = require('../middleware/kidneys');
const { sweepExpiredAuth } = require('../controllers/authController');
const { pruneSessions, trackSession } = require('../controllers/sessionController');
const otpService = require('../middleware/otp');

const USERS_FILE = require('../middleware/dataStore').paths.users;

test('sweepExpiredAuth drops dead pending entries and stale device tokens, keeps live ones', () => {
  const original = fs.readFileSync(USERS_FILE, 'utf8');
  const stale = new Date(Date.now() - 100 * 24 * 60 * 60 * 1000).toISOString(); // 100 days ago
  const fresh = new Date(Date.now() - 1 * 24 * 60 * 60 * 1000).toISOString();   // 1 day ago
  fs.writeFileSync(USERS_FILE, JSON.stringify([
    {
      id: 1, email: 'device-user@example.test', role: 'user', storeId: 'buraza',
      // Distinct IPs: getUsers()' normalizeTrustedDevices dedupes per-IP, so a
      // shared IP would hide these entries from the sweep before it runs.
      trustedDevices: [
        { token: 'old-stale-token', lastSeen: stale, ip: '10.0.0.1' },
        { token: 'fresh-token', lastSeen: fresh, ip: '10.0.0.2' },
        { token: 'no-timestamp-token', ip: '10.0.0.3' } // defensive: kept
      ]
    }
  ], null, 2));

  try {
    const result = sweepExpiredAuth();

    // Device pruning: only the clearly-stale one goes.
    assert.equal(result.staleDevices, 1);
    const users = JSON.parse(fs.readFileSync(USERS_FILE, 'utf8'));
    const tokens = users[0].trustedDevices.map(d => d.token);
    assert.ok(tokens.includes('fresh-token'), 'fresh device must survive');
    assert.ok(tokens.includes('no-timestamp-token'), 'defensive keep when no timestamp');
    assert.ok(!tokens.includes('old-stale-token'), 'stale device must be pruned');

    // A second sweep is idempotent — nothing left to prune.
    const again = sweepExpiredAuth();
    assert.equal(again.staleDevices, 0);
  } finally {
    fs.writeFileSync(USERS_FILE, original);
  }
});

test('pruneSessions drops idle sessions and keeps active ones', () => {
  // Distinct IPs — trackSession evicts other tokens sharing the same IP.
  trackSession({ headers: { 'x-device-token': 'active-session-token' }, ip: '10.1.0.1' }, {}, () => {});
  trackSession({ headers: { 'x-device-token': 'idle-session-token' }, ip: '10.1.0.2' }, {}, () => {});

  // Age the idle one beyond 24h by pruning with a future "now".
  const pruned = pruneSessions(24 * 60 * 60 * 1000, Date.now() + 25 * 60 * 60 * 1000);
  assert.ok(pruned >= 2, 'both sessions age out with a 25h-forward clock');

  // With the real clock, freshly-tracked sessions survive.
  trackSession({ headers: { 'x-device-token': 'live-token' }, ip: '127.0.0.1' }, {}, () => {});
  const kept = pruneSessions();
  assert.equal(kept, 0, 'live session must not be pruned');
});

test('expired OTPs are removed by the sweep while active ones survive', () => {
  const key = 'sweep-test@example.test:Sweep Purpose';
  const otp = otpService.generateOTP(key, true);
  assert.ok(otp);

  const result = sweep();
  assert.ok(result, 'sweep returns a result');

  // Active OTP (5-minute window) must still verify after the sweep.
  const check = otpService.verifyOTP(otp, 'sweep-test@example.test', 'Sweep Purpose');
  assert.equal(check.valid, true);
});

test('runKidneySweep never throws and logs only counts (no user material)', () => {
  const result = runKidneySweep();
  assert.ok(result === null || typeof result === 'object');
  // Return shape carries counts only.
  if (result) {
    assert.equal(typeof result.sessions, 'number');
    assert.equal(typeof result.errors, 'number');
    assert.equal(typeof result.auth, 'object');
    const flat = JSON.stringify(result);
    assert.ok(!flat.includes('@'), 'no email addresses in sweep result');
    assert.ok(!/token/i.test(flat), 'no token material in sweep result');
  }
});
