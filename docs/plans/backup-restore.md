# ExecPlan — Admin Backup & Restore

## Requirement
Admins can snapshot all core data (users, loans, feedback, notifications,
daily-report state, invites) to a timestamped file and restore it later —
protecting project data against corruption/accident (TODO.md line 21).

## Design
- Snapshot dir: `data/backups/` (inside `DATA_DIR` → sandboxed in tests).
- One snapshot = `backup-YYYYMMDD-HHMMSS[.N].json` holding `{ id, createdAt,
  createdBy, files: { <name>: <parsed content> } }`.
- Files snapshotted: users.json, loans.json, feedback.json, notifications.json,
  dailyReportState.json, invites.json (missing files are skipped, never block).
- Atomic write: temp file + rename (same discipline as dataStore).
- Restore validates: admin session (`isAdminRole`) **and** `MASTER_KEY`
  (`process.env.MASTER_KEY || config.SHUTDOWN_KEY`) — destructive op needs both.
- Restore id must match `/^backup-\d{8}-\d{6}(-\d+)?$/` → no path traversal.
- Restore writes via `dataStore.writeJson` (refreshes `.bak` last-known-good),
  then runs `ensureDataIntegrity()` and audits with `logHr` to hr-audit.log.
- Routes in `routes/index.js` (AGENTS rule 7): `POST /admin/backup`,
  `GET /admin/backups`, `POST /admin/restore`.
- `middleware/dataStore.js` is NOT modified (AGENTS rule 2).

## Steps
- [x] (10/12/2026) Create this ExecPlan.
- [x] (10/12/2026) `controllers/backupController.js` (create/list/restore).
- [x] (10/12/2026) Routes + routeWiring expected list + AGENTS.md route registry.
- [x] (10/12/2026) `test/backupRestore.test.js`: admin create/list, non-admin 403,
      wrong key 401, traversal id 400, restore round-trip + integrity.
- [x] (10/12/2026) `node --check` + full suite (86/86) + isolated-PORT boot check.
- [x] (10/12/2026) TODO.md line 21.
