# Shared BMF Dark Theme

## Purpose
Use the requested developer dark palette consistently across customer-facing pages and the BMF admin panel. Keep the existing light theme available when users select it.

## Progress
- [x] (2026-10-17) Trace shared stylesheet, admin overrides, and public HTML asset references.
- [x] (2026-10-17) Define shared theme tokens and apply them to public and admin dark surfaces, controls, text, and status colors.
- [x] (2026-10-17) Version stylesheet references to invalidate cached palette assets across all public pages.
- [x] (2026-10-17) Run syntax, existing test, and server startup checks.

## Decision Log
- (2026-10-17) Dark mode uses the exact requested colors as CSS custom properties; light mode remains an alternate preference.
- (2026-10-17) Keep semantic success, warning, and danger colors distinct while using the shared palette for layout surfaces and text.
- (2026-10-17) Version the shared stylesheet URL in every public HTML page so existing browsers fetch the updated theme.

## Surprises and Discoveries
- The customer pages used a teal and gray palette while the admin dashboard had a separate GitHub-style dark palette; the shared CSS alone did not unify all dashboard surfaces.
- Admin inline styles also set body and panel colors, so corresponding shared dark selectors need enough specificity to override those page defaults.

## Outcomes and Retrospective
The shared stylesheet now defines the requested dark palette and applies it across customer and admin pages, including panels, inputs, buttons, tables, badges, and dashboard surfaces. Light-mode rules remain separate. Existing tests pass.

## Concrete Steps
1. Update CSS palette tokens and dark-mode component overrides in `public/style.css`.
2. Align admin inline dark defaults in `public/admin.html`.
3. Update `style.css` asset references in `public/admin.html`, `public/dashboard.html`, `public/index.html`, `public/forgot-password.html`, `public/login.html`, `public/signup.html`, and `public/user.html`.
4. Run `node --check public/admin.js`, `npm.cmd test`, `git diff --check`, and `node server.js`.

## Validation
- All public HTML pages request `style.css?v=20261017-bmf-dark-theme`.
- CSS defines the exact requested tokens: `#0B0F17`, `#161B22`, `#21262D`, `#2F81F7`, `#2EA043`, `#D29922`, `#DA3633`, `#F0F6FC`, and `#8B949E`.
- `npm.cmd test` passes and `node server.js` starts.
- Routes added/changed: none.
- Middleware changed: none.
- Body part: Skin.
