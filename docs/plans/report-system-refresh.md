# Report system refresh plan

## Purpose
Refresh the BMF report engine so the admin panel and export endpoints use the plain-English report set described in the reporting prompt, with consistent Excel/PDF naming, manual download actions, and defensive code paths that avoid broken or duplicate report generation.

## Progress
- [x] Review the pasted report specification and compare it with the live report code paths
- [x] Confirm the current report controller/admin panel are inconsistent with the intended report names and manual-download flow
- [ ] Replace the mismatched report metadata and admin panel actions with the intended report set
- [ ] Rebuild the Excel/PDF export names and content to match the intended BMF report spec
- [ ] Validate the server starts and the relevant route flow remains working

## Decision Log
- 2026-11-02: Keep the existing report services as the base implementation, but replace the mismatched labels/names and admin download wiring so that the system matches the authored BMF report prompt instead of the older generic report labels.
- 2026-11-02: Avoid broad rewrites of unrelated controllers; scope changes to the report controller, admin panel, and report metadata so the feature is corrected without altering non-report logic.

## Surprises and Discoveries
- The repository already contains a report engine with 10+ typed reports, but it is not aligned with the plain-English labels and manual admin-panel flow in the pasted spec.
- Some report endpoints and labels exist, but the admin panel still uses older generic labels and direct scoped URLs that do not match the intended BMF report output naming.

## Outcomes and Retrospective
This will produce a consistent report library where the admin panel can pull the intended BMF Excel/PDF files manually and the exports use clean, plain-English names rather than legacy generic labels.

## Concrete Steps
1. Update the report metadata and typed report names so the admin panel exposes the prompt-defined report set.
2. Adjust the export filename generation to match the plain-English report names from the prompt.
3. Update the admin panel download logic to call the correct typed-report endpoints and trigger the manual Excel/PDF download flow.
4. Validate the server boots cleanly and the route surface still resolves.

## Validation
- Run: node server.js
- Check the server starts without errors.
- Verify the admin panel can call the report endpoints and the generated file names follow the prompt-defined naming scheme.
