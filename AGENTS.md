# NaviServer — Agent Instructions
Project: Pryme Vertex / Buraza Micro Finance (BMF)
Stack: Node.js, Express, JSON file storage, Nodemailer

## CRITICAL RULES — NEVER VIOLATE

1. Do NOT add /theme routes — theme is localStorage only
2. Do NOT modify middleware/logger.js, middleware/otp.js, middleware/dataStore.js without explicit instruction
3. Do NOT use inline require() inside route handlers
4. Do NOT hardcode secrets — always use process.env
5. Do NOT break existing exports in any controller
6. Always run node server.js to verify the server starts after changes
7. Always add new routes to routes/index.js — never create separate route files
8. Never remove req.authUser population from middleware/security.js
9. Never remove existing try/catch circuit breaker blocks from any controller
10. Do NOT swap GMAIL_USER and ADMIN_EMAILS — they serve different purposes

## EMAIL ROLES
- SENDER: prymebmf@gmail.com (process.env.GMAIL_USER)
  Sends all OTPs and customer-facing emails
- ADMIN REPORTS: jophiri223@gmail.com (process.env.ADMIN_EMAILS)
  Receives all daily reports, error alerts, and admin notifications
- These are different accounts and must never be swapped or merged
- ALERT ROUTING: logError(msg, true) breakage alerts resolve the recipient as
  ERROR_EMAIL_RECIPIENT (explicit override) → ADMIN_EMAILS (first address) →
  ADMIN_EMAIL. Flood protection: one email per incident signature every
  15 minutes.
- BREAKAGE ALERT FORMAT: controllers/schedulers call
  logBreakage(file, handler, err, label) from middleware/logger.js. It logs
  "[file → handler] LABEL: message" to logs/errors.log and alerts the admin
  inbox (notify=true). Use it ONLY on money/silence-critical circuits (auth
  OTP flow, loan request/action/payment, report build/export, scheduler
  report/notification jobs). Read-only handlers, 4xx validations, unknown
  routes, and per-borrower notification failures stay log-only via
  logError(msg) — never alert the inbox for those.
- ALERT FALLBACK: if the alert email itself cannot be sent (Gmail/SMTP down),
  the incident is queued as JSON lines in logs/pending-alerts.log so no
  breakage alert is silently lost.

## AUTHENTICATION FLOW — DO NOT BREAK
After login, server returns a deviceToken to the client.
Client stores deviceToken in localStorage.
Every protected request sends: x-device-token header.
middleware/security.js reads that token, finds the user in users.json,
and sets req.authUser before the request reaches any controller.
req.authUser contains: email, username, role, storeId.
Never remove req.authUser population from security.js.
Admin checks use: req.authUser?.role === 'admin' or isAdminRole(req.authUser?.role)

## CIRCUIT BREAKER PATTERN — MANDATORY ON ALL CONTROLLERS
Every controller function must be wrapped in try/catch.
On catch: logError with function name, return 503 with user-friendly message.
Never remove existing try/catch blocks.
Pattern:
async function myFunction(req, res) {
  try {
    // logic here
  } catch (err) {
    logError(`MY_FUNCTION CIRCUIT TRIPPED: ${err.message}`);
    res.status(503).json({ error: 'Feature temporarily unavailable.' });
  }
}

## CONFIRMED WORKING ROUTES — DO NOT CHANGE PATHS
GET  /status
GET  /health
GET  /logs/access
GET  /logs/errors
GET  /sessions
GET  /loans
GET  /loans/all
GET  /loans/search
GET  /loans/:id
POST /loans/request
POST /loans/:id/action
POST /loans/payment
POST /loans/:id/payment-submissions
POST /loans/:id/payment-submissions/:submissionId/approve
POST /loans/:id/payment-submissions/:submissionId/decline
POST /loans/:id/notify-overdue
POST /loans/notify-overdue
POST /uploads/sign
GET  /reports/user
GET  /reports/all
GET  /reports/analytics
GET  /reports/:type            (typed-report JSON: daily, all-loans, payments-today, overdue, defaulters, monthly-collections, borrower-statements, approval-log, interest-revenue, repayment-performance, repayment-tracker)
GET  /reports/:type/export     (typed-report Excel)
GET  /reports/:type/pdf        (typed-report PDF)
GET  /reports/:scope/summary
GET  /reports/:scope/export
GET  /reports/:scope/profits
GET  /reports/:scope/defaulters
GET  /reports/:scope/overdue
GET  /reports/:scope/paid
GET  /reports/search
GET  /reports/user/:email
GET  /users
GET  /notifications
PATCH /notifications/:id/read
POST /signup
POST /signup/confirm
POST /signup/resend
POST /login
POST /login/confirm
POST /password-reset
POST /password-reset/confirm
POST /invites/create
GET  /invites/validate/:token
POST /invites/validate
POST /admin/users
POST /admin/announcements
POST /admin/backup
GET  /admin/backups
POST /admin/restore
POST /feedback
GET  /feedback
POST /feedback/:id/status
POST /vault/request
POST /vault/authorize
POST /internal-shutdown

## ROUTE ORDER RULES
Static routes must always come before dynamic routes in routes/index.js.
Example: /loans/search must appear before /loans/:id
Example: /reports/user must appear before /reports/:scope/...
Violating this causes the wrong handler to catch the request.

## FOLDER STRUCTURE — DO NOT REORGANISE
C:\NaviServer\
├── config\index.js
├── controllers\authController.js
├── controllers\loanController.js
├── controllers\logController.js
├── controllers\sessionController.js
├── controllers\statusController.js
├── controllers\reportController.js
├── controllers\feedbackController.js
├── data\loans.json
├── data\users.json
├── data\feedback.json
├── data\notifications.json
├── logs\access.log
├── logs\errors.log
├── middleware\dataStore.js
├── middleware\db.js
├── middleware\healthWatch.js
├── middleware\kidneys.js
├── middleware\email.js
├── middleware\logger.js
├── middleware\loanNotifications.js
├── middleware\dailyReport.js
├── middleware\otp.js
├── middleware\phoneNumber.js
├── middleware\security.js
├── middleware\storeScope.js
├── public\admin.html
├── public\admin.js
├── public\dashboard.html
├── public\dashboard.js
├── public\index.html
├── public\login.html
├── public\signup.html
├── public\forgot-password.html
├── public\user.html
├── public\style.css
├── routes\index.js
├── server.js
├── cli.js
├── stop.js
└── AGENTS.md

## BODY PART ARCHITECTURE
Skeleton      — folder structure (DONE)
Spine         — routes/index.js and all middleware (DONE)
Nervous system — middleware/security.js (DONE)
Brain         — all controllers (DONE)
Skin          — all public HTML/JS/CSS files (IN PROGRESS)
Heart         — SQLite via middleware/db.js behind dataStore (DONE — better-sqlite3, DB_MODE json|dual|sqlite, JSON mirror + crash fallback, scripts/import-json-to-sqlite.js)
Liver         — middleware/dataStore.js (DONE — atomic writes, backup, recovery)
Kidneys       — middleware/kidneys.js hourly sweep (DONE — expired OTPs, dead pending-auth, stale sessions/devices; cron '20 * * * *' + boot sweep)
Immune system — monitoring and alerts (DONE — logBreakage admin alerts, 15-min flood protection, pending-alerts.log fallback, GET /health two-tier, healthWatch heartbeat + outage alerts)
Lungs         — API flow and schedulers (DONE — dailyReport, loanNotifications)

## LOAN STATUS VALUES — USE THESE EXACT STRINGS FROM config.LOAN_STATUSES
pending, active, grace, defaulted, liquidated, paid, declined
Never use any other status string. Always reference config.LOAN_STATUSES constants.

## LOAN RECEIPT ID FORMAT
Loan receipt:   BMF-YYYYMMDD-XXXX  (e.g. BMF-20261010-4872)
Payment receipt: PAY-YYYYMMDD-XXXX  (e.g. PAY-20261010-3341)
Generate automatically on creation. Never allow duplicates.

## PAYMENT RECORD REQUIRED FIELDS
Every recorded payment must include:
- paymentReceiptId (auto-generated PAY-YYYYMMDD-XXXX)
- amount
- paymentDate (ISO timestamp)
- balanceBefore (outstanding before this payment)
- balanceAfter (outstanding after this payment)
- mode (Airtel Money / MTN MoMo / Cash / Bank Transfer / Other)
- note (optional, for dispute tracking)
- screenshot (filename from multer upload)
- recordedBy (req.authUser.email or req.authUser.username)

## APPROVAL DATE RULE
approvedAt is set ONLY when a loan is approved — the approve action writes the
canonical status 'active' (legacy records may still store 'approved').
approvedAt is used as the official borrowed/disbursement date in all reports.
Never use createdAt as the borrowed date in any report or customer view.

## CURRENCY FORMAT
Always format as: K X,XXX.XX (Zambian Kwacha)
Example: K 3,500.00 not 3500 or ZMW 3500

## DATE FORMAT
Always display as: DD/MM/YYYY
Example: 10/10/2026 not 2026-10-10

## PHONE VALIDATION
Zambian mobile only: 09XXXXXXXX or +2609XXXXXXXX
Regex: /^(\+?260|0)(?:(?:9[5-7]|7[6-7]|57)\d{7}|26\d{7})$/
Phone is MANDATORY on signup — never make it optional.

## INTEREST RATES BY TENURE
1 week  = 10%
2 weeks = 16%
3 weeks = 24%
4 weeks = 32%
These are fixed BMF rates. Do not change without explicit instruction.

## URGENCY LEVELS AND APPROVAL TIMEFRAMES
Standard  = 48 hours
Urgent    = 24 hours
Emergency = 4 hours

## GRACE PERIOD
GRACE_PERIOD_DAYS = 3 (from config)
Loans move to grace status 3 days before due date.
Loans move to defaulted status the day after due date if balance > 0.

## GRACE / DEFAULT PENALTY RATE
1.8% per day on the outstanding balance while a loan is in grace or defaulted
(controllers/loanController.js GRACE_DAILY_RATE = 0.018).
Editable per loan via that loan's graceDailyRate field.
Capped at 50% additional on the original principal.
Accrual is idempotent and runs daily via the scheduler (cron 5 0 * * *).

## ADMIN PANEL RULES
admin.html must redirect non-admin users to login.html on page load.
Check localStorage for role === 'admin' or role === 'store_admin'.
All admin fetch calls must include x-device-token header from localStorage.
Admin panel is the only place to approve, decline, record payments, and generate invite links.

## STORE SCOPE
DEFAULT_STORE_ID = 'buraza' (from config)
FRANCHISE_ID = 'pryme-vertex'
role 'admin' = full access to all stores
role 'store_admin' = access to their own store only
role 'user' = customer, no admin access at all

## ROLE & ACTION GATES (tested — do not widen without updating the tests)
isAdminRole(role) = admin | franchise_admin | store_admin
  Used for: loan/payment reads, recordPayment, overdue notifications, reports.
Loan DECISIONS (approve / decline / enter_grace / verify_overdue / liquidate)
  Restricted to role 'store_admin' only. test/storeScope.test.js and
  test/notificationFlow.test.js assert role 'admin' receives 403 — intentional
  franchise-scoping policy. Payments/notifications deliberately use isAdminRole.
Announcements (POST /admin/announcements)
  Senders: store_admin + franchise_admin only (role 'admin' gets 403 — tested).
  Recipients exclude ALL staff roles: admin, franchise_admin, store_admin.
  admin.html must hide the announcement button from role 'admin' to match.
HR / Employee Securities (GET/PATCH /hr/employees)
  admin + franchise_admin only.
FIELD HYGIENE (GET /users — public-facing even when authed): strip ALL
  credential material — password (hash), tokens (legacy blind credentials),
  AND trustedDevices (LIVE device tokens — leaking these lets any admin-panel
  reader impersonate the user). Return only safe summaries (device count +
  last-seen). Never return `safeUser` after destructuring to `...rest` —
  return `rest` or the tokens ride along untouched.

## ExecPlans
When implementing complex features or significant changes, create an ExecPlan
as described in docs/PLANS.md before writing any code.
An ExecPlan is a living document — update it as work progresses.
