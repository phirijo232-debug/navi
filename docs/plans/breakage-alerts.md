# ExecPlan — Enriched Admin Breakage Alerts

## Purpose

When a money-critical or silence-critical circuit trips (loan payment write,
login OTP mail, daily report delivery, HR employee edit, …), the admin should
receive one clear email that names the file and handler that broke — instead of
a generic "server error" line. Before this change only 4 of ~86 `logError` call
sites notified the admin inbox, and the alert body gave no indication of which
handler failed. After this change:

- every money/silence-critical circuit break emails an alert formatted
  `[file → handler] LABEL: message`
- distinct handlers produce distinct incident signatures, so a broken login
  flow and a broken payment flow each get their own (flood-protected) alert
- if Gmail itself is down, the alert is queued to `logs/pending-alerts.log`
  instead of being silently lost

Body part: **Immune system** (monitoring and alerts).

Routes added or changed: **none** — no route paths, order, or handlers'
request/response behaviour change (two tracking handlers gained the
standard try/catch circuit-breaker that AGENTS.md already mandates).

## Progress

- [x] (10/10/2026) Create this ExecPlan.
- [x] (10/10/2026) `middleware/logger.js`: add `logBreakage(file, handler, err, label)`; timestamp-stable flood signature; `logs/pending-alerts.log` fallback on send failure; export `logBreakage`/`sendErrorAlert`/`emailTransporter`.
- [x] (10/10/2026) `controllers/authController.js`: notify + prefix on signup/confirm/resend, login/confirm, password-reset/confirm, invite generation, admin user creation, announcement, HR edit/restrict, store-switch request (incl. inner OTP send) + verify.
- [x] (10/10/2026) `controllers/loanController.js`: notify + prefix on loan request, loan action, payment record, single + bulk overdue notify, admin loan creation.
- [x] (10/10/2026) `controllers/reportController.js`: notify + prefix on report exports; add mandated try/catch + alert to `getTrackingSheet`/`exportTrackingSheet` (moved their inline require to module top — AGENTS rule 3).
- [x] (10/10/2026) `controllers/reportTracking.js`: notify + prefix on tracking-sheet persist failure.
- [x] (10/10/2026) `scheduler.js`, `middleware/dailyReport.js`, `middleware/loanNotifications.js`: notify + prefix on scheduler-level report/notification/catch-up failures only.
- [x] (10/10/2026) `test/mailErrorClassify.test.js`: add format, no-spam, and pending-alert fallback tests.
- [x] (10/10/2026) `AGENTS.md` + `TODO.md` updated.
- [x] (10/10/2026) Full suite `node --test` green; `node server.js` boot verified; `data/users.json` intact.

## Concrete Steps

1. `middleware/logger.js` (explicitly authorized override of rule 2):
   - `logBreakage(file, handler, err, label = 'CIRCUIT TRIPPED')` →
     `logError('[file → handler] LABEL: message', true)`.
   - `sendErrorAlert` signature now strips the leading `[timestamp]` before
     building the cooldown key (previously each new second created a new
     "incident" and could re-alert).
   - On send failure: `persistPendingAlert()` appends
     `{"queuedAt","subject","body"}` JSON lines to `logs/pending-alerts.log`.
   - Exports appended: `logBreakage`, `sendErrorAlert`, `emailTransporter`
     (tests mock `sendMail` on the shared transporter; no existing exports
     removed — rule 5).
2. Controllers/middleware: replace `logError(...)` / `logError(..., true)` with
   `logBreakage('<file>', '<handler>', err, '<LABEL>')` at the sites listed in
   Progress. All existing try/catch blocks kept intact (rule 9); no handler
   logic changed except adding the missing try/catch to the two tracking-sheet
   HTTP handlers.
3. Log-only sites deliberately untouched: unknown routes, blocked vault/shutdown,
   rate-limit hits, 400/403 validations, read-only list/search handlers,
   per-borrower notification failures (`loanNotifications.js` send level),
   loan-save helper rethrow (its handler already alerts).
4. Tests: `npm test` (`node --test`), then `node server.js` boot check (rule 6).


## Validation

- `npm test` — all tests pass (existing suite + new alert tests).
- New test: `logBreakage('authController.js', 'confirmLogin', err, 'LOGIN CONFIRM CIRCUIT TRIPPED')`
  writes `[authController.js → confirmLogin] LOGIN CONFIRM CIRCUIT TRIPPED: …`
  to `logs/errors.log`.
- New test: two identical incidents within 15 minutes → `sendMail` called once.
- New test: `sendMail` throwing → JSON line appears in `logs/pending-alerts.log`.
- `node server.js` starts: `Navi Server running on port 3000`.
- `data/users.json` byte-size/content unchanged after the test run.

## Decision Log

- (10/10/2026) `logBreakage` takes an optional 4th `label` argument so each
  site keeps its historical LABEL text — existing log-parsing habits keep
  working and incident signatures stay handler-specific.
- (10/10/2026) Flood signature now excludes the leading timestamp. Reason: the
  old key included the ISO timestamp prefix, so a crash-looping handler would
  re-alert every minute once the clock ticked over. The `[file → handler]`
  prefix keeps distinct incidents distinct, satisfying the no-spam goal.
- (10/10/2026) Gmail-down fallback is persistence-only (`logs/pending-alerts.log`);
  automatic replay is intentionally deferred (keeps logger dependency-free and
  avoids retry storms; the file doubles as an audit trail).
- (10/10/2026) `emailTransporter` and `sendErrorAlert` exported (append-only) so
  tests can mock delivery instead of ever hitting real SMTP.
- (10/10/2026) Read-only handlers (user/loan/report lists), 4xx validations, and
  per-borrower notification failures stay log-only to keep the admin inbox
  reserved for true breakage.

## Surprises and Discoveries

- `getTrackingSheet` and `exportTrackingSheet` had **no try/catch** at all
  (pre-existing gap vs AGENTS circuit-breaker mandate); a `dataStore.writeJson`
  failure would have crashed to the global safety net with a generic message.
  Fixed as part of the build/export sweep.
- `getTrackingSheet` contained an inline `require('./reportTracking')` inside
  the handler (rule 3 violation); moved to module scope. No require cycle:
  `reportTracking` → `loanController` does not import `reportController`.
- The old cooldown key embedded the alert timestamp (see Decision Log).

## Outcomes and Retrospective

- 37 circuit sites across 7 files now alert with file→handler context; log-only
  sites intentionally untouched. Admin inbox gets at most one email per
  incident signature per 15 minutes, and nothing is lost when Gmail is down.
- Possible future work (not in scope): replay/flush of `logs/pending-alerts.log`
  on the next successful send; extending the same prefix format to the
  remaining read-only `logError` sites for grep consistency.
