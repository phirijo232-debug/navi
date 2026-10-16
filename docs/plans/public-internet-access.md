# ExecPlan — Public Internet Access (role-safe routing)

## Purpose
Make NaviServer reachable from outside the LAN (via free ngrok HTTPS tunnels)
without leaking data across roles. Fixes the blockers that made the second PC
report "connection not found": no exposure path, no trusted client IP behind a
proxy, and the deliberate PUBLIC_DEPLOY boot gate. Adds a route × role test
matrix so no future route can silently lose its gate.

## Body part
Immune system (security gates) + Skin (client links/errors) + Lungs (exposure).

## Exposure decision (user-confirmed, $0)
- ngrok free tier now: `ngrok http 3000` (1 free static domain recommended).
- No router port-forward, no inbound firewall rules, TLS terminated by ngrok.
- Because ngrok terminates TLS and forwards from localhost, Express MUST set
  `trust proxy` or req.ip collapses to 127.0.0.1 (rate-limit + LAN checks off).

## Progress
- [x] Phase 1: signed image URLs replace the `?token=` fallback
- [x] Phase 2: trust proxy, /status limiter exemption, PUBLIC_DEPLOY gate upgrade
- [x] Phase 2: TRUSTED_TOKENS emptied (config trusted-token bypass removed)
- [ ] Phase 3: test/routeMatrix.test.js — every route × 6 identities (NOT DONE — file does not exist yet)
- [x] Phase 4: client error taxonomy + click-to-sign image links
- [ ] Phase 5: full suite green (DONE 119/119) + server boots clean (DONE); PUBLIC_DEPLOY=true boot + external ngrok test from a second device still TODO (needs SIGNING_SECRET in .env)

## Decision Log
- Signed URL = HMAC-SHA256 over `bmf-upload|filename|exp`, TTL 10 min, issued
  ONLY after `canViewFile()` passes at `POST /uploads/sign` (deviceAuth-gated).
  Serve-time validation = signature + expiry; possession of a fresh link is the
  authorization (S3 presigned-URL model). No user email/token in the URL.
- SECRET source: `process.env.SIGNING_SECRET`; if unset, an ephemeral per-boot
  secret (safe default — outstanding links die on restart, TTL is 10 min anyway).
  PUBLIC_DEPLOY=true REFUSES boot unless SIGNING_SECRET is explicitly set.
- `?token=` device-token query fallback REMOVED from resolveAuthUser and
  serveFile. logger.js redaction of `token=` stays (legacy log lines; harmless).
- TRUSTED_TOKENS emptied to `[]`: config tokens were bare CLI-only strings that
  map to no user (`findUserByDeviceToken` returns null) — the ONLY leak path
  was `GET /loans?email=` skipping the ownership check for authless-but-trusted
  requests. Real per-user tokens (`…01`, `…02`) live in users.json and are
  unaffected, so nobody gets logged out. cli.js guards the now-empty default.
- PUBLIC_DEPLOY gate upgraded: refuses boot unless SIGNING_SECRET set AND
  MASTER_KEY/SHUTDOWN_KEY set to a non-default value (kills the `'phirii26'`
  fallback for /internal-shutdown, /vault/*, /admin/restore).
- `/status` exempted from the general rate limiter (dashboard polls every 5s =
  120 req/15 min vs 100/min cap → second PC would 429 after ~8 min).
  Change lives in server.js wrapper — middleware/security.js NOT touched.

## Surprises and Discoveries
- Admin/loan/report routes already carry server-side role gates (audit); the
  real public-internet risks were bearer tokens in URLs, trusted-token bypass,
  missing trust proxy, and the guessable master-key default.

## Concrete Steps
1. middleware/signedUrl.js (new): signUploadUrl/verifyUploadUrl.
2. controllers/fileController.js: drop query-token fallback, accept signed
   query in serveFile, add signUpload handler (circuit-breaker pattern).
3. routes/index.js: POST /uploads/sign (static-before-dynamic safe).
4. config/index.js: TRUSTED_TOKENS: []; cli.js: omit empty default header.
5. server.js: trust proxy, /status exempt, gate rewrite, comment refresh.
6. public/admin.js + public/dashboard.js: data-upload links + click-to-sign.
7. test/uploadAccess.test.js: signature unit tests + ?token= rejection.
8. test/routeMatrix.test.js: route × identity matrix.
9. TODO.md lines 26–28, AGENTS route list updates at ship time.

## Validation
- `node --check` all touched JS; full `node --test` green (119/119, incl. 3 new
  signed-URL tests: signature verify/expiry/tamper, serveFile signed/`?token=`
  rejection, signUpload owner-vs-cross-user).
- `node server.js` boots clean (port 3000, `[server-mode] PUBLIC`).
- PUBLIC_DEPLOY=true boots only with secrets set; refuses without.
- Anonymous /uploads/x → 403; signed link → 200; expired/tampered → 403;
  raw ?token= → 403; cross-user sign → 403.
- External: ngrok URL from a second device on cellular — login, role matrix,
  image open via signed link, 403s for wrong roles.

## Out of scope
- middleware/security.js, logger.js, otp.js, dataStore.js edits (AGENTS rule 2 —
  /status exemption implemented in server.js wrapper instead).
- Real domain / Cloudflare (deferred until budget allows).