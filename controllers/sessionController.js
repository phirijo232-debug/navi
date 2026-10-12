const { logError } = require('../middleware/logger');
const { isAdminRole } = require('../middleware/storeScope');

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
  res.json({
    total: Object.keys(activeSessions).length,
    sessions: activeSessions
  });
});

module.exports = { trackSession, getActiveSessions };