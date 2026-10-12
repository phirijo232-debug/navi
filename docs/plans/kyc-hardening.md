# ExecPlan — KYC / Proof-of-Payment Image Hardening

## Purpose
Customer KYC images (collateral front/back) and payment proofs were served as
plain static files with **no authentication or ownership check**. Anyone who
could reach the server (LAN, or any local process) could open another customer's
ID photo or payment proof by guessing a `/uploads/<filename>` URL. After this
change, images are only viewable by the borrower who owns the loan or an admin
whose store scope covers it.

## Body part
Immune system (security) + Skin (frontend links).

## Progress
- [x] Block unauthenticated `/uploads/*` (route registered before express.static)
- [x] Ownership + store-scope check via controllers/fileController.js
- [x] Token carried on frontend `<a>` links (query token fallback for navigation)
- [x] Multer hardened: image-only filter + sanitized, de-collidable filenames
- [x] Tests: controller/uploadAccess.test.js (traversal, ownership, admin scope)
- [x] Validation: node --test green + node server.js boot check

## Decision Log
- Serve via an auth handler mounted BEFORE express.static (static runs before
  deviceAuth), not a new route file — respects AGENTS rule 7. Reason: static is
  ahead of deviceAuth in server.js, so the only correct place to intercept
  `/uploads/*` is ahead of static.
- Return 404 (not 403) when the file is unknown/unreferenced — no enumeration
  oracle. Return 403 only when a valid user lacks ownership of a real file.
- `?token=` query fallback scoped to this one handler only, because `<a>` clicks
  cannot attach the x-device-token header. Header still preferred when present.
- Did NOT move uploads out of public/ — avoids breaking existing files on disk
  and honours "do not reorganise the folder structure".

## Surprises and Discoveries
- PII-bearing API report endpoints (`/reports/*`, `/payments`, tracking) were
  already admin-or-self gated (isAuthorized / isAuthorizedUserReport /
  getPaymentsLedger). The only true leak was the static image mount.
- Filenames stored in loans.json for existing uploads use the old
  `Date.now()-originalname` scheme; the new scheme is additive and both resolve
  because the controller looks up the exact stored name.

## Concrete Steps
1. middleware/security.js: export findUserByDeviceToken (append-only).
2. controllers/fileController.js (new): safeFilename, canViewFile, serveFile.
3. controllers/loanController.js: multer fileFilter + sanitized filename.
4. server.js: `app.get('/uploads/:filename', serveFile)` before express.static.
5. public/admin.js + public/dashboard.js: fileUrl() adds ?token= to links.
6. test/uploadAccess.test.js: coverage for the above.

## Validation
- `node --test` all green.
- Anonymous GET /uploads/<file> → 403; valid owner token → 200; other customer →
  403; admin out-of-store → 403; `../../x` traversal → 400; non-image upload →
  rejected by fileFilter.
- `node server.js` starts cleanly (AGENTS rule 6).
