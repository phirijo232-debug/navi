# Admin directory and access refresh

## Purpose
Make the existing Customers, HR, and Quick Screen Applications views reliably useful as searchable, date-filterable, paginated admin directories; make new Quick Screen submissions appear in the admin notification bell; allow the main admin account to make loan decisions; and ensure every dashboard sidebar section opens a dedicated, data-backed page rather than scrolling to a dashboard section.

## Body parts
- Brain: application notifications, application filtering data, and loan-decision authorization.
- Skin: Customers, HR, and Applications search/date/pagination controls and consistent admin message styling.
- Spine: no new routes. Preserve existing route paths and middleware order.

## Progress
- [x] (2026-11-03) Read both attached dashboard specifications; verified they are identical and reviewed current admin, application, customer, HR, notification, and loan-decision wiring.
- [x] The reported mixed-theme issue is the notification bell dropdown; keep its panel, message text, and actions consistent in both themes.
- [x] Add searchable, date-filterable, paginated customer, HR, and applicant directories, including loan-only customers and visible empty/error/loading states.
- [x] Persist and surface Quick Screen submissions in the existing authenticated admin notification bell; provide Approve, Decline, and View actions.
- [x] Permit the main `admin` role to make loan decisions, preserving record/store checks for other roles.
- [x] Add/adjust focused regression tests for filters, applicant notifications, and authorized loan decisions.
- [x] Run focused and full tests plus `node server.js` and `GET /status`; record the pre-existing route-wiring failure separately.
- [x] Rebuild the dashboard shell to the supplied dark Aura-style specification while preserving current routes and all existing actions.
- [x] Replace example-like dashboard values with live API-derived KPI, chart, activity, loan-table, and loyalty metrics.
- [x] Add a Reports Platform entry to the business menu that opens the manual report cards.
- [x] Validate responsive dashboard navigation, charts, actions, and the dark-only admin view.
- [x] (2026-11-03) Audit every sidebar item and its API-backed view; separate pages for loans, payments, overdue, defaulters, HR, customers, applications, and reports.
- [x] Fix borrower/customer records rendering and expose complete payment history with search/date filters and clear empty/error states.
- [x] Remove the redundant top-left menu and route all sidebar navigation to page-level views without losing existing role gates/actions.
- [x] Re-run targeted/full tests and verify `node server.js` plus `/status`.
- [ ] Inspect follow-up Back buttons and applicant-profile attachment links in an authenticated browser session.
- [x] (2026-11-03) Fix the confirmed Quick Screen attachment signing denial; notify admins on applications with visible delivery failures; show applicants in the customer directory without creating passwordless login accounts; add back navigation to every detail page; and send both borrower/admin notifications for admin-created loans.

## Decision log
- 2026-11-03: The two user attachments have matching SHA-256 hashes and contain the same 789-line dashboard specification. Treat them as one authoritative read-only specification.
- 2026-11-03: The current user data stores `jophiri223@gmail.com` with role `admin`. Permit the `admin` role in loan decisions instead of adding an email-specific bypass; existing record/store authorization remains in force.
- 2026-11-03: The mixed-theme report refers to the notification bell dropdown, so align its contents and action controls in light and dark modes.
- 2026-11-03: Keep report calculations and API routes unchanged. Use the existing authenticated endpoints and device-token/store headers.
- 2026-11-03: Treat all prompt examples as illustrative only; render records from the existing JSON-backed APIs and derive loan-only customer summaries only from actual loan fields.
- 2026-11-03: The duplicated admin UI prompts have matching SHA-256 hashes. Implement their structure with existing authenticated API paths; the prompt's sample names, IDs, amounts, and dates are not production data and must not be added.
- 2026-11-03: Prefer the existing local SVG chart implementation over a new CDN dependency if CSP blocks remote scripts; chart values must still come from live loan/payment records.
- 2026-11-03: Separate directory pagination from the later full dashboard redesign so customer/request lists do not grow without limit while the original dashboard specification is implemented deliberately.
- 2026-11-03: Do not guess which long-message surface has the reported mixed theme; ask the user to identify it before styling that component.
- 2026-11-03: Keep the redesigned admin dashboard dark regardless of the shared `mode` preference; other customer-facing pages continue using their existing theme behavior.
- 2026-11-03: The Reports Platform menu action returns to the dashboard and scrolls directly to the existing manual report cards; it does not add a duplicate report screen or endpoint.
- 2026-11-03: Replace scroll navigation with page-level admin views; add focused pages only for existing loan/payment data and preserve the existing route/auth/store-scope contracts.
- 2026-11-03: Customers is a system-wide registered-customer directory for the main admin, not a growing subset of pending loan requests; retain safe summaries from the existing `/users` endpoint and do not expose credentials or device tokens.
- 2026-11-03: The error log confirms `SIGNED LINK DENIED` for Quick Screen filenames because `fileController.canViewFile` only checks loan records. Extend authorization to application records, retaining admin store scope and borrower ownership.
- 2026-11-03: Quick Screen applicant records will appear in Customer Management as clearly labeled application/prospect entries; do not create login accounts without a password/verified signup flow.
- 2026-11-03: Manual admin-created loans must notify both customer and authorized admin via in-app and email channels; log skipped or failed mail delivery instead of swallowing it.
- 2026-11-03: Add page-history-aware Back controls to all standalone admin pages so navigation can return to the prior page and cannot strand the user.
- 2026-11-03: Admin application emails use the shared configured admin-recipient resolver (ADMIN_EMAILS/ADMIN_EMAIL and report-mailbox fallback); delivery failures and skips are now logged instead of discarded.
- 2026-11-03: Admin-created loans now create borrower and admin in-app notifications and attempt customer/admin email delivery after persistence. Notification/email failure is logged without misreporting a successfully persisted loan as failed.

## Surprises and discoveries
- Both attachments are identical copies of the dashboard prompt.
- The customer view already fetches registered users, loan metadata, supports text search, and shows explicit errors; it has no pagination or date filters.
- The HR view has explicit loading and error states, but no search, time filters, or pagination.
- The Quick Screen Applications view has explicit loading/error handling but no filters/pagination. New applications are stored in `applications.json`, but submission currently creates no in-app notification; the bell's visible notification list is sourced from `notifications.json`.
- The Quick Screen bell's pending-count request and the notification-list request are separate. A pending count alone does not make an application appear in the notification dropdown.
- `jophiri223@gmail.com` is a main `admin`, not a `franchise_admin`. `updateLoanStatus` currently permits `store_admin` and `franchise_admin`, explicitly rejecting the `admin` role before normal store-scope checks.
- Existing tests intentionally encode the previous loan-decision policy and must be revised only for the user-authorized change.

## Outcomes and retrospective
The directories now use live customer, employee, application, and loan records; customer profiles found only in loan management are included using actual loan fields. Quick Screen notifications are persisted per authorized staff recipient, idempotently backfilled, and scoped by store. Main-admin loan decisions are enabled without changing record/store scoping. The dashboard now uses live loans, payments, and feedback; search, status filters, range controls, pagination, sidebar navigation, quick actions, the Reports Platform menu link, and dark-only theme are wired. Prompt example data is not used. The current live ledger validates across all nine issued loans; the previously reported K18.79 discrepancy was an accrued grace penalty absent from the persisted outstanding balance and is now reconciled. Focused admin/report tests pass (20/20). Server startup and `GET /status` returned HTTP 200 using an isolated verification port.

The 2026-11-03 follow-up confirmed repeated signed-link denials for existing Quick Screen uploads; the files existed but authorization only searched loan records. Application uploads now use the same applicant-ownership/admin-store-scope checks. Admin email recipient fallback and delivery logging were fixed; application prospects now appear in Customer Management; standalone pages receive history-aware Back controls; and admin-created loans notify both borrower and scoped admin. Focused tests pass (15/15), the complete suite passes, `git diff --check` and JavaScript syntax checks pass, and the isolated server returned HTTP 200 at `/status`. The public POST smoke check used an empty form and created no record.

## Concrete steps
1. Audit `public/admin.html`/`public/admin.js` sidebar controls and the existing user, HR, loan, payment, notification, report, and application API contracts.
2. Add page-level admin panels for dashboard, loans, payments, overdue, defaulters, reports, HR, customers, and Quick Screen; route sidebar controls to those views and remove the duplicate top-left menu.
3. Ensure customer/HR directories load live records with searchable, date-filterable pagination; show loan-only borrowers only as summaries backed by real loans.
4. Build a payment-history page from recorded payments in accessible loans, with borrower/receipt search and date range filters; do not infer payment schedule or payment records.
5. Add overdue/defaulter pages from canonical loan statuses and positive outstanding balances, with search/date filters and existing safe actions.
6. Preserve role visibility, authorization, store scopes, notification review actions, and all existing routes.
7. Add regression tests for each page entry, data binding, filters, and empty/error/loading states.
8. Run targeted/full tests, check syntax/diff, start `node server.js`, request `/status`, and validate the admin UI once the user signs into the shared browser session.

## Routes affected
No routes should be added or renamed for this UI refresh. Existing behavior is exercised on:
- `GET /users`
- `GET /hr/employees`
- `GET /api/apply`
- `PATCH /api/apply/:id`
- `GET /notifications`
- `PATCH /notifications/:id/read`
- `GET /loans/all`
- `GET /loans`
- `GET /loans/search`
- `POST /loans/:id/action`
- `POST /loans/payment`

## Validation
- Customer, HR, and Applications panels filter by identity/record metadata and date range, have deterministic pagination, and show informative zero-result states.
- Quick Screen submission creates a persisted unread notification visible only to authorized admins in the correct store; marking it read persists.
- The `admin` role can approve/decline an accessible loan; unrelated users and out-of-scope roles/records remain denied.
- Focused frontend integrity, application, notification, HR, and store-scope tests pass.
- `node server.js` starts and `GET /status` returns HTTP 200.
- Full-suite failures unrelated to this change are reported, not silently fixed.
