# Money rules and backup correctness

## Purpose
The shop book uses the written loan rules: due date is approval day plus the agreed weeks, a request is not money already owed, default is the day after the due date, the first late day is charged, fees are real only when typed, a pledge sale reduces what is owed, and a wrong payment can be undone. Backups include the expense book. Login codes survive a restart.

Body parts: Brain (loan and report controllers), Liver (data file list), Kidneys (OTP and pending auth), Skin (request form and admin loan panel).

## Progress
- [x] (2026-11-01) Money rules, Lusaka dates, backups, OTP persistence, tests
- [ ] Customer documents, KYC, limits (next pull request)
- [ ] Staff, cash, reporting
- [ ] Messaging, multi-store, operations

## Decision Log
- (2026-11-01) DEFAULT_GRACE_DAYS = 0. Written rule: defaulted the day after the due date. Grace still starts 3 days before, including the due date. A longer grace only happens when staff enter an agreed grace-until date.
- (2026-11-01) CHARGE_GRACE_ENTRY_DAY = true. 1.8% is charged on the day the loan enters grace or default. The cap stays 50% of principal.
- (2026-11-01) EARLY_PAYOFF_KEEPS_FULL_INTEREST = true. Paying early does not reduce the agreed interest. Said on the request terms.
- (2026-11-01) Existing approved loans keep the due date already stored. The new sum applies the next time a loan is approved. Balances are not rewritten backwards except the late-fee formula, which is idempotent and adds a missed first day once.
- (2026-11-01) A fee typed on a payment is income. It does not reduce the loan balance.
- (2026-11-01) Collateral sale amount is required (0 allowed). The amount up to the balance is recorded like a payment. Anything still owed stays on the loan.
- (2026-11-01) Only the store admin can undo a payment, and the original row is kept.
- (2026-11-01) The built-in master password lines were not edited.

## Surprises and Discoveries
The public-mode startup check sits beside the master-password line, so it was left unchanged.

## Outcomes and Retrospective
Money and backup items from the owner review are in this branch. Documents, cashier, messages, and extra stores follow.

## Concrete Steps
- middleware/calendar.js — Lusaka day and contract due date
- middleware/dataFiles.js — one list used by backups and the database copy
- controllers/loanController.js — status, penalty, approval date, sale, undo, fee
- config/index.js — the three policy constants (SHUTDOWN_KEY line untouched)

## Validation
`node --test` and `node server.js`. On the request screen, the due-date sentence is visible. Approving a 1-week loan sets a due date 7 days after the approval day. The portfolio total skips pending requests. A backup file lists expenses.json.

## Routes
- POST /loans/payment/reverse (store admin, reason required)
