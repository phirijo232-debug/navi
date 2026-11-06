# BMF Audit Guardian Integration

## Purpose
Add a safe append-only audit log, tamper/integrity threat checks, and concise advisory emails to affected borrowers when loan/payment data is inconsistent.

## Progress
- [x] (2026-11-06) Inspect the full pasted guardian command and current NaviServer logging/email/data models.
- [x] (2026-11-06) Add a self-contained audit module without touching logger, OTP, dataStore, server, or route wiring.
- [x] (2026-11-06) Add pure integrity evaluators and plain-language borrower advisory messages.
- [x] (2026-11-06) Add scoped unit coverage and report the integration points needed in the main app.

## Decision Log
- (2026-11-06) The referenced `claude/BMF_System_Master_Prompt.md` is absent from the repository, so follow the user's pasted command and `AGENTS.md` instead.
- (2026-11-06) Adapt legacy `routes/loans.js`, `routes/payments.js`, and `utils/email.js` references to the actual `controllers/loanController.js`, `routes/index.js`, and `middleware/email.js` architecture. Leave route/server integration to the primary agent.
- (2026-11-06) Keep the audit helper self-contained and avoid sensitive fields (passwords, OTPs, device tokens, secrets, file contents) in audit details.
- (2026-11-06) Send borrower messages as plain-language text via the existing email service; only the existing BMF sender configuration is used.

## Surprises and Discoveries
- The repo already has `middleware/errorAudit.js` for global error provenance, but no append-only business/security audit log or guardian module.
- The prompt names several absent legacy files; the current system uses one `routes/index.js` and controller modules.
- Current loan ledgers include grace accrual in the repayment total, so integrity checks must compare the current computed loan totals and avoid assuming stale base-only values.

## Outcomes and Retrospective
The standalone audit/guardian module and focused tests are complete. Main application event hooks and admin log access remain for the primary agent to integrate in the existing auth/loan controllers and route layout.

## Concrete Steps
1. Add `middleware/auditLog.js` with append-only JSONL records, safe filtering, flood-limited threat notifications, failed-login tracking, integrity checks, and borrower advisory messages.
2. Add tests for serialization/redaction, filters, and pure integrity evaluation.
3. Hand the primary agent the minimal route/controller integration points and the environment-only `GUARDIAN_EMAILS` configuration note.

## Validation
- `node --check middleware/auditLog.js` — passed.
- `node --test --test-reporter=spec test/auditGuardian.test.js` — 5 passed, 0 failed.
- Do not edit `middleware/logger.js`, `middleware/otp.js`, or `middleware/dataStore.js`.
- Do not change `server.js` or `routes/index.js` from this subtask; integration is coordinated by the primary agent.
