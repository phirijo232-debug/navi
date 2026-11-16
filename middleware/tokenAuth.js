'use strict';

// Signed device tokens and shared constant-time helpers.
// A token is useless unless the signature matches SIGNING_SECRET (or the
// process secret in private dev), it has not expired, and the server still
// holds a matching hash for that user. The raw token is returned once and
// is not written to the user file.
const crypto = require('crypto');

const DEVICE_TTL_MS = 90 * 24 * 60 * 60 * 1000;
let ephemeralSecret = '';

function signingSecret() {
  const fromEnv = String(process.env.SIGNING_SECRET || '').trim();
  if (fromEnv.length >= 32) return fromEnv;
  if (!ephemeralSecret) ephemeralSecret = crypto.randomBytes(32).toString('hex');
  return ephemeralSecret;
}

function hashValue(value) {
  return crypto.createHash('sha256').update(String(value)).digest('hex');
}

function timingSafeEqualString(left, right) {
  const a = Buffer.from(String(left));
  const b = Buffer.from(String(right));
  if (a.length !== b.length) {
    crypto.timingSafeEqual(a, a);
    return false;
  }
  return crypto.timingSafeEqual(a, b);
}

function issueDeviceToken({ userId, email }) {
  const jti = crypto.randomBytes(16).toString('hex');
  const exp = Date.now() + DEVICE_TTL_MS;
  const body = Buffer.from(JSON.stringify({
    v: 1,
    jti,
    uid: userId == null ? null : userId,
    email: String(email || '').trim().toLowerCase(),
    exp
  })).toString('base64url');
  const sig = crypto.createHmac('sha256', signingSecret()).update(body).digest('base64url');
  const token = `v1.${body}.${sig}`;
  return {
    token,
    record: {
      tokenHash: hashValue(token),
      jti,
      expiresAt: new Date(exp).toISOString(),
      revoked: false,
      createdAt: new Date().toISOString()
    }
  };
}

function readDeviceClaims(token) {
  const parts = String(token || '').split('.');
  if (parts.length !== 3 || parts[0] !== 'v1') return null;
  const body = parts[1];
  const sig = parts[2];
  const expected = crypto.createHmac('sha256', signingSecret()).update(body).digest('base64url');
  if (!timingSafeEqualString(expected, sig)) return null;
  let claims;
  try {
    claims = JSON.parse(Buffer.from(body, 'base64url').toString('utf8'));
  } catch {
    return null;
  }
  if (!claims || !claims.jti || !claims.email || !Number.isFinite(Number(claims.exp))) return null;
  if (Number(claims.exp) <= Date.now()) return null;
  return claims;
}

function deviceRecordMatches(device, token, claims) {
  if (!device || device.revoked) return false;
  if (!claims || device.jti !== claims.jti) return false;
  if (device.expiresAt && Date.parse(device.expiresAt) <= Date.now()) return false;
  if (!device.tokenHash) return false;
  return timingSafeEqualString(device.tokenHash, hashValue(token));
}

module.exports = {
  DEVICE_TTL_MS,
  hashValue,
  timingSafeEqualString,
  issueDeviceToken,
  readDeviceClaims,
  deviceRecordMatches
};
