'use strict';

// PRYME LOG license client. The browser never calls PRYME LOG and never sees
// the license secret. Sign the exact JSON string that is posted — do not parse
// it and stringify it again before the HMAC.
const crypto = require('crypto');
const fs = require('fs');
const path = require('path');
const dataStore = require('./dataStore');
const { logError } = require('./logger');

const DEFAULT_VALIDATE_URL = 'https://pryme-log.vercel.app/api/license/validate';
const FALLBACK_NAME = 'PRYME LOAN';
const FOOTER = 'Powered by PRYME LOAN';
const EXPIRED_MESSAGE = 'Your license has expired. Contact us on +260777251160 to make payment.';
const SEATS_FULL_MESSAGE = 'All licensed computers are in use. Contact us on +260777251160 to add more.';
const CREDENTIAL_TTL_MS = 60 * 1000;
const SESSION_BURST_MS = 5 * 60 * 1000;
const SESSION_RECHECK_MS = 6 * 60 * 60 * 1000;
const GRACE_MS = 72 * 60 * 60 * 1000;
const LOGO_MAX_BYTES = 400000;
const INSTALL_ID_PATTERN = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/;

function signBody(rawBody, secret) {
  return crypto.createHmac('sha256', String(secret)).update(String(rawBody)).digest('hex');
}

function buildPayload({ licenseId, installId, deviceLabel, ts, nonce }) {
  const body = {
    license_id: licenseId,
    install_id: installId,
    ts,
    nonce
  };
  if (deviceLabel) {
    return JSON.stringify({
      license_id: licenseId,
      install_id: installId,
      device_label: deviceLabel,
      ts,
      nonce
    });
  }
  return JSON.stringify(body);
}

function runningAsTest() {
  if (process.env.NODE_TEST_CONTEXT) return true;
  if (process.argv.some(arg => String(arg).includes('mocha'))) return true;
  const main = typeof require.main !== 'undefined' && require.main && require.main.filename;
  return Boolean(main && main.split(/[\\/]/).slice(0, -1).includes('test'));
}

function cleanName(value) {
  const name = String(value || '').replace(/[\u0000-\u001f]/g, ' ').replace(/\s+/g, ' ').trim();
  return name.slice(0, 80);
}

function httpsUrl(value) {
  try {
    const parsed = new URL(String(value || '').trim());
    if (parsed.protocol !== 'https:') return '';
    return parsed.toString().slice(0, 500);
  } catch {
    return '';
  }
}

function sanitizeCompany(company) {
  if (!company || typeof company !== 'object') return null;
  const name = cleanName(company.name);
  const logoUrl = httpsUrl(company.logo_url || company.logoUrl);
  const contactIn = company.contact && typeof company.contact === 'object' ? company.contact : {};
  const contact = {
    name: cleanName(contactIn.name),
    email: String(contactIn.email || '').trim().slice(0, 120),
    phone: String(contactIn.phone || '').trim().slice(0, 40)
  };
  if (!name && !logoUrl) return null;
  return { name, logo_url: logoUrl, contact };
}

function displayMessage(payload) {
  const code = String(payload && payload.code || '').trim().toUpperCase();
  if (code === 'EXPIRED') return EXPIRED_MESSAGE;
  if (code === 'SEATS_FULL') return SEATS_FULL_MESSAGE;
  const message = String(payload && payload.message || '').replace(/\s+/g, ' ').trim();
  if (message) return message.slice(0, 300);
  return 'This installation is not licensed.';
}

function configMessage(config) {
  const parts = [];
  if (config.missing.length) {
    parts.push(`Set ${config.missing.join(' and ')} on the server.`);
  }
  if (config.urlError) parts.push(config.urlError);
  return `License validation is not configured. ${parts.join(' ')}`.trim();
}

function emptyState() {
  return { version: 1, installs: {}, company: null, logoFile: null };
}

function defaultStore() {
  const file = path.join(dataStore.DATA_DIR, 'licenseState.json');
  return {
    read() {
      const value = dataStore.readJson(file, emptyState(), (entry) => entry && typeof entry === 'object' && !Array.isArray(entry));
      return value && typeof value === 'object' ? value : emptyState();
    },
    write(state) {
      dataStore.writeJson(file, state);
    }
  };
}

function readConfig(env) {
  const licenseId = String(env.PRYMELOG_LICENSE_ID || '').trim();
  const secret = String(env.PRYMELOG_LICENSE_SECRET || '').trim();
  const rawUrl = String(env.PRYMELOG_VALIDATE_URL || '').trim();
  const url = rawUrl || DEFAULT_VALIDATE_URL;
  const missing = [];
  if (!licenseId) missing.push('PRYMELOG_LICENSE_ID');
  if (!secret) missing.push('PRYMELOG_LICENSE_SECRET');
  let urlError = '';
  try {
    const parsed = new URL(url);
    if (parsed.protocol !== 'https:') urlError = 'PRYMELOG_VALIDATE_URL must use https.';
  } catch {
    urlError = 'PRYMELOG_VALIDATE_URL is not a valid URL.';
  }
  return { licenseId, secret, url, missing, urlError };
}

function readInstallId(req) {
  const header = req && req.headers ? req.headers['x-install-id'] : '';
  const body = req && req.body ? req.body : {};
  const value = String(header || body.installId || body.install_id || '').trim().toLowerCase();
  return INSTALL_ID_PATTERN.test(value) ? value : '';
}

function readDeviceLabel(req) {
  const header = req && req.headers ? req.headers['x-device-label'] : '';
  const body = req && req.body ? req.body : {};
  return String(header || body.deviceLabel || body.device_label || '')
    .replace(/[^\x20-\x7E]/g, '')
    .trim()
    .slice(0, 80);
}

function withinGrace(row, nowMs) {
  if (!row || !Number.isFinite(Number(row.lastSuccessAt))) return false;
  if (Number.isFinite(Number(row.lastDeniedAt)) && Number(row.lastDeniedAt) > Number(row.lastSuccessAt)) return false;
  return nowMs - Number(row.lastSuccessAt) <= GRACE_MS;
}

function decisionFromRow(row, extra) {
  const company = sanitizeCompany(row && row.company) || null;
  return {
    allowed: true,
    code: extra && extra.code ? extra.code : 'OK',
    message: null,
    warn: Boolean(row && row.warn),
    grace: Boolean(extra && extra.grace),
    daysLeft: row && Number.isFinite(Number(row.daysLeft)) ? Number(row.daysLeft) : null,
    company
  };
}

function createClient(deps = {}) {
  const env = deps.env || process.env;
  const fetchImpl = deps.fetchImpl || ((url, options) => fetch(url, options));
  const now = deps.now || Date.now;
  const store = deps.store || defaultStore();
  const cacheLogo = deps.cacheLogo === true;
  const memory = new Map();
  const inflight = new Map();

  function isEnforced() {
    if (deps.enforce === true) return true;
    if (deps.enforce === false) return false;
    if (String(env.PRYMELOG_LICENSE_ENFORCE || '') === '0') return false;
    if (runningAsTest() && String(env.PRYMELOG_LICENSE_ENFORCE || '') !== '1') return false;
    return true;
  }

  function readState() {
    try {
      const state = store.read() || emptyState();
      if (!state.installs || typeof state.installs !== 'object') state.installs = {};
      return state;
    } catch (err) {
      logError(`LICENSE STATE READ FAILED: ${err.message}`);
      return emptyState();
    }
  }

  function writeState(state) {
    store.write(state);
  }

  function cachedLogoFile() {
    try {
      const state = readState();
      const name = path.basename(String(state.logoFile || ''));
      if (name !== 'license-logo.png' && name !== 'license-logo.jpg') return null;
      const full = path.join(dataStore.DATA_DIR, name);
      if (!fs.existsSync(full) || fs.statSync(full).size <= 0) return null;
      return full;
    } catch {
      return null;
    }
  }

  function publicBranding() {
    try {
      const company = sanitizeCompany(readState().company) || null;
      return {
        name: company && company.name ? company.name : FALLBACK_NAME,
        logoUrl: cachedLogoFile() ? '/branding/logo' : null,
        footer: FOOTER,
        contact: company ? company.contact : null
      };
    } catch {
      return { name: FALLBACK_NAME, logoUrl: null, footer: FOOTER, contact: null };
    }
  }

  function headerName() {
    return publicBranding().name.toUpperCase();
  }

  function licenseStatus(installId) {
    const row = installId ? readState().installs[installId] : null;
    const branding = publicBranding();
    const denied = row && row.lastResult === 'denied';
    return {
      warn: Boolean(row && row.warn && !denied),
      grace: Boolean(row && row.lastResult === 'grace'),
      daysLeft: row && Number.isFinite(Number(row.daysLeft)) ? Number(row.daysLeft) : null,
      name: branding.name,
      footer: branding.footer
    };
  }

  function configurationError() {
    if (!isEnforced()) return null;
    const config = readConfig(env);
    if (!config.missing.length && !config.urlError) return null;
    return configMessage(config);
  }

  function remember(installId, decision) {
    memory.set(installId, { at: now(), decision });
    return decision;
  }

  function blocked(code, message) {
    return { allowed: false, code, message, warn: false, grace: false, daysLeft: null, company: null };
  }

  async function downloadLogo(logoUrl) {
    if (!cacheLogo || !logoUrl) return null;
    const response = await fetchImpl(logoUrl, { method: 'GET', signal: AbortSignal.timeout(4000) });
    if (!response || !response.ok) return null;
    const bytes = Buffer.from(await response.arrayBuffer());
    if (!bytes.length || bytes.length > LOGO_MAX_BYTES) return null;
    const png = bytes[0] === 0x89 && bytes[1] === 0x50 && bytes[2] === 0x4e && bytes[3] === 0x47;
    const jpeg = bytes[0] === 0xff && bytes[1] === 0xd8 && bytes[2] === 0xff;
    if (!png && !jpeg) return null;
    const name = png ? 'license-logo.png' : 'license-logo.jpg';
    fs.writeFileSync(path.join(dataStore.DATA_DIR, name), bytes);
    const other = png ? 'license-logo.jpg' : 'license-logo.png';
    try { fs.rmSync(path.join(dataStore.DATA_DIR, other), { force: true }); } catch { /* best effort */ }
    return name;
  }

  async function callValidate(installId, deviceLabel) {
    const config = readConfig(env);
    const rawBody = buildPayload({
      licenseId: config.licenseId,
      installId,
      deviceLabel,
      ts: now(),
      nonce: crypto.randomBytes(16).toString('hex')
    });
    const signature = signBody(rawBody, config.secret);
    let response;
    try {
      response = await fetchImpl(config.url, {
        method: 'POST',
        headers: {
          'content-type': 'application/json',
          'x-signature': signature
        },
        body: rawBody,
        signal: AbortSignal.timeout(8000)
      });
    } catch (err) {
      return { outcome: 'unreachable', error: err };
    }
    let payload = null;
    try {
      const text = await response.text();
      payload = text ? JSON.parse(text) : null;
    } catch {
      payload = null;
    }
    const status = Number(response && response.status);
    if (!response || !response.ok || !payload || typeof payload.ok !== 'boolean') {
      if (payload && payload.ok === false && status >= 400 && status < 500 && status !== 429) {
        return { outcome: 'denied', payload };
      }
      return { outcome: 'unreachable', error: new Error(`License server HTTP ${status || 'error'}`) };
    }
    if (payload.ok === false) return { outcome: 'denied', payload };
    return { outcome: 'ok', payload };
  }

  function applyUnreachable(installId) {
    const state = readState();
    const row = state.installs[installId] || null;
    const at = now();
    if (withinGrace(row, at)) {
      state.installs[installId] = {
        ...(row || {}),
        lastResult: 'grace',
        lastAttemptAt: at,
        warn: true
      };
      writeState(state);
      return remember(installId, decisionFromRow(state.installs[installId], { grace: true, code: 'GRACE' }));
    }
    state.installs[installId] = {
      ...(row || {}),
      lastResult: 'unreachable',
      lastAttemptAt: at
    };
    writeState(state);
    return remember(installId, blocked(
      'UNREACHABLE',
      'The license server could not be reached. Contact us on +260777251160.'
    ));
  }

  function applyDenied(installId, payload) {
    const state = readState();
    const row = state.installs[installId] || {};
    const at = now();
    state.installs[installId] = {
      ...row,
      lastResult: 'denied',
      lastAttemptAt: at,
      lastDeniedAt: at,
      code: String(payload.code || 'UNKNOWN').toUpperCase(),
      message: displayMessage(payload),
      warn: false
    };
    writeState(state);
    return remember(installId, blocked(state.installs[installId].code, state.installs[installId].message));
  }

  async function applyOk(installId, payload) {
    const company = sanitizeCompany(payload.company);
    let logoFile = readState().logoFile || null;
    if (company && company.logo_url) {
      try {
        const saved = await downloadLogo(company.logo_url);
        if (saved) logoFile = saved;
      } catch (err) {
        logError(`LICENSE LOGO DOWNLOAD FAILED: ${err.message}`);
      }
    }
    const state = readState();
    const at = now();
    const daysLeft = Number.isFinite(Number(payload.days_left)) ? Number(payload.days_left) : null;
    state.installs[installId] = {
      ...(state.installs[installId] || {}),
      lastResult: 'ok',
      lastAttemptAt: at,
      lastSuccessAt: at,
      lastDeniedAt: null,
      code: 'OK',
      message: null,
      warn: Boolean(payload.warn),
      daysLeft,
      expiresAt: payload.expires_at || null,
      company: company || state.company || null
    };
    if (company) state.company = company;
    if (logoFile) state.logoFile = logoFile;
    writeState(state);
    return remember(installId, decisionFromRow(state.installs[installId]));
  }

  async function refresh(installId, deviceLabel) {
    if (inflight.has(installId)) return inflight.get(installId);
    const pending = (async () => {
      const result = await callValidate(installId, deviceLabel);
      if (result.outcome === 'unreachable') return applyUnreachable(installId);
      if (result.outcome === 'denied') return applyDenied(installId, result.payload || {});
      return applyOk(installId, result.payload || {});
    })().finally(() => inflight.delete(installId));
    inflight.set(installId, pending);
    return pending;
  }

  async function gate(kind, installId, deviceLabel) {
    if (!isEnforced()) return { allowed: true, skipped: true };
    const config = readConfig(env);
    if (config.missing.length || config.urlError) {
      const message = configMessage(config);
      logError(`LICENSE NOT CONFIGURED: ${message}`);
      return blocked('NOT_CONFIGURED', message);
    }
    if (!installId) {
      return blocked('INSTALL_ID', 'This computer could not be identified. Refresh the page and try again.');
    }
    const at = now();
    const cached = memory.get(installId);
    const ttl = kind === 'credential' ? CREDENTIAL_TTL_MS : SESSION_BURST_MS;
    if (cached && at - cached.at < ttl) return cached.decision;

    if (kind === 'session') {
      const row = readState().installs[installId];
      if (row && row.lastResult === 'ok' && Number.isFinite(Number(row.lastSuccessAt)) && at - Number(row.lastSuccessAt) < SESSION_RECHECK_MS) {
        return remember(installId, decisionFromRow(row));
      }
    }
    return refresh(installId, deviceLabel);
  }

  return {
    signBody,
    buildPayload,
    enforcementEnabled: isEnforced,
    configurationError,
    gateCredential(installId, deviceLabel) {
      return gate('credential', installId, deviceLabel);
    },
    gateSession(installId, deviceLabel) {
      return gate('session', installId, deviceLabel);
    },
    publicBranding,
    headerName,
    licenseStatus,
    cachedLogoFile,
    readInstallId,
    readDeviceLabel
  };
}

const client = createClient({ cacheLogo: true });

function createLicenseSession(activeClient) {
  return function licenseSession(req, res, next) {
    if (!req.authUser || !activeClient.enforcementEnabled()) return next();
    Promise.resolve(activeClient.gateSession(activeClient.readInstallId(req), activeClient.readDeviceLabel(req)))
      .then(decision => {
        if (res.headersSent) return undefined;
        if (!decision.allowed) {
          logError(`LICENSE BLOCKED: ${decision.code || 'UNKNOWN'}`);
          return res.status(403).json({ error: decision.message, code: decision.code, license: true });
        }
        req.license = decision;
        return next();
      })
      .catch(err => {
        logError(`LICENSE SESSION CIRCUIT TRIPPED: ${err.message}`);
        if (!res.headersSent) res.status(503).json({ error: 'License check is temporarily unavailable.' });
      });
  };
}

module.exports = {
  DEFAULT_VALIDATE_URL,
  FALLBACK_NAME,
  FOOTER,
  EXPIRED_MESSAGE,
  SEATS_FULL_MESSAGE,
  CREDENTIAL_TTL_MS,
  SESSION_BURST_MS,
  SESSION_RECHECK_MS,
  GRACE_MS,
  signBody,
  buildPayload,
  createClient,
  createLicenseSession,
  licenseSession: createLicenseSession(client),
  enforcementEnabled: client.enforcementEnabled,
  configurationError: client.configurationError,
  gateCredential: client.gateCredential,
  gateSession: client.gateSession,
  publicBranding: client.publicBranding,
  headerName: client.headerName,
  licenseStatus: client.licenseStatus,
  cachedLogoFile: client.cachedLogoFile,
  readInstallId,
  readDeviceLabel
};
