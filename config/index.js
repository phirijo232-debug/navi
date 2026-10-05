module.exports = {
  PORT: 3000,
  HOST: '0.0.0.0',
  FRANCHISE_ID: 'pryme-vertex',
  DEFAULT_STORE_ID: 'buraza',
  STORES: [
    { id: 'buraza', name: 'Buraza Micro Finance', code: 'BMF', active: true }
  ],
  SHUTDOWN_KEY: process.env.MASTER_KEY || 'phirii26',

  // ─── Loan lifecycle ──────────────────────────────────────────────────────
  // Legacy statuses (pending / approved / in_progress / declined / paid) are
  // normalised into these business states everywhere reports are produced.
  LOAN_STATUSES: {
    PENDING: 'pending',
    ACTIVE: 'active',
    GRACE: 'grace',
    DEFAULTED: 'defaulted',
    LIQUIDATED: 'liquidated',
    PAID: 'paid',
    DECLINED: 'declined'
  },
  // Loans move to "grace" this many days before the due date, and to
  // "defaulted" once the due date passes with a balance outstanding.
  GRACE_PERIOD_DAYS: 3,
  DEFAULT_GRACE_DAYS: 5,
  // Days before the due date that the reminder notifications fire.
  REMINDER_DAYS_BEFORE: 3,
  REPORTS: {
    DAILY_ADMIN_EMAIL: process.env.DAILY_REPORT_EMAIL || 'jophiri232@gmail.com',
    DAILY_SEND_TIME: process.env.DAILY_REPORT_TIME || '23:59',
    TIME_ZONE: process.env.DAILY_REPORT_TIMEZONE || 'Africa/Lusaka'
  },
  LOGS: {
    ACCESS: 'logs/access.log',
    ERRORS: 'logs/errors.log'
  },
  TRUSTED_TOKENS: [
    'LAPTOP-Solojjktitazeckjomerali',
    'PHONE-Alimercjoezectitjjksolo'
  ]
};