# TODO - PC admin + loan workflow (desktop only)

## Confirmed this week: necessary for the project

- [x] Review the current user flow and server-side loan logic to confirm the real gaps.
- [ ] Finalize the desktop-only UX and keep the dark theme untouched while adding light-mode clarity where required.
- [ ] Extend the user loan request form with timeframe/urgency fields and the matching interest calculation.
- [ ] Add a complete user loan history area with filters for recent periods and computed totals/interest.
- [x] Implement invite-based onboarding so a customer can only sign up for the intended loan flow.
- [ ] Build the admin loan review workflow: create invite, approve/start/close/pay actions, and summary reporting.
- [ ] Validate the backend loan status logic against real user actions and repayment events.
- [ ] Run an end-to-end desktop QA pass for signup -> login -> dashboard -> loan request -> history -> admin review.

## Additional items that bring clear project value

- [ ] Add stronger server-side validation for all loan submissions and updates so invalid data cannot slip through.
- [x] Add explicit audit trail fields for loan actions, timestamps, and who changed what.
- [x] Add overdue detection and repayment reminders to reduce manual follow-up.
- [x] Add admin reporting exports (CSV or PDF) for loans, totals, and outstanding balances.
- [x] Add notification hooks for approval, payment, and overdue events using the email path already in place.
- [x] Add backup/restore handling for users and loan records to protect project data.
- [x] Notify the admin inbox when a server breakage trips a circuit breaker (logError notify path with 15-minute flood protection per incident).
- [x] Enrich breakage alerts with [file → handler] prefixes, expand notify coverage to every money/silence-critical circuit (auth, loans, reports, schedulers), and queue unsent alerts to logs/pending-alerts.log when Gmail is down.
- [ ] Add UI polish for status badges, summary cards, and error messages for faster admin use.
- [ ] Add a strict release checklist before deployment: env checks, login flow, invite checks, and data integrity checks.
- [x] Partial `?token=` hardening (LAN mitigation): redact the device token from `logs/access.log`, set `Cache-Control: no-store` + `Referrer-Policy: no-referrer` on image responses, and log a warning when a file is opened via the URL token.
- [x] Deployment gate (blocking): `server.js` refuses `PUBLIC_DEPLOY=true` boot unless `SIGNING_SECRET` is set AND `MASTER_KEY` is a non-default value.
- [x] Deployment security: replaced the `?token=` image fallback with short-lived signed URLs — `POST /uploads/sign` issues a 10-minute HMAC link only after the ownership/store check passes; `serveFile` rejects raw `?token=` with 403. The device token no longer appears in any URL.
- [ ] PUBLIC_DEPLOY go-live: set `SIGNING_SECRET` (long random) in `.env`, then set `PUBLIC_DEPLOY=true` and boot behind one reverse proxy / ngrok (`app.set('trust proxy', 1)` already in place).



## Operations / infrastructure

- [x] Core organs shipped (2026-10-13): **Heart** = SQLite document store (`middleware/db.js`) behind the unchanged `dataStore` API via `DB_MODE` json|dual|sqlite (live stays `json`; migration-verified, cutover deferred); **Kidneys** = `middleware/kidneys.js` hourly sweep of expired OTPs, dead pending-auth, stale sessions/devices (cron + boot sweep); **Immune** = `GET /health` two-tier + `healthWatch` heartbeat/outage alerts. Also tightened `/status` (no host/platform/CPU to anon) and `/sessions` (masked tokens + store scoping). Suite 98/98.
- [ ] When ready to cut the Heart over to SQLite reads: soak in `dual` first, then set `DB_MODE=sqlite` in `.env` and restart; JSON stays as the crash fallback (rollback = flip back to `json`).
- [ ] Run the Navi server hidden in the background with Windows auto-start (Task Scheduler at logon, or a proper Windows service) so no terminal window has to stay open; interim option is the double-click `start-server.cmd`. Decide the account/rights (user logon vs system service) and confirm the daily 23:58/23:59 Lusaka jobs fire reliably while no one is logged in.

## Why these are important

- The backend already supports user login, loan requests, and status actions, so the next value is finishing the desktop workflow and admin controls.
- The invite flow and loan status logic are the biggest functional wins because they protect onboarding quality and reduce operational mistakes.
- Reporting, reminders, and audit tracking increase trust, reduce manual admin work, and make the project easier to scale beyond a local demo.

## Weekly priority order

1. User request data + interest + history flow
2. Invite-based signup and admin access control
3. Admin actions + reporting
4. QA, notification hooks, and operational safeguards

