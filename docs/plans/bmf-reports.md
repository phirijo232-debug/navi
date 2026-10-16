# BMF 10-Report System — ExecPlan (living document)
Body part: Brain (controllers) + Skin (admin panel) + Lungs (schedulers)

## Purpose
10 BMF report types (Excel + PDF) downloadable from routes + admin panel,
auto-emailed on schedule. Daily Business Report 08:00 Lusaka is the ONLY daily
report (replaces 23:58/23:59 slots entirely). Admin recipient jophiri223@gmail.com.

## Progress
- [x] (2026-10-16) config REPORTS: 08:00 default, DAILY_ADMIN_EMAIL jophiri223, REPORT_TYPES list
- [x] (2026-10-16) scheduler header: 08:00-only comment
- [ ] services/bmfReports.js pure builders (displayStatus, 10 row builders, filenames, risk)
- [ ] Excel builders (10 sheets + tracker, spec styling/widths)
- [ ] PDF builders (borrower card + business report)
- [ ] reportController handlers + data/reportMeta.json last-generated
- [ ] routes: 11 flat /reports/<type> before :scope block
- [ ] scheduler: 08:00 daily + monthly 07:00/07:05/07:10 + Monday 07:00 overdue/defaulters; remove 23:58/23:59
- [ ] admin.html/admin.js Reports menu (10 rows + borrower search + date range)
- [ ] test/bmfReports.test.js
- [ ] AGENTS.md routes + TODO.md + full suite green + boot check

## Decision Log
- 08:00 replaces 23:58 notifications + 23:59 report (user instruction 2026-10-16).
- Recipient jophiri223@gmail.com (spec's jophiri232 treated as typo); env ADMIN_EMAILS/DAILY_REPORT_EMAIL wins.
- services/ new folder (reportController ~1170 lines; AGENTS only forbids separate route files).
- grace displays as active; Overdue sheet strictly past-due + outstanding>0.
- Balance Before/After from stored payment fields, never recomputed.

## Concrete Steps / Validation
- node --check each file; node --test full suite; node server.js boot; GET /reports/daily?format=xlsx with admin token downloads.
