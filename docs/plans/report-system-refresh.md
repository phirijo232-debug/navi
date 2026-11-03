# BMF report system refresh plan

## Purpose
Implement the attached BMF Reports System Prompt v3 so administrators can manually download accurate reports based only on live data, with auditable calculations, validation gates, specified Excel styling/formulas, and print-ready borrower statements.

## Progress
- [x] (2026-11-02) Read the complete 917-line Version 3 attachment and compare its report requirements with the live code
- [x] (2026-11-02) Identify inaccurate aliases, missing calculations, unsupported filters, and mismatched export names/layouts
- [x] (2026-11-02) Resolve output behavior with the user: each Excel button downloads the complete 10-sheet workbook; all nine cards retain PDF downloads, with borrower history using the specified two-page statement
- [x] (2026-11-02) Confirm examples in the prompt are illustrative only; report rows must come from live records
- [x] (2026-11-02) Confirm future loan and payment receipt IDs use independent sequential daily sequences; preserve existing IDs
- [x] Build validated report datasets from live loan, payment, and user records
- [x] Implement the nine report datasets, Excel formulas/styling, cashbook checks, and statement PDF
- [x] Wire report-card filters, single-loan selection, accurate filenames, and last-generated timestamps
- [x] Add targeted report tests for calculations, invalid-ledger rejection, workbook structure/formulas, PDFs, and route dispatch
- [x] Fix grace-penalty sweeps so accrued interest and persisted outstanding balances stay reconciled
- [x] Apply the user's confirmed penalty treatment to the identified live loan through the existing JSON/SQLite store API
- [x] Generate all nine cards' Excel and PDF exports from live records and validate workbook/page counts
- [x] (2026-11-03) Start `node server.js`, confirm `GET /status` returns HTTP 200, and stop the verification process

## Decision Log
- 2026-11-02: Use the user's read-only Version 3 attachment as the authoritative specification; do not infer missing report math from older report builders.
- 2026-11-02: Preserve the existing Express routes and controller exports where possible; expose prompt-friendly aliases through the existing `routes/index.js`.
- 2026-11-02: Keep all report data access in existing dataStore/controller services; do not add a Python dependency or modify `middleware/dataStore.js`, `middleware/logger.js`, or `middleware/otp.js`.
- 2026-11-02: Validate loan balance arithmetic in integer cents before generating exports; fail with HTTP 422 and a useful loan reference when a record does not reconcile.
- 2026-11-02: The user confirmed every Excel button should download the complete 10-sheet workbook, and all nine report cards should retain PDF downloads; borrower history must use the exact two-page statement layout.
- 2026-11-02: For PDF types without a dedicated page design, use the existing PDFKit renderer with the matching report's validated data and plain-English title; do not invent report-specific PDF styling requirements.
- 2026-11-02: The user confirmed prompt examples are not production data and future BMF loan receipts and PAY receipts should each increment sequentially; do not rewrite existing receipt numbers.

## Surprises and Discoveries
- The attachment is Version 3 (917 lines) and has detailed definitions for PAR aging, arrears aging buckets, statement ledgers, disbursements, installment schedules, collection efficiency, write-offs, cashbook reconciliation, and officer scorecards.
- The admin panel currently maps several cards to incompatible data: Aging to all-loans, single-borrower history to a one-loan tracker, collection efficiency to monthly collections, and officer scorecard to interest revenue.
- Date/officer controls are not all sent/applied, borrower history currently selects one loan, "Last generated" is static, and filenames use period dates or generic labels in some typed exports.
- Current services use PDFKit and ExcelJS; the prompt's ReportLab/openpyxl examples are Python-specific, so equivalent native Node implementations should be used rather than introducing a second runtime.
- The production loan schema does not record an installment schedule, write-off recovery metadata, client visits, or a separately reconciled cashbook. Reports must leave those measures blank/clearly unavailable rather than infer values from sample data; schedule input cells remain editable as specified.
- The grace-penalty sweep updated total payable and interest but did not rebuild the persisted outstanding balance. A focused regression test now verifies reconciliation and idempotence; the affected loan was corrected only after the user confirmed the accrued penalty was due.
- Multi-page business PDFs exposed that PDFKit page buffering was enabled after document construction. Buffering is now enabled in the constructor, and a multi-page regression test covers page footers.
- The report cards now render from a single live-data report library. They send selected-store, date, and officer filters; single-loan reports require an unambiguous loan search; successful downloads update the card's last-generated time.
- Targeted report, route, receipt-sequence, admin-integrity, and payment-audit tests pass. The full suite has one remaining failure in the existing frontend route-wiring check for `/api/apply`; all report-related tests pass.

## Outcomes and Retrospective
The Version 3 report builders and admin download flows are wired and covered by focused tests. All nine report cards successfully generated both formats from live data: each workbook has 10 sheets, and the borrower statement is exactly two A4 pages. The paid-plus-outstanding guard passes for all eight issued live loans after the user-confirmed reconciliation. One unrelated frontend route-wiring test remains failing for `/api/apply`.

## Concrete Steps
1. Audit live loan/payment/user fields and define report datasets with no inferred money fields.
2. Implement independent sequential future loan/payment receipt IDs without rewriting stored IDs.
3. Implement validation, date/officer/borrower filters, time buckets, collection/scorecard metrics, and honest unavailable-data handling for missing fields.
4. Build ExcelJS output with the specified 10-sheet workbook structure, formula cells, formatting, totals, and recalculation-on-open; every card downloads this workbook.
5. Build PDFKit output for every card; make the borrower statement exactly two A4 pages with its required ledger and validation.
6. Correct admin cards and aliases in `public/admin.js`, preserving auth/store headers and existing route paths.
7. Add deterministic tests using fixtures, including failure cases; run report tests, app startup, and inspect generated workbook/PDF properties.

## Validation
- Unit tests use fixed dates and loan/payment fixtures and assert exact bucket/rate/rounding results.
- Every export is refused when paid + outstanding differs from payable by more than K0.01 or outstanding is negative; cashbook running totals and the unavailable external balance are made explicit.
- Workbook inspection verifies the directory plus all nine report sheets, formula strings/styles, totals, and generated-date filenames.
- PDF inspection verifies A4 page size, exactly two pages for a borrower statement, required sections/footer, and balance/progress checks.
- Route tests verify admin auth/store scope, supported report aliases/formats, required loan IDs, error status, and Content-Disposition names.
- Focused report/admin/payment checks pass. Full suite currently has one unrelated `/api/apply` route-wiring failure.
- Live export check generated all nine card PDFs and complete workbooks in memory; no export was saved to the repository.
- `npm run lint` is unavailable because the repository has no ESLint configuration.
- `node server.js` started successfully, startup data validation passed, and `GET /status` returned HTTP 200. The verification process was stopped afterward.
