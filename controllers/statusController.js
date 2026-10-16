const os = require('os');
const { logError } = require('../middleware/logger');
const { findUserByDeviceToken, getServerMode } = require('../middleware/security');
const { isAdminRole } = require('../middleware/storeScope');
const dataStore = require('../middleware/dataStore');
const { heartbeatInfo } = require('../middleware/healthWatch');

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

const getStatus = circuitBreaker('getStatus', async (req, res) => {
  const uptime = process.uptime();
  const hours = Math.floor(uptime / 3600);
  const minutes = Math.floor((uptime % 3600) / 60);
  const seconds = Math.floor(uptime % 60);

  // /status is public, so keep operational capacity and configuration in the
  // authenticated admin tier only. Anonymous callers need just liveness.
  const status = {
    server: 'Navi Server',
    status: 'running',
    uptime: `${hours}h ${minutes}m ${seconds}s`
  };

  const token = req.headers && req.headers['x-device-token'];
  const user = token ? findUserByDeviceToken(token) : null;
  if (user && isAdminRole(user.role)) {
    status.serverMode = typeof getServerMode === 'function' ? getServerMode() : 'private';
    status.cpu = { cores: os.cpus().length };
    status.ram = {
      total: `${Math.round(os.totalmem() / 1024 / 1024)}MB`,
      free: `${Math.round(os.freemem() / 1024 / 1024)}MB`,
      used: `${Math.round((os.totalmem() - os.freemem()) / 1024 / 1024)}MB`
    };
  }

  res.json(status);
});

// ─── IMMUNE: GET /health ─────────────────────────────────────────────────────
// Public tier (no token): {status, uptime} only — safe for uptime monitors.
// Admin tier (valid admin device token): adds memory, db mode/health and the
// heartbeat age. The token is resolved in-handler because /health lives in
// PUBLIC_PATHS (deviceAuth skips it), so req.authUser is never populated here.
const getHealth = circuitBreaker('getHealth', async (req, res) => {
  const base = {
    status: 'ok',
    uptime: `${Math.round(process.uptime())}s`
  };

  const token = req.headers['x-device-token'];
  const user = token ? findUserByDeviceToken(token) : null;
  if (!user || !isAdminRole(user.role)) {
    return res.json(base);
  }

  const dbHealth = dataStore.db.isHealthy();
  res.json({
    ...base,
    serverMode: typeof getServerMode === 'function' ? getServerMode() : 'private',
    memory: {
      usedMB: Math.round((process.memoryUsage().rss) / 1024 / 1024),
      heapUsedMB: Math.round(process.memoryUsage().heapUsed / 1024 / 1024)
    },
    db: {
      mode: dataStore.db.getMode(),
      // Boolean (or null when in json mode) — never the file path.
      healthy: dbHealth,
      documents: dataStore.db.stats()?.documents ?? null
    },
    heartbeat: heartbeatInfo(),
    pid: process.pid
  });
});

module.exports = { getStatus, getHealth };
