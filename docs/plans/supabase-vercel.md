# Supabase storage for Vercel

## Purpose
BMF can keep running from the shop JSON files, or store the same JSON documents, sessions, codes, invites, rate limits, and photos in the Supabase project `bmf` so Vercel can host it.

Body parts: Liver (data access), Nervous system (sessions and limits), Lungs (cron), Skin (unchanged pages).

## Progress
- [x] (2026-11-16) Schema file for the owner to apply. No connection from this agent.
- [x] (2026-11-16) STORAGE=supabase vs local files behind readJson/writeJson.
- [x] (2026-11-16) Shared rows, private upload bucket, cron routes, import dry-run.

## Decision Log
- (2026-11-16) Whole JSON files stay one document each so controllers do not change shape.
- (2026-11-16) Sessions, OTPs, invites, rate limits, and upload-link ids are rows, hashed, with expiry.
- (2026-11-16) The master-key check and the public/private network check are not edited. SERVER_MODE still defaults to private.
- (2026-11-16) The service role key is read only from the environment. It is not sent to the browser.

## Routes
- GET /api/cron/kidneys
- GET /api/cron/grace
- GET /api/cron/notifications
- GET /api/cron/daily-report
- GET /api/cron/payments

These sit in front of the device check and require CRON_SECRET. Vercel cron uses Authorization: Bearer. The header x-cron-secret is also accepted.

## Validation
Local file tests stay the default. New tests cover the Supabase document path with a fake transport, OTP rows, the import totals, and the cron secret.
