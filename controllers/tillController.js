const path = require('path');
const dataStore = require('../middleware/dataStore');
const { logError, logBreakage } = require('../middleware/logger');
const { calendarToday } = require('../middleware/calendar');
const { getRequestedStoreId, canAccessStore, isStaffRole, getRecordStoreId } = require('../middleware/storeScope');
const { getLoansData } = require('./loanController');

const TILL_FILE = path.join(dataStore.DATA_DIR, 'tillCounts.json');

function readCounts() {
  return dataStore.readJson(TILL_FILE, [], Array.isArray);
}

function bucket(mode) {
  const value = String(mode || '').toLowerCase();
  if (value.includes('airtel')) return 'airtel';
  if (value.includes('mtn') || value.includes('momo')) return 'mtn';
  if (value.includes('cash')) return 'cash';
  return 'other';
}

function expectedFor(storeId, date) {
  const expected = { cash: 0, airtel: 0, mtn: 0, other: 0 };
  getLoansData().forEach(loan => {
    if (storeId !== 'all' && getRecordStoreId(loan) !== storeId) return;
    (loan.payments || []).forEach(payment => {
      if (payment.reversed) return;
      const paidOn = String(payment.paymentDate || payment.date || '').slice(0, 10);
      if (paidOn !== date) return;
      const key = bucket(payment.mode);
      if (!expected[key] && key !== 'other') return;
      const slot = expected[key] === undefined ? 'other' : key;
      expected[slot] = Number((expected[slot] + (Number(payment.amount) || 0)).toFixed(2));
    });
  });
  return expected;
}

function listTill(req, res) {
  try {
    if (!isStaffRole(req.authUser?.role)) return res.status(403).json({ error: 'Admin access required.' });
    const storeId = getRequestedStoreId(req);
    if (!canAccessStore(req, storeId)) return res.status(403).json({ error: 'Access to this store is not allowed.' });
    const date = String(req.query.date || calendarToday()).slice(0, 10);
    const counts = readCounts().filter(item => item.storeId === storeId && item.date === date);
    return res.json({ date, expected: expectedFor(storeId, date), counts });
  } catch (err) {
    logError(`TILL LIST FAILED: ${err.message}`);
    return res.status(503).json({ error: 'The till count is temporarily unavailable.' });
  }
}

function saveTill(req, res) {
  try {
    if (!isStaffRole(req.authUser?.role)) return res.status(403).json({ error: 'Admin access required.' });
    const storeId = getRequestedStoreId(req);
    if (!canAccessStore(req, storeId) || storeId === 'all') {
      return res.status(403).json({ error: 'Choose one store before counting the till.' });
    }
    const date = String(req.body?.date || calendarToday()).slice(0, 10);
    if (!/^\d{4}-\d{2}-\d{2}$/.test(date)) return res.status(400).json({ error: 'Date must be YYYY-MM-DD.' });
    const counted = {
      cash: Number(req.body?.cash || 0),
      airtel: Number(req.body?.airtel || 0),
      mtn: Number(req.body?.mtn || 0)
    };
    if (Object.values(counted).some(value => !Number.isFinite(value) || value < 0)) {
      return res.status(400).json({ error: 'Counted amounts must be zero or more.' });
    }
    const expected = expectedFor(storeId, date);
    const counts = readCounts();
    const entry = {
      id: counts.reduce((max, item) => Math.max(max, Number(item.id) || 0), 0) + 1,
      storeId,
      date,
      cash: Number(counted.cash.toFixed(2)),
      airtel: Number(counted.airtel.toFixed(2)),
      mtn: Number(counted.mtn.toFixed(2)),
      note: String(req.body?.note || '').slice(0, 300),
      recordedBy: req.authUser?.email || 'staff',
      createdAt: new Date().toISOString(),
      difference: {
        cash: Number((counted.cash - expected.cash).toFixed(2)),
        airtel: Number((counted.airtel - expected.airtel).toFixed(2)),
        mtn: Number((counted.mtn - expected.mtn).toFixed(2))
      }
    };
    counts.push(entry);
    dataStore.writeJson(TILL_FILE, counts);
    return res.json({ message: 'Till count saved.', entry, expected });
  } catch (err) {
    logBreakage('tillController.js', 'saveTill', err, 'TILL COUNT FAILED');
    return res.status(503).json({ error: 'The till count could not be saved.' });
  }
}

module.exports = { listTill, saveTill };
