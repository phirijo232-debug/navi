// ─── IMMUNE SYSTEM — heartbeat + silence/crash alerting ──────────────────────
// Writes data/health.json every HEARTBEAT_INTERVAL_MS. Two failure modes are
// covered:
//   1. SILENCE (event-loop stall): a watchdog timer in THIS process notices the
//      heartbeat is stale by >2x interval and alerts the admin inbox.
//   2. CRASH / hard kill: the process cannot email while dead — instead, on the
//      NEXT boot we compare the last recorded beat to now; a gap far longer
//      than one interval means the server was down, and we alert the outage
//      window on startup (same pending-alert fallback if SMTP is down).
// All alerts route through logBreakage → admin inbox with the 15-min flood
// protection. No user data ever appears in these messages.

const fs = require('fs');
const path = require('path');
const { logError, logBreakage } = require('./logger');
const dataStore = require('./dataStore');

const HEARTBEAT_FILE = path.join(dataStore.DATA_DIR, 'health.json');
const HEARTBEAT_INTERVAL_MS = 60 * 1000;
// A beat is "stale" after 2 missed intervals; outage detection on boot uses a
// more generous 5 minutes so ordinary restarts don't fire false alerts.
const STALE_MS = 2 * HEARTBEAT_INTERVAL_MS;
const OUTAGE_MIN_MS = 5 * 60 * 1000;

let beatTimer = null;
let watchdogTimer = null;
let lastBeatAt = 0;

function writeBeat() {
  try {
    lastBeatAt = Date.now();
    const payload = {
      pid: process.pid,
      beatAt: new Date(lastBeatAt).toISOString(),
      uptimeSeconds: Math.round(process.uptime())
    };
    // Direct write (atomic-enough for a diagnostic file) — keeps health.json
    // out of the readJson recovery path so a torn write can never trigger
    // data-repair machinery on a non-critical file.
    const tmp = `${HEARTBEAT_FILE}.${process.pid}.tmp`;
    fs.writeFileSync(tmp, JSON.stringify(payload));
    fs.renameSync(tmp, HEARTBEAT_FILE);
  } catch (err) {
    try { logError(`HEARTBEAT WRITE FAILED: ${err.message}`); } catch { /* best effort */ }
  }
}

function readBeat() {
  try {
    if (!fs.existsSync(HEARTBEAT_FILE)) return null;
    const beat = JSON.parse(fs.readFileSync(HEARTBEAT_FILE, 'utf8'));
    const t = Date.parse(beat?.beatAt || '');
    return Number.isFinite(t) ? { ...beat, ts: t } : null;
  } catch {
    return null;
  }
}

// Boot-time crash detector: a long silent gap between the previous process's
// last beat and now means the server was down (or hard-killed). Alerts once.
function detectOutageOnBoot() {
  try {
    const beat = readBeat();
    const now = Date.now();
    if (beat && now - beat.ts > OUTAGE_MIN_MS) {
      const downFrom = new Date(beat.ts).toISOString();
      const upAt = new Date(now).toISOString();
      const minutes = Math.round((now - beat.ts) / 60000);
      logBreakage(
        'healthWatch.js', 'detectOutageOnBoot',
        new Error(`server was offline from ${downFrom} to ${upAt} (~${minutes} min)`),
        'SERVER OUTAGE DETECTED'
      );
    }
  } catch {
    // Never block startup on heartbeat diagnostics.
  }
  writeBeat();
}

// In-process silence detector: if the watchdog itself fires late, the loop was
// stalled — report how long we missed.
function checkStale() {
  const staleFor = Date.now() - lastBeatAt;
  if (staleFor > STALE_MS) {
    logBreakage(
      'healthWatch.js', 'checkStale',
      new Error(`heartbeat silent for ${Math.round(staleFor / 1000)}s — event loop stalled`),
      'SERVER HEARTBEAT STALE'
    );
  }
  writeBeat();
}

function startHealthWatch() {
  if (beatTimer) return; // idempotent
  detectOutageOnBoot();
  beatTimer = setInterval(writeBeat, HEARTBEAT_INTERVAL_MS);
  watchdogTimer = setInterval(checkStale, HEARTBEAT_INTERVAL_MS);
  beatTimer.unref?.();
  watchdogTimer.unref?.();
}

function stopHealthWatch() {
  if (beatTimer) clearInterval(beatTimer);
  if (watchdogTimer) clearInterval(watchdogTimer);
  beatTimer = null;
  watchdogTimer = null;
}

// Detail payload for the admin tier of GET /health — counts/millis only.
function heartbeatInfo() {
  const beat = readBeat();
  if (!beat) return { present: false };
  return {
    present: true,
    beatAt: beat.beatAt,
    ageSeconds: Math.max(0, Math.round((Date.now() - beat.ts) / 1000))
  };
}

module.exports = { startHealthWatch, stopHealthWatch, heartbeatInfo, HEARTBEAT_INTERVAL_MS };
