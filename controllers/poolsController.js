'use strict';

const path = require('path');
const { logError, logBreakage } = require('../middleware/logger');
const auditGuardian = require('../middleware/auditLog');
const dataStore = require('../middleware/dataStore');
const config = require('../config');
const { isAdminRole, isFranchiseAdmin, getRequestedStoreId, canAccessStore, getRecordStoreId } = require('../middleware/storeScope');
const { getLoansData } = require('./loanController');

const CAPITAL_FILE = path.join(dataStore.DATA_DIR, 'lendingCapital.json');
const DISBURSED = new Set(['active', 'grace', 'defaulted', 'overdue', 'paid', 'liquidated']);

function roundMoney(value) {
  return Number((Number(value) || 0).toFixed(2));
}

function readCapitalBook() {
  return dataStore.readJson(CAPITAL_FILE, {}, value => value && typeof value === 'object' && !Array.isArray(value));
}

function isDisbursed(loan) {
  if (loan.approvedAt) return true;
  const status = String(loan.status || '').trim().toLowerCase();
  return DISBURSED.has(status);
}

function principalRepaid(loan) {
  return (Array.isArray(loan.payments) ? loan.payments : []).reduce((sum, payment) => {
    if (payment.principalPortion != null && payment.principalPortion !== '') {
      return sum + (Number(payment.principalPortion) || 0);
    }
    return sum;
  }, 0);
}

function principalStillOut(loan) {
  return roundMoney(Math.max(0, (Number(loan.amount) || 0) - principalRepaid(loan)));
}

function interestStillExpected(loan) {
  const outstanding = Math.max(0, Number(loan.outstanding) || 0);
  let interest;
  if (loan.interestOutstanding != null && loan.interestOutstanding !== '') {
    interest = Math.max(0, Number(loan.interestOutstanding) || 0);
  } else {
    const booked = Number(loan.interestAmount) || 0;
    const paid = (Array.isArray(loan.payments) ? loan.payments : [])
      .reduce((sum, payment) => sum + (Number(payment.interestPortion) || 0), 0);
    interest = Math.max(0, booked - paid);
  }
  return roundMoney(Math.min(interest, outstanding));
}

function collectedSoFar(loans) {
  return roundMoney(loans.reduce((sum, loan) => sum + (Array.isArray(loan.payments) ? loan.payments : [])
    .reduce((inner, payment) => inner + (Number(payment.amount) || 0), 0), 0));
}

function computePools(loans, capital) {
  const given = (Array.isArray(loans) ? loans : []).filter(isDisbursed);
  const principalOut = roundMoney(given.reduce((sum, loan) => sum + principalStillOut(loan), 0));
  const stillOwed = roundMoney(given.reduce((sum, loan) => sum + Math.max(0, Number(loan.outstanding) || 0), 0));
  const interestExpected = roundMoney(given.reduce((sum, loan) => sum + interestStillExpected(loan), 0));
  return {
    capital: roundMoney(capital),
    availableToLend: roundMoney(capital - principalOut),
    principalStillOut,
    expectedIncome: stillOwed,
    collected: collectedSoFar(given),
    expectedInterest: interestExpected,
    disbursedCount: given.length
  };
}

function storeKey(req) {
  const requested = getRequestedStoreId(req);
  if (requested && requested !== 'all') return requested;
  return getRecordStoreId(req.authUser || {}) || config.DEFAULT_STORE_ID;
}

function getPools(req, res) {
  try {
    if (!isAdminRole(req.authUser?.role)) {
      return res.status(403).json({ error: 'Admin access required.' });
    }
    const storeId = storeKey(req);
    if (!canAccessStore(req, storeId)) {
      return res.status(403).json({ error: 'Access to this store is not allowed.' });
    }
    const book = readCapitalBook();
    const capital = Number(book[storeId]?.capital) || 0;
    const loans = getLoansData().filter(loan => getRecordStoreId(loan) === storeId);
    return res.json({
      storeId,
      ...computePools(loans, capital),
      updatedAt: book[storeId]?.updatedAt || null,
      assumption: 'Available to lend falls by the loan principal when the loan is disbursed, and rises only by the principal part of each repayment. Interest stays in Expected interest and does not go back into the lending pool.'
    });
  } catch (err) {
    logBreakage('poolsController.js', 'getPools', err, 'POOLS READ FAILED');
    return res.status(503).json({ error: 'Lending pools are temporarily unavailable.' });
  }
}

function setLendingCapital(req, res) {
  try {
    if (!isFranchiseAdmin(req.authUser?.role) && req.authUser?.role !== 'admin') {
      return res.status(403).json({ error: 'Only an admin can set the lending capital.' });
    }
    const storeId = storeKey(req);
    if (!canAccessStore(req, storeId)) {
      return res.status(403).json({ error: 'Access to this store is not allowed.' });
    }
    const capital = Number(req.body?.capital);
    if (!Number.isFinite(capital) || capital < 0) {
      return res.status(400).json({ error: 'Enter a lending capital of zero or more.' });
    }
    const book = readCapitalBook();
    const previous = Number(book[storeId]?.capital) || 0;
    book[storeId] = {
      capital: roundMoney(capital),
      updatedAt: new Date().toISOString(),
      updatedBy: req.authUser.email || req.authUser.username || 'admin'
    };
    dataStore.writeJson(CAPITAL_FILE, book);
    auditGuardian.writeAudit({
      action: 'LENDING_CAPITAL_SET',
      actor: book[storeId].updatedBy,
      targetId: storeId,
      ip: req.ip,
      detail: { storeId, previous, capital: book[storeId].capital }
    });
    const loans = getLoansData().filter(loan => getRecordStoreId(loan) === storeId);
    return res.json({ storeId, ...computePools(loans, book[storeId].capital), updatedAt: book[storeId].updatedAt });
  } catch (err) {
    logError(`LENDING CAPITAL SET FAILED: ${err.message}`);
    return res.status(503).json({ error: 'Could not save the lending capital.' });
  }
}

module.exports = {
  computePools,
  isDisbursed,
  principalStillOut,
  interestStillExpected,
  getPools,
  setLendingCapital,
  CAPITAL_FILE
};
