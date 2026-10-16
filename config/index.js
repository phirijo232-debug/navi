module.exports = {
PORT: Number(process.env.PORT) || 3000,
  HOST: '0.0.0.0',
  FRANCHISE_ID: 'pryme-vertex',
  DEFAULT_STORE_ID: process.env.DEFAULT_STORE_ID || 'buraza',
  STORES: [
    { id: 'buraza', name: 'Buraza Micro Finance', code: 'BMF', active: true }
  ],

  // Public/private server-mode toggle (see middleware/security.js). PRIVATE keeps
  // the server LAN-only; PUBLIC makes it internet-reachable while STILL requiring
  // device-token auth on every protected route. Only the franchise-manager admin
  // (FRANCHISE_MANAGER_EMAILS + an admin/franchise role) may flip it.
  SERVER_MODE: process.env.SERVER_MODE || 'private',
  FRANCHISE_MANAGER_EMAILS: (process.env.FRANCHISE_MANAGER_EMAILS || 'jophiri223@gmail.com')
    .split(',')
    .map(email => email.trim().toLowerCase())
    .filter(Boolean),
  SHUTDOWN_KEY: process.env.SHUTDOWN_KEY || process.env.MASTER_KEY || null,

  LOAN_STATUSES: {
    PENDING: 'pending',
    ACTIVE: 'active',
    GRACE: 'grace',
    DEFAULTED: 'defaulted',
    LIQUIDATED: 'liquidated',
    PAID: 'paid',
    DECLINED: 'declined'
  },

  GRACE_PERIOD_DAYS: 3,
  DEFAULT_GRACE_DAYS: 5,
  REMINDER_DAYS_BEFORE: 3,

  REPORTS: {
    DAILY_ADMIN_EMAIL: process.env.DAILY_REPORT_EMAIL || 'jophiri223@gmail.com',
    DAILY_SEND_TIME: process.env.DAILY_REPORT_TIME || '08:00',
    TIME_ZONE: process.env.DAILY_REPORT_TIMEZONE || 'Africa/Lusaka',
    // Single source of truth for the 10 BMF report types (Excel + PDF + admin panel + scheduler share this).
    REPORT_TYPES: [
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
    ]
  },

  LOGS: {
    ACCESS: 'logs/access.log',
    ERRORS: 'logs/errors.log'
  },

  // Trusted-token bypass REMOVED for public access (was: bare CLI-only strings
  // that map to no real user). Every authenticated request must now resolve to a
  // real user in users.json via findUserByDeviceToken. See
  // docs/plans/public-internet-access.md.
  TRUSTED_TOKENS: [],

  // Routes reachable WITHOUT a device token (deviceAuth skips these). Invite
  // validation must stay public so a prospective borrower can validate their
  // link on signup.html before any account/device token exists.
  PUBLIC_PATHS: [
    '/',
    '/signup',
    '/signup/confirm',
    '/signup/resend',
    '/login',
    '/login/confirm',
    '/password-reset',
    '/password-reset/confirm',
    '/status',
    '/health',
    '/favicon.ico',
    '/invites/validate'
  ]
};
