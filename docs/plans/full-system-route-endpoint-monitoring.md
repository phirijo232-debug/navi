# ExecPlan: Full System, Route, and Endpoint Monitoring

## Purpose

Find and fix the cause of blank Customers and HR views, then audit the request path from the public pages through authentication, store scope, route registration, controller output, and runtime behavior. Leave a reproducible route/endpoint health summary.

## Progress

- [x] (2026-10-17) Review the repository rules and preserve the existing uncommitted HR fixes.
- [x] (2026-10-17) Create an audit plan before implementation changes.
- [x] (2026-10-17) Inventory frontend fetches and match each one to a registered route and method; inspect response shapes.
- [x] (2026-10-17) Trace Customers and HR navigation, authentication, fetch state, and render behavior end to end.
- [x] (2026-10-17) Inspect runtime server identity, health, access/error logs, and authenticated endpoint responses without printing credentials or customer data.
- [x] (2026-10-17) Fix verified defects and add focused regression coverage.
- [x] (2026-10-17) Run the complete test suite, project syntax and whitespace checks, and start `node server.js`.
- [x] (2026-10-17) Update this plan with findings, fixes, and validation results; no API contract changed, so `docs/ROUTES.md` did not need edits.

## Decision Log

- (2026-10-17) Keep the existing uncommitted changes from the prior HR investigation; audit and validate them as part of this work.
- (2026-10-17) Do not alter authentication middleware, logging, OTP, or data-store middleware without evidence and explicit authorization; first locate failures in callers, routes, controllers, or runtime configuration.
- (2026-10-17) Do not print device tokens, passwords, raw customer records, or sensitive log contents in audit output.
- (2026-10-17) Render the Customers list as soon as `/users` succeeds; reports, feedback, and loan management must not gate the directory.
- (2026-10-17) Add a bounded HR request timeout with a visible status so slow requests cannot leave the page waiting indefinitely.

## Surprises and Discoveries

- The first comparison of port 3000 and a fresh instance differed; a later direct check of port 3000 served the current `admin.html` cache tag and the current HR safe-summary schema. This was transient during process restarts, not a persistent data mismatch.
- Current data-store path is the repository's `data` directory in SQLite mode. Authenticated `/users` returns 7 in-scope accounts (5 customers); `/hr/employees` returns 3 staff records with safe device counts/restrictions and no credential fields.
- Today's log slice (2026-10-17): 439 access entries and 24 error-log entries; zero HR list failures, user list failures, DB failures, auth blocks, unknown routes, or rate limits. The 22 unknown-route entries in the recent retained log window are historical: GET `/login` (2026-10-12), GET `/notifications` (2026-10-16), and POST `/loans` (2026-09-25); none occurred today.
- The shared computer-use inventory exposed no browsers or apps, so visual inspection of an authenticated screen was unavailable. Current HTML/API responses and UI route tests were used instead.
- A confirmed UI coupling left customer cards unrendered until three unrelated data loads (reports, feedback, loans) settled. Customer rendering is now immediate after `/users`, and secondary failures are isolated with `Promise.allSettled`.
- HR loading now aborts after 12 seconds and shows an explicit timeout message.
- `admin.html` now uses a new `admin.js` cache key (`20261017-customer-hr-render`) so clients cannot keep reusing the earlier script version after these rendering fixes.
- Router audit found 69 method/path registrations, no duplicates, no static-route capture conflicts, and all statically discoverable frontend fetches now match both route path and method.

## Outcomes and Retrospective

- Customers render immediately from their own API response; loan/report/feedback loads only enrich their metrics. HR loading is bounded and reports timeout/error/permission states.
- Route wiring tests now compare HTTP methods as well as paths, resolve template-literal path segments, detect duplicate method/path registrations, and guard static-before-dynamic order.
- HR tests assert safe device summaries and the absence of passwords, legacy tokens, and raw trusted-device tokens.
- Full automated suite passes (137/137), all 67 project JavaScript files pass `node --check`, and `git diff --check` passes. A full sweep also encountered two ignored root-level checkpoint artifacts (`head_reportSpec.js`, `checkpoint_reportSpec.js`), which are not application source and were left untouched.
- Fresh `node server.js` startup succeeded on port 3000 in PUBLIC mode. `GET /health` returned `ok`; `GET /admin.html` returned HTTP 200 and referenced the new cache key. Authenticated `/users` and `/hr/employees` aggregate shape checks earlier in this run returned 5 customers and 3 staff records with safe HR fields.
- No shared browser/app was available in the computer-use session, so the UI could not be visually confirmed. This confirms the repository and local server state; if the user still sees blank pages after reloading the updated deployment, inspect that deployment’s served `admin.js` network response and `/users` plus `/hr/employees` responses.

## Concrete Steps

1. Use `routes/index.js`, client `fetch`/XHR calls, and `test/routeWiring.test.js` to produce a complete frontend route inventory and flag missing or ambiguous mappings.
2. Trace `adminMenuCustomers`, `adminMenuHr`, `fetchUsers`, `fetchHrEmployees`, their render functions, auth headers, and API response filtering.
3. Check the intended runtime port and deployment/static-asset version; test `/health`, `/status`, `/users`, `/hr/employees`, and each other browser-called endpoint with safe aggregate summaries.
4. Review authorization and store scoping for each registered endpoint, plus static-before-dynamic route ordering.
5. Make only evidence-backed fixes and add focused regression coverage. No route path or authorization policy changed, so `docs/ROUTES.md` remains the existing API contract.

## Body Parts

- Skin: `public/admin.html`, `public/admin.js`, `public/style.css`, other public clients if implicated.
- Spine: `routes/index.js` and `docs/ROUTES.md`.
- Brain: the controllers referenced by browser routes.
- Nervous system: `middleware/security.js` and `middleware/storeScope.js` are audit targets; do not alter auth population or weaken access gates.
- Immune system: runtime health and existing operational logs.

## Routes in Scope

- Audit every route registered in `routes/index.js` and every route requested by public frontend code.
- Expected changed routes: none until a concrete defect is proven.

## Validation

- All browser-called paths resolve to a registered route with the correct method; current authenticated API responses match the UI schemas.
- Customers and HR return distinct visible success, empty, loading, and error states; valid data renders without silent blank output.
- Confirm authenticated request headers, role gates, store filters, and safe field hygiene.
- `node --check` across project JavaScript, `git diff --check`, full `npm.cmd test`, and successful startup using `node server.js`.
- Runtime smoke checks return HTTP status and aggregate counts/shapes only; never print tokens or customer personal data.
