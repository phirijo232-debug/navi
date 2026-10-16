# Admin Dashboard Screenshot Match

## Purpose
Reshape the BMF admin dashboard to follow the user-provided screenshots while retaining the existing authenticated actions, reports, customer/HR sections, payment review safeguards, and current API contracts.

## Progress
- [x] (2026-10-16) Read the screenshots and map them to the admin page.
- [x] (2026-10-16) Inspect current dashboard renderers and interaction wiring.
- [ ] Rebuild the admin dashboard shell and screenshot-matched sections.
- [ ] Connect each new visual section to existing loan, customer, feedback, notification, and quick-action data/actions.
- [ ] Verify element wiring and server startup; record remaining visual limitations.

## Decision Log
- (2026-10-16) Treat the screenshots as the visual source of truth for admin layout, while retaining existing server routes and role gates.
- (2026-10-16) No routes or controller behavior are planned; this is a Skin-layer change using current API data.
- (2026-10-16) Do not fabricate borrower phone, tier, recent activity, or KPI data when the API does not provide it; show available safe values or a neutral fallback.

## Surprises and Discoveries
- The current dashboard has portfolio KPIs, collections SVG, recent activity, and returning borrowers, but lacks the screenshot's loan management table and notification dropdown.
- Existing admin quick actions, customer list, feedback, reports, and payment review already have working actions in other dashboard sections; these will be reused or exposed in the new layout.
- Backup/restore API exists but is not part of the screenshot and will remain outside this visual scope.

## Outcomes and Retrospective
Pending implementation.

## Concrete Steps
1. Edit `public/admin.html` to add the fixed screenshot-style topbar, anchored business menu, dashboard KPI/chart/activity/table/customer/feedback/quick-action composition, and notification popover while retaining auth, customer, HR, and modals.
2. Edit `public/admin.js` to render screenshot sections from existing `portfolioLoans`/`allUsers`, load available notifications, and wire search, notification, row actions, export, and quick actions without changing route contracts.
3. Edit `public/style.css` for responsive BMF dark dashboard styling.
4. Run syntax checks and `node server.js`; inspect diffs and confirm all newly queried IDs/selectors exist in HTML.

## Validation
- `node --check public/admin.js`
- `node server.js` starts cleanly.
- Static check verifies all literal admin.js `getElementById` IDs and queried data attributes have matching HTML.
- Browser visual verification is limited by the available UI environment; compare against supplied screenshots and report this limitation if no browser becomes available.

## NaviServer Specific
- Body part: Skin.
- Routes added/changed: none.
- `node server.js` startup is required after changes.
- Existing tests are not modified; no middleware changes are planned.
