/**
 * Startup Health Validation
 * Validates critical data files before the server accepts traffic.
 * Logs and emails the admin if any file is corrupt or missing.
 */
const fs = require('fs');
const path = require('path');
const { logError, logBreakage } = require('./logger');
const config = require('../config');

const CRITICAL_FILES = [
  { file: 'data/users.json', label: 'USERS' },
  { file: 'data/loans.json', label: 'LOANS' },
  { file: 'data/feedback.json', label: 'FEEDBACK' },
  { file: 'data/notifications.json', label: 'NOTIFICATIONS' },
];

function validateJsonFile(filePath, label) {
  try {
    if (!fs.existsSync(filePath)) {
      const msg = `${label}: File missing — ${filePath}`;
      logError(msg, true); // email admin
      return { ok: false, error: msg };
    }
    const raw = fs.readFileSync(filePath, 'utf8');
    if (!raw.trim()) {
      const msg = `${label}: File is empty — ${filePath}`;
      logError(msg, true);
      return { ok: false, error: msg };
    }
    JSON.parse(raw);
    return { ok: true };
  } catch (err) {
    const msg = `${label}: Invalid JSON — ${filePath} — ${err.message}`;
    logError(msg, true); // email admin
    return { ok: false, error: msg };
  }
}

/**
 * Run all validations. Returns array of problems found.
 * Call this before app.listen() in server.js.
 */
function validateStartup() {
  const problems = [];
  console.log('Running startup data validation...');
  CRITICAL_FILES.forEach(({ file, label }) => {
    const result = validateJsonFile(path.resolve(__dirname, '..', file), label);
    if (!result.ok) {
      problems.push(result.error);
      console.error(`VALIDATION FAIL: ${result.error}`);
    } else {
      console.log(`VALIDATION OK: ${label}`);
    }
  });
  return problems;
}

module.exports = { validateStartup };
