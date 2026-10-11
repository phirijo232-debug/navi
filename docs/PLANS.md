# Codex Execution Plans (ExecPlans)

This document defines how execution plans work for NaviServer / Pryme Vertex BMF.
Every ExecPlan is a living document stored in docs/plans/ and named descriptively.
Example: docs/plans/admin-panel.md, docs/plans/report-system.md

## When to create an ExecPlan

Create an ExecPlan before starting any task that:
- Touches more than two files
- Adds a new route, controller, or frontend page
- Changes existing authentication or loan logic
- Could break existing working features

## Required sections in every ExecPlan

### Purpose
What the user gains after this change. What they can do that they could not before.

### Progress
Checkbox list updated as work happens.
- [x] (date) completed step
- [ ] incomplete step

### Decision Log
Every significant decision recorded with reason and date.

### Surprises and Discoveries
Unexpected bugs or behaviors found during implementation.

### Outcomes and Retrospective
Summary at completion — what was achieved, what remains.

### Concrete Steps
Exact commands to run, exact files to edit, exact functions to change.

### Validation
How to prove the feature works — specific URL to visit, specific output to see.

## NaviServer specific rules inside every ExecPlan

1. State which body part this work belongs to (Spine, Brain, Skin, etc.)
2. List every route added or changed
3. Confirm node server.js starts without errors after changes
4. Confirm no existing tests break
5. Never change middleware/logger.js, middleware/otp.js, or middleware/dataStore.js
   without explicit instruction from Joseph