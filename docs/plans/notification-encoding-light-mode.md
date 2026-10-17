# Admin Notifications and Shared Theme Cleanup

## Purpose
Make admin loan-request notifications appear consistently in the bell, remove garbled admin-page text, and bring light mode in line with the refreshed shared palette.

## Progress
- [x] (2026-10-17) Trace loan-request creation, notification storage/API filtering, and admin bell refresh/render behavior.
- [x] (2026-10-17) Identify garbled text and legacy light-mode overrides in the admin/public theme.
- [x] (2026-10-17) Persist and expose scoped admin loan-request notifications with working review/read actions.
- [x] (2026-10-17) Replace mojibake and unify the light theme across frontend/admin.
- [x] (2026-10-17) Verify notification flow, test suite, syntax, diff, and server startup.

## Decision Log
- (2026-10-17) Store loan-request alerts as in-app notifications with no recipient email, then expose them to in-scope admin roles by loan record scope.
- (2026-10-17) Keep borrower notifications private to the borrower and reuse existing mark-read authorization patterns.
- (2026-10-17) Use plain ASCII text for previously garbled decorative labels and a neutral light palette with the shared blue/semantic accents.

## Surprises and Discoveries
- Loan request creation only persisted a borrower notification; staff alerts were only sent by email.
- Staff notification reads only included payment-review items, so request queue updates could never increment the bell.
- The shared stylesheet still had old slate/teal light-mode overrides, while admin.html contained corrupted emoji/arrow/search glyphs.

## Outcomes and Retrospective
New requests now persist a separate staff inbox item, exposed only to in-scope admin roles. The bell refreshes when opened and during dashboard refresh, displays request/payment review actions, and can mark items read. Garbled admin labels were replaced and a shared neutral light theme was added with refreshed asset versions.

## Concrete Steps
1. Update `controllers/loanController.js` and `routes/index.js` only if needed to create and scope admin loan-request inbox items.
2. Update `public/admin.js` to refresh/render actionable loan-request notifications and mark them read.
3. Replace corrupted text in `public/admin.html`.
4. Update `public/style.css` light-mode tokens and high-specificity admin/customer component overrides.
5. Run the existing suite, JavaScript syntax checks, `git diff --check`, and `node server.js`.

## Validation
- New loan requests appear in the in-scope admin bell with an unread count and a review action.
- Marking a request read clears the unread state; unauthorized users cannot read another store's alert.
- No garbled strings remain in the public UI; light mode uses the updated coherent palette on both frontend and admin.
- Routes changed: none expected.
- Middleware changed: none.
- Body part: Brain and Skin.
- The test suite passes (133 tests); the new request notification test checks visibility, store scoping, and mark-read behavior. Visual browser inspection was unavailable because no browser surface was attached to this session.
