const config = require('../config');

// Public share-link helpers (Option A — keyed public links).
// PUBLIC_URL + SHARE_PUBLIC_KEY come ONLY from process.env (never hardcoded).
// The key is a FIRST door on HTML page loads. It never replaces login,
// invite tokens, OTP, or x-device-token auth on APIs.

function getPublicBaseUrl(req) {
  const override = String(process.env.PUBLIC_URL || process.env.APP_URL || config.PUBLIC_URL || '').trim().replace(/\/+$/, '');
  if (override) return override;
  try {
    const host = req && typeof req.get === 'function'
      ? req.get('host')
      : (req && req.headers && (req.headers['x-forwarded-host'] || req.headers.host));
    if (host) {
      const proto = (req && req.protocol)
        || (req && req.headers && String(req.headers['x-forwarded-proto'] || '').split(',')[0].trim())
        || 'http';
      return `${String(proto).split(',')[0].trim()}://${String(host).trim()}`;
    }
  } catch { /* fall through */ }
  return '';
}

function getShareKey() {
  return String(process.env.SHARE_PUBLIC_KEY || config.SHARE_PUBLIC_KEY || '').trim();
}

function appendShareKey(url) {
  const key = getShareKey();
  if (!key || !url) return url;
  try {
    if (url.startsWith('/')) {
      const sep = url.includes('?') ? '&' : '?';
      return `${url}${sep}key=${encodeURIComponent(key)}`;
    }
    const base = getPublicBaseUrl(null);
    if (base && url.startsWith(base)) {
      const sep = url.includes('?') ? '&' : '?';
      return `${url}${sep}key=${encodeURIComponent(key)}`;
    }
  } catch { /* return original */ }
  return url;
}

// Gate HTML page loads behind ?key= when SHARE_PUBLIC_KEY is set.
// Only /signup.html and /signup are gated — the public invite/signup entry
// page. Login, admin, dashboard and customer pages stay open (auth is
// enforced via x-device-token on the APIs behind them). APIs, assets,
// health checks and invite validation are never gated here.
function shareKeyGate(req, res, next) {
  try {
    const key = getShareKey();
    if (!key) return next();
    const path = String(req.path || '');
    // Only gate the public signup entry page; everything else is open
    // (login page is unauthenticated by design — login form itself does auth).
    if (path !== '/signup.html' && path !== '/signup') return next();
    const supplied = String((req.query && req.query.key) || '');
    if (supplied === key) return next();
    return res.status(403).send('Access denied. A valid share key (?key=) is required to open this page.');
  } catch (err) {
    return next();
  }
}

module.exports = { getPublicBaseUrl, getShareKey, appendShareKey, shareKeyGate };
