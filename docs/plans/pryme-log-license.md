# ExecPlan — PRYME LOG license and company branding

## Purpose

PRYME LOAN checks each installation with PRYME LOG before it issues a session, and it shows the licensed company's name and logo. Buraza Micro Finance is one company using the product, not the product name. Until a license has been validated, visible branding falls back to PRYME LOAN. The page footer says "Powered by PRYME LOAN".

Body parts: Nervous system (login gate, mounted beside device auth), Liver (license state JSON through the existing dataStore API), Skin (login, quick loan, admin header), Lungs (report and PDF headers).

## Progress

- [x] (23/11/2026) Read TESTING_RULES.md and docs/LICENSE_API.md from PRYME-LOG.
- [x] (23/11/2026) Signing module, server-side validate, cache, 72-hour grace, login and session gates.
- [x] (23/11/2026) Browser install id, blocked-login messages, admin expiry banner.
- [x] (23/11/2026) Replace Buraza strings on login, quick loan, admin header, and PDF/report headers.
- [x] (23/11/2026) Tests (216 passed), `node server.js` startup on port 3456, and browser check of `/`, `/login`, and `/admin`.
- [ ] Pull request into `bmf-staging` only. Do not merge.

## Decision Log

- (23/11/2026) `ts` is Unix milliseconds (`Date.now()`), matching docs/LICENSE_API.md and its Node client. Values below `1e12` are also accepted by PRYME LOG as seconds. The HMAC is computed on the exact raw JSON string that is sent, in `middleware/prymeLogLicense.js`.
- (23/11/2026) Env names are `PRYMELOG_LICENSE_ID`, `PRYMELOG_LICENSE_SECRET`, and `PRYMELOG_VALIDATE_URL` (default `https://pryme-log.vercel.app/api/license/validate`). Missing id or secret fails closed on login. The server still boots. Master-password, vault, shutdown, and the public/private mode check are not modified and are not license-gated.
- (23/11/2026) The browser generates `prymeInstallId` with `crypto.randomUUID` and sends it on login (JSON body and `x-install-id`). The browser never calls PRYME LOG.
- (23/11/2026) Credential success calls PRYME LOG before a session or login OTP is issued. A 60-second memory cache only collapses a double submit and the OTP confirm that follows immediately. Device-token reuse calls PRYME LOG at least every 6 hours. A 5-minute memory cache stops a burst of API calls. The last success is stored in `licenseState.json` (dataStore, so JSON and SQLite mirror stay in step).
- (23/11/2026) If PRYME LOG cannot be reached, a last successful validation younger than 72 hours still allows access. A definitive `ok: false` (expired, seats full, suspended, bad signature) blocks even when an older success exists. `EXPIRED` and `SEATS_FULL` are shown with the exact sentences specified for this product.
- (23/11/2026) Automated tests run with the gate off unless a test builds its own client with `enforce: true`. `node server.js` always enforces. This keeps the existing login suite from calling the live license API.
- (23/11/2026) The company logo is downloaded server-side and served from `/branding/logo` so the page CSP stays `self`. The upstream `logo_url` is not given to the browser.

## Surprises and Discoveries

- PRYME LOG's published client uses millisecond timestamps, while the task note said seconds. Both are accepted; the implementation follows the published client.
- There is no separate invoice document. Statement, business, portfolio, and payment-tracking PDFs, plus the Excel report headers, are the invoice/report headers.
- `middleware/security.js` is left unchanged. Session reuse is a middleware mounted immediately after `deviceAuth`, so the public/private IP check and `checkMasterPassword` stay as they are.

## Outcomes and Retrospective

- (23/11/2026) Login with a wrong password still returns `Invalid username, email, or password.` and does not call PRYME LOG.
- (23/11/2026) A correct password with no license env returns 403 `License validation is not configured. Set PRYMELOG_LICENSE_ID and PRYMELOG_LICENSE_SECRET on the server.` and does not issue a device token.
- (23/11/2026) `GET /branding` before any successful validation returns name `PRYME LOAN` and footer `Powered by PRYME LOAN`.
- (23/11/2026) `npm test` — 216 passed. There is no `npm run build` script in this repo.
- (23/11/2026) Browser check: dark and light themes, phone width, bad-login message, and a stored `prymeInstallId` all behaved. Master-password and public/private mode code were not edited.
- Signup, password reset, customer emails, and the store dropdown still say Buraza. Those are outside the header surfaces named for this change.

## Concrete Steps

- `middleware/prymeLogLicense.js` — sign, validate, cache, grace, branding, session middleware.
- `controllers/licenseController.js` — `GET /branding`, `GET /branding/logo`, `POST /login/resume`, `GET /license/status`.
- `controllers/authController.js` — gate after a correct password and again before `establishLoginSession`.
- `server.js` — mount the session middleware after `deviceAuth`. Add `/login/resume` to the auth rate limit. Do not edit vault, shutdown, or server-mode routes.
- `config/index.js` — public paths `/branding`, `/branding/logo`, `/login/resume`.
- `routes/index.js` — register the four routes. Static paths only.
- `public/pryme-client.js` plus login, quick loan (`public/index.html`), admin header, and account page (install id only).
- PDF/Excel/report header strings read the cached company name.
- `test/prymeLogLicense.test.js`.

Routes added:

- `GET /branding` (public)
- `GET /branding/logo` (public)
- `POST /login/resume` (public; still requires a valid device token inside the handler)
- `GET /license/status` (device token, admin roles)

No existing route path changes.

## Validation

- `node --test test/prymeLogLicense.test.js`
- `npm test`
- `PORT=3456 node server.js` then `GET /health` and `GET /branding` return 200. `/branding` name is `PRYME LOAN` and footer is `Powered by PRYME LOAN` before any license success.
- Login with a wrong password still returns the existing invalid-credentials error and does not call PRYME LOG.
- With the env vars set, a correct password and a mocked `EXPIRED` or `SEATS_FULL` response shows that response's product message and does not return a device token.

## NaviServer rules

- Do not modify `middleware/logger.js`, `middleware/otp.js`, `middleware/dataStore.js`, `checkMasterPassword`, or the public/private mode check.
- New routes live in `routes/index.js`.
- No secrets in git. License state and the cached logo stay under `data/`, which is gitignored.
