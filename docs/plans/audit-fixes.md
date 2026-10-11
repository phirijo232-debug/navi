# ExecPlan — Server audit fixes (10/11/2026)

Goal: resolve inconsistencies found in the cross-cutting server audit
(backend vs frontend interest rates, non-canonical status writes, legacy
summary buckets, announcement/recipient role filters, dead ledger-corrupting
action branch, stale AGENTS.md docs).

## Changes
- [x] `public/admin.js` — weeklyRate ladder aligned to backend calculateInterest (10/16/24/32%).
- [x] `public/admin.js` — announcement button hidden for role 'admin' (backend 403 is tested policy).
- [x] `public/admin.js` — announcement recipient count + add-loan customer picker exclude franchise_admin.
- [x] `controllers/loanController.js` — approve and in_progress actions write canonical 'active'.
- [x] `controllers/loanController.js` — removed dead `record-payment` branch (no receipt/ledger; borrowers could zero their own balance — payments go through POST /loans/payment only).
- [x] `controllers/loanController.js` — getAllLoans summary uses canonical buckets via deriveLoanStatus.
- [x] `controllers/authController.js` — announcement recipients exclude franchise_admin; gate comment added.
- [x] `test/loanAuditTrail.test.js` — assertions updated for canonical status + summary buckets.
- [x] `AGENTS.md` — ADMIN_REPORTS address corrected (jophiri223; jophiri232 is ERROR_EMAIL_RECIPIENT override), grace penalty 1.8%/day, approval-date rule, immune-system status, new ROLE & ACTION GATES section.

## Validation
- [x] `npm test` green — 68/68 pass, exit code 0.
- [x] Boot check: fresh `node server.js` (PORT=3198) + GET /status → 200. Hoisted module-level requires resolve at startup (no circular-import breakage).

## Round 2 — remaining unfixed items
- [x] AGENTS rule 3 (no inline require in handlers/module scope misuse): removed all 12 inline
      `require('./loanController')` calls in controllers/reportController.js (lines 190/208/215/316/
      480/556/710/742/940/953/1031/1058) and the inline require in middleware/loanNotifications.js:124.
      All symbols (getEnrichedLoans, summarizeStore, searchLoansByReceipt, normalizeStatus,
      getLoansData, deriveLoanStatus) are now imported once at module top. loanController does not
      import loanNotifications/reportController, so hoisting is cycle-safe (confirmed by boot + tests).
- [x] controllers/reportTracking.js:111 copy-paste bug — totalInterestCollected read
      totalInterestBooked (booked≠collected). Now reads storeSummary.totalCollected.
- [x] public/user.html:897 decision-button gate was role==='admin' but backend rejects 'admin'
      with 403 (decisions are store_admin-only). Changed to store_admin so shown buttons match
      what the API accepts.
- [x] `npm test` green again — 68/68 pass, exit code 0 (includes runDueDatePass, which exercises
      the hoisted loanNotifications require).
- [x] Boot check: fresh `node server.js` (PORT=3198) + GET /status → 200.

## Notes
- Backend announcement/decision gates intentionally NOT widened: test/notificationFlow.test.js and test/storeScope.test.js assert 403 for role 'admin'. UI was aligned to the tested backend policy instead.
- A live server instance (old code) may still be running on port 3000 — restart it to pick up these fixes.