'use strict';

// Vercel calls these on a UTC clock. Lusaka is UTC+2 all year, so
// 00:05 Lusaka = 22:05 UTC, 08:00 Lusaka = 06:00 UTC, 23:58 Lusaka = 21:58 UTC.
const crypto = require('crypto');
const path = require('path');
const dataStore = require('../middleware/dataStore');
const { runKidneySweep } = require('../middleware/kidneys');
const { runDueDatePass } = require('../middleware/loanNotifications');
const { accrueAllGrace } = require('../controllers/loanController');
const {
  lusakaDate,
  sendDailyLoanReport,
  sendPaymentsTrackingEmail
} = require('../scheduler');

const express = require('express');
const router = express.Router();

function secretsMatch(presented, expected) {
  const left = Buffer.from(String(presented || ''));
  const right = Buffer.from(String(expected || ''));
  if (!right.length || left.length !== right.length) {
    if (right.length) crypto.timingSafeEqual(right, right);
    return false;
  }
  return crypto.timingSafeEqual(left, right);
}

function requireCron(req, res, next) {
  const expected = String(process.env.CRON_SECRET || '').trim();
  if (!expected) {
    return res.status(503).json({ error: 'CRON_SECRET is not set.' });
  }
  const header = req.get('x-cron-secret') || '';
  const bearer = String(req.get('authorization') || '').replace(/^Bearer\s+/i, '');
  if (!secretsMatch(header, expected) && !secretsMatch(bearer, expected)) {
    return res.status(401).json({ error: 'Cron secret required.' });
  }
  return next();
}

router.use(requireCron);

router.get('/kidneys', (req, res) => {
  const result = runKidneySweep();
  res.json({ ok: true, result });
});

router.get('/grace', (req, res) => {
  const result = accrueAllGrace(lusakaDate());
  res.json({ ok: true, result });
});

router.get('/notifications', async (req, res) => {
  const result = await runDueDatePass();
  res.json({ ok: true, result });
});

router.get('/daily-report', async (req, res) => {
  const today = lusakaDate();
  const state = dataStore.readJson(dataStore.paths.dailyReportState, {});
  if (state.lastSentDate >= today) return res.json({ ok: true, skipped: true });
  const result = await sendDailyLoanReport();
  res.json({ ok: true, result });
});

router.get('/payments', async (req, res) => {
  const today = lusakaDate();
  const state = dataStore.readJson(path.join(dataStore.DATA_DIR, 'paymentsReportState.json'), {});
  const frame = `${process.env.PAYMENTS_SHEET_FROM || 'all'}:${process.env.PAYMENTS_SHEET_TO || 'all'}`;
  if (state.lastSentDate >= today && state.frame === frame) return res.json({ ok: true, skipped: true });
  const result = await sendPaymentsTrackingEmail();
  res.json({ ok: true, result });
});

module.exports = router;
