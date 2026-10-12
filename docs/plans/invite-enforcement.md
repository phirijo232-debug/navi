# ExecPlan — Invite-Based Onboarding (Enforcement)

## Requirement
A customer may only sign up through an admin-generated invite link bound to their
exact email. Open public signup is closed. Invites must survive a server restart
and can be used exactly once.

## Security model
- `POST /signup` returns 400 unless a valid `inviteToken` is supplied.
- Token must exist, be unused, unexpired (24h), and match the signup email
  (case/whitespace-insensitive).
- Invite check runs BEFORE the "Email already registered" probe so an uninvited
  caller cannot enumerate registered emails.
- `confirmSignup` re-validates the token and marks it used — one signup per link.
- Invites persist to `data/invites.json` via `dataStore.readJson/writeJson`
  (atomic + `.bak` recovery). `middleware/dataStore.js` itself is NOT modified —
  the path is built from the exported `DATA_DIR` (AGENTS rule 2).
- `signup.html` requires `?invite=` (also accepts `?token=`); without it the form
  is hidden with an explanation.

## Steps
- [x] (10/12/2026) Create this ExecPlan.
- [x] (10/12/2026) `controllers/authController.js`: file-backed invite store (`loadInvites`/
      `saveInvites`/`markInviteUsed`), required-token gate in `requestSignup`,
      used-marking in `confirmSignup`, `listInvites` reads from disk.
- [x] (10/12/2026) `public/signup.html`: require invite token from URL, send it in the body.
- [x] (10/12/2026) `test/userStoreRecovery.test.js`: happy-path test generates a real invite.
- [x] (10/12/2026) `test/inviteEnforcement.test.js`: no-token 400, wrong-email 400, valid → OTP,
      restart persistence, used-token 400.
- [x] (10/12/2026) `node --check` + `npm test` (79/79) + isolated-PORT boot check (200).
- [x] (10/12/2026) Update TODO.md.

## Out of scope
- `pendingSignups` remains memory-only (OTP-bound, 5-minute codes) — acceptable.
- `testOtpE2E.js` (stale manual script; already missing phone/NRC fields).
