# Customer Support, Refresh States, and Notification Results

## Purpose
Make the customer Payments & Support options usable, show visible progress on refresh actions, and report notification delivery outcomes clearly.

## Progress
- [x] (2026-10-17) Trace customer feedback, refresh, and notification flows.
- [x] Add customer inquiry history and related loan references.
- [x] Add loading/completion feedback to refresh controls.
- [x] Show individual and broadcast notification success/failure counts and reasons.
- [x] Start the server and review changed JavaScript for syntax errors.
- [ ] Convert the payment dispute area into loan-linked payment submission.
- [ ] Block new loan requests while an outstanding loan is active, in grace, or defaulted.

## Decision Log
- (2026-10-17) Reuse the existing feedback endpoint and stored feedback records for inquiries; no new route is needed.
- (2026-10-17) Keep payment proof submission as the customer's payment action and label its destination “Payments & Support.”
- (2026-10-17) Payment submissions must use the selected BMF loan receipt and existing proof-review workflow; the balance shown is read-only and the customer enters only the amount they are paying.
- (2026-10-17) Enforce the unsettled-loan request lock on both the customer UI and the request controller.

## Surprises and Discoveries
- The customer “Inquiries” menu previously opened the generic feedback form; related loan IDs were not persisted and prior submissions were not shown.
- Several refresh buttons called async loaders without any visual busy state.
- Broadcast endpoints returned aggregate counts but UI feedback did not consistently distinguish partial failures or report reasons.

## Outcomes and Retrospective
Customer Payments & Support now includes payment history, inquiry submission/history, payment disputes, and due schedules. Refresh buttons show progress, and notification feedback identifies success, failure, and partial delivery with available provider reasons. No route or middleware changes were needed.

## Concrete Steps
1. Updated `public/user.html` support tabs, inquiry fields/history, and customer refresh states.
2. Updated `controllers/feedbackController.js` to persist the optional related loan reference.
3. Updated `public/admin.js` to show loading states for refresh buttons and clear notification results.
4. Updated `controllers/loanController.js` and `controllers/authController.js` broadcast results to include failure reasons where available.

## Validation
- `node --check public/admin.js` and inline customer script parsing passed.
- `node server.js` loaded environment configuration and stayed running without a startup error.
- Routes added/changed: none.
- Middleware changed: none.
- Body part: Skin and Brain.
