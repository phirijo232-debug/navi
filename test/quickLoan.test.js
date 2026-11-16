'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const { imageKind, quickLoanLimits, resetQuickLoanLimits } = require('../middleware/quickLoan');

test('photo bytes must be jpeg, png, or webp', () => {
  const jpeg = Buffer.from([0xFF, 0xD8, 0xFF, 0xE0, 0x00, 0x10, 0x4A, 0x46, 0x49, 0x46, 0x00, 0x01, 0x01, 0x00, 0x00, 0x01, 0x00, 0x01, 0x00, 0x00, 0xFF, 0xD9]);
  const png = Buffer.from([0x89, 0x50, 0x4E, 0x47, 0x0D, 0x0A, 0x1A, 0x0A, 0, 0, 0, 0]);
  const webp = Buffer.concat([Buffer.from('RIFF'), Buffer.alloc(4), Buffer.from('WEBP')]);
  assert.equal(imageKind(jpeg), 'jpg');
  assert.equal(imageKind(png), 'png');
  assert.equal(imageKind(webp), 'webp');
  assert.equal(imageKind(Buffer.from('GIF89aXXXXYYYY')), null);
});

test('quick loan limits count ip, phone, and nrc separately', () => {
  resetQuickLoanLimits();
  const attempt = { ip: '203.0.113.5', phone: '0977000001', nrc: '111111/11/1' };
  for (let i = 0; i < 4; i += 1) assert.equal(quickLoanLimits(attempt), '');
  assert.match(quickLoanLimits(attempt), /phone|NRC|network/i);
});
