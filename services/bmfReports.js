// BMF 10-report pure builders — no Express, no fs, no email. Testable in isolation.
'use strict';

const REPORT_TYPES = [
  'daily',
  'all-loans',
  'payments-today',
  'overdue',
  'defaulters',
  'monthly-collections',
  'borrower-statements',
  'approval-log',
  'interest-revenue',
  'repayment-performance',
  'repayment-tracker'
];

// Canonical statuses stay untouched in storage. This maps to SPEC DISPLAY labels only.
function displayStatus(loan, today = new Date().toISOString().slice(0, 10)) {
  const raw = String(loan.status || 'pending').trim().toLowerCase();
  if (raw === 'declined') return 'declined';
  if (raw === 'liquidated') return 'liquidated';
  if (raw === 'paid' || Number(loan.outstanding || 0) <= 0) return 'repaid';
  if (raw === 'defaulted') return 'default';
  if (raw === 'pending') return 'pending';
  if (isOverdue(loan, today)) return 'overdue';
  return 'active';
}

function isOverdue(loan, today = new Date().toISOString().slice(0, 10)) {
  const raw = String(loan.status || '').toLowerCase();
  if (['paid', 'declined', 'liquidated'].includes(raw)) return false;
  if (Number(loan.outstanding || 0) <= 0) return false;
  const due = String(loan.dueDate || '').slice(0, 10);
  return Boolean(due) && due < today;
}

function daysOverdue(loan, today = new Date().toISOString().slice(0, 10)) {
  if (!isOverdue(loan, today)) return 0;
  const due = new Date(`${String(loan.dueDate).slice(0, 10)}T00:00:00Z`).getTime();
  const now = new Date(`${today}T00:00:00Z`).getTime();
  return Math.max(0, Math.round((now - due) / 86400000));
}

function lastPaymentOf(loan) {
  const ps = Array.isArray(loan.payments) ? loan.payments : [];
  if (!ps.length) return null;
  return ps.slice().sort((a, b) => String(a.paymentDate || a.date || '').localeCompare(String(b.paymentDate || b.date || ''))).at(-1);
}

function toDDMMYYYY(value) {
  if (!value) return '';
  const s = String(value).slice(0, 10);
  const m = s.match(/^(\d{4})-(\d{2})-(\d{2})$/);
  if (m) return `${m[3]}/${m[2]}/${m[1]}`;
  return s;
}

function userByEmail(users, email) {
  const want = String(email || '').trim().toLowerCase();
  return (users || []).find(u => String(u.email || '').trim().toLowerCase() === want) || null;
}

function riskLevel(stats) {
  const pastDue = Number(stats.pastDueCount || 0);
  const active = Number(stats.activeCount || 0);
  const repaid = Number(stats.totalRepaid || 0);
  if (pastDue >= 3) return 'Critical';
  if (pastDue >= 2) return 'High';
  if (pastDue >= 1 || (active >= 3 && repaid <= 0)) return 'Medium';
  return 'Low';
}

function filenameFor(type, opts = {}) {
  const d = String(opts.date || new Date().toISOString().slice(0, 10));
  switch (type) {
    case 'daily': return `BMF-Daily-Report-${d}.xlsx`;
    case 'monthly-collections': return `BMF-Monthly-Collections-${d.slice(0, 7)}.xlsx`;
    case 'interest-revenue': return `BMF-Interest-Revenue-${d.slice(0, 7)}.xlsx`;
    case 'repayment-performance': return `BMF-Repayment-Performance-${d.slice(0, 7)}.xlsx`;
    case 'repayment-tracker': {
      const name = String(opts.borrower || 'Borrower').replace(/[^A-Za-z0-9]+/g, '-').replace(/^-+|-+$/g, '') || 'Borrower';
      return `BMF-Report-${name}-${d}.xlsx`;
    }
    case 'all-loans': return `BMF-All-Loans-${d}.xlsx`;
    case 'payments-today': return `BMF-Payments-${d}.xlsx`;
    case 'overdue': return `BMF-Overdue-${d}.xlsx`;
    case 'defaulters': return `BMF-Defaulters-${d}.xlsx`;
    case 'borrower-statements': return `BMF-Borrower-Statements-${d}.xlsx`;
    case 'approval-log': return `BMF-Approval-Log-${d}.xlsx`;
    default: return `BMF-${type}-${d}.xlsx`;
  }
}

function loanLabel(loan) {
  return loan.receiptId || loan.receipt || (loan.id != null ? `BMF-${loan.id}` : '');
}

function borrowerName(loan, users) {
  if (loan.username) return loan.username;
  const u = userByEmail(users, loan.email);
  return u ? (u.username || u.name || loan.email) : (loan.email || '');
}

function dailySummaryRows(loans, users, today) {
  const t = today || new Date().toISOString().slice(0, 10);
  const scoped = loans.filter(l => String(l.status || '').toLowerCase() !== 'declined');
  const approvedToday = scoped.filter(l => String(l.approvedAt || '').slice(0, 10) === t);
  const paidToday = [];
  scoped.forEach(l => (Array.isArray(l.payments) ? l.payments : []).forEach(p => {
    if (String(p.paymentDate || p.date || '').slice(0, 10) === t) paidToday.push(p);
  }));
  const collected = paidToday.reduce((s, p) => s + (Number(p.amount) || 0), 0);
  const disbursed = approvedToday.reduce((s, l) => s + (Number(l.amount) || 0), 0);
  const outstanding = scoped.reduce((s, l) => s + (Number(l.outstanding) || 0), 0);
  const borrowers = new Set(scoped.map(l => String(l.email || '').toLowerCase())).size;
  return {
    headers: ['Metric', 'Value'],
    rows: [
      ['Report date', t],
      ['Loans approved today', approvedToday.length],
      ['Amount disbursed today (K)', disbursed],
      ['Payments received today', paidToday.length],
      ['Cash collected today (K)', collected],
      ['Total outstanding (K)', outstanding],
      ['Active borrowers', borrowers],
      ['Total loan records', scoped.length]
    ],
    meta: { approvedToday: approvedToday.length, paidToday: paidToday.length, collected, disbursed, outstanding }
  };
}

function allLoansRows(loans, users, today) {
  const t = today || new Date().toISOString().slice(0, 10);
  const group = (l) => {
    const d = displayStatus(l, t);
    if (d === 'pending') return 0;
    if (d === 'active') return 1;
    if (d === 'overdue') return 2;
    if (d === 'default') return 3;
    if (d === 'repaid') return 4;
    return 5;
  };
  const rows = loans
    .filter(l => String(l.status || '').toLowerCase() !== 'declined')
    .slice()
    .sort((a, b) => group(a) - group(b) || String(a.dueDate || '').localeCompare(String(b.dueDate || '')))
    .map(l => [
      loanLabel(l), borrowerName(l, users), l.email || '', l.product || '',
      Number(l.amount || 0), Number(l.interestAmount || 0), Number(l.totalRepayment || 0),
      Number(l.paidTotal || 0), Number(l.outstanding || 0),
      displayStatus(l, t), toDDMMYYYY(l.approvedAt), toDDMMYYYY(l.dueDate)
    ]);
  return {
    headers: ['Loan ID', 'Borrower', 'Email', 'Product', 'Principal (K)', 'Interest (K)', 'Total (K)', 'Paid (K)', 'Outstanding (K)', 'Status', 'Loan Date', 'Due Date'],
    rows
  };
}

function paymentsTodayRows(loans, users, today) {
  const t = today || new Date().toISOString().slice(0, 10);
  const rows = [];
  loans.forEach(l => (Array.isArray(l.payments) ? l.payments : []).forEach(p => {
    if (String(p.paymentDate || p.date || '').slice(0, 10) !== t) return;
    rows.push([
      loanLabel(l), borrowerName(l, users), Number(p.amount || 0),
      toDDMMYYYY(p.paymentDate || p.date), p.mode || p.method || '',
      p.paymentReceiptId || p.receiptId || '', p.recordedBy || ''
    ]);
  }));
  return {
    headers: ['Loan ID', 'Borrower', 'Amount (K)', 'Payment Date', 'Mode', 'Receipt', 'Recorded By'],
    rows
  };
}

function overdueRows(loans, users, today) {
  const t = today || new Date().toISOString().slice(0, 10);
  const rows = loans
    .filter(l => isOverdue(l, t))
    .map(l => {
      const lp = lastPaymentOf(l);
      return {
        days: daysOverdue(l, t),
        row: [
          loanLabel(l), borrowerName(l, users), l.phone || (userByEmail(users, l.email) || {}).phone || '',
          l.email || '', toDDMMYYYY(l.dueDate), daysOverdue(l, t),
          Number(l.amount || 0), Number(l.outstanding || 0),
          lp ? toDDMMYYYY(lp.paymentDate || lp.date) : '', lp ? Number(lp.amount || 0) : 0
        ]
      };
    })
    .sort((a, b) => b.days - a.days)
    .map(x => x.row);
  return {
    headers: ['Loan ID', 'Borrower Name', 'Phone', 'Email', 'Due Date', 'Days Overdue', 'Loan Amount (K)', 'Outstanding (K)', 'Last Payment Date', 'Last Payment Amount (K)'],
    rows
  };
}

function defaulterRows(loans, users, today) {
  const t = today || new Date().toISOString().slice(0, 10);
  const rows = loans
    .filter(l => String(l.status || '').toLowerCase() === 'defaulted' && Number(l.outstanding || 0) > 0)
    .map(l => {
      const lp = lastPaymentOf(l);
      const hist = Array.isArray(l.statusHistory) ? l.statusHistory : [];
      return {
        out: Number(l.outstanding || 0),
        row: [
          loanLabel(l), borrowerName(l, users), l.phone || (userByEmail(users, l.email) || {}).phone || '',
          l.email || '', toDDMMYYYY(l.dueDate), daysOverdue(l, t),
          Number(l.amount || 0), Number(l.outstanding || 0),
          lp ? toDDMMYYYY(lp.paymentDate || lp.date) : '', lp ? Number(lp.amount || 0) : 0,
          hist.length ? toDDMMYYYY(hist[hist.length - 1].at) : ''
        ]
      };
    })
    .sort((a, b) => b.out - a.out)
    .map(x => x.row);
  return {
    headers: ['Loan ID', 'Borrower Name', 'Phone', 'Email', 'Due Date', 'Days Overdue', 'Loan Amount (K)', 'Outstanding (K)', 'Last Payment Date', 'Last Payment Amount (K)', 'Default Declared Date'],
    rows
  };
}

function monthlyCollectionsRows(loans, users, month) {
  const m = month || new Date().toISOString().slice(0, 7);
  const rows = [];
  let total = 0;
  loans.forEach(l => (Array.isArray(l.payments) ? l.payments : []).forEach(p => {
    if (String(p.paymentDate || p.date || '').slice(0, 7) !== m) return;
    const amt = Number(p.amount || 0);
    total += amt;
    rows.push([
      toDDMMYYYY(p.paymentDate || p.date), loanLabel(l), borrowerName(l, users),
      amt, p.mode || p.method || '', p.paymentReceiptId || p.receiptId || ''
    ]);
  }));
  rows.sort((a, b) => String(a[0]).localeCompare(String(b[0])));
  return {
    headers: ['Payment Date', 'Loan ID', 'Borrower', 'Amount (K)', 'Mode', 'Receipt'],
    rows, meta: { month: m, total, count: rows.length }
  };
}

function borrowerStatementRows(loans, users) {
  const byEmail = new Map();
  loans.filter(l => String(l.status || '').toLowerCase() !== 'declined').forEach(l => {
    const key = String(l.email || '').toLowerCase();
    if (!byEmail.has(key)) byEmail.set(key, []);
    byEmail.get(key).push(l);
  });
  const sections = [...byEmail.entries()]
    .sort((a, b) => borrowerName({ email: a[0] }, users).localeCompare(borrowerName({ email: b[0] }, users)))
    .map(([email, ls]) => {
      const u = userByEmail(users, email);
      return {
        borrower: borrowerName({ email, username: ls[0].username }, users),
        email, phone: (u || {}).phone || ls[0].phone || '', nrc: (u || {}).nrc || '',
        principal: ls.reduce((s, l) => s + Number(l.amount || 0), 0),
        paid: ls.reduce((s, l) => s + Number(l.paidTotal || 0), 0),
        outstanding: ls.reduce((s, l) => s + Number(l.outstanding || 0), 0),
        loans: ls.map(l => ([
          loanLabel(l), Number(l.amount || 0), Number(l.interestAmount || 0),
          Number(l.paidTotal || 0), Number(l.outstanding || 0),
          displayStatus(l), toDDMMYYYY(l.dueDate)
        ]))
      };
    });
  return { sections };
}

function approvalLogRows(loans, users) {
  const rows = loans
    .filter(l => l.approvedAt)
    .slice()
    .sort((a, b) => String(b.approvedAt || '').localeCompare(String(a.approvedAt || '')))
    .map(l => [
      loanLabel(l), borrowerName(l, users), l.email || '',
      Number(l.amount || 0), l.tenureWeeks || '', l.urgency || '',
      toDDMMYYYY(l.approvedAt), l.reviewedBy || l.updatedBy || '', displayStatus(l)
    ]);
  return {
    headers: ['Loan ID', 'Borrower', 'Email', 'Amount (K)', 'Tenure (wks)', 'Urgency', 'Approved Date', 'Approved By', 'Status'],
    rows
  };
}

function interestRevenueRows(loans, users, month) {
  const m = month || new Date().toISOString().slice(0, 7);
  const inMonth = loans.filter(l => String(l.approvedAt || '').slice(0, 7) === m && String(l.status || '').toLowerCase() !== 'declined');
  const booked = inMonth.reduce((s, l) => s + Number(l.interestAmount || 0), 0);
  let collected = 0;
  loans.forEach(l => (Array.isArray(l.payments) ? l.payments : []).forEach(p => {
    if (String(p.paymentDate || p.date || '').slice(0, 7) === m) collected += Number(p.amount || 0);
  }));
  const detail = inMonth.map(l => [
    loanLabel(l), borrowerName(l, users), Number(l.amount || 0),
    Number(l.interestAmount || 0), toDDMMYYYY(l.approvedAt), displayStatus(l)
  ]);
  return {
    summaryHeaders: ['Metric', 'Value (K)'],
    summary: [[`Interest booked (${m})`, booked], [`Cash collected (${m})`, collected]],
    detailHeaders: ['Loan ID', 'Borrower', 'Principal (K)', 'Interest (K)', 'Loan Date', 'Status'],
    detail, meta: { month: m, booked, collected }
  };
}

function settledOnTime(loan) {
  if (!(Number(loan.outstanding || 0) <= 0 || String(loan.status || '').toLowerCase() === 'paid')) return null;
  const due = String(loan.dueDate || '').slice(0, 10);
  const at = loan.settledAt ? String(loan.settledAt).slice(0, 10) : null;
  if (!due || !at) return null;
  return at <= due;
}

function repaymentPerformanceRows(loans, users, today) {
  const t = today || new Date().toISOString().slice(0, 10);
  const scoped = loans.filter(l => String(l.status || '').toLowerCase() !== 'declined');
  const settled = scoped.filter(l => Number(l.outstanding || 0) <= 0 || String(l.status || '').toLowerCase() === 'paid').length;
  const onTime = scoped.filter(l => settledOnTime(l) === true).length;
  const byEmail = new Map();
  scoped.forEach(l => {
    const key = String(l.email || '').toLowerCase();
    if (!byEmail.has(key)) byEmail.set(key, { active: 0, pastDue: 0, repaid: 0, loans: 0 });
    const st = byEmail.get(key);
    st.loans += 1;
    if (Number(l.outstanding || 0) <= 0) st.repaid += Number(l.paidTotal || 0);
    else { st.active += 1; if (isOverdue(l, t)) st.pastDue += 1; }
  });
  const table = [...byEmail.entries()].map(([email, st]) => ([
    borrowerName({ email }, users), email, st.loans, st.active, st.pastDue,
    Number(st.repaid.toFixed(2)),
    riskLevel({ activeCount: st.active, pastDueCount: st.pastDue, totalRepaid: st.repaid })
  ]));
  return {
    summaryHeaders: ['Metric', 'Value'],
    summary: [
      ['Total loans', scoped.length],
      ['Settled loans', settled],
      ['Settled on time', onTime],
      ['Settlement rate %', scoped.length ? Math.round((settled / scoped.length) * 100) : 0]
    ],
    tableHeaders: ['Borrower', 'Email', 'Loans', 'Active', 'Past Due', 'Total Repaid (K)', 'Risk Level'],
    table
  };
}

function repaymentTrackerRows(loan, user) {
  const payments = (Array.isArray(loan.payments) ? loan.payments : []).slice()
    .sort((a, b) => String(a.paymentDate || a.date || '').localeCompare(String(b.paymentDate || b.date || '')));
  const rows = payments.map((p, i) => ([
    i + 1, toDDMMYYYY(p.paymentDate || p.date), Number(p.amount || 0),
    p.balanceBefore != null ? Number(p.balanceBefore) : '',
    p.balanceAfter != null ? Number(p.balanceAfter) : '',
    p.paymentReceiptId || p.receiptId || '', p.recordedBy || '', ''
  ]));
  const need = Math.max(0, 20 - rows.length);
  for (let i = 0; i < need; i += 1) rows.push([rows.length + 1, '', '', '', '', '', '', '']);
  return {
    header: {
      lender: 'Buraza Micro Finance (BMF)',
      borrower: (user && (user.username || user.name)) || loan.username || loan.email || '',
      nrc: (user && user.nrc) || loan.nrc || '',
      phone: (user && user.phone) || loan.phone || '',
      principal: Number(loan.amount || 0),
      interest: Number(loan.interestAmount || 0),
      total: Number(loan.totalRepayment || 0),
      loanDate: toDDMMYYYY(loan.approvedAt),
      dueDate: toDDMMYYYY(loan.dueDate)
    },
    tableHeaders: ['No.', 'Payment Date', 'Amount Paid (K)', 'Balance Before (K)', 'Balance After (K)', 'Receipt No.', 'Received By', 'Borrower Signature'],
    rows
  };
}

module.exports = {
  REPORT_TYPES,
  displayStatus, isOverdue, daysOverdue, lastPaymentOf, toDDMMYYYY, userByEmail,
  riskLevel, filenameFor, loanLabel, borrowerName, settledOnTime,
  dailySummaryRows, allLoansRows, paymentsTodayRows, overdueRows, defaulterRows,
  monthlyCollectionsRows, borrowerStatementRows, approvalLogRows, interestRevenueRows,
  repaymentPerformanceRows, repaymentTrackerRows
};
