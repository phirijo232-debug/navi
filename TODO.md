# TODO - PC admin + loan workflow (desktop only)

## Confirmed this week: necessary for the project

- [x] Review the current user flow and server-side loan logic to confirm the real gaps.
- [ ] Finalize the desktop-only UX and keep the dark theme untouched while adding light-mode clarity where required.
- [ ] Extend the user loan request form with timeframe/urgency fields and the matching interest calculation.
- [ ] Add a complete user loan history area with filters for recent periods and computed totals/interest.
- [ ] Implement invite-based onboarding so a customer can only sign up for the intended loan flow.
- [ ] Build the admin loan review workflow: create invite, approve/start/close/pay actions, and summary reporting.
- [ ] Validate the backend loan status logic against real user actions and repayment events.
- [ ] Run an end-to-end desktop QA pass for signup -> login -> dashboard -> loan request -> history -> admin review.

## Additional items that bring clear project value

- [ ] Add stronger server-side validation for all loan submissions and updates so invalid data cannot slip through.
- [ ] Add explicit audit trail fields for loan actions, timestamps, and who changed what.
- [ ] Add overdue detection and repayment reminders to reduce manual follow-up.
- [ ] Add admin reporting exports (CSV or PDF) for loans, totals, and outstanding balances.
- [ ] Add notification hooks for approval, payment, and overdue events using the email path already in place.
- [ ] Add backup/restore handling for users and loan records to protect project data.
- [ ] Add UI polish for status badges, summary cards, and error messages for faster admin use.
- [ ] Add a strict release checklist before deployment: env checks, login flow, invite checks, and data integrity checks.

## Why these are important

- The backend already supports user login, loan requests, and status actions, so the next value is finishing the desktop workflow and admin controls.
- The invite flow and loan status logic are the biggest functional wins because they protect onboarding quality and reduce operational mistakes.
- Reporting, reminders, and audit tracking increase trust, reduce manual admin work, and make the project easier to scale beyond a local demo.

## Weekly priority order

1. User request data + interest + history flow
2. Invite-based signup and admin access control
3. Admin actions + reporting
4. QA, notification hooks, and operational safeguards

