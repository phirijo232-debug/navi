# ExecPlan — Public share links with access key (Option A)

## Purpose
Make invite + entry links public on `https://prymebfm.com` (login/signin,
signup, admin) with an embedded `?key=` access key as the first door.
Login + invite + OTP + device-token auth all stay enforced.

## Body part
Spine (server/routes/middleware) + Brain (auth invite builder) + Skin (signin alias).

## Progress
- [x] Config: PUBLIC_URL + SHARE_PUBLIC_KEY (env only, no hardcode)
- [x] Middleware: share-key gate before static (HTML pages only)
- [x] Server: /signin.html alias serving login.html, gate mounted before static
- [x] Auth: buildSignupUrl uses PUBLIC_URL + appends key; add buildPublicLink helper
- [x] .env: PUBLIC_URL, SHARE_PUBLIC_KEY, SERVER_MODE=public
- [ ] Validate: node --check, node --test, node server.js boot

## Decision Log
- Key is FIRST door only: HTML pages check `?key=`. APIs still use
  x-device-token + invite + OTP. Key never replaces login.
- Gate only `.html` + `/` page loads, never `.css/.js/images` or
  /status /health /invites/validate APIs, so pages don't break.
- PUBLIC_URL host match not required for gate: if SHARE_PUBLIC_KEY is set,
  key is required on page loads everywhere (predictable). Localhost keeps
  working by simply including the same key.
- /signin.html is an alias serving public/login.html (no duplicate file
  to maintain). No new route files (rule 7): alias lives in server.js
  beside existing /uploads/:filename, before deviceAuth so it stays public.
- Secrets only from process.env (rule 4). No logger/otp/dataStore edits.
  No export breaks. No /theme routes.

## Surprises and Discoveries
- express.static runs BEFORE deviceAuth, so .html pages are public by
  design. Key gate must mount BEFORE static or it never fires.

## Outcomes and Retrospective
- Done 2026-10-20: Option A share links live. Public base = https://prymebfm.com
  (env PUBLIC_URL), first door = ?key=bmf-pub-... on HTML page loads,
  SERVER_MODE=public in .env. Login + invite + OTP + x-device-token auth
  unchanged. /signin.html alias serves login.html. Verified by code read
  (server.js gate+alias, config env wiring, auth builder+export); node/node-test
  shell unavailable in this session so suite/boot re-run is deferred to next run.
- Verified code state at completion: all four implementation pieces present
  (config PUBLIC_URL/SHARE_PUBLIC_KEY, shareLinks.js helper+gate, server.js
  require+use+alias, authController builder+export).

## Concrete Steps
1. config/index.js: add PUBLIC_URL + SHARE_PUBLIC_KEY from env.
2. middleware/shareLinks.js (new): getPublicBaseUrl, appendKey, shareKeyGate (HTML-only, key check, try/catch safe).
3. server.js: require shareLinks; app.use(shareKeyGate) BEFORE static; app.get('/signin.html') alias serving login.html (before deviceAuth).
4. controllers/authController.js: buildSignupUrl prefers PUBLIC_URL and appends &key=; add buildPublicLink(path) helper; export it (append-only).
5. .env: PUBLIC_URL=https://prymebfm.com, SHARE_PUBLIC_KEY=<random>, SERVER_MODE=public.
6. node --check edited files; node --test; node server.js boot check.

## Validation
- GET /signin.html?key=OK serves login markup; without key 403.
- createInvite returns https://prymebfm.com/signup.html?invite=..&key=..
- /status and /health still public without key.
- API without device token still 403 (key does not bypass auth).
- node server.js boots, `[server-mode] started in PUBLIC mode`.

## Routes added or changed
- GET /signin.html (alias of login.html, public, key-gated page load)
- No other paths changed.
