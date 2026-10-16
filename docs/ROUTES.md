# NaviServer URL and access map

Use the same origin for pages and APIs. All browser API calls use relative paths, so a configured HTTPS domain or ngrok URL does not need to be hard-coded into the frontend. Public deployment still requires `PUBLIC_DEPLOY=true`, strong configured secrets, and a trusted reverse proxy as documented in `docs/plans/public-internet-access.md`.

## Public pages and endpoints

These paths are intentionally reachable without a device token. Signup requires a valid invite token; the invite validation endpoint only validates the provided link.

| URL | Purpose |
| --- | --- |
| `/` and `/index.html` | Public landing page |
| `/login.html` | Login and OTP entry |
| `/signup.html?invite=…` | Invite-bound customer registration |
| `/forgot-password.html` | Password reset request and confirmation |
| `/style.css`, `/favicon.ico` | Public static assets |
| `POST /signup`, `POST /signup/confirm`, `POST /signup/resend` | Invite-bound signup and OTP |
| `POST /login`, `POST /login/confirm` | Login and OTP |
| `POST /password-reset`, `POST /password-reset/confirm` | Password reset (generic account eligibility response) |
| `GET /invites/validate/:token`, `POST /invites/validate` | Invite validation |
| `GET /status`, `GET /health` | Liveness only for anonymous callers |

`/admin.html`, `/dashboard.html`, and `/user.html` are static app shells and can be downloaded by a browser. They contain no server-side records or secrets. Client-side redirects only improve navigation; every data operation is protected by API authorization and must not rely on those redirects.

## Device-authenticated APIs

All API routes below require `x-device-token` and resolve a real user in `users.json`, except the signed upload retrieval path. `SERVER_MODE=private` also limits these requests to local/private network addresses. `SERVER_MODE=public` permits internet requests while keeping device-token and role/store checks in place.

| URL | Authorization boundary |
| --- | --- |
| `GET /loans`, `GET /loans/:id`, `GET /loans/search` | Customers see their own loans in their assigned store; staff are store-scoped; main admin may request `storeId=all` |
| `GET /loans/all`, `POST /loans/notify-overdue`, `POST /loans/notify-user`, `POST /loans/:id/notify-overdue` | Staff role and assigned store; main admin may span stores where the handler permits it |
| `POST /loans/request`, `POST /loans/:id/action`, `POST /loans/payment`, `POST /admin/loans` | Authenticated customer ownership or the exact staff role required by the loan lifecycle policy |
| `/reports/*`, `/payments`, `/payments/export` | Staff role and store scope; customer report routes verify ownership |
| `GET /users`, `POST /admin/users`, `/invites*`, `/admin/announcements` | Staff role gates; response fields and store scope are enforced in controllers |
| `/feedback*` | Authenticated submission, scoped staff reads, store-admin status updates |
| `/sessions`, `/logs/access`, `/logs/errors` | Staff-only; sessions expose masked tokens and are scoped |
| `/admin/backup`, `/admin/backups`, `/admin/restore` | Staff gate; restore also requires the configured master key |
| `/hr/employees*`, `/hr/store-switch/*` | Main admin or franchise admin, with store scope |
| `/admin/server-mode` | Franchise-manager allow-list plus admin/franchise role |
| `POST /uploads/sign` | Authenticated file ownership/store check |
| `GET /uploads/:filename?exp=…&sig=…` | Short-lived signed link; bearer access for that file only. Raw `?token=` is rejected. |

## Operator-only key endpoints

| URL | Purpose |
| --- | --- |
| `POST /vault/request`, `POST /vault/authorize` | Master-key + email OTP vault flow |
| `POST /internal-shutdown` | Local operator shutdown command |

These endpoints are registered before the general device-auth middleware, so the handlers separately reject non-private client IPs even in PUBLIC mode. Keep them out of customer-facing pages and never place their keys in URLs or browser storage.

## External URL checks still required at deployment

1. Start behind the configured single trusted HTTPS proxy and use the actual public hostname from the deployment provider.
2. Open the landing, login, invite signup, stylesheet, and script URLs from a second device.
3. Verify signup rejects missing/expired/wrong-email invites; login and reset remain same-origin.
4. Verify anonymous requests cannot read loans, users, reports, logs, backups, HR data, or feedback.
5. Verify each staff role is denied cross-store reads and actions, and signed upload links expire.
