# ExecPlan — BMF Admin and Customer Portals with Verified Payments

## Purpose
Reorganize the BMF admin and customer dashboards around the supplied Aura-style prompts, add a review-first bank/mobile-money payment flow, collect separate NRC front/back images, and provide consistent success/error feedback and customer notifications without exposing private records or credentials.

## Body Part
Skin (admin/customer pages, styles, shared feedback), Brain (loan/payment/notification controllers), Spine (existing route registry), and Immune system (ownership, role/store, file access, input validation).

## Progress
- [x] (2026-10-16) Read both full supplied design prompts and compare their endpoint assumptions with the current API and authorization rules.
- [x] (2026-10-16) Inspect existing loan upload, payment ledger, file signing, notification storage, customer/admin pages, and relevant tests.
- [x] (2026-10-16) Record design and money-flow decisions before implementation.
- [x] Reorganize the admin request queue around pending loans and pending transfer reviews; preserve staff actions and role-specific controls.
- [x] Reorganize the customer loan detail flow with secure transfer submission and separate NRC front/back uploads.
- [x] Implement pending payment submission, admin approval/decline, audit fields, notifications, duplicate-reference checks, and strict scope gates.
- [x] Add on-screen success feedback to authentication and loan/payment actions; remove device-token display and escape customer loan content.
- [x] Add payment lifecycle/authorization tests and route wiring coverage.
- [x] Run the automated suite, inline/page and controller syntax checks, `git diff --check`, and verify `node server.js` starts.
- [x] Update `AGENTS.md`, `docs/ROUTES.md`, and `TODO.md` for the new routes and final behavior.
- [ ] Inspect authenticated dashboard pages at desktop/mobile sizes. The computer-use browser inventory is empty and the in-app browser reports `iab` unavailable, so only DOM/HTML, script parsing, route wiring, and app tests could be verified here.

## Decision Log
- 2026-10-16: Treat both pasted prompts as design references, not API contracts. Keep current route names and exact AGENTS role gates unless a new route is required for the payment feature.
- 2026-10-16: Bank/mobile-money proof submission creates a `pending` payment submission. Only an authenticated, in-scope staff approval can append a payment ledger record and change outstanding balance. A decline never changes the ledger.
- 2026-10-16: Admin approval requires a deliberate confirmation that the proof image was inspected and the transaction was verified with the provider; the server rejects approval without that attestation.
- 2026-10-16: Approval uses the amount, mode, reference, and image already stored with the submission; approval requests cannot replace them. Require a valid transaction reference and proof image; reject duplicate references per loan/store.
- 2026-10-16: Keep physical cash payments on the existing staff-only `POST /loans/payment` flow. Customer self-service is limited to Airtel/MTN mobile money and bank transfer, which need proof review.
- 2026-10-16: Store NRC front/back in distinct loan fields and include them in signed-file ownership checks. Do not serve uploaded documents from the public static mount.
- 2026-10-16: Use existing loan/feedback/user APIs for admin metrics; do not add fake `/loans/my`, `/users/me`, `/announcements`, or theme routes. Use native SVG for charts so no external script/CDN is required by the current CSP.
- 2026-10-16: User-supplied guidance requires currency `K X,XXX.XX`, date `DD/MM/YYYY`, fixed tenure-specific BMF interest, canonical loan statuses, and loan decisions restricted to `store_admin`; these rules override contradictory sample values in the prompts.
- 2026-10-16: Keep live device tokens out of the customer UI and all HTML/URLs. Escape or text-render user-supplied values in dynamic page content.

## Surprises and Discoveries
- The design prompts name nonexistent or mismatched endpoints (`/loans/my`, `/payments/my`, `/announcements`, `/users/me`, `/loans/:id/pay`, `/admin/mode`, etc.). Existing working paths use `GET /loans?email=…`, `POST /loans/request`, `POST /loans/payment`, `POST /admin/announcements`, and `/admin/server-mode`.
- Existing direct payment recording posts immediately to the ledger. Reusing it for customer uploads would let unverified transfer claims reduce balances, so the new customer flow must be separate.
- Current uploads accept only images up to 5 MB and are served by signed ownership-checked links; this is a suitable existing base for payment proof and NRC images.
- `public/user.html` displays the device token in its About section; remove it.
- Existing `notifications.json` is an array used for scheduler email deduplication. Add distinct in-app notification records without changing the scheduled-notification record semantics.
- The admin decision policy is deliberately store_admin-only for approve/decline; preserve it even though the prompt suggests generic admin approvals.

## Concrete Steps
1. Add `paymentSubmissions` to the loan data shape and create customer submit plus staff approve/decline controller functions. Use the existing multipart image upload middleware, new route fields `paymentProof`, `nrcFront`, and `nrcBack`, and validate all fields server-side.
2. Reconcile approved submissions through the existing payment-ledger path only after scope and pending-state checks. Persist reviewer, decision time/reason, proof filename, transaction reference, and receipt id. Reject replays and duplicate references.
3. Extend `fileController.canViewFile` to recognize NRC fields and pending proof while preserving borrower ownership and staff store scope.
4. Add scoped customer in-app notification reads/mark-read and create notifications for loan request/status/payment transitions; keep email delivery best-effort after data is persisted.
5. Reorganize `admin.html`/`admin.js` and `user.html` around the prompts, use same-origin actual URLs and safe rendering, and preserve every existing staff operation.
6. Add a shared BMF toast component and wire successful OTP/login/request/payment/admin actions to it while retaining accessible inline error details.
7. Add route, security, UI-integrity, and lifecycle tests; update the route map and operating documentation.

## Routes Added or Changed
- `POST /loans/:id/payment-submissions` — authenticated borrower submits proof; creates pending review only.
- `POST /loans/:id/payment-submissions/:submissionId/approve` — scoped staff approval; posts the immutable pending amount into the ledger.
- `POST /loans/:id/payment-submissions/:submissionId/decline` — scoped staff decline with reason; no ledger change.
- `GET /notifications` — authenticated caller’s in-app notifications (staff may read store-scoped staff alerts if implemented by the admin panel).
- `PATCH /notifications/:id/read` — mark caller-owned notification as read.
- Existing `POST /loans/request` accepts `nrcFront` and `nrcBack` upload fields in addition to collateral photos.
- Existing `GET /uploads/:filename` and `POST /uploads/sign` include ownership-checked NRC and pending-payment proof files.

## Validation
- Payment tests prove submit leaves `payments`, `paidTotal`, and `outstanding` unchanged; approve adds one canonical payment with a unique PAY receipt and reconciled balances; decline leaves the ledger unchanged; repeat/duplicate approvals fail.
- Authorization tests deny customers submitting against another borrower’s loan, staff outside store scope, and roles not allowed by AGENTS.
- Upload tests prove NRC/payment proof cannot be accessed by anonymous, other borrowers, or out-of-scope staff, including signed URL issuance.
- UI tests ensure all dynamic API URLs map to registered routes, required dashboard elements exist, and the customer page never displays a device token.
- `npm.cmd test`, `node --check` on project JavaScript, `git diff --check`, visual browser review, then `node server.js` startup.

## Outcomes and Retrospective
The pending-transfer accounting and access boundaries are implemented and covered by tests. Both portals now expose the requested payment, report, notification, review, NRC, and portfolio summary flows. Automated checks pass. Browser visual QA and checking the deployment's actual public URL remain for an environment with a browser surface and the deployment hostname.
