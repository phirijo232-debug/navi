const fs = require('fs');
const path = require('path');
const config = require('../config');
const { logError, logBreakage, logHr } = require('../middleware/logger');
const dataStore = require('../middleware/dataStore');
const { isAdminRole } = require('../middleware/storeScope');

// ─── Backup / restore ────────────────────────────────────────────────────────
// A backup is one timestamped JSON file under data/backups/ holding every core
// data file. Listing needs an admin session; restore additionally demands the
// MASTER_KEY because it overwrites live data. Restore goes through
// dataStore.writeJson (atomic + refreshes .bak) and finishes with
// ensureDataIntegrity() so the restored store is verified immediately.

const BACKUPS_DIR = path.join(dataStore.DATA_DIR, 'backups');
const BACKUP_FILES = [
  'users.json',
  'loans.json',
  'feedback.json',
  'notifications.json',
  'dailyReportState.json',
  'invites.json'
];
const BACKUP_ID_PATTERN = /^backup-\d{8}-\d{6}(-\d+)?$/;
const BACKUP_NAME_PATTERN = /^backup-\d{8}-\d{6}(-\d+)?\.json$/;

function ensureBackupDir() {
  fs.mkdirSync(BACKUPS_DIR, { recursive: true });
}

function readBackupFile(name) {
  try {
    const raw = fs.readFileSync(path.join(dataStore.DATA_DIR, name), 'utf8');
    return raw.trim() ? JSON.parse(raw) : null;
  } catch {
    return null; // missing or unreadable file — skip it, never block a snapshot
  }
}

function createBackup(req, res) {
  try {
    if (!isAdminRole(req.authUser?.role)) {
      return res.status(403).json({ error: 'Admin access required.' });
    }

    ensureBackupDir();
    const now = new Date();
    const stamp = now.toISOString().replace(/[-:]/g, '').replace(/\..+/, '').replace('T', '-');

    let id = `backup-${stamp}`;
    for (let counter = 1; fs.existsSync(path.join(BACKUPS_DIR, `${id}.json`)); counter++) {
      id = `backup-${stamp}-${counter}`;
    }

    const files = {};
    const included = [];
    for (const name of BACKUP_FILES) {
      const content = readBackupFile(name);
      if (content !== null) {
        files[name] = content;
        included.push(name);
      }
    }
    if (!included.length) {
      return res.status(503).json({ error: 'No data files are available to back up yet.' });
    }

    const snapshot = {
      id,
      createdAt: now.toISOString(),
      createdBy: req.authUser?.email || req.authUser?.username || 'unknown',
      files
    };

    const target = path.join(BACKUPS_DIR, `${id}.json`);
    const tmp = `${target}.${process.pid}.tmp`;
    try {
      fs.writeFileSync(tmp, JSON.stringify(snapshot, null, 2));
      fs.renameSync(tmp, target);
    } catch (err) {
      try { fs.rmSync(tmp, { force: true }); } catch { /* best effort */ }
      throw err;
    }

    logHr(`BACKUP CREATED ${id} files=${included.join(',')}`, req.authUser);
    return res.json({
      message: 'Backup created.',
      backup: { id, createdAt: snapshot.createdAt, files: included }
    });
  } catch (err) {
    logBreakage('backupController.js', 'createBackup', err, 'BACKUP CIRCUIT TRIPPED');
    return res.status(503).json({ error: 'Backup is temporarily unavailable. Please try again shortly.' });
  }
}

function listBackups(req, res) {
  try {
    if (!isAdminRole(req.authUser?.role)) {
      return res.status(403).json({ error: 'Admin access required.' });
    }

    ensureBackupDir();
    const backups = fs.readdirSync(BACKUPS_DIR)
      .filter((name) => BACKUP_NAME_PATTERN.test(name))
      .map((name) => {
        const stat = fs.statSync(path.join(BACKUPS_DIR, name));
        return {
          id: name.replace(/\.json$/, ''),
          sizeBytes: stat.size,
          createdAt: new Date(stat.mtimeMs).toISOString()
        };
      })
      .sort((a, b) => String(b.createdAt).localeCompare(String(a.createdAt)));

    return res.json({ backups });
  } catch (err) {
    logError(`BACKUP LIST FAILED: ${err.message}`);
    return res.status(500).json({ error: 'Unable to list backups.' });
  }
}

function restoreBackup(req, res) {
  try {
    if (!isAdminRole(req.authUser?.role)) {
      return res.status(403).json({ error: 'Admin access required.' });
    }

    const { id, key } = req.body || {};
    const masterKey = process.env.MASTER_KEY || config.SHUTDOWN_KEY;
    if (!key || key !== masterKey) {
      logError(`RESTORE REFUSED — invalid master key attempt by ${req.authUser?.email || 'unknown'}`);
      return res.status(401).json({ error: 'Invalid master key.' });
    }

    if (!BACKUP_ID_PATTERN.test(String(id || ''))) {
      return res.status(400).json({ error: 'Invalid backup id.' });
    }

    let snapshot;
    try {
      snapshot = JSON.parse(fs.readFileSync(path.join(BACKUPS_DIR, `${id}.json`), 'utf8'));
    } catch {
      return res.status(400).json({ error: 'Backup file not found or corrupted.' });
    }
    if (!snapshot || typeof snapshot !== 'object' || !snapshot.files || typeof snapshot.files !== 'object') {
      return res.status(400).json({ error: 'Backup file has an unexpected format.' });
    }

    const restored = [];
    for (const name of BACKUP_FILES) {
      if (Object.prototype.hasOwnProperty.call(snapshot.files, name)) {
        dataStore.writeJson(path.join(dataStore.DATA_DIR, name), snapshot.files[name]);
        restored.push(name);
      }
    }
    if (!restored.length) {
      return res.status(400).json({ error: 'Backup contains no recognisable data files.' });
    }

    const repairs = dataStore.ensureDataIntegrity();
    logHr(`BACKUP RESTORED ${id} files=${restored.join(',')}`, req.authUser);
    return res.json({ message: 'Backup restored.', restored, repairs });
  } catch (err) {
    logBreakage('backupController.js', 'restoreBackup', err, 'RESTORE CIRCUIT TRIPPED');
    return res.status(503).json({ error: 'Restore is temporarily unavailable. Please try again shortly.' });
  }
}

module.exports = { createBackup, listBackups, restoreBackup };
