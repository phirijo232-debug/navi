'use strict';

const REPORTS = [
  { type: 'how-risky', title: 'How Risky Are Our Loans?', sheet: 'PAR Report', filename: 'bmf_how_risky' },
  { type: 'who-owes', title: 'Who Owes What and How Late?', sheet: 'Aging Schedule', filename: 'bmf_who_owes' },
  { type: 'full-history', title: 'One Borrower\'s Full History', sheet: 'Loan Statement', filename: 'bmf_full_history', loanRequired: true },
  { type: 'all-loans', title: 'All Loans We Gave Out This Period', sheet: 'Disbursement Register', filename: 'bmf_all_loans' },
  { type: 'schedule', title: 'Payment Schedule Per Loan', sheet: 'Repayment Schedule', filename: 'bmf_schedule', loanRequired: true },
  { type: 'collection', title: 'How Well Is Money Being Collected?', sheet: 'Collection Efficiency', filename: 'bmf_collection' },
  { type: 'problem-loans', title: 'Problem Loans & Write-Offs', sheet: 'Default Register', filename: 'bmf_problem_loans' },
  { type: 'daily-cashbook', title: 'Daily Money In and Out', sheet: 'Cash Collections', filename: 'bmf_daily_cashbook' },
  { type: 'officer-scorecard', title: 'Officer Scorecard', sheet: 'Officer Scorecard', filename: 'bmf_officer_scorecard' }
];

const REPORT_ALIASES = {
  par: 'how-risky',
  aging: 'who-owes',
  statement: 'full-history',
  disbursements: 'all-loans',
  defaults: 'problem-loans',
  cashbook: 'daily-cashbook',
  officers: 'officer-scorecard',
  overdue: 'how-risky',
  'all-loans': 'all-loans',
  'repayment-tracker': 'full-history',
  'monthly-collections': 'collection',
  defaulters: 'problem-loans',
  daily: 'daily-cashbook',
  'interest-revenue': 'officer-scorecard',
  'repayment-performance': 'officer-scorecard'
};

const RISK_BUCKETS = [
  { label: 'Current', min: 0, max: 0, reserve: 0.01 },
  { label: '1–30 days', min: 1, max: 30, reserve: 0.10 },
  { label: '31–60 days', min: 31, max: 60, reserve: 0.50 },
  { label: '61–90 days', min: 61, max: 90, reserve: 0.50 },
  { label: '91–180 days', min: 91, max: 180, reserve: 0.75 },
  { label: 'Over 180 days', min: 181, max: Infinity, reserve: 1 }
];

class ReportDataError extends Error {
  constructor(message, status = 422, loanId = null) {
    super(message);
    this.name = 'ReportDataError';
    this.status = status;
    this.loanId = loanId;
  }
}

function canonicalReportType(type) {
  const key = String(type || '').trim().toLowerCase().replace(/_/g, '-');
  const canonical = REPORT_ALIASES[key] || key;
  return REPORTS.some(report => report.type === canonical) ? canonical : null;
}

function reportConfig(type) {
  const canonical = canonicalReportType(type);
  return REPORTS.find(report => report.type === canonical) || null;
}

function cents(value, label, loanId) {
  if (value == null || (typeof value === 'string' && !value.trim())) {
    throw new ReportDataError(`Report stopped: ${label} is missing or invalid on loan ${loanId}.`, 422, loanId);
  }
  const amount = Number(value);
  if (!Number.isFinite(amount)) {
    throw new ReportDataError(`Report stopped: ${label} is missing or invalid on loan ${loanId}.`, 422, loanId);
  }
  return Math.round(amount * 100);
}

function major(value) {
  return value / 100;
}

function paymentTotalCents(loan) {
  return (Array.isArray(loan.payments) ? loan.payments : []).reduce((total, payment) => {
    const id = loan.receiptNumber || loan.id || 'unknown';
    const amount = cents(payment.amount, 'payment amount', id);
    if (amount < 0) throw new ReportDataError(`Report stopped: negative payment on loan ${id}.`, 422, id);
    return total + amount;
  }, 0);
}

function validateLoanLedgers(loans) {
  for (const loan of loans) {
    const id = loan.receiptNumber || loan.id || 'unknown';
    const principal = cents(loan.amount, 'principal', id);
    const interest = cents(loan.interestAmount, 'interest', id);
    const payable = cents(loan.totalRepayment, 'total payable', id);
    const outstanding = cents(loan.outstanding, 'outstanding balance', id);
    const paid = paymentTotalCents(loan);
    if (outstanding < 0) {
      throw new ReportDataError(`Numbers do not add up on loan ${id}. Outstanding balance is negative. Report stopped. Please check the cashbook.`, 422, id);
    }
    if (Math.abs(paid + outstanding - payable) > 1) {
      const formatMoney = value => `K ${(value / 100).toLocaleString('en-ZM', {
        minimumFractionDigits: 2,
        maximumFractionDigits: 2
      })}`;
      throw new ReportDataError(
        `Numbers do not add up on loan ${id}. Paid ${formatMoney(paid)} + outstanding ${formatMoney(outstanding)} does not equal total payable ${formatMoney(payable)}. Report stopped. Please check the cashbook.`,
        422,
        id
      );
    }
    if (principal < 0 || interest < 0 || payable < 0) {
      throw new ReportDataError(`Report stopped: negative loan totals on loan ${id}.`, 422, id);
    }
  }
  return true;
}

function validDate(value) {
  if (!value) return true;
  if (!/^\d{4}-\d{2}-\d{2}$/.test(String(value))) return false;
  const parsed = new Date(`${value}T00:00:00Z`);
  return !Number.isNaN(parsed.getTime()) && parsed.toISOString().slice(0, 10) === value;
}

function checkPeriod(from, to) {
  if (!validDate(from) || !validDate(to) || (from && to && from > to)) {
    throw new ReportDataError('from/to must be valid YYYY-MM-DD dates, and from cannot be after to.', 400);
  }
}

function loanOfficer(loan) {
  return String(loan.officer || loan.assignedOfficer || loan.loanOfficer || loan.reviewedBy || loan.createdBy || loan.updatedBy || '').trim();
}

function disbursedDate(loan) {
  return String(loan.approvedAt || loan.borrowedDate || '').slice(0, 10);
}

function userFor(users, loan) {
  const email = String(loan.email || '').trim().toLowerCase();
  return (users || []).find(user => String(user.email || '').trim().toLowerCase() === email) || {};
}

function borrowerName(loan, users) {
  const user = userFor(users, loan);
  return loan.username || user.username || user.name || loan.email || 'Unknown borrower';
}

function loanReference(loan) {
  return String(loan.receiptNumber || (loan.id != null ? `BMF-${loan.id}` : ''));
}

function canonicalStatus(loan, today) {
  const status = String(loan.businessStatus || loan.status || '').toLowerCase().replace(/\s+/g, '_');
  if (status === 'declined') return 'Declined';
  if (status === 'liquidated' || status === 'recovered') return 'Write-Off';
  if (status === 'paid' || status === 'settled' || Number(loan.outstanding) === 0) return 'Repaid';
  if (status === 'defaulted' || status === 'default') return 'Default';
  const days = daysLate(loan, today);
  return days ? 'Overdue' : 'Active';
}

function scheduleRows(loan) {
  const raw = loan.installments || loan.repaymentSchedule || loan.paymentSchedule;
  return Array.isArray(raw) ? raw : [];
}

function installmentDate(item) {
  return String(item.dueDate || item.dueAt || item.date || '').slice(0, 10);
}

function installmentAmount(item) {
  const amount = item.amountDue ?? item.dueAmount ?? item.amount;
  return amount != null && amount !== '' && Number.isFinite(Number(amount)) ? Number(amount) : null;
}

function earliestUnpaidDueDate(loan) {
  const scheduled = scheduleRows(loan)
    .filter(item => {
      const due = installmentAmount(item);
      const paid = Number(item.amountPaid || item.paidAmount || 0);
      return String(item.status || '').toLowerCase() !== 'paid' && (due == null || paid + 0.01 < due);
    })
    .map(installmentDate)
    .filter(date => validDate(date))
    .sort();
  return scheduled[0] || String(loan.dueDate || '').slice(0, 10);
}

function daysLate(loan, today) {
  if (Number(loan.outstanding) <= 0) return 0;
  const due = earliestUnpaidDueDate(loan);
  if (!validDate(due) || !due || due >= today) return 0;
  return Math.floor((Date.parse(`${today}T00:00:00Z`) - Date.parse(`${due}T00:00:00Z`)) / 86400000);
}

function bucketFor(days) {
  return RISK_BUCKETS.find(bucket => days >= bucket.min && days <= bucket.max) || RISK_BUCKETS[0];
}

function isIssued(loan) {
  return Boolean(disbursedDate(loan)) && String(loan.status || '').toLowerCase() !== 'declined';
}

function inRange(date, from, to) {
  if (from && (!date || date < from)) return false;
  if (to && (!date || date > to)) return false;
  return true;
}

function filterLoans(loans, { from, to, officer }) {
  return loans.filter(loan => {
    if (!isIssued(loan)) return false;
    if (!inRange(disbursedDate(loan), from, to)) return false;
    if (officer && loanOfficer(loan) !== officer) return false;
    return true;
  });
}

function paymentDate(payment) {
  return String(payment.paymentDate || payment.date || '').slice(0, 10);
}

function paymentRows(loans, from, to) {
  const rows = [];
  loans.forEach(loan => (Array.isArray(loan.payments) ? loan.payments : []).forEach(payment => {
    const date = paymentDate(payment);
    if (inRange(date, from, to)) rows.push({ loan, payment, date });
  }));
  return rows.sort((a, b) => a.date.localeCompare(b.date) ||
    String(a.payment.paymentReceiptId || '').localeCompare(String(b.payment.paymentReceiptId || '')));
}

function selectedLoan(loans, loanId) {
  if (!loanId) return null;
  return loans.find(loan => String(loan.id) === String(loanId) ||
    String(loan.receiptNumber || '') === String(loanId)) || null;
}

function paidCents(loan) {
  return paymentTotalCents(loan);
}

function buildParRows(loans, users, today) {
  return loans.map(loan => {
    const balance = cents(loan.outstanding, 'outstanding balance', loanReference(loan));
    const overdueDays = daysLate(loan, today);
    const bucket = bucketFor(overdueDays);
    return {
      loanId: loanReference(loan),
      borrower: borrowerName(loan, users),
      officer: loanOfficer(loan) || 'Unassigned',
      principal: major(cents(loan.amount, 'principal', loanReference(loan))),
      payable: major(cents(loan.totalRepayment, 'total payable', loanReference(loan))),
      outstanding: major(balance),
      paid: major(paidCents(loan)),
      daysOverdue: overdueDays,
      overdueAmount: overdueDays > 0 ? major(balance) : 0,
      riskBucket: bucket.label,
      reserveRate: bucket.reserve,
      reserve: major(Math.round(balance * bucket.reserve)),
      status: canonicalStatus(loan, today)
    };
  });
}

function buildAgingRows(loans, users, today) {
  return loans.map(loan => {
    const outstanding = cents(loan.outstanding, 'outstanding balance', loanReference(loan));
    const portions = [0, 0, 0, 0, 0, 0, 0];
    const bucketIndex = days => days === 0 ? 0
      : days <= 7 ? 1
        : days <= 30 ? 2
          : days <= 60 ? 3
            : days <= 90 ? 4
              : days <= 180 ? 5 : 6;
    const schedules = scheduleRows(loan);
    if (schedules.length) {
      let scheduledOutstanding = 0;
      schedules.forEach(item => {
        const due = installmentAmount(item);
        const paid = String(item.status || '').toLowerCase() === 'paid'
          ? due
          : Number(item.amountPaid ?? item.paidAmount ?? 0);
        if (due == null || !Number.isFinite(paid) || paid < 0) return;
        const remaining = Math.max(0, Math.round(due * 100) - Math.round(paid * 100));
        if (!remaining) return;
        scheduledOutstanding += remaining;
        const dueDate = validDate(installmentDate(item)) && installmentDate(item)
          ? installmentDate(item)
          : String(loan.dueDate || '').slice(0, 10);
        const days = dueDate && dueDate < today
          ? Math.floor((Date.parse(`${today}T00:00:00Z`) - Date.parse(`${dueDate}T00:00:00Z`)) / 86400000)
          : 0;
        portions[bucketIndex(days)] += remaining;
      });
      if (scheduledOutstanding > outstanding + 1) {
        throw new ReportDataError(
          `Numbers do not add up on loan ${loanReference(loan)}. Unpaid installments exceed the outstanding balance. Report stopped. Please check the cashbook.`,
          422,
          loanReference(loan)
        );
      }
      const unallocated = outstanding - scheduledOutstanding;
      if (unallocated > 0) portions[bucketIndex(daysLate(loan, today))] += unallocated;
    } else {
      portions[bucketIndex(daysLate(loan, today))] = outstanding;
    }
    const total = portions.slice(1).reduce((sum, amount) => sum + amount, 0);
    return {
      loanId: loanReference(loan),
      borrower: borrowerName(loan, users),
      payable: major(cents(loan.totalRepayment, 'total payable', loanReference(loan))),
      outstanding: major(outstanding),
      buckets: portions.map(major),
      arrears: major(total),
      status: canonicalStatus(loan, today)
    };
  });
}

function buildStatement(loan, users, today) {
  if (!loan) return null;
  const user = userFor(users, loan);
  const total = cents(loan.totalRepayment, 'total payable', loanReference(loan));
  const principal = cents(loan.amount, 'principal', loanReference(loan));
  const interest = cents(loan.interestAmount, 'interest', loanReference(loan));
  const rawRate = Number(loan.interestRate);
  const interestRate = Number.isFinite(rawRate) ? (rawRate > 1 ? rawRate : rawRate * 100) : null;
  const payments = (Array.isArray(loan.payments) ? loan.payments : []).slice()
    .sort((a, b) => paymentDate(a).localeCompare(paymentDate(b)));
  const transactions = [{
    date: disbursedDate(loan),
    description: 'Loan Paid Out',
    receipt: `DISB-${loanReference(loan)}`,
    due: 0,
    paid: -major(principal),
    balance: major(total),
    daysLate: 0,
    officer: loanOfficer(loan) || '—',
    kind: 'disbursement',
    order: 0
  }];
  payments.forEach((payment, index) => {
    const amount = cents(payment.amount, 'payment amount', loanReference(loan));
    transactions.push({
      date: paymentDate(payment),
      description: `Payment Received — Instalment ${index + 1}`,
      receipt: payment.paymentReceiptId || payment.receiptNumber || '—',
      due: 0,
      paid: major(amount),
      balance: 0,
      daysLate: 0,
      officer: payment.recordedBy || '—',
      kind: 'payment',
      order: 2
    });
  });
  const schedules = scheduleRows(loan).slice().sort((a, b) => installmentDate(a).localeCompare(installmentDate(b)));
  schedules.forEach((item, index) => {
    const due = installmentAmount(item);
    const paid = String(item.status || '').toLowerCase() === 'paid'
      ? due
      : Number(item.amountPaid ?? item.paidAmount ?? 0);
    const dueDate = installmentDate(item);
    if (due == null || !dueDate || !validDate(dueDate) || !Number.isFinite(paid)) return;
    const remaining = Math.max(0, Math.round(due * 100) - Math.round(paid * 100));
    if (!remaining) return;
    const lateDays = dueDate < today
      ? Math.floor((Date.parse(`${today}T00:00:00Z`) - Date.parse(`${dueDate}T00:00:00Z`)) / 86400000)
      : 0;
    transactions.push({
      date: dueDate,
      description: lateDays ? 'Payment Due — Overdue' : `Payment Due — ${dueDate}`,
      receipt: '—',
      due: major(remaining),
      paid: null,
      balance: 0,
      daysLate: lateDays,
      officer: '—',
      kind: lateDays ? 'overdue' : 'upcoming',
      order: 1 + index / 1000
    });
  });
  transactions.sort((a, b) => a.date.localeCompare(b.date) || a.order - b.order);
  let runningCents = total;
  transactions.forEach(item => {
    if (item.kind === 'disbursement') runningCents = total;
    else if (item.kind === 'payment') runningCents = Math.max(0, runningCents - Math.round(item.paid * 100));
    item.balance = major(runningCents);
    delete item.order;
  });
  const next = schedules.find(item => {
    const amount = installmentAmount(item);
    const paid = String(item.status || '').toLowerCase() === 'paid'
      ? amount
      : Number(item.amountPaid ?? item.paidAmount ?? 0);
    return amount != null && amount > paid && installmentDate(item) >= today;
  });
  const nextAmount = next
    ? Math.max(0, Math.round(installmentAmount(next) * 100) -
      Math.round((String(next.status || '').toLowerCase() === 'paid'
        ? installmentAmount(next)
        : Number(next.amountPaid ?? next.paidAmount ?? 0)) * 100)) / 100
    : null;
  return {
    borrower: borrowerName(loan, users),
    loanId: loanReference(loan),
    principal: major(principal),
    interest: major(interest),
    total: major(total),
    paid: major(paidCents(loan)),
    outstanding: major(cents(loan.outstanding, 'outstanding balance', loanReference(loan))),
    interestRate,
    officer: loanOfficer(loan) || '—',
    status: canonicalStatus(loan, today),
    loanType: loan.product || '',
    loanDate: loan.approvedAt || loan.borrowedDate || '',
    dueDate: loan.dueDate || '',
    nextAmount,
    nextDate: next ? installmentDate(next) : '',
    installmentCount: schedules.length || Number(loan.installmentCount || loan.numberOfInstallments || ''),
    completedCount: schedules.filter(item => {
      const amount = installmentAmount(item);
      return String(item.status || '').toLowerCase() === 'paid' ||
        (amount != null && Number(item.amountPaid ?? item.paidAmount ?? 0) >= amount);
    }).length,
    transactions,
    nrc: user.nrc || loan.nrc || '',
    phone: user.phone || loan.phone || '',
    branch: loan.branch || user.branch || loan.storeId || '',
    tenureWeeks: Number(loan.tenureWeeks || 0),
    generatedAt: new Date().toISOString()
  };
}

function buildSchedule(loan, today) {
  if (!loan) return null;
  const schedules = scheduleRows(loan);
  const rawRate = Number(loan.interestRate);
  return {
    loanId: loanReference(loan),
    principal: Number(loan.amount),
    interestRate: Number.isFinite(rawRate) ? (rawRate > 1 ? rawRate / 100 : rawRate) : null,
    total: Number(loan.totalRepayment),
    interest: Number(loan.interestAmount),
    installmentCount: Number(loan.installmentCount || loan.numberOfInstallments || schedules.length || ''),
    firstPaymentDate: loan.firstPaymentDate || '',
    frequency: loan.paymentFrequency || '',
    installments: schedules,
    today
  };
}

function buildDisbursements(loans, users, from, to, today) {
  return loans.filter(loan => inRange(disbursedDate(loan), from, to))
    .slice()
    .sort((a, b) => disbursedDate(a).localeCompare(disbursedDate(b)) || Number(a.id) - Number(b.id))
    .map((loan, index, list) => {
      const user = userFor(users, loan);
      const scheduleTotal = cents(loan.amount, 'principal', loanReference(loan));
      const prior = list.slice(0, index).reduce((sum, item) =>
        sum + cents(item.amount, 'principal', loanReference(item)), 0);
      return {
        rowNumber: index + 1,
        date: disbursedDate(loan),
        loanId: loanReference(loan),
        borrower: borrowerName(loan, users),
        nrc: user.nrc || loan.nrc || '',
        phone: user.phone || loan.phone || '',
        officer: loanOfficer(loan) || 'Unassigned',
        purpose: loan.product || loan.loanPurpose || '',
        principal: major(scheduleTotal),
        interestRate: Number(loan.interestRate),
        total: major(cents(loan.totalRepayment, 'total payable', loanReference(loan))),
        tenure: loan.tenureWeeks ? `${loan.tenureWeeks} weeks` : '',
        dueDate: String(loan.dueDate || '').slice(0, 10),
        collateral: loan.collateralDescription || '',
        paymentMethod: loan.paymentMode || '',
        approvalReference: loan.approvalReference || '',
        status: canonicalStatus(loan, today),
        runningPrincipal: major(prior + scheduleTotal)
      };
    });
}

function buildCollectionRows(loans, users, from, to, today) {
  const byOfficer = new Map();
  const transactions = paymentRows(loans, from, to);
  loans.forEach(loan => {
    const officer = loanOfficer(loan) || 'Unassigned';
    const stats = byOfficer.get(officer) || {
      officer, branch: loan.branch || userFor(users, loan).branch || loan.storeId || '',
      activeLoans: 0, portfolio: 0, amountDue: 0, amountCollected: 0,
      onTimePaid: 0, missedPayments: 0, missedAmount: 0, overdue30: 0,
      newLoans: 0, closedLoans: 0, dueDataComplete: true, onTimeDataComplete: true
    };
    const outstanding = cents(loan.outstanding, 'outstanding balance', loanReference(loan));
    if (outstanding > 0) {
      stats.activeLoans += 1;
      stats.portfolio += outstanding;
      if (daysLate(loan, today) > 30) stats.overdue30 += outstanding;
    }
    if (inRange(disbursedDate(loan), from, to)) stats.newLoans += 1;
    if (String(loan.status || '').toLowerCase() === 'paid' || outstanding === 0) stats.closedLoans += 1;
    const schedules = scheduleRows(loan);
    if (!schedules.length && outstanding > 0) stats.dueDataComplete = false;
    schedules.forEach(item => {
      const dueDate = installmentDate(item);
      if (!inRange(dueDate, from, to)) return;
      if (!dueDate || !validDate(dueDate)) {
        stats.dueDataComplete = false;
        stats.onTimeDataComplete = false;
        return;
      }
      const dueAmount = installmentAmount(item);
      if (dueAmount == null) {
        stats.dueDataComplete = false;
        stats.onTimeDataComplete = false;
        return;
      }
      stats.amountDue += cents(dueAmount, 'installment amount', loanReference(loan));
      const paidAmount = String(item.status || '').toLowerCase() === 'paid'
        ? dueAmount
        : Number(item.amountPaid ?? item.paidAmount ?? 0);
      if (!Number.isFinite(paidAmount) || paidAmount < 0) {
        stats.dueDataComplete = false;
        stats.onTimeDataComplete = false;
        return;
      }
      const late = dueDate < today && paidAmount + 0.01 < dueAmount;
      if (late) {
        stats.missedPayments += 1;
        stats.missedAmount += Math.round((dueAmount - paidAmount) * 100);
      } else if (paidAmount >= dueAmount) {
        const paidDate = String(item.datePaid || item.paidAt || '').slice(0, 10);
        if (!validDate(paidDate) || !paidDate) stats.onTimeDataComplete = false;
        else if (paidDate <= dueDate) stats.onTimePaid += 1;
        else stats.missedPayments += 1;
      }
    });
    byOfficer.set(officer, stats);
  });
  transactions.forEach(({ loan, payment }) => {
    const officer = loanOfficer(loan) || 'Unassigned';
    const stats = byOfficer.get(officer);
    if (stats) stats.amountCollected += cents(payment.amount, 'payment amount', loanReference(loan));
  });
  return [...byOfficer.values()].sort((a, b) => a.officer.localeCompare(b.officer)).map(stats => {
    const scheduleDue = stats.dueDataComplete ? stats.amountDue : null;
    const collected = stats.dueDataComplete ? stats.amountCollected : null;
    return {
      ...stats,
      portfolio: major(stats.portfolio),
      amountDue: scheduleDue == null ? null : major(scheduleDue),
      amountCollected: collected == null ? major(stats.amountCollected) : major(collected),
      collectionRate: scheduleDue ? stats.amountCollected / scheduleDue : null,
      onTimeRate: stats.dueDataComplete && stats.onTimeDataComplete &&
        (stats.onTimePaid + stats.missedPayments)
        ? stats.onTimePaid / (stats.onTimePaid + stats.missedPayments)
        : null,
      missedAmount: major(stats.missedAmount),
      par30: stats.portfolio
        ? major(stats.overdue30) / major(stats.portfolio)
        : 0,
      rating: stats.dueDataComplete && scheduleDue
        ? (stats.amountCollected / scheduleDue >= 0.95 ? 'Excellent'
          : stats.amountCollected / scheduleDue >= 0.90 ? 'Good' : 'Needs Review')
        : 'Not available — no installment schedule',
      dataNote: stats.dueDataComplete ? '' : 'Installment schedule not recorded'
    };
  });
}

function buildDefaultRows(loans, users, today, from = '', to = '') {
  return loans.filter(loan => ['defaulted', 'liquidated'].includes(String(loan.status || '').toLowerCase()))
    .map(loan => {
      const payments = Array.isArray(loan.payments) ? loan.payments : [];
      const lastPayment = payments.slice().sort((a, b) => paymentDate(b).localeCompare(paymentDate(a)))[0];
      const defaultAt = loan.verifiedOverdueAt || (Array.isArray(loan.statusHistory)
        ? loan.statusHistory.find(item => String(item.status || '').toLowerCase() === 'defaulted')?.updatedAt
        : null);
      const eventDate = String(defaultAt || loan.writtenOffAt || loan.writeOffDate || '').slice(0, 10);
      const recovered = defaultAt
        ? payments.filter(payment => String(payment.paymentDate || payment.date || '') >= defaultAt)
          .reduce((sum, payment) => sum + Number(payment.amount || 0), 0)
        : null;
      const outstandingAtDefault = loan.outstandingAtDefault != null && Number.isFinite(Number(loan.outstandingAtDefault))
        ? Number(loan.outstandingAtDefault)
        : null;
      return {
        loanId: loanReference(loan),
        borrower: borrowerName(loan, users),
        principal: Number(loan.amount),
        totalOwed: Number(loan.totalRepayment),
        lastPaymentDate: lastPayment ? paymentDate(lastPayment) : '',
        lastPaymentAmount: lastPayment ? Number(lastPayment.amount) : 0,
        daysSinceLastPayment: lastPayment && validDate(paymentDate(lastPayment))
          ? Math.max(0, Math.floor((Date.parse(`${today}T00:00:00Z`) - Date.parse(`${paymentDate(lastPayment)}T00:00:00Z`)) / 86400000))
          : null,
        outstandingAtDefault,
        writtenOffDate: loan.writtenOffAt || loan.writeOffDate || '',
        reason: loan.writeOffReason || loan.adminReason || '',
        authorizedBy: loan.writtenOffBy || loan.verifiedOverdueBy || '',
        recoveryAction: loan.recoveryAction || '',
        recovered,
        eventDateUnavailable: !eventDate,
        netLoss: outstandingAtDefault != null && recovered != null
          ? Math.max(0, outstandingAtDefault - recovered)
          : null,
        status: outstandingAtDefault != null && recovered != null && recovered >= outstandingAtDefault
          ? 'Recovered'
          : String(loan.status || '').toLowerCase() === 'liquidated' ? 'Write-Off' : 'Default',
        eventDate
      };
    })
    .filter(row => !((from || to) && row.eventDate && !inRange(row.eventDate, from, to)));
}

function buildCashbookRows(loans, users, from, to) {
  const entries = [];
  paymentRows(loans, from, to).forEach(({ loan, payment, date }) => {
    entries.push({
      date,
      loanId: loanReference(loan),
      borrower: borrowerName(loan, users),
      receipt: payment.paymentReceiptId || payment.receiptNumber || '',
      officer: payment.recordedBy || loanOfficer(loan),
      received: Number(payment.amount),
      principal: payment.principalPortion == null ? null : Number(payment.principalPortion),
      interest: payment.interestPortion == null ? null : Number(payment.interestPortion),
      penalty: payment.penaltyPortion == null ? null : Number(payment.penaltyPortion),
      disbursed: 0,
      note: payment.note || payment.description || ''
    });
  });
  loans.filter(loan => inRange(disbursedDate(loan), from, to)).forEach(loan => {
    entries.push({
      date: disbursedDate(loan),
      loanId: loanReference(loan),
      borrower: borrowerName(loan, users),
      receipt: loan.disbursementReceipt || '',
      officer: loanOfficer(loan),
      received: 0,
      principal: 0,
      interest: 0,
      penalty: 0,
      disbursed: Number(loan.amount),
      note: 'Loan disbursement'
    });
  });
  entries.sort((a, b) => a.date.localeCompare(b.date) ||
    String(a.receipt).localeCompare(String(b.receipt)));
  let runningCents = 0;
  entries.forEach(entry => {
    const net = Math.round(entry.received * 100) - Math.round(entry.disbursed * 100);
    runningCents += net;
    entry.net = major(net);
    entry.running = major(runningCents);
  });
  return {
    entries,
    received: entries.reduce((sum, entry) => sum + Math.round(entry.received * 100), 0),
    disbursed: entries.reduce((sum, entry) => sum + Math.round(entry.disbursed * 100), 0),
    running: runningCents,
    balanced: entries.length === 0 || runningCents ===
      entries.reduce((sum, entry) => sum + Math.round(entry.received * 100) - Math.round(entry.disbursed * 100), 0),
    externalBalanceAvailable: false
  };
}

function buildOfficerRows(collectionRows, loans, from, to, today) {
  const currentMonth = today.slice(0, 7);
  return collectionRows.map(row => {
    const assigned = loans.filter(loan => (loanOfficer(loan) || 'Unassigned') === row.officer);
    const outstanding = assigned.reduce((sum, loan) => sum + Math.round(Number(loan.outstanding || 0) * 100), 0);
    const overdue = assigned.filter(loan => daysLate(loan, today) > 0);
    const par30Balance = overdue.filter(loan => daysLate(loan, today) > 30)
      .reduce((sum, loan) => sum + Math.round(Number(loan.outstanding || 0) * 100), 0);
    const defaults = assigned.filter(loan => String(loan.status || '').toLowerCase() === 'defaulted').length;
    const currentPeriod = paymentRows(assigned, from || `${currentMonth}-01`, to || today)
      .reduce((sum, item) => sum + Math.round(Number(item.payment.amount) * 100), 0);
    return {
      ...row,
      portfolioValue: major(outstanding),
      overdueLoans: overdue.length,
      par30: outstanding ? par30Balance / outstanding : 0,
      defaults,
      disbursedThisMonth: major(assigned.filter(loan => disbursedDate(loan).slice(0, 7) === currentMonth)
        .reduce((sum, loan) => sum + Math.round(Number(loan.amount) * 100), 0)),
      collectedThisMonth: major(currentPeriod),
      clientVisits: null,
      branch: row.branch || ''
    };
  }).sort((a, b) => {
    if (a.collectionRate == null && b.collectionRate == null) return a.officer.localeCompare(b.officer);
    if (a.collectionRate == null) return 1;
    if (b.collectionRate == null) return -1;
    return b.collectionRate - a.collectionRate;
  });
}

function buildReportData({ loans, users, from = '', to = '', officer = '', loanId = '', today, generatedAt }) {
  checkPeriod(from, to);
  const asOf = today || new Date().toISOString().slice(0, 10);
  const issued = loans.filter(isIssued);
  validateLoanLedgers(issued);
  const periodLoans = filterLoans(issued, { from, to, officer });
  const officerLoans = issued.filter(loan => !officer || loanOfficer(loan) === officer);
  const chosenLoan = selectedLoan(issued, loanId);
  if (loanId && !chosenLoan) throw new ReportDataError('Loan not found in the selected store.', 404);
  if ((officer || from || to) && chosenLoan && officer && loanOfficer(chosenLoan) !== officer) {
    throw new ReportDataError('Loan does not match the selected officer filter.', 404);
  }
  const parRows = buildParRows(periodLoans, users, asOf);
  const agingRows = buildAgingRows(periodLoans, users, asOf);
  const disbursements = buildDisbursements(issued, users, from, to, asOf)
    .filter(row => !officer || row.officer === officer);
  const collections = buildCollectionRows(officerLoans, users, from, to, asOf);
  const officers = buildOfficerRows(collections, officerLoans, from, to, asOf);
  const defaults = buildDefaultRows(officerLoans, users, asOf, from, to);
  const cashbook = buildCashbookRows(officerLoans, users, from, to);
  const report = {
    generatedAt: generatedAt || new Date().toISOString(),
    today: asOf,
    from,
    to,
    officer,
    loans: periodLoans,
    parRows,
    agingRows,
    statement: buildStatement(chosenLoan, users, asOf),
    schedule: buildSchedule(chosenLoan, asOf),
    disbursements,
    collections,
    defaults,
    cashbook,
    officers,
    note: [
      'Amounts are sourced from recorded loan and payment data. Installment-level due amounts, client visits, write-off recovery metadata, and external cash balances are shown as unavailable when not recorded.',
      (from || to) && defaults.some(row => row.eventDateUnavailable)
        ? 'Some defaulted loans have no recorded default/write-off date and are retained because the selected period cannot be verified.'
        : ''
    ].filter(Boolean).join(' ')
  };
  return report;
}

function filenameFor(type, format, date, loanId) {
  const config = reportConfig(type);
  if (!config) throw new ReportDataError(`Unknown report type: ${type}`, 400);
  const loanSuffix = config.loanRequired
    ? `_${String(loanId || '').replace(/[^A-Za-z0-9-]/g, '')}`
    : '';
  return `${config.filename}${loanSuffix}_${date}.${format}`;
}

module.exports = {
  REPORTS,
  REPORT_ALIASES,
  RISK_BUCKETS,
  ReportDataError,
  canonicalReportType,
  reportConfig,
  validateLoanLedgers,
  checkPeriod,
  loanOfficer,
  disbursedDate,
  borrowerName,
  loanReference,
  daysLate,
  bucketFor,
  scheduleRows,
  buildReportData,
  filenameFor
};
