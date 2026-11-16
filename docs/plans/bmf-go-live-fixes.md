# BMF go-live fixes

## Purpose
The published branch serves the website again, late loans stay visible in the reports without a job that mislabels them as grace, students can apply on Quick Screen without an account, and the admin screen shows the three lending pools.

Body parts: Spine (server and routes), Brain (loans, applications, pools), Skin (Quick Screen and admin), Immune (tokens and signing secret).

## Progress
- [x] (2026-11-16) Website restored. Nightly jobs start once from scheduler.js. Overdue status rewrite removed.
- [x] (2026-11-16) Grace end date, late-loan totals, and checked default interest rates.
- [x] (2026-11-16) Student Quick Screen submit, approve, and reject.
- [x] (2026-11-16) Signed device tokens, hashed OTPs, signed photo links.
- [x] (2026-11-16) Admin pools.
- [x] (2026-11-16) node_modules and scratch files untracked. History was scanned and not rewritten.

## Decision Log
- (2026-11-16) The master-key check and the public/private network check were not edited.
- (2026-11-16) Official 10/16/24/32 rates are used only when a store has no saved policy. A saved policy that fails the checks still errors.
- (2026-11-16) Approving a Quick Screen application creates a pending loan and does not set approvedAt.
- (2026-11-16) Pool 1 moves by principal only. That assumption is written on the admin screen.

## Routes
- GET /api/apply/public-config (public)
- POST /api/apply (public, unchanged path)
- PATCH /api/apply/:id (admin, unchanged path)
- GET /admin/pools
- POST /admin/pools/capital

## Validation
`node --test test/*.test.js` — 193 passed.
`node server.js` prints `Navi Server running` in private mode. `/health` is 200, `/quick-screen` is 200, `/loans` without a token is 403.

## Outcomes
Shop data files were not edited. Old device tokens in users.json stop working after this code is deployed; people sign in again.
