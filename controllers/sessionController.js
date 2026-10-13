const { logError } = require('../middleware/logger');
const { isAdminRole } = require('../middleware/storeScope');
const { findUserByDeviceToken } = require('../middleware/security');

const activeSessions = {};
const failureTracker = {};

function circuitBreaker(name, fn) {
  return async function(req, res) {
    const now = Date.now();
    const tracker = failureTracker[name] || { count: 0, pausedUntil: 0 };

    if (tracker.pausedUntil > now) {
      const minutesLeft = Math.ceil((tracker.pausedUntil - now) / 60000);
      return res.status(503).json({ error: `${name} is paused. Try again in ${minutesLeft} minute(s).` });
    }

    try {
      await fn(req, res);
      failureTracker[name] = { count: 0, pausedUntil: 0 };
    } catch (err) {
      tracker.count = (tracker.count || 0) + 1;
      try {
        logError(`CIRCUIT TRIPPED [${name}]: ${err.message}`);
      } catch (logErr) {
        console.error(`CIRCUIT TRIPPED [${name}]: ${err.message}`);
      }
      if (tracker.count >= 5) {
        tracker.pausedUntil = now + 3 * 60 * 1000;
        tracker.count = 0;
        logError(`CIRCUIT PAUSED [${name}] for 3 minutes after 5 failures`);
      }
      failureTracker[name] = tracker;
      res.status(503).json({ error: `${name} is temporarily unavailable.` });
    }
  };
}

function trackSession(req, res, next) {
  try {
    const token = req.headers['x-device-token'];
    const ip = req.ip;
    if (token) {
      const sameIpEntries = Object.entries(activeSessions)
        .filter(([entryToken, session]) => entryToken !== token && session.ip === ip);

      sameIpEntries.forEach(([entryToken]) => delete activeSessions[entryToken]);

      activeSessions[token] = {
        ip,
        lastSeen: new Date().toISOString()
      };
    }
    next();
  } catch (err) {
    try {
      logError(`CIRCUIT TRIPPED [trackSession]: ${err.message}`);
    } catch (logErr) {
      console.error(`CIRCUIT TRIPPED [trackSession]: ${err.message}`);
    }
    next();
  }
}

const getActiveSessions = circuitBreaker('getActiveSessions', async (req, res) => {
  if (!isAdminRole(req.authUser?.role)) {
    return res.status(403).json({ error: 'Admin access required.' });
  }
  // ─── LEAK TIGHTENING ──────────────────────────────────────────────────────
  // Previously the map keys were the RAW device tokens of every user on the
  // server — any isAdminRole caller (incl. a store_admin) could harvest tokens
  // for accounts outside their store and hijack those sessions. Now:
  //   • token is masked (last 4 only) and used as an opaque id,
  //   • store_admin sees ONLY sessions of users in their own store,
  //   • franchise_admin/admin see all, resolved users show email + store,
  //   • unknown/trusted-tool tokens are visible to full admins only.
  const callerRole = req.authUser?.role;
  const callerStore = req.authUser?.storeId;
  const isFullAdmin = callerRole === 'admin' || callerRole === 'franchise_admin';

  const sessions = [];
  for (const [token, session] of Object.entries(activeSessions)) {
    const user = findUserByDeviceToken(token);
    const userStore = user?.storeId || null;
    const userRole = user?.role || null;

    // Store-scoped admins never see sessions outside their store; tokens that
    // don't resolve to any user are admin-only.
    if (!isFullAdmin) {
      if (!user || userStore !== callerStore) continue;
    }

    sessions.push({
      // Opaque id — only the last 4 characters survive; the full token is
      // never echoed back to any caller.
      id: `…${String(token).slice(-4)}`,
      email: user?.email || null,
      role: userRole,
      storeId: userStore,
      ip: session?.ip || null,
      lastSeen: session?.lastSeen || null
    });
  }

  res.json({
    total: sessions.length,
    sessions
  });
});

// ─── KIDNEYS: drop sessions idle longer than maxAgeMs (default 24h) ─────────
// Returns the number pruned — counts only, never token/IP material.
function pruneSessions(maxAgeMs = 24 * 60 * 60 * 1000, now = Date.now()) {
  let pruned = 0;
  for (const [token, session] of Object.entries(activeSessions)) {
    const lastSeen = Date.parse(session?.lastSeen || '');
    if (!Number.isFinite(lastSeen) || now - lastSeen > maxAgeMs) {
      delete activeSessions[token];
      pruned++;
    }
  }
  return pruned;
}

module.exports = { trackSession, getActiveSessions, pruneSessions };