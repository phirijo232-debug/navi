# ExecPlan — Report Scope and Access Hardening

## Purpose
Apply the same store boundary to legacy report endpoints as the newer report handlers, preserve both typed and scoped exports, and close the security and consistency issues found in the review.

## Body Part
Brain (controllers), Spine (routes), and Immune system (security gates).

## Progress
- [x] (2026-10-16) Review current report authorization, route order, error handlers, and working-tree state.
- [x] (2026-10-16) Add scope-aware legacy report responses and regression coverage.
- [x] (2026-10-16) Resolve the typed/scoped export route collision while preserving both URL forms.
- [x] (2026-10-16) Remove the insecure hardcoded master-key fallback and make missing-key checks fail closed.
- [x] (2026-10-16) Normalize login errors and replace the malformed duplicate report-spec module with a compatibility facade retaining its exports.
- [x] (2026-10-16) Run targeted tests, the full test suite, project JavaScript syntax checks, and `node server.js`.

## Decision Log
- 2026-10-16: Legacy report scope defaults through `getRequestedStoreId`, matching newer report handlers. Only role `admin` can explicitly request `all`; store and franchise admins remain within their assigned store.
- 2026-10-16: Keep the existing `/reports/:scope/export` behavior by dispatching recognized report types to typed export handlers and other segment values to the scoped export handler.
- 2026-10-16: If no explicit master/shutdown key exists, keep the application available but deny vault, shutdown, and restore key checks. Never let an absent key compare equal to an absent credential.

## Surprises and Discoveries
- The typed export route and scoped export route have identical Express path shapes, and the earlier typed handler currently captures both.
- Existing report scope tests cover newer summary routes, but not the legacy `/reports/all`, `/reports/analytics`, or `/reports/user` endpoints.
- `controllers/reportSpec.js` is not used by the live router and fails to parse due to malformed copied fragments; its exported API was retained as a compatibility facade over the active report services.
- `public/admin.js` already has an unrelated uncommitted change; it is outside this work and must remain untouched.

## Concrete Steps
1. Update `controllers/reportController.js` to derive an authorized scope for the legacy report handlers and filter both profiles and loans by that scope.
2. Update `routes/index.js` to dispatch the shared export URL shape to the typed or scoped handler based on the configured report type.
3. Update `server.js`, `config/index.js`, and `controllers/backupController.js` to remove the hardcoded master-key fallback and fail closed if no key is configured.
4. Update `controllers/authController.js` so login failures do not disclose whether an email is registered.
5. Replace the malformed, unused `controllers/reportSpec.js` fragments with a compatibility facade over the active BMF services, retaining its existing export names.
6. Add regression cases in `test/storeScope.test.js`, `test/reportExportDispatch.test.js`, `test/loginEnumeration.test.js`, `test/reportSpecCompatibility.test.js`, and `test/userStoreRecovery.test.js`.

## Routes Changed
- `GET /reports/user`
- `GET /reports/all`
- `GET /reports/analytics`
- `GET /reports/:type/export` and `GET /reports/:scope/export` dispatch behavior
- `POST /vault/request`, `POST /vault/authorize`, `POST /internal-shutdown`, `POST /admin/restore` key checks (paths unchanged)
- `POST /login` failure response (path unchanged)

## Validation
- Run the scope, report, route-wiring, authentication, and backup/restore tests, followed by the full test suite.
- Start with `node server.js` and confirm it listens without errors; stop the verification process afterward.
- Confirm `git status` shows no changes to `public/admin.js` beyond its pre-existing modification.

## Outcomes and Retrospective
Legacy portfolio, analytics, and borrower report endpoints now filter by the requested/assigned store; borrower profile responses strip password hashes and credentials. Typed and scoped exports both resolve correctly. Master-key checks no longer fall back to a published hardcoded value, login failure responses no longer distinguish unknown emails, and critical loan/report failures use 503 responses. The malformed legacy report-spec file was not referenced by live routes; its exported names now delegate to the active report services.

Validation: `npm.cmd test` passes 123/123; all 85 project JavaScript files checked pass `node --check`; `node server.js` starts on port 3000 and schedulers start. `npm.cmd run lint` cannot run because this repository has no ESLint configuration. The test `requestSignup can recover when the users store is malformed` now mocks OTP email delivery so it is deterministic and does not depend on external SMTP.
