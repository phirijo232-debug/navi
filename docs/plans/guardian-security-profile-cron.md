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

Audit entries are redacted append-only JSONL records with a SHA-256 chain, tamper detection, threat email deduplication, login/loan/payment hooks, an admin audit view, and borrower advisories for detected balance inconsistencies. Security group routes/UI support store-scoped custom group creation, assignment, and deletion while keeping the built-in Franchise Admin locked. Temporary access requests are persisted and store scoped; eligible admin/franchise_admin decisions expire after 15 minutes, require an OTP through the existing OTP service, and send request notices only to configured same-store Franchise Admins. Stored flags and active approvals now gate reports, invite generation, user creation, bulk notifications, and force-close actions without replacing the original role/store checks. Server-side premium masking covers customer, loan, payment, and report JSON responses, with sensitive exports blocked when they could expose premium records. The HR approval queue and customer premium toggle use the new endpoints.

All scheduler callbacks run via `setImmediate` with cron error handling. The HTTPS keep-alive is registered after scheduler startup.

The customer profile now follows the supplied layout with bordered personal information, six portfolio tiles, status/period filters, compact loan facts, payment records, and status history. Quick Screen applicant cards now contain their facts, attached documents, and review controls in separate bordered areas. All Loans keeps its table scrollable on narrow screens and wraps long receipt IDs and borrower details instead of overlapping. Security & Permissions now has a live overview, role sections, a fixed read-only Franchise Admin section, per-Store Admin permission switches, custom group assignment, and save controls wired to the existing scoped security endpoint. The screenshots' example names and loan values were not added.

## Concrete Steps
1. Add the audit module and integrate it without changing protected middleware dependencies.
2. Improve `public/admin.js`, `public/admin.html`, and necessary styles for the customer profile, Quick Screen, loan detail, and consistent modal behavior.
3. Add security permissions and custom permission-group behavior using current role/store gates and `routes/index.js`.
4. Update `scheduler.js` cron callbacks and `server.js` keep-alive startup.
5. Wire stored permissions and OTP-backed approvals into route gates; mask premium borrower details before staff JSON responses.

## Security Wiring Addendum

### Goal
Make the existing seven permission flags affect supported admin features, make a denied feature produce a store-scoped approval request, require the existing OTP service for approval decisions, and mask premium borrower detail on staff responses.

### Invariants
- Existing role/store/loan gates remain the outer authority; a feature permission or active approval can only narrow access or unlock a feature for a role that already had base access.
- Approval notices go only to real, same-store `franchise_admin` accounts loaded from the system users store. No prompt sample addresses are used.
- Franchise Admin permissions remain fixed. OTP uses the current middleware service and its current authentication identities; do not change `middleware/otp.js`.
- Premium masking must happen server-side for customer-level loan/payment records; main `admin` and same-store `franchise_admin` remain unrestricted.

### Steps
1. Derive effective permissions from stored custom groups/defaults and active approval records.
2. Add shared route/controller gates for locked features without bypassing current role and store checks.
3. Bind the approval decision endpoint to `otpService.sendOTP` / `verifyOTP` and notify only scoped Franchise Admins.
4. Add server-side premium masking to customer/loan/payment/report record responses, plus a safe premium toggle for authorized Franchise Admins.
5. Update simple UI lock/request states and HR approval queue, then test role/store gates, OTP transitions, expiry, and masking.

## Validation
- Preserve existing routes and status/action gates; add tests for the new security and audit behavior where appropriate.
- Run focused tests and syntax checks, then verify `node server.js` starts.
- Routes added/changed: `/admin/security/groups`, `/admin/security/employees`, `/admin/audit-log`, and `/admin/access-approvals` in `routes/index.js`.
- Middleware changed: audit module/security integration only; logger, OTP, and dataStore remain unchanged.
- Body part: Skin, Brain, Spine, and Immune System.
- (2026-11-06) Validation: `node --test` passed all 178 tests. `node server.js` completed startup data validation and reported Navi Server running on port 3000; the process was then stopped cleanly.
- (2026-11-06) Added an access-approval test confirming request notification recipients are restricted to same-store Franchise Admins and the decision flow uses the existing OTP service.
- (2026-11-06) UI follow-up validation: all 178 tests pass, including admin DOM/data-attribute integrity checks; `node server.js` passes startup data validation and reports the server running on port 3000.
