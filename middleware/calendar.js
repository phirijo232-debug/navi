const config = require('../config');

/** YYYY-MM-DD in the shop's timezone (Africa/Lusaka unless configured). */
function calendarToday(date = new Date(), timeZone = config.REPORTS.TIME_ZONE) {
  const parts = new Intl.DateTimeFormat('en-US', {
    timeZone,
    year: 'numeric',
    month: '2-digit',
    day: '2-digit'
  }).formatToParts(date);
  const map = {};
  for (const part of parts) {
    if (part.type !== 'literal') map[part.type] = part.value;
  }
  return `${map.year}-${map.month}-${map.day}`;
}

/** Add calendar days to a YYYY-MM-DD string. No clock drift. */
function addCalendarDays(isoDate, days) {
  const [year, month, day] = String(isoDate).slice(0, 10).split('-').map(Number);
  const dt = new Date(Date.UTC(year, month - 1, day));
  dt.setUTCDate(dt.getUTCDate() + Number(days || 0));
  return dt.toISOString().slice(0, 10);
}

/**
 * Contract due date: the borrowed (approval) day plus the agreed weeks.
 * Waiting time before approval is not added.
 */
function contractDueDate(borrowedDate, tenureWeeks) {
  const weeks = [1, 2, 3, 4].includes(Number(tenureWeeks)) ? Number(tenureWeeks) : Math.max(parseInt(tenureWeeks, 10) || 1, 1);
  return addCalendarDays(String(borrowedDate).slice(0, 10), weeks * 7);
}

function approvalSchedule(approvedAt, tenureWeeks) {
  const borrowedDate = calendarToday(approvedAt instanceof Date ? approvedAt : new Date(approvedAt));
  return {
    borrowedDate,
    dueDate: contractDueDate(borrowedDate, tenureWeeks)
  };
}

module.exports = { calendarToday, addCalendarDays, contractDueDate, approvalSchedule };
