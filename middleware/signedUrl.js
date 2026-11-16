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
const supabaseApi = require('./supabaseApi');

const TTL_SECONDS = 10 * 60;
const SIGNED_SECRET = String(process.env.SIGNING_SECRET || '').trim().length >= 32
  ? String(process.env.SIGNING_SECRET).trim()
  : crypto.randomBytes(32).toString('hex');
const SIGNED_SECRET_IS_EPHEMERAL = String(process.env.SIGNING_SECRET || '').trim().length < 32;
const issuedLinks = new Map();

function payload(filename, exp, email, jti) {
  return `bmf-upload|${filename}|${exp}|${email}|${jti}`;
}

function hmac(value) {
  return crypto.createHmac('sha256', SIGNED_SECRET).update(value).digest('hex');
}

function signUploadQuery(filename, ttlSeconds = TTL_SECONDS, user = {}) {
  const exp = Math.floor(Date.now() / 1000) + ttlSeconds;
  const jti = crypto.randomBytes(9).toString('hex');
  const email = String(user.email || '').trim().toLowerCase();
  const record = { exp, email, filename, revoked: false };
  if (supabaseApi.enabled()) {
    supabaseApi.saveUploadLink({
      jti,
      filename,
      email,
      expires_at: new Date(exp * 1000).toISOString(),
      revoked: false
    });
  } else {
    issuedLinks.set(jti, record);
  }
  return { exp, sig: hmac(payload(filename, exp, email, jti)), jti, email };
}

function signedUploadPath(filename, user) {
  const { exp, sig, jti, email } = signUploadQuery(filename, TTL_SECONDS, user);
  return `/uploads/${encodeURIComponent(filename)}?exp=${exp}&sig=${sig}&jti=${jti}&u=${encodeURIComponent(email)}`;
}

function revokeUploadLinksForEmail(email) {
  const target = String(email || '').trim().toLowerCase();
  for (const record of issuedLinks.values()) {
    if (record.email === target) record.revoked = true;
  }
}

// Signature, expiry, server-issued id, and the user the link was bound to.
function verifyUploadSig(filename, expRaw, sigRaw, jtiRaw, emailRaw) {
  if (!filename || !expRaw || !sigRaw || !jtiRaw || typeof sigRaw !== 'string') return false;
  const exp = Number(expRaw);
  if (!Number.isFinite(exp) || !Number.isInteger(exp)) return false;
  if (exp < Math.floor(Date.now() / 1000)) return false;
  const record = supabaseApi.enabled()
    ? supabaseApi.getUploadLink(String(jtiRaw))
    : issuedLinks.get(String(jtiRaw));
  if (!record || record.revoked || record.filename !== filename) return false;
  const recordExp = record.exp != null ? Number(record.exp) : Math.floor(Date.parse(record.expires_at) / 1000);
  if (recordExp !== exp) return false;
  const email = String(emailRaw == null ? record.email : emailRaw).trim().toLowerCase();
  if (record.email !== email) return false;
  const expected = hmac(payload(filename, exp, email, jtiRaw));
  const a = Buffer.from(expected, 'utf8');
  const b = Buffer.from(sigRaw, 'utf8');
  if (a.length !== b.length) {
    crypto.timingSafeEqual(a, a);
    return false;
  }
  return crypto.timingSafeEqual(a, b);
}

module.exports = {
  TTL_SECONDS,
  SIGNED_SECRET_IS_EPHEMERAL,
  signUploadQuery,
  signedUploadPath,
  verifyUploadSig,
  revokeUploadLinksForEmail
};