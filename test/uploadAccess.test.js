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
