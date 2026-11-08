# ExecPlan — Custom Loan Tenure and Daily Extension Interest

## Purpose
Allow customer-requested loan terms longer than four weeks to retain the requested duration and calculate a transparent, consistent simple-interest estimate. Preserve current one-to-four-week rates and use the approved date as the start of the loan term.

## Body parts
Brain (loan calculation and persistence), Skin (customer/admin forms and displays), Spine (quote endpoint), and records/reports (term display).

## Progress
- [x] (2026-11-08) Trace existing customer/admin term selection, hard-coded BMF rates, backend limits, due-date logic, and report/email term displays.
- [x] Confirm selected model: keep the 1–4 week ladder; after 28 days charge a separate daily extension rate, scaled proportionally to the configured one-week rate.
- [x] Clarify scope: this is the customer's custom-date term on New Loan Request. The extension calculation ends at the requested due date and does not add term interest for overdue days. Add manual rate editing for `admin` and `franchise_admin`.
- [x] Centralize the rate policy, persist it per store, and implement validated custom-day interest calculations.
- [x] Add a rate-management page and server update gate for `admin` and `franchise_admin` only; audit each update.
- [x] Persist exact requested term days; on approval, start that many calendar days from the Lusaka approval date.
- [x] Update customer and admin estimate/term displays to use the same server policy.
- [x] Update reports, profile/history, and email term labels to show custom durations accurately.
- [x] Add regression coverage for week-rate parity, extension rate, limits, request-to-approval delay, and tampered client estimates.
- [x] Run targeted checks, full tests (187 passed), `git diff --check`, and `node server.js` startup (port 3000, private mode).

## Pricing policy
- Existing week tiers remain 10%, 16%, 24%, and 32% at 7, 14, 21, and 28 days.
- For custom terms through day 28, interpolate linearly between the existing weekly checkpoints so a custom date has a continuous simple-interest estimate; exact week durations retain exact current tier rates.
- For days above 28, preserve the 32% rate at day 28 and add 0.10 percentage points per additional day at the current 10% one-week baseline. Scale that daily extension in direct proportion to the configured one-week rate. Example: if the one-week tier changes from 10% to 12%, the extension changes from 0.10% to 0.12% per extra day.
- No compounding. Interest is based on original principal. Total rate is capped by the maximum supported term; loan term maximum is 153 calendar days (five calendar months rounded to the longest five-month span).
- The selected term is the duration from approval, not the time since request. Pending requests retain their requested day count; approval sets the due date to approval's Lusaka date plus that count.
- Existing loan records and financial obligations are not migrated by this change.

## Decision log
- (2026-11-08) The user selected a separate daily extension rate. Adopt 0.10 percentage points/day as the example baseline previously offered, scaled proportionally to the 1-week rate; preserve all established 1–4 week rates.
- (2026-11-08) The system had no rate-settings UI or single source of truth. Persist a store-scoped rate policy; expose its read-only policy to signed-in customers; allow only admin/franchise_admin to edit; backend remains authoritative on loan creation.
- (2026-11-08) Apply term-extension interest only through the agreed due date. Do not add the extension rate to overdue days or alter existing grace/default penalty behavior in this task.
- (2026-11-08) Keep custom term days, not rounded weeks, as the authoritative duration; retain a compatibility week field only for legacy consumers and update customer-facing term formatting.

## Routes added or changed
- Add `GET /loans/interest-policy` (authenticated): expose current non-secret rates/term limits for customer and admin previews.
- Add `PATCH /admin/loan-interest-policy`: update only the selected accessible store's rates; authorize `admin` and `franchise_admin`, deny customers and `store_admin`.
- Change `POST /loans/request` validation to derive and validate the exact duration from the selected due-date calendar day; ignore any client-computed interest totals.
- Change `POST /admin/loans` to use the same server-side term and interest calculator.

## Files to inspect/change
- `config/index.js`
- `controllers/loanController.js`
- `routes/index.js`
- `public/user.html`
- `public/admin.html`, `public/admin.js`
- `public/dashboard.js`
- `middleware/email.js`
- `controllers/reportController.js`, `services/bmfReports.js`, `services/bmfPdf.js`, `services/bmfPromptExcel.js`, `services/bmfPromptReports.js`
- `AGENTS.md`, `test/loanWorkflow.test.js`, relevant portal/report tests

## Validation
- Exact 7/14/21/28-day rates remain 10/16/24/32%.
- Non-week custom terms interpolate without discontinuities through day 28.
- A 90-day term has 38.2% simple interest at the baseline 0.10 percentage-point daily extension; a 153-day term is within the configured maximum.
- Changing the one-week configured rate scales the extension rate proportionally.
- Forged interest, total, and tenure-week fields cannot override server calculation or selected due-date duration.
- Approval after request preserves the requested number of days from the approval date.
- `node --test`, JavaScript syntax checks, `git diff --check`, and `node server.js` startup.
