// ─── Tracking-sheet controller ──────────────────────────────────────────────────
// Builds / refreshes the portfolio profit-loss tracking sheet and persists it
// to data/trackingSheet.json.
//
// The tracking sheet exposes:
//   - all users with their aggregated principal, interest booked / collected,
//     collected, outstanding, net profit, net profit margin, and possible loss
//   - portfolio-level profit/loss summary with status breakdown
//
// Pure, deterministic, and safe to call on every scheduler interval.
//
// NOTE: auth is enforced by the HTTP handlers in reportController.js; this module
// deliberately contains no request/response handling so the scheduler can reuse
// the same builder without an Express request in hand.

const fs = require('fs');
const path = require('path');
const { getEnrichedLoans, summarizeStore } = require('./loanController');
const dataStore = require('../middleware/dataStore');
const { getRecordStoreId } = require('../middleware/storeScope');
const { logError, logBreakage } = require('../middleware/logger');

const USERS_FILE = dataStore.paths.users;
const TRACKING_FILE = path.join(dataStore.DATA_DIR, 'trackingSheet.json');

// ─── Persistence helpers ────────────────────────────────────────────────────────

function loadTracking() {
  try {
    return JSON.parse(fs.readFileSync(TRACKING_FILE, 'utf8'));
  } catch (err) {
    if (err.code !== 'ENOENT') {
      logError(`TRACKING SHEET READ FAILED: ${err.message}`);
    }
    return null;
  }
}

function persistTracking(sheet) {
  dataStore.writeJson(TRACKING_FILE, sheet);
  try {
    fs.writeFileSync(`${TRACKING_FILE}.bak`, JSON.stringify(sheet, null, 2));
  } catch (err) {
    logBreakage('reportTracking.js', 'persistTracking', err, 'TRACKING BACKUP WRITE FAILED');
  }
  return sheet;
}

// ─── Pure builder ──────────────────────────────────────────────────────────────

function buildTrackingSheet(scope = 'buraza', asOf = null) {
  const today = asOf || new Date().toISOString().slice(0, 10);
  const enriched = getEnrichedLoans(today);

  const loans = scope === 'all'
    ? enriched
    : enriched.filter(l => getRecordStoreId(l) === scope);

  const users = dataStore.readJson(USERS_FILE, [], Array.isArray);
  const customersByEmail = new Map();
  users.forEach(u => {
    const email = String(u.email || '').trim().toLowerCase();
    if (email) customersByEmail.set(email, u);
  });

  const storeSummary = summarizeStore(loans, today);
  const netProfit = Number((storeSummary.totalInterestBooked - storeSummary.totalOutstanding).toFixed(2));
  const netProfitMargin = storeSummary.totalInterestBooked > 0
    ? Number(((storeSummary.totalInterestBooked - storeSummary.totalOutstanding) / storeSummary.totalInterestBooked * 100).toFixed(2))
    : 0;

  const userSheets = [];
  if (scope === 'all') {
    for (const [email, user] of customersByEmail) {
      const userLoans = loans.filter(l => String(l.email || '').trim().toLowerCase() === email);
      const principal = userLoans.reduce((s, l) => s + (Number(l.amount || 0)), 0);
      const interestBooked = userLoans.reduce((s, l) => s + (Number(l.interestAmount || 0)), 0);
      const interestCollected = userLoans.reduce((s, l) => s + (Number(l.paidTotal || 0)), 0);
      const outstanding = userLoans.reduce((s, l) => s + (Number(l.outstanding || 0)), 0);
      const net = Number((interestBooked - outstanding).toFixed(2));
      userSheets.push({
        email,
        username: user.username,
        phone: user.phone,
        nrc: user.nrc,
        role: user.role,
        loanCount: userLoans.length,
        principal,
        interestBooked,
        interestCollected,
        totalCollected: interestCollected,
        outstanding,
        netProfit: net,
        netProfitMargin: interestBooked > 0 ? Number((net / interestBooked * 100).toFixed(2)) : 0,
        outstandingBalance: outstanding,
        possibleLoss: outstanding,
        status: userLoans.map(l => l.businessStatus).filter((v, i, a) => a.indexOf(v) === i),
        lastActivity: user.createdAt
      });
    }
  }

  return {
    scope,
    generatedAt: new Date().toISOString(),
    asOf: today,
    summary: {
      totalLoans: loans.length,
      totalCapital: storeSummary.totalCapital,
      totalInterestBooked: storeSummary.totalInterestBooked,
      totalInterestCollected: storeSummary.totalCollected,
      totalCollected: storeSummary.totalCollected,
      totalOutstanding: storeSummary.totalOutstanding,
      netProfit,
      netProfitMargin: Number(netProfitMargin.toFixed(2)),
      possibleLoss: storeSummary.defaulted.possibleLoss,
      defaulted: storeSummary.defaulted.count,
      grace: storeSummary.grace.count,
      liquidated: storeSummary.liquidated.count,
      paid: storeSummary.paid.count,
      active: storeSummary.active.count,
      users: userSheets.length
    },
    users: userSheets
  };
}

module.exports = {
  loadTracking,
  persistTracking,
  buildTrackingSheet,
  TRACKING_FILE
};

