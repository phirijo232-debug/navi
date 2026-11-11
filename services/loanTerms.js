'use strict';

// SHAPE_POLICY defines validation bounds and fixed structural values only.
// It is NEVER used as a fallback for missing rates — if no rates have been
// saved by the admin, the system must surface an error, not silently serve
// these numbers. All rate values must come from loanInterestPolicy.json.
const SHAPE_POLICY = Object.freeze({
  extensionBaselineOneWeekRatePercent: 10,
  minTermDays: 7,
  maxTermDays: 153
});

// Kept for external consumers that import DEFAULT_POLICY by name.
// Contains only the structural (non-rate) fields — never use its rate values.
const DEFAULT_POLICY = Object.freeze({
  weeklyRates: Object.freeze({ 1: 0, 2: 0, 3: 0, 4: 0 }), // zeroed — never fall back to these
  extensionDailyRatePercent: 0,
  extensionBaselineOneWeekRatePercent: SHAPE_POLICY.extensionBaselineOneWeekRatePercent,
  minTermDays: SHAPE_POLICY.minTermDays,
  maxTermDays: SHAPE_POLICY.maxTermDays
});

function getDefaultPolicy() {
  // Returns structural shape only. Callers must not use this for loan calculations.
  return {
    weeklyRates: { 1: null, 2: null, 3: null, 4: null },
    extensionDailyRatePercent: null,
    extensionBaselineOneWeekRatePercent: SHAPE_POLICY.extensionBaselineOneWeekRatePercent,
    minTermDays: SHAPE_POLICY.minTermDays,
    maxTermDays: SHAPE_POLICY.maxTermDays
  };
}

function normalizePolicy(input) {
  // Throws if input is missing or incomplete — no silent fallback to any default rates.
  if (!input || typeof input !== 'object' || Array.isArray(input)) {
    throw new TypeError('No loan interest rates have been configured for this store. An admin must set the rates before loans can be processed.');
  }
  const source = input;
  const rates = source.weeklyRates && typeof source.weeklyRates === 'object' ? source.weeklyRates : {};
  const weeklyRates = {};
  for (const week of [1, 2, 3, 4]) {
    if (!Object.prototype.hasOwnProperty.call(rates, week) && !Object.prototype.hasOwnProperty.call(rates, String(week))) {
      throw new TypeError(`Week ${week} rate is missing. All four weekly rates must be set by an admin.`);
    }
    const value = Number(rates[week] ?? rates[String(week)]);
    if (!Number.isFinite(value) || value < 0 || value > 100) throw new TypeError(`Week ${week} rate must be between 0% and 100%.`);
    weeklyRates[week] = Number(value.toFixed(4));
  }
  if (weeklyRates[1] <= 0) throw new TypeError('The one-week rate must be greater than 0%.');
  if ([1, 2, 3].some(week => weeklyRates[week] > weeklyRates[week + 1])) {
    throw new TypeError('Weekly rates must stay the same or increase with each longer term.');
  }
  if (!Object.prototype.hasOwnProperty.call(source, 'extensionDailyRatePercent')) {
    throw new TypeError('The daily extension rate is missing. An admin must set it before loans can be processed.');
  }
  const extensionDailyRatePercent = Number(source.extensionDailyRatePercent);
  if (!Number.isFinite(extensionDailyRatePercent) || extensionDailyRatePercent < 0 || extensionDailyRatePercent > 1) {
    throw new TypeError('The daily extension rate must be between 0% and 1% per day.');
  }
  return {
    weeklyRates,
    extensionDailyRatePercent: Number(extensionDailyRatePercent.toFixed(4)),
    extensionBaselineOneWeekRatePercent: SHAPE_POLICY.extensionBaselineOneWeekRatePercent,
    minTermDays: SHAPE_POLICY.minTermDays,
    maxTermDays: SHAPE_POLICY.maxTermDays
  };
}

function getEffectiveDailyExtensionRatePercent(policy) {
  const normalized = normalizePolicy(policy);
  return Number((normalized.extensionDailyRatePercent *
    normalized.weeklyRates[1] / normalized.extensionBaselineOneWeekRatePercent).toFixed(6));
}

function getInterestRatePercentForDays(termDays, policy) {
  const normalized = normalizePolicy(policy);
  const days = Number(termDays);
  if (!Number.isInteger(days) || days < normalized.minTermDays || days > normalized.maxTermDays) {
    throw new RangeError(`Loan term must be between ${normalized.minTermDays} and ${normalized.maxTermDays} days.`);
  }

  if (days > 28) {
    const extraDays = days - 28;
    return Number((normalized.weeklyRates[4] + extraDays * getEffectiveDailyExtensionRatePercent(normalized)).toFixed(6));
  }

  const lowerWeek = Math.floor(days / 7);
  const upperWeek = Math.ceil(days / 7);
  if (lowerWeek === upperWeek) return normalized.weeklyRates[lowerWeek];
  const lowerDay = lowerWeek * 7;
  const ratio = (days - lowerDay) / 7;
  return Number((normalized.weeklyRates[lowerWeek] +
    (normalized.weeklyRates[upperWeek] - normalized.weeklyRates[lowerWeek]) * ratio).toFixed(6));
}

function calculateInterestForDays(amount, termDays, policy) {
  const principal = Number(amount);
  if (!Number.isFinite(principal) || principal <= 0) throw new TypeError('Loan amount must be a positive number.');
  const rate = getInterestRatePercentForDays(termDays, policy);
  const interest = Number((principal * rate / 100).toFixed(2));
  return { rate, interest, total: Number((principal + interest).toFixed(2)) };
}

function getLoanTermDays(loan = {}) {
  const days = Number(loan.tenureDays);
  if (Number.isInteger(days) && days > 0) return days;
  const weeks = Number(loan.tenureWeeks ?? loan.tenure);
  return Number.isFinite(weeks) && weeks > 0 ? Math.round(weeks * 7) : 0;
}

function formatLoanTerm(loanOrDays = {}) {
  const days = typeof loanOrDays === 'number' ? loanOrDays : getLoanTermDays(loanOrDays);
  if (!Number.isFinite(days) || days <= 0) return 'Not provided';
  if (days % 7 === 0) {
    const weeks = days / 7;
    return `${weeks} week${weeks === 1 ? '' : 's'}`;
  }
  return `${days} days`;
}

function dateKeyToEpochDay(value) {
  const match = /^(\d{4})-(\d{2})-(\d{2})$/.exec(String(value || ''));
  if (!match) throw new TypeError('A valid calendar date is required.');
  const [, year, month, day] = match.map(Number);
  const date = new Date(Date.UTC(year, month - 1, day));
  if (date.getUTCFullYear() !== year || date.getUTCMonth() !== month - 1 || date.getUTCDate() !== day) {
    throw new TypeError('A valid calendar date is required.');
  }
  return Math.floor(date.getTime() / 86400000);
}

function calendarDaysBetween(startDate, endDate) {
  return dateKeyToEpochDay(endDate) - dateKeyToEpochDay(startDate);
}

module.exports = {
  DEFAULT_POLICY,
  getDefaultPolicy,
  normalizePolicy,
  getEffectiveDailyExtensionRatePercent,
  getInterestRatePercentForDays,
  calculateInterestForDays,
  getLoanTermDays,
  formatLoanTerm,
  calendarDaysBetween
};