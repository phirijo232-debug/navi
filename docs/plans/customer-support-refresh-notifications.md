# Customer Support, Refresh States, and Notification Results

## Purpose
Make the customer Payments & Support options usable, show visible progress on refresh actions, and report notification delivery outcomes clearly.

## Progress
- [x] (2026-10-17) Trace customer feedback, refresh, and notification flows.
- [x] Add customer inquiry history and related loan references.
- [x] Add loading/completion feedback to refresh controls.
- [x] Show individual and broadcast notification success/failure counts and reasons.
- [x] Start the server and review changed JavaScript for syntax errors.
- [x] Convert the payment dispute area into loan-linked payment submission.
- [x] Block new loan requests while an outstanding loan is active, in grace, or defaulted.

## Decision Log
- (2026-10-17) Reuse the existing feedback endpoint and stored feedback records for inquiries; no new route is needed.
- (2026-10-17) Keep payment proof submission as the customer's payment action and label its destination “Payments & Support.”
- (2026-11-06) Payment submissions use the selected BMF loan receipt and existing proof-review workflow; the balance shown is read-only and the customer enters only the amount they are paying.
- (2026-11-06) Enforce the unsettled-loan request lock on both the customer UI and the request controller, including a delayed loan-load case.

## Surprises and Discoveries
- The customer “Inquiries” menu previously opened the generic feedback form; related loan IDs were not persisted and prior submissions were not shown.
- Several refresh buttons called async loaders without any visual busy state.
- Broadcast endpoints returned aggregate counts but UI feedback did not consistently distinguish partial failures or report reasons.

## Outcomes and Retrospective
Customer Payments & Support records payment proof against one selected BMF loan receipt and shows the current balance read-only. Active, grace, or defaulted loans with a remaining balance block new requests in the customer page and loan request controller. The lock explains the reason and links customers to My Loans. No route or middleware changes were needed.

## Concrete Steps
1. Updated `public/user.html` with receipt-linked payment submission, per-loan Record Payment buttons, read-only current balance, and a full-screen request lock.
2. Updated `controllers/loanController.js` to reject new requests while the signed-in customer has an active, grace, or defaulted loan with a positive outstanding balance.

## Validation
- `node --check` passed for the updated controller; inline customer script parsing and the loan lifecycle test passed.
- `node server.js` loaded environment configuration and stayed running without a startup error.
- Routes added/changed: none.
- Middleware changed: none.
- Body part: Skin and Brain.
