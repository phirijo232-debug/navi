# Guardian, Customer Profile, Permissions, and Cron Reliability

## Purpose
Implement the user's three build prompts, fix customer/admin loan detail and modal UX, and make scheduled jobs run outside cron's synchronous tick with a ten-minute HTTPS keep-alive.

## Progress
- [x] (2026-11-06) Read the supplied prompts and NaviServer AGENTS.md.
- [x] Implement and integrate the audit guardian using the current Express architecture.
- [x] Rebuild the customer profile view and repair dialog/quick-screen layouts.
- [x] Implement a security permissions area with custom groups and an immutable built-in Franchise Admin group.
- [x] Wrap scheduler callbacks and add the HTTPS keep-alive.
- [x] Verify focused flows, syntax, and `node server.js` startup.

## Decision Log
- (2026-11-06) The referenced `claude/BMF_System_Master_Prompt.md` is not in the workspace; proceed from the provided audit prompt and the repository's AGENTS.md.
- (2026-11-06) Adapt attachment examples to NaviServer's existing `routes/index.js`, `controllers`, `middleware/email.js`, configured role names (`franchise_admin`), and store-scoping policy. Do not create route files or use the prompt's legacy `franchiseAdmin` boolean as authorization.
- (2026-11-06) Keep `middleware/logger.js`, `middleware/otp.js`, and `middleware/dataStore.js` unchanged. Preserve existing security middleware behavior and avoid exposing customer or device secrets.
- (2026-11-06) The scheduled jobs currently live in `scheduler.js`, not `server.js`; wrap those jobs there and register the keep-alive after the existing scheduler is started from `server.js`.

## Surprises and Discoveries
- The audit prompt references a missing master prompt and legacy `routes/loans.js` / `routes/payments.js` that do not exist in this project.
- The active cron schedules are in `scheduler.js`; there are no `cron.schedule` calls in `server.js`.
- The user supplied two copies of the security prompt; initial review is in progress to confirm whether their contents differ.
- The security prompt's `staff` role and `franchiseAdmin` flag conflict with the repository's canonical roles and authorization tests. Keep the existing `franchise_admin` role immutable; group settings cannot promote roles or bypass route/store gates.

## Outcomes and Retrospective
Customer profiles now show bordered customer, loan, and payment details; customer loan cards open the full detail modal on click and close through the button, backdrop, or Escape. Quick Screen facts are arranged in bordered fields, and the request-lock dialog closes immediately.

Audit entries are redacted append-only JSONL records with a SHA-256 chain, tamper detection, threat email deduplication, login/loan/payment hooks, an admin audit view, and borrower advisories for detected balance inconsistencies. Security group routes/UI support store-scoped custom group creation, assignment, and deletion while keeping the built-in Franchise Admin locked. Temporary access requests are persisted and store scoped; admin/franchise_admin decisions expire after 15 minutes, with requester/admin email notifications and an HR review queue. The approval controller exposes an active-approval check, but does not by itself grant feature access; the repository's existing role/store gates remain authoritative. Group settings are stored and displayed but are not yet consumed as a new authorization layer, and premium-customer masking is not wired into every customer/loan/report response.

All scheduler callbacks run via `setImmediate` with cron error handling. The HTTPS keep-alive is registered after scheduler startup.

## Concrete Steps
1. Add the audit module and integrate it without changing protected middleware dependencies.
2. Improve `public/admin.js`, `public/admin.html`, and necessary styles for the customer profile, Quick Screen, loan detail, and consistent modal behavior.
3. Add security permissions and custom permission-group behavior using current role/store gates and `routes/index.js`.
4. Update `scheduler.js` cron callbacks and `server.js` keep-alive startup.

## Validation
- Preserve existing routes and status/action gates; add tests for the new security and audit behavior where appropriate.
- Run focused tests and syntax checks, then verify `node server.js` starts.
- Routes added/changed: `/admin/security/groups`, `/admin/security/employees`, `/admin/audit-log`, and `/admin/access-approvals` in `routes/index.js`.
- Middleware changed: audit module/security integration only; logger, OTP, and dataStore remain unchanged.
- Body part: Skin, Brain, Spine, and Immune System.
