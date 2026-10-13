# Admin Panel — BMF Loan Control Dashboard

This ExecPlan is a living document. Progress, Decision Log, Surprises,
and Outcomes must be kept updated as work proceeds.

## Purpose

Joseph needs a single web page (admin.html) where he can log in as admin
and see everything about BMF loans in one place — all loans, all customers,
all payments, all reports. After this change Joseph can approve loans,
record payments, generate invite links for customers, and read daily
analytics without touching any code or JSON files directly.

## Body Part
Skin — this is a frontend build. Backend routes already exist.

## Progress

- [ ] Read AGENTS.md completely before writing any code
- [ ] Confirm node server.js starts cleanly before making changes
- [ ] Create public/admin.html with role check redirecting non-admins
- [ ] Create public/admin.js with all fetch calls using x-device-token
- [ ] Section 1 — Dashboard overview panel (totals, quick actions)
- [ ] Section 2 — Loan portfolio table with filters and action buttons
- [ ] Section 3 — Add new loan form (all BMF fields)
- [ ] Section 4 — Record payment form
- [ ] Section 5 — Reports tabs (daily, profits, defaulters, overdue, paid)
- [ ] Section 6 — Customer directory table
- [ ] Section 7 — Generate invite link form
- [ ] Section 8 — Announcements form
- [ ] Section 9 — Feedback and complaints table
- [ ] Wire any missing routes in routes/index.js
- [ ] Confirm node server.js starts without errors
- [ ] Test all sections on PC browser
- [ ] Test all sections on mobile browser

## Decision Log

- Decision: Build admin panel as single HTML file with tab navigation
  Rationale: Keeps existing style.css and dark/light mode system intact
  Date: 2026-10-10

## Surprises and Discoveries

(update as work proceeds)

## Outcomes and Retrospective

(update at completion)

## Context and Orientation

The server runs at http://localhost:3000
Admin panel will be at http://localhost:3000/admin.html
All routes are defined in C:\NaviServer\routes\index.js
All report data comes from C:\NaviServer\controllers\reportController.js
All loan data comes from C:\NaviServer\controllers\loanController.js
Theme is handled by localStorage — never by server routes
Authentication uses x-device-token header stored in localStorage after login
Role check: localStorage.getItem('role') must equal 'admin' or 'store_admin'

## Routes Available for Admin Panel

GET  /loans/all — all loans
GET  /reports/all — all users report
GET  /reports/analytics — analytics summary
GET  /reports/:scope/profits — profit analytics
GET  /reports/:scope/defaulters — defaulters
GET  /reports/:scope/overdue — overdue loans
GET  /reports/:scope/paid — paid loans
GET  /users — all users
POST /loans/:id/action — approve, decline, mark active, close
POST /loans/payment — record payment
POST /invites/create — generate invite link
POST /admin/announcements — send announcement
GET  /feedback — get all feedback
POST /feedback/:id/status — update feedback status

## Concrete Steps

1. Create C:\NaviServer\public\admin.html
2. Create C:\NaviServer\public\admin.js
3. Add role check at top of admin.js:
   const role = localStorage.getItem('role');
   if (role !== 'admin' && role !== 'store_admin') {
     window.location.href = 'login.html';
   }
4. Build each section as a tab panel
5. Each fetch call must include:
   headers: { 'x-device-token': localStorage.getItem('deviceToken') }
6. Run node server.js after changes and confirm no errors
7. Open http://localhost:3000/admin.html in browser
8. Confirm redirect happens if not logged in as admin
9. Log in as admin and confirm all sections load data correctly

## Validation

After completing:
- Visit http://localhost:3000/admin.html without being logged in
  Expected: redirect to login.html
- Log in as admin, visit http://localhost:3000/admin.html
  Expected: dashboard overview shows loan totals
- Click Loan Portfolio tab
  Expected: table of all loans loads with correct data
- Record a test payment
  Expected: outstanding balance updates correctly
- Generate an invite link
  Expected: link appears and is copyable

## Currency and Date Format

All amounts displayed as: K X,XXX.XX
All dates displayed as: DD/MM/YYYY