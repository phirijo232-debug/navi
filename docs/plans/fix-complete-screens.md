# Fix and complete screens

## Purpose

Make every existing Navi screen load and complete its flow for customers, store staff, and the main admin, on top of the Northline palette. No new product areas.

## Progress

- [x] (2026-11-01) Branch from the Northline palette work
- [x] (2026-11-01) Install dependencies and seed demo accounts
- [x] (2026-11-01) Fix role routing, live loan status, currency format, empty and error states, and the payments list
- [x] (2026-11-01) Exercise the API and the key screens
- [x] (2026-11-01) Open a pull request based on the palette branch

## Decision Log

- (2026-11-01) Public login sends `store_admin` and `franchise_admin` to admin.html and `admin` to dashboard.html. Customers stay on user.html.
- (2026-11-01) Loan lists include the server-derived `businessStatus` so grace and default follow the due date, and the new-request queue uses that status.
- (2026-11-01) Customer money uses `K 3,500.00`. The About screen no longer prints the device token.
- (2026-11-01) Suggested follow-ups stay out of this change: operating expenses for net profit, a second store, and live email OTP without Gmail credentials.

## Surprises and Discoveries

- (2026-11-01) Public login sent every non-`admin` role, including store staff, to the customer account.
- (2026-11-01) The new-request queue compared the raw stored status, so legacy values such as `rejected` fell through as pending, and the clock-derived grace state never reached the screen.
- (2026-11-01) Customer amounts rendered as `K6240` or `K0` because the formatter omitted the space and the two decimal places.

## Outcomes and Retrospective

The API listens with exceljs installed. Demo accounts exercise customer, store, franchise, and main-admin screens. Public login now sends staff to the control panel. Loan reads include the live business status, money is formatted as K 1,500.00, the payments screen lists receipts, and the franchise panel no longer sits on “Loading…” for other roles. Approve and record-payment both succeeded against the demo loan. Follow-ups are listed in the pull request, not built.

## Concrete Steps

1. `npm install` so exceljs and the rest of package.json are present.
2. `node scripts/seed-demo.js` writes gitignored demo data.
3. Edit login routing, loan responses, admin request filter, dashboard empty states, and the customer payments and currency display.
4. `node server.js`, then curl each role and screenshot the working screens.

## Validation

- Routes are unchanged.
- `node server.js` listens.
- Customer, store admin, and main admin screens show real seeded records.
- Existing loan and store-scope tests still pass.

## NaviServer rules

- Body part: Skin, plus the loan read responses the screens already call.
- Routes added or changed: none.
- Do not edit middleware/logger.js, middleware/otp.js, or middleware/dataStore.js.
