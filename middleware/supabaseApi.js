'use strict';

const { spawnSync } = require('child_process');
const path = require('path');

const BUCKET = 'bmf-uploads';
let transport = null;

function enabled() {
  return String(process.env.STORAGE || '').trim().toLowerCase() === 'supabase';
}

function setTransport(fn) {
  transport = typeof fn === 'function' ? fn : null;
}

function projectUrl() {
  return String(process.env.SUPABASE_URL || '').trim().replace(/\/+$/, '');
}

function serviceKey() {
  return String(process.env.SUPABASE_SERVICE_ROLE_KEY || '').trim();
}

function authHeaders(extra = {}) {
  const key = serviceKey();
  if (!projectUrl() || !key) {
    throw new Error('SUPABASE_URL and SUPABASE_SERVICE_ROLE_KEY are required when STORAGE=supabase.');
  }
  return {
    apikey: key,
    Authorization: `Bearer ${key}`,
    ...extra
  };
}

function buildHttp(op) {
  const root = projectUrl();
  if (op.op === 'getDocument') {
    return {
      url: `${root}/rest/v1/documents?key=eq.${encodeURIComponent(op.key)}&select=body`,
      method: 'GET',
      headers: authHeaders({ Accept: 'application/json' })
    };
  }
  if (op.op === 'putDocument') {
    return {
      url: `${root}/rest/v1/documents?on_conflict=key`,
      method: 'POST',
      headers: authHeaders({
        'Content-Type': 'application/json',
        Prefer: 'resolution=merge-duplicates,return=minimal'
      }),
      body: { key: op.key, body: op.body, updated_at: new Date().toISOString() }
    };
  }
  if (op.op === 'select') {
    return {
      url: `${root}/rest/v1/${op.table}?${op.query}`,
      method: 'GET',
      headers: authHeaders({ Accept: 'application/json' })
    };
  }
  if (op.op === 'upsert') {
    return {
      url: `${root}/rest/v1/${op.table}?on_conflict=${encodeURIComponent(op.onConflict)}`,
      method: 'POST',
      headers: authHeaders({
        'Content-Type': 'application/json',
        Prefer: 'resolution=merge-duplicates,return=minimal'
      }),
      body: op.row
    };
  }
  if (op.op === 'patch') {
    return {
      url: `${root}/rest/v1/${op.table}?${op.query}`,
      method: 'PATCH',
      headers: authHeaders({ 'Content-Type': 'application/json', Prefer: 'return=minimal' }),
      body: op.row
    };
  }
  if (op.op === 'delete') {
    return {
      url: `${root}/rest/v1/${op.table}?${op.query}`,
      method: 'DELETE',
      headers: authHeaders({ Prefer: 'return=minimal' })
    };
  }
  if (op.op === 'rpc') {
    return {
      url: `${root}/rest/v1/rpc/${op.name}`,
      method: 'POST',
      headers: authHeaders({ 'Content-Type': 'application/json', Accept: 'application/json' }),
      body: op.args
    };
  }
  if (op.op === 'upload') {
    return {
      url: `${root}/storage/v1/object/${BUCKET}/${encodeURIComponent(op.name)}`,
      method: 'POST',
      headers: authHeaders({ 'Content-Type': op.contentType || 'application/octet-stream', 'x-upsert': 'true' }),
      bodyBase64: Buffer.from(op.bytes).toString('base64')
    };
  }
  if (op.op === 'sign') {
    return {
      url: `${root}/storage/v1/object/sign/${BUCKET}/${encodeURIComponent(op.name)}`,
      method: 'POST',
      headers: authHeaders({ 'Content-Type': 'application/json', Accept: 'application/json' }),
      body: { expiresIn: op.expiresIn }
    };
  }
  throw new Error(`Unknown Supabase operation ${op.op}`);
}

function decodeHttp(op, response) {
  if (!response || response.error) throw new Error(response?.error || 'Supabase request failed.');
  if (response.status >= 400) {
    const detail = typeof response.json === 'string' ? response.json : JSON.stringify(response.json || {});
    throw new Error(`Supabase ${op.op} failed (${response.status}): ${detail}`);
  }
  if (op.op === 'getDocument') {
    const rows = Array.isArray(response.json) ? response.json : [];
    return rows[0] ? rows[0].body : null;
  }
  if (op.op === 'select') {
    const rows = Array.isArray(response.json) ? response.json : [];
    return op.single ? (rows[0] || null) : rows;
  }
  if (op.op === 'rpc') return response.json;
  if (op.op === 'sign') {
    const signed = response.json?.signedURL || response.json?.signedUrl || '';
    if (!signed) throw new Error('Supabase did not return a signed upload URL.');
    if (signed.startsWith('http')) return signed;
    return `${projectUrl()}/storage/v1${signed}`;
  }
  return response.json;
}

function http(op) {
  const request = buildHttp(op);
  const child = spawnSync(process.execPath, [path.join(__dirname, 'supabaseFetch.js')], {
    input: JSON.stringify(request),
    encoding: 'utf8',
    timeout: 20000
  });
  if (child.error) throw child.error;
  const stdout = String(child.stdout || '').trim();
  let parsed = null;
  try { parsed = stdout ? JSON.parse(stdout) : null; } catch { parsed = null; }
  if (!parsed) throw new Error(String(child.stderr || 'Supabase helper returned nothing.').slice(0, 300));
  return decodeHttp(op, parsed);
}

function execute(op) {
  if (transport) return decodeHttp(op, transport(op));
  return http(op);
}

function getDocument(key) {
  return execute({ op: 'getDocument', key });
}

function putDocument(key, body) {
  execute({ op: 'putDocument', key, body });
}

function selectOne(table, query) {
  return execute({ op: 'select', table, query, single: true });
}

function upsert(table, row, onConflict) {
  execute({ op: 'upsert', table, row, onConflict });
}

function patch(table, query, row) {
  execute({ op: 'patch', table, query, row });
}

function remove(table, query) {
  execute({ op: 'delete', table, query });
}

function saveSession(row) {
  upsert('sessions', row, 'token_hash');
}

function getSession(tokenHash) {
  return selectOne('sessions', `token_hash=eq.${encodeURIComponent(tokenHash)}&select=*`);
}

function touchSession(tokenHash, ip) {
  patch('sessions', `token_hash=eq.${encodeURIComponent(tokenHash)}`, {
    last_seen: new Date().toISOString(),
    ip: ip || null
  });
}

function revokeSessions(email) {
  patch('sessions', `email=eq.${encodeURIComponent(String(email || '').toLowerCase())}`, { revoked: true });
}

function saveOtp(otpKey, codeHash, expiresAt) {
  upsert('otps', { otp_key: otpKey, code_hash: codeHash, expires_at: new Date(expiresAt).toISOString() }, 'otp_key');
}

function getOtp(otpKey) {
  return selectOne('otps', `otp_key=eq.${encodeURIComponent(otpKey)}&select=*`);
}

function deleteOtp(otpKey) {
  remove('otps', `otp_key=eq.${encodeURIComponent(otpKey)}`);
}

function deleteExpiredOtps() {
  remove('otps', `expires_at=lt.${encodeURIComponent(new Date().toISOString())}`);
}

function saveInvite(row) {
  upsert('invites', row, 'token_hash');
}

function getInvite(tokenHash) {
  return selectOne('invites', `token_hash=eq.${encodeURIComponent(tokenHash)}&select=*`);
}

function markInviteUsed(tokenHash) {
  patch('invites', `token_hash=eq.${encodeURIComponent(tokenHash)}`, { used: true });
}

function deleteExpiredInvites() {
  remove('invites', `expires_at=lt.${encodeURIComponent(new Date().toISOString())}&used=eq.false`);
}

function bumpRateLimit(bucket, windowSeconds) {
  const hits = execute({ op: 'rpc', name: 'bump_rate_limit', args: { p_bucket: bucket, p_window_seconds: windowSeconds } });
  return Number(hits);
}

function saveUploadLink(row) {
  upsert('upload_links', row, 'jti');
}

function getUploadLink(jti) {
  return selectOne('upload_links', `jti=eq.${encodeURIComponent(jti)}&select=*`);
}

function uploadObject(name, bytes, contentType) {
  const buffer = Buffer.isBuffer(bytes) ? bytes : Buffer.from(bytes);
  execute({ op: 'upload', name, bytes: buffer, contentType });
}

function createSignedUrl(name, expiresIn = 60) {
  return execute({ op: 'sign', name, expiresIn });
}

module.exports = {
  BUCKET,
  enabled,
  setTransport,
  buildHttp,
  getDocument,
  putDocument,
  saveSession,
  getSession,
  touchSession,
  revokeSessions,
  saveOtp,
  getOtp,
  deleteOtp,
  deleteExpiredOtps,
  saveInvite,
  getInvite,
  markInviteUsed,
  deleteExpiredInvites,
  bumpRateLimit,
  saveUploadLink,
  getUploadLink,
  uploadObject,
  createSignedUrl
};
