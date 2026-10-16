const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const { safeFilename, canViewFile } = require('../controllers/fileController');

const LOANS_FILE = require('../middleware/dataStore').paths.loans;
const USERS_FILE = require('../middleware/dataStore').paths.users;

test('safeFilename rejects traversal and non-images but accepts images', () => {
  assert.equal(safeFilename('1790000000000-abc.jpg'), '1790000000000-abc.jpg');
  assert.equal(safeFilename('proof.png'), 'proof.png');
  assert.equal(safeFilename('../../etc/passwd'), null);
  assert.equal(safeFilename('a/b.png'), null);
  assert.equal(safeFilename('a\\b.png'), null);
  assert.equal(safeFilename('shell.php'), null);
  assert.equal(safeFilename('evil.jpg.php'), null);
  assert.equal(safeFilename(''), null);
});

test('uploaded images are viewable only by the owning borrower or an in-scope admin', () => {
  const loansOriginal = fs.readFileSync(LOANS_FILE, 'utf8');
  const usersOriginal = fs.readFileSync(USERS_FILE, 'utf8');
  const filename = '1700000000000-x7k2-collateral.jpg';
  fs.writeFileSync(LOANS_FILE, JSON.stringify([
    {
      id: 4242,
      email: 'borrower@example.test',
      storeId: 'buraza',
      collateralFront: filename,
      payments: [{ screenshot: '1700000000001-y8m3-proof.png' }]
    },
    {
      id: 5252,
      email: 'other@example.test',
      storeId: 'buraza',
      collateralFront: '1700000000002-z9n4-other.jpg',
      payments: []
    }
  ], null, 2));
  fs.writeFileSync(USERS_FILE, JSON.stringify([
    { id: 1, email: 'borrower@example.test', role: 'user', storeId: 'buraza', trustedDevices: [] },
    { id: 2, email: 'other@example.test', role: 'user', storeId: 'buraza', trustedDevices: [] },
    { id: 3, email: 'bmf.admin@example.test', role: 'store_admin', storeId: 'buraza', trustedDevices: [] },
    { id: 4, email: 'outside.admin@example.test', role: 'store_admin', storeId: 'future-store', trustedDevices: [] }
  ], null, 2));

  try {
    const borrower = { email: 'borrower@example.test', role: 'user', storeId: 'buraza' };
    const other = { email: 'other@example.test', role: 'user', storeId: 'buraza' };
    const bmfAdmin = { email: 'bmf.admin@example.test', role: 'store_admin', storeId: 'buraza' };
    const outsideAdmin = { email: 'outside.admin@example.test', role: 'store_admin', storeId: 'future-store' };

    // Borrower sees their own collateral and their own payment proof.
    assert.equal(canViewFile(borrower, filename), true);
    assert.equal(canViewFile(borrower, '1700000000001-y8m3-proof.png'), true);
    // A different customer cannot see it.
    assert.equal(canViewFile(other, filename), false);
    // In-store admin can; an admin scoped elsewhere cannot.
    assert.equal(canViewFile(bmfAdmin, filename), true);
    assert.equal(canViewFile(outsideAdmin, filename), false);
    // Unauthenticated and unknown files are denied.
    assert.equal(canViewFile(null, filename), false);
    assert.equal(canViewFile(borrower, 'does-not-exist.jpg'), false);
  } finally {
    fs.writeFileSync(LOANS_FILE, loansOriginal);
    fs.writeFileSync(USERS_FILE, usersOriginal);
  }
});

// ─── Signed URL coverage (public-internet-access plan, Phase 1/5) ────────────
const { serveFile, signUpload } = require('../controllers/fileController');
const { signUploadQuery, verifyUploadSig } = require('../middleware/signedUrl');

const UPLOADS_DIR = path.join(__dirname, '..', 'public', 'uploads');

function mockRes() {
  return {
    statusCode: 200,
    headers: {},
    body: null,
    sentFile: null,
    set(name, value) { this.headers[name] = value; return this; },
    status(code) { this.statusCode = code; return this; },
    send(payload) { this.body = payload; return this; },
    sendFile(abs) { this.sentFile = abs; return this; },
    json(payload) { this.body = payload; return this; }
  };
}

test('signed upload URLs: valid verifies, expired/tampered/wrong-file fail', () => {
  const good = signUploadQuery('a.jpg');
  assert.equal(verifyUploadSig('a.jpg', good.exp, good.sig), true);
  // Expired (negative TTL → exp in the past; signature itself is well-formed).
  const expired = signUploadQuery('a.jpg', -60);
  assert.equal(verifyUploadSig('a.jpg', expired.exp, expired.sig), false);
  // Tampered signature.
  const tamperedSig = `${good.sig.slice(0, -1)}${good.sig.endsWith('0') ? '1' : '0'}`;
  assert.equal(verifyUploadSig('a.jpg', good.exp, tamperedSig), false);
  // Signature minted for one file cannot open another.
  assert.equal(verifyUploadSig('b.jpg', good.exp, good.sig), false);
  // Garbage / missing inputs are denied, never thrown.
  assert.equal(verifyUploadSig('a.jpg', 'not-a-number', good.sig), false);
  assert.equal(verifyUploadSig('a.jpg', undefined, undefined), false);
});

test('serveFile opens a file via signed query, and rejects expired/tampered/token URLs', async () => {
  const loansOriginal = fs.readFileSync(LOANS_FILE, 'utf8');
  const usersOriginal = fs.readFileSync(USERS_FILE, 'utf8');
  const filename = '1700000000099-signed-access.jpg';
  const abs = path.join(UPLOADS_DIR, filename);
  fs.writeFileSync(LOANS_FILE, JSON.stringify([
    { id: 7373, email: 'borrower@example.test', storeId: 'buraza', collateralFront: filename, payments: [] }
  ], null, 2));
  fs.writeFileSync(USERS_FILE, JSON.stringify([
    { id: 1, email: 'borrower@example.test', role: 'user', storeId: 'buraza', trustedDevices: [] }
  ], null, 2));
  fs.writeFileSync(abs, 'fake-image-bytes');

  try {
    // Valid signed link → served (no header user, no token in URL).
    const { exp, sig } = signUploadQuery(filename);
    const okRes = mockRes();
    serveFile({ params: { filename }, query: { exp, sig }, headers: {}, ip: 'test' }, okRes);
    assert.equal(okRes.statusCode, 200);
    assert.equal(okRes.sentFile, abs);

    // Expired link → 403.
    const expired = signUploadQuery(filename, -60);
    const expiredRes = mockRes();
    serveFile({ params: { filename }, query: { exp: expired.exp, sig: expired.sig }, headers: {}, ip: 'test' }, expiredRes);
    assert.equal(expiredRes.statusCode, 403);

    // Tampered signature → 403.
    const tamperedRes = mockRes();
    const tamperedSig = `${sig.slice(0, -1)}${sig.endsWith('0') ? '1' : '0'}`;
    serveFile({ params: { filename }, query: { exp, sig: tamperedSig }, headers: {}, ip: 'test' }, tamperedRes);
    assert.equal(tamperedRes.statusCode, 403);

    // Raw ?token= must be rejected even though the file exists (no URL sessions).
    const tokenRes = mockRes();
    serveFile({ params: { filename }, query: { token: 'borrower-device-token' }, headers: {}, ip: 'test' }, tokenRes);
    assert.equal(tokenRes.statusCode, 403);
    assert.match(String(tokenRes.body), /signed link/i);

    // Anonymous with no query at all → 403.
    const anonRes = mockRes();
    serveFile({ params: { filename }, query: {}, headers: {}, ip: 'test' }, anonRes);
    assert.equal(anonRes.statusCode, 403);
  } finally {
    fs.writeFileSync(LOANS_FILE, loansOriginal);
    fs.writeFileSync(USERS_FILE, usersOriginal);
    if (fs.existsSync(abs)) fs.unlinkSync(abs);
  }
});

test('signUpload issues a link only to the owner / in-scope admin, never cross-user', async () => {
  const loansOriginal = fs.readFileSync(LOANS_FILE, 'utf8');
  const usersOriginal = fs.readFileSync(USERS_FILE, 'utf8');
  const filename = '1700000000098-signed-issue.jpg';
  fs.writeFileSync(LOANS_FILE, JSON.stringify([
    { id: 8383, email: 'borrower@example.test', storeId: 'buraza', collateralFront: filename, payments: [] }
  ], null, 2));
  fs.writeFileSync(USERS_FILE, JSON.stringify([
    { id: 1, email: 'borrower@example.test', role: 'user', storeId: 'buraza', trustedDevices: [] },
    { id: 2, email: 'other@example.test', role: 'user', storeId: 'buraza', trustedDevices: [] }
  ], null, 2));

  try {
    // Owner gets a signed URL with exp + sig.
    const ownerRes = mockRes();
    await signUpload(
      { authUser: { email: 'borrower@example.test', role: 'user', storeId: 'buraza' }, body: { filename }, ip: 'test' },
      ownerRes
    );
    assert.equal(ownerRes.statusCode, 200);
    assert.match(ownerRes.body.url, new RegExp(`^/uploads/${filename}\\?exp=\\d+&sig=[0-9a-f]{64}$`));
    assert.equal(ownerRes.body.expiresIn, 600);

    // Cross-user (different borrower) is refused.
    const crossRes = mockRes();
    await signUpload(
      { authUser: { email: 'other@example.test', role: 'user', storeId: 'buraza' }, body: { filename }, ip: 'test' },
      crossRes
    );
    assert.equal(crossRes.statusCode, 403);

    // Unknown / traversal filenames are refused.
    const badRes = mockRes();
    await signUpload(
      { authUser: { email: 'borrower@example.test', role: 'user', storeId: 'buraza' }, body: { filename: '../../etc/passwd' }, ip: 'test' },
      badRes
    );
    assert.equal(badRes.statusCode, 400);
  } finally {
    fs.writeFileSync(LOANS_FILE, loansOriginal);
    fs.writeFileSync(USERS_FILE, usersOriginal);
  }
});
