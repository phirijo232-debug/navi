const os = require('os');
const { logError } = require('../middleware/logger');

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

  const status = {
    server: 'Navi Server',
    status: 'running',
    uptime: `${hours}h ${minutes}m ${seconds}s`,
    cpu: {
      model: os.cpus()[0].model,
      cores: os.cpus().length
    },
    ram: {
      total: `${Math.round(os.totalmem() / 1024 / 1024)}MB`,
      free: `${Math.round(os.freemem() / 1024 / 1024)}MB`,
      used: `${Math.round((os.totalmem() - os.freemem()) / 1024 / 1024)}MB`
    },
    platform: os.platform(),
    hostname: os.hostname()
  };

  res.json(status);
});

module.exports = { getStatus };