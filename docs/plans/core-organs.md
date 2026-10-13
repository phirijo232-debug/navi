# ExecPlan — Core Organs: Heart (SQLite), Kidneys (cleanup), Immune (monitoring)

## Purpose
- **Heart:** real database behind the existing `dataStore` API — ACID writes, no torn JSON files, zero caller changes (`DB_MODE` flag-gated).
- **Kidneys:** scheduled sweep of expired OTPs, dead pending-auth entries, stale sessions, and stale device tokens so memory/users.json never accumulates dead credentials.
- **Immune:** `GET /health` (public tier minimal, admin tier detailed) + heartbeat file with silence/outage alerts to the admin inbox.
- **Leak tightening:** `/status` stops exposing hostname/platform/CPU model to unauthenticated callers; `/sessions` stops handing raw device tokens (and cross-store session lists) to store-scoped admins.

## Body parts
- Heart → `middleware/db.js` (new) + delegate hooks in `middleware/dataStore.js`
- Kidneys → `middleware/kidneys.js` (new) + exports in auth/session controllers
- Immune → `middleware/healthWatch.js` (new) + `GET /health` in `routes/index.js`

## Progress
- [x] Prerequisites: full backup `C:\NaviServer-Backup` mirrored; baseline tests 86/86 green
- [x] Heart: `better-sqlite3` installed + native load verified (`SQLITE_OK`)
- [x] Heart: `middleware/db.js` built (kv documents store, health flag, JSON-wins reconcile)
- [x] Heart: `dataStore.js` delegate hooks (`json` default | `dual` | `sqlite`)
- [x] Heart: migration script `scripts/import-json-to-sqlite.js` + run on live data (`data/navi.db` created, counts/checksums verified)
- [ ] Heart: reads switched to SQLite (`DB_MODE=sqlite` in `.env`) with JSON fallback — **deliberately deferred**: `.env` has no `DB_MODE`, so the live server runs the safe `json` default; SQLite is built + migration-verified, cutover is a separate go/no-go after a soak in `dual`
- [x] Kidneys: `middleware/kidneys.js` sweep + exports (`cleanupExpiredOtps`, `sweepExpiredAuth`, `pruneSessions`)
- [x] Kidneys: hourly cron + boot sweep wired in `scheduler.js`
- [x] Immune: `GET /health` two-tier + `PUBLIC_PATHS` entry
- [x] Immune: heartbeat + outage/stall alerts (`middleware/healthWatch.js`)
- [x] Leak tightening: `/status` field strip; `/sessions` token masking + store scoping
- [x] Tests: `dbMode`, `kidneysSweep`, `healthEndpoint`, `statusSessionsLeak` added
- [x] Validation: `node --check`, `npm test` green (98/98), isolated-PORT boot, curl leak matrix, temp cleanup

## Decision Log
- (2026-10-13) **kv document store over per-core-file tables:** `readJson/writeJson` are whole-document APIs; a `documents(key, json, updated_at)` table preserves exact semantics with zero caller changes. Normalised tables can be added later without an API change.
- (2026-10-13) **JSON always written too, even in `sqlite` mode:** JSON remains the crash fallback + human-readable mirror. SQLite write failure ⇒ health flag drops ⇒ reads transparently fall back to JSON (degrade, never lose).
- (2026-10-13) **JSON-wins boot reconcile:** JSON mtime newer than kv `updated_at` (crash between the two writes) ⇒ kv overwritten from JSON at startup. Prevents stale-SQLite reads after a crash.
- (2026-10-13) **Rule-2 files touched ONLY where the approved flowchart demands it:** `dataStore.js` (Heart delegate hooks), `otp.js` (export `cleanupExpiredOtps` — additive, needed by Kidneys' "Clean OTPs" step). `logger.js` NOT modified.
- (2026-10-13) **Test env forces `json` mode** (`NAVI_TEST_DB_MODE` opt-in) so the suite never touches the live `data/navi.db`; sandbox still gets its own temp DATA_DIR.
- (2026-10-13) **`/health` public tier = `{status, uptime}` only** — no hostname, memory, db path, or mode unless the caller presents an admin device token (resolved in-handler; `deviceAuth` skips public paths).
- (2026-10-13) **Hard-death alerting is boot-catch-up:** a process killed with no chance to email reports its outage gap on next boot (`SERVER OUTAGE DETECTED`); stalls detected by heartbeat watchdog; `uncaughtException` already alerts live. Documented limitation: no in-process mechanism emails during a hard kill before restart.

## Surprises and Discoveries
- `pendingSignups`/`pendingLogins` had **no timestamp** — a sweep would be impossible; added `createdAt` at creation (additive).
- `/sessions` returns sessions keyed by the **raw device token** to any `isAdminRole` caller — a store_admin could harvest other stores' tokens. Now masked + store-scoped (dashboard only reads `total`, so no frontend break).
- `/status` is in `PUBLIC_PATHS` → unauthenticated callers got `hostname`, `platform`, CPU model. Stripped; dashboard only uses `status/uptime/ram.used/cpu.cores`.
- OTP store cleanup already runs inside `generateOTP`; the export lets Kidneys force it on schedule too (belt + braces).

## Concrete Steps
1. `node --check` each edited file; `npm test` after each phase.
2. Heart: `middleware/db.js` → edit `middleware/dataStore.js` → `scripts/import-json-to-sqlite.js` → run script → `node scripts/import-json-to-sqlite.js` → append `DB_MODE=sqlite` to `.env`.
3. Kidneys: `middleware/kidneys.js` → export hooks in `otp.js`/`authController.js`/`sessionController.js` → cron in `scheduler.js`.
4. Immune: `healthWatch.js` → `server.js` start → `GET /health` in `routes/index.js` + `security.js` `PUBLIC_PATHS`.
5. Leak tightening: `statusController.js` strip; `sessionController.js` mask/scope.
6. Tests for every new behaviour; update `AGENTS.md` route list + folder tree; update `TODO.md`.

## Validation
- `npm test` → all green (86 baseline + new).
- Boot on isolated PORT → `node server.js` starts clean, `GET /health` → `{status:'ok',uptime}` with **no** hostname/memory/db keys.
- `GET /status` without token → no `hostname`/`platform`/`cpu.model`.
- `GET /sessions` as store_admin → tokens masked, only own-store sessions.
- `curl` leak matrix: anon 403 on loans/users/logs/sessions; cross-customer 404; admin-in-store 200.
- Migration: import reports exact counts for users/loans/feedback; JSON files untouched (checksums equal).

## Outcomes and Retrospective
- **Delivered (2026-10-13):** Heart (SQLite document store behind the unchanged `dataStore` API), Kidneys (hourly hygiene sweep), Immune (`GET /health` two-tier + heartbeat/outage alerts), and the `/status` + `/sessions` leak tightening. Suite 98/98 green; isolated-port boot clean; `data/navi.db` created by the migration import.
- **Live mode is `json` (safe default).** SQLite is built, wired, and migration-verified, but `.env` sets no `DB_MODE`, so reads/writes stay on JSON with a SQLite mirror available. Cutover to `sqlite` reads is intentionally a separate go/no-go after a `dual` soak — not done here, so no behaviour changed for live traffic.
- **Rollback:** `DB_MODE` env flag — set `json` (default, current), `dual` (write both), or `sqlite`. JSON files are always written too, so flipping back never loses data; JSON-wins reconcile on boot heals a stale mirror after any crash.
- **Terminal note:** `npm` was blocked in the shell this session; the suite was run directly via `node --test --test-reporter=tap` and output captured to a file (PowerShell `|`/redirect caused `EmptyPipeElement` errors) — this is a shell/tooling issue only, not a code issue.

