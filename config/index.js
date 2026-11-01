module.exports = {
  PORT: Number(process.env.PORT) || 3000,
  HOST: '0.0.0.0',
  FRANCHISE_ID: 'pryme-vertex',
  DEFAULT_STORE_ID: process.env.DEFAULT_STORE_ID || 'buraza',
  STORES: [
    { id: 'buraza', name: 'Buraza Micro Finance', code: 'BMF', active: true }
  ],
  SHUTDOWN_KEY: process.env.SHUTDOWN_KEY || process.env.MASTER_KEY || 'phirii26',

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
  // Extra calendar days AFTER the due date before the loan is marked defaulted.
  // 0 matches the written rule: defaulted the day after the due date.
  // Grace still begins GRACE_PERIOD_DAYS before the due date, including the due date.
  DEFAULT_GRACE_DAYS: 0,
  // 1.8% of the pinned balance, charged on the day grace or default starts.
  GRACE_DAILY_RATE: 0.018,
  CHARGE_GRACE_ENTRY_DAY: true,
  // Paying early does not reduce the interest agreed for the weeks.
  EARLY_PAYOFF_KEEPS_FULL_INTEREST: true,
  // How much a customer may have out at once, until staff set their own limit.
  DEFAULT_CREDIT_LIMIT: 10000,
  // A second loan needs the shop to tick "allow another loan" on that customer.
  MAX_OPEN_LOANS: 1,
  REMINDER_DAYS_BEFORE: 3,

  REPORTS: {
    DAILY_ADMIN_EMAIL: process.env.DAILY_REPORT_EMAIL || 'jophiri223@gmail.com',
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