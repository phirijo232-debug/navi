const fs = require('fs');
const path = require('path');
const emailService = require('./email');
const { logError } = require('./logger');
const dataStore = require('./dataStore');
const config = require('../config');
const { getReportData, buildDailyReportText } = require('../controllers/reportController');

const DEFAULT_TIME_ZONE = config.REPORTS.TIME_ZONE;
const DEFAULT_SEND_TIME = config.REPORTS.DAILY_SEND_TIME;
const REPORT_STATE_FILE = dataStore.paths.dailyReportState;

function readLastSentDate() {
  try {
    return JSON.parse(fs.readFileSync(REPORT_STATE_FILE, 'utf8')).lastSentDate || '';
  } catch (err) {
    if (err.code !== 'ENOENT') logError(`DAILY BMF REPORT STATE READ FAILED: ${err.message}`);
    return '';
  }
}

let scheduler = null;
let lastSentDate = readLastSentDate();
let lastAttemptDate = '';
let attemptsToday = 0;
let lastAttemptAt = 0;

function getLocalTimeParts(date = new Date()) {
  const parts = new Intl.DateTimeFormat('en-GB', {
    timeZone: DEFAULT_TIME_ZONE,
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
    hour: '2-digit',
    minute: '2-digit',
    hourCycle: 'h23'
  }).formatToParts(date);
  return Object.fromEntries(parts.filter(part => part.type !== 'literal').map(part => [part.type, part.value]));
}

async function sendDailyBmfReport(date = new Date()) {
  const recipient = config.REPORTS.DAILY_ADMIN_EMAIL;
  if (!recipient) {
    logError('DAILY BMF REPORT SKIPPED: no report recipient configured.');
    return { ok: false, reason: 'No report recipient configured.' };
  }

  const report = getReportData('buraza');
  const result = await emailService.sendCustomerEmail({
    to: recipient,
    subject: `Daily BMF portfolio report - ${date.toISOString().slice(0, 10)}`,
    text: buildDailyReportText(report)
  });
  if (!result?.ok) {
    logError(`DAILY BMF REPORT FAILED: ${result?.reason || 'Email delivery failed.'}`);
    return { ok: false, reason: result?.reason || 'Email delivery failed.' };
  }
  return { ok: true, recipient };
}

async function checkDailyReportSchedule(now = new Date(), sendReport = sendDailyBmfReport) {
  const parts = getLocalTimeParts(now);
  const localDate = `${parts.year}-${parts.month}-${parts.day}`;
  const currentTime = `${parts.hour}:${parts.minute}`;
  if (currentTime < DEFAULT_SEND_TIME || lastSentDate === localDate) return false;

  if (lastAttemptDate !== localDate) {
    lastAttemptDate = localDate;
    attemptsToday = 0;
  }
  if (attemptsToday >= 3 || Date.now() - lastAttemptAt < 10 * 60 * 1000) return false;

  attemptsToday += 1;
  lastAttemptAt = Date.now();
  const result = await sendReport(now);
  if (result.ok) {
    lastSentDate = localDate;
    try {
      dataStore.writeJson(REPORT_STATE_FILE, { lastSentDate });
    } catch (err) {
      logError(`DAILY BMF REPORT STATE WRITE FAILED: ${err.message}`);
    }
  }
  return result.ok;
}

function startDailyReportScheduler() {
  if (scheduler) return scheduler;
  scheduler = setInterval(() => {
    checkDailyReportSchedule().catch(err => logError(`DAILY BMF REPORT SCHEDULER FAILED: ${err.message}`));
  }, 60 * 1000);
  scheduler.unref?.();
  checkDailyReportSchedule().catch(err => logError(`DAILY BMF REPORT SCHEDULER FAILED: ${err.message}`));
  return scheduler;
}

module.exports = { sendDailyBmfReport, checkDailyReportSchedule, startDailyReportScheduler };
