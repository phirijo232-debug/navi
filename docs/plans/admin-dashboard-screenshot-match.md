# Admin Dashboard Screenshot Match

## Purpose
Reshape the BMF admin dashboard to follow the user-provided screenshots while retaining the existing authenticated actions, reports, customer/HR sections, payment review safeguards, and current API contracts.

## Progress
- [x] (2026-10-17) Read the screenshots and map them to the admin page.
- [x] (2026-10-17) Inspect current dashboard renderers and interaction wiring.
- [x] (2026-10-17) Rebuild the admin dashboard shell and screenshot-matched sections.
- [x] (2026-10-17) Connect dashboard panels to existing loan, customer, feedback, notification, and quick-action data/actions.
- [x] (2026-10-17) Verify element wiring and server startup; record remaining visual limitations.

## Decision Log
- (2026-10-17) Treat the screenshots as the visual source of truth for admin layout, while retaining existing server routes and role gates.
- (2026-10-17) No routes or controller behavior changed; this is a Skin-layer change using current API data.
- (2026-10-17) Do not fabricate borrower phone, tier, recent activity, or KPI data when the API does not provide it; show available safe values or a neutral fallback.
- (2026-10-17) Keep store switching and logout available in the anchored business menu so the topbar matches the supplied reference more closely.

## Surprises and Discoveries
- The current dashboard has portfolio KPIs, collections SVG, recent activity, and returning borrowers, but lacks the screenshot's loan management table and notification dropdown.
- Existing admin quick actions, customer list, feedback, reports, and payment review already have working actions in other dashboard sections; these will be reused or exposed in the new layout.
- Backup/restore API exists but is not part of the screenshot and will remain outside this visual scope.

## Outcomes and Retrospective
The admin dashboard now follows the supplied dark BMF dashboard composition: four colored KPI cards, monthly collections chart, activity feed, loan table, returning-borrower table, feedback preview, and stacked quick actions. The notification bell uses the existing scoped `/notifications` APIs. Loan-row actions open the existing customer detail workflow; overdue rows use the existing overdue-notification route. The API contracts and server role gates were not changed. Startup and static DOM checks passed. Visual comparison in a live browser remains unavailable in this session.

## Concrete Steps
1. Edit `public/admin.html` to add the fixed screenshot-style topbar, anchored business menu, dashboard KPI/chart/activity/table/customer/feedback/quick-action composition, and notification popover while retaining auth, customer, HR, and modals.
2. Edit `public/admin.js` to render screenshot sections from existing `portfolioLoans`/`allUsers`, load available notifications, and wire search, notification, row actions, export, and quick actions without changing route contracts.
3. Edit `public/style.css` for responsive BMF dark dashboard styling.
4. Run syntax checks and `node server.js`; inspect diffs and confirm all newly queried IDs/selectors exist in HTML.

## Validation
- `node --check public/admin.js` passed.
- `node server.js` started on port 3000 in PUBLIC mode with schedulers initialized; process was stopped after startup verification.
- Static DOM check passed for 137 literal IDs, with no duplicate IDs.
- `npm.cmd test` passed: 132 tests, 0 failures. PowerShell blocked the `npm` script shim, so the Windows command wrapper was used.
- `git diff --check` passed after cleaning the HTML file ending.
- Browser visual verification was unavailable because no browser surface is enabled; CSS follows the supplied screenshots but rendered pixel comparison remains unverified.

## NaviServer Specific
- Body part: Skin.
- Routes added/changed: none.
- `node server.js` startup is required after changes.
- Existing tests are not modified; no middleware changes are planned.
