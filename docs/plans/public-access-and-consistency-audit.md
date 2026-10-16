# ExecPlan — Public Access and Consistency Audit

## Purpose
Make the platform reachable through its intended public URL for customers while ensuring every page and API response exposes only information that the caller is authorized to see. Finish partial work from prior reviews, align API paths with their clients, and leave a verifiable route inventory and deployment checklist.

## Body Part
Spine (routes), Nervous system (authentication), Brain (controllers), Skin (public pages and client URLs), and Immune system (security/monitoring).

## Progress
- [x] (2026-10-16) Record the user’s full-audit request in `TODO.md` and inspect existing plans and repository state.
- [x] Inventory registered routes, public HTML URLs, client API calls, auth gates, role/store checks, and sensitive response fields; document the public URL map.
- [x] Fix verified authorization, data exposure, and controller/server failure-response inconsistencies without changing protected middleware files.
- [x] Add focused regression tests for corrected behavior and update route/security documentation and TODO status.
- [x] Run the final full test suite, JavaScript syntax checks, `git diff --check`, and `node server.js`; inspect resulting diff for unrelated changes.
- [ ] Record public URL/deployment verification steps and any external second-device check that cannot be performed from the local workspace.

## Decision Log
- 2026-10-16: Public access means internet-reachable customer entry points (signup/login and permitted public pages), with API data protected by server-side auth/role/store authorization. It does not mean exposing administrative or borrower records anonymously.
- 2026-10-16: Keep the existing route paths stable unless an actual mismatch or vulnerability requires a correction; preserve confirmed working endpoints and static-before-dynamic ordering.
- 2026-10-16: Do not inspect or print `.env` values, secrets, or customer records during the audit.

## Surprises and Discoveries
- TODO already contains an incomplete PUBLIC_DEPLOY/ngrok go-live item and prior internet-access work whose route-matrix and external-device validation are marked incomplete.
- Existing `report-scope-and-hardening.md` is completed; this plan covers the broader follow-up across all routes, UI URL wiring, and sensitive response fields.
- Anonymous `/status` exposed CPU and RAM metrics while `/health` already used a minimal public tier; the dashboard still retains those metrics for a valid admin token.
- Receipt search treated every staff role as globally scoped, and customer `/loans` filters honored caller-provided store selectors. Both now derive/validate scope on the server.
- Password reset returned different responses for unknown, customer, and admin email addresses. Responses are now generic and do not return the registered mailbox.
- Vault and shutdown controls were registered before device authentication and remained reachable in PUBLIC mode. They now reject public-network client IPs while preserving local CLI operation.
- Several controller/server catch paths returned 500 despite the project’s required temporary-unavailability status; verified catch paths now return 503.
- Found and removed an inline `require('exceljs')` from the typed-report controller handler; the controller already imports `ExcelJS` at module scope.

## Concrete Steps
1. Build the route and frontend URL inventory from `routes/index.js`, `server.js`, page links, and fetch/XHR call sites.
2. Trace each route into middleware/controller authorization and inspect response shaping for secrets/credential material and cross-store data.
3. Compare frontend calls with registered URL/methods, including admin/customer flows and public entry pages; resolve mismatches and ambiguous routing.
4. Add tests for discovered gaps; keep edits within existing architecture and preserve existing exports and authorization policy.
5. Update `TODO.md`, this plan, and relevant route documentation with completed work and remaining external deployment checks.

## Routes Changed
No URL paths changed. Access/response behavior tightened for:
- `GET /loans`, `GET /loans/search`, `GET /loans/:id`
- `POST /password-reset`
- `GET /status`
- `POST /vault/request`, `POST /vault/authorize`, `POST /internal-shutdown` (private-network check)
- Remaining affected controller/server failure handlers return 503 on exceptions.

## Validation
- `npm.cmd test`
- `node --check` on touched JavaScript files (and broader project scan if practical)
- `git diff --check`
- `node server.js` starts successfully and shuts down cleanly
- Route tests verify public unauthenticated access only for intended entry/status endpoints, and deny protected data to unauthorized roles or stores.
- External verification checklist includes the configured HTTPS public URL, signup/login from a separate device, static asset loading, and denied anonymous/admin/store-crossing requests.

## Outcomes and Retrospective
Implemented the verified fixes above and added `docs/ROUTES.md` as the source-of-truth URL/access inventory. Regression coverage now includes store-isolated receipt and customer loan reads, public/admin status payload tiers, generic password reset responses, private-network control IP classification, and route wiring.

Local validation passed: `npm.cmd test` 127/127, all project JavaScript passed `node --check`, `git diff --check` passed, and `node server.js` started in PUBLIC mode on port 3000 and shut down cleanly. External verification is still deployment-specific: this workspace does not include an authoritative public hostname or a second device, so the ngrok/HTTPS customer journey and real external IP behavior must be completed after the operator supplies/configures the public URL. Keep the matching TODO unchecked until that check is done.
