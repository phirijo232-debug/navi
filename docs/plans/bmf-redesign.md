# BMF redesign

## Purpose
Give Buraza Micro Finance one public loan page and one back office, with a dark and light theme, username or email sign-in, and an optional emailed code. The live Vercel fixes stay in place.

## Progress
- [x] (2026-11-16) Applied the three Vercel and shared-OTP patches as their own commits.
- [x] (2026-11-16) Login accepts a username or email. A one-time code is sent only when requested. Older clients that omit the flag still get a code.
- [x] (2026-11-16) Clean URLs: `/` is the loan application, `/admin` is the back office. Old `.html` paths redirect.
- [x] (2026-11-16) Removed the store chooser and the Pryme Vertex server overview from the product flow.
- [x] (2026-11-16) Restyled the admin, public application, sign-in, signup, and password reset screens. Customer portal colors follow the same palette.
- [x] (2026-11-16) Report titles and Excel/PDF headers use plain BMF wording.

## Decision Log
- (2026-11-16) OTP stays the default when `requireOtp` is omitted, so existing mail and device tests keep working. The new screens send `requireOtp: false` unless the box is ticked.
- (2026-11-16) Network access (public or private) stays in Settings. The master-password check and the server-mode check were not changed.
- (2026-11-16) Lime text is used on the near-black theme. On the off-white theme, lime is a fill with near-black text, because lime on off-white fails WCAG AA.
- (2026-11-16) IBM Plex Sans is the UI face. IBM Plex Mono is available for small technical labels. Money uses the sans face with tabular figures.

## Surprises and Discoveries
- Dialogs were visible on every screen until the stylesheet stopped forcing `.modal` to display. They now stay closed until a screen opens them.
- The phone header search sat on top of the theme and notification icons. It now drops to its own row.
- An empty activity row was squeezed into a 10px grid column, so the sentence wrapped one word per line.

## Outcomes and Retrospective
Staff sign in at `/admin` and land on the BMF dashboard. Customers apply at `/`. Excel and PDF downloads remain on the reports screen. The old server overview is no longer a destination.

## Concrete Steps
- `git am` of the three patches in `/cursor/stores/bot/bmf/`.
- `controllers/authController.js` login lookup and optional OTP.
- `server.js` page routes and redirects. `vercel.json` redirects ahead of the filesystem.
- `public/style.css`, `public/admin.html`, `public/admin.js`, `public/index.html`, `public/login.html`, and the related public pages.
- `services/bmfPdf.js`, `services/bmfExcel.js`, `services/bmfPromptExcel.js`, `services/bmfPromptReports.js`.

## Validation
- `node --test` passes.
- `node server.js` starts.
- Screenshots at 390px and 1280px, dark and light, for login, dashboard, reports, loans, and the public loan page.
