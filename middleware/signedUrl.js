'use strict';
// Short-lived signed URLs for KYC / proof-of-payment images.
// Replaces the old `?token=<deviceToken>` fallback (TODO.md line 28): the
// device token IS the session, so it must never appear in a URL. A signed link
// is a bearer of ONE file for at most 10 minutes and is issued only after the
// caller's ownership/store-scope check passes (see signUpload in
// controllers/fileController.js) — the S3 presigned-URL model.
//
// SECRET: process.env.SIGNING_SECRET when set (REQUIRED for PUBLIC_DEPLOY —
// server.js refuses public boot without it). Otherwise an ephemeral per-boot
// secret: links then die on restart, which is fine for dev/LAN because the
// TTL is only 10 minutes anyway.
const crypto = require('crypto');

const TTL_SECONDS = 10 * 60;
const SIGNED_SECRET = process.env.SIGNING_SECRET
  || crypto.randomBytes(32).toString('hex');
const SIGNED_SECRET_IS_EPHEMERAL = !process.env.SIGNING_SECRET;

function payload(filename, exp) {
  return `bmf-upload|${filename}|${exp}`;
}

function hmac(value) {
  return crypto.createHmac('sha256', SIGNED_SECRET).update(value).digest('hex');
}

// Returns a query string fragment: `exp=<unix-seconds>&sig=<hex>`.
function signUploadQuery(filename, ttlSeconds = TTL_SECONDS) {
  const exp = Math.floor(Date.now() / 1000) + ttlSeconds;
  return { exp, sig: hmac(payload(filename, exp)) };
}

// Build the link the client opens: /uploads/<file>?exp=..&sig=..
function signedUploadPath(filename) {
  const { exp, sig } = signUploadQuery(filename);
  return `/uploads/${encodeURIComponent(filename)}?exp=${exp}&sig=${sig}`;
}

// Strict verification: correct signature AND not expired. Constant-time
// comparison so a wrong guess cannot be measured byte-by-byte.
function verifyUploadSig(filename, expRaw, sigRaw) {
  if (!filename || !expRaw || !sigRaw || typeof sigRaw !== 'string') return false;
  const exp = Number(expRaw);
  if (!Number.isFinite(exp) || !Number.isInteger(exp)) return false;
  if (exp < Math.floor(Date.now() / 1000)) return false; // expired
  const expected = hmac(payload(filename, exp));
  const a = Buffer.from(expected, 'utf8');
  const b = Buffer.from(sigRaw, 'utf8');
  if (a.length !== b.length) return false;
  return crypto.timingSafeEqual(a, b);
}

module.exports = {
  TTL_SECONDS,
  SIGNED_SECRET_IS_EPHEMERAL,
  signUploadQuery,
  signedUploadPath,
  verifyUploadSig
};