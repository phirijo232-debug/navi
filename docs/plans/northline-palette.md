# Northline palette

## Purpose

Replace the violet/cyan screen colors with the Northline palette in both light and dark modes, so staff and customers get a calmer, readable interface. Layout, copy, and behavior stay as they are. This work is Skin (public CSS and the few pages that hardcode colors).

## Progress

- [x] (2026-11-01) Audit current colors and lock the Northline hex tables
- [x] (2026-11-01) Apply tokens in public/style.css, admin.html, admin.js message colors, login.html, dashboard.html
- [x] (2026-11-01) Confirm text/background pairs meet WCAG AA
- [x] (2026-11-01) Confirm node server.js starts and serves / and /style.css
- [x] (2026-11-01) Capture after screenshots of landing, login, admin, account, and dashboard in both modes

## Decision Log

- (2026-11-01) Primary fills are a flat primary color. Dark buttons and the filled wordmark use text-on-primary `#0E1A2C`. Light wordmarks stay clipped text in the solid primary `#1E4E8C`.
- (2026-11-01) The dark glow stays animated and is recolored to the primary at 8–12% opacity. Purple shadows become black at the same alpha.
- (2026-11-01) Status chips: pending and grace use warning, active (and legacy in-progress) uses info, paid uses success, declined and defaulted use error, liquidated uses secondary. Chip fill is 14% of that color over the card.
- (2026-11-01) `.stat-label` (opacity 0.5) and `.panel h2` (opacity 0.6) cannot reach 4.5:1 on the light card at those opacities, for any text color. Their color becomes the muted token at full strength so the pair meets WCAG AA.

## Surprises and Discoveries

- Light-mode loan badges and the cyan end of the old primary gradient fail WCAG AA. Northline replaces both.

## Outcomes and Retrospective

Northline is applied in both modes. Primary fills are flat. The dark glow is a faint primary wash and still animates. Shadows are neutral black. Dark buttons and the filled wordmark use `#0E1A2C`. Light wordmarks stay clipped text in `#1E4E8C`. `.stat-label` and `.panel h2` use the muted token at full strength because their old 50% and 60% fades cannot clear 4.5:1 on the light card. The print stylesheet in admin.js is unchanged. No routes changed.

## Concrete Steps

1. Add Northline custom properties (dark on `:root`, light on `.light`).
2. Point existing color declarations at those properties. Remove the duplicated light `.enter-btn` and `.tagline` rules.
3. Update message colors in admin.js only. Leave the print stylesheet.
4. Run `node server.js` and screenshot the five pages in both modes.

## Validation

- No route changes.
- Grep shows no leftover `#7b2fff`, `#00cfff`, or `#050510` in the public UI.
- Landing, login, admin, account, and dashboard screenshots in light and dark show the Northline blues, gray page, and white or slate cards.
- `node server.js` prints the listen line and exits cleanly when stopped.

## NaviServer rules

- Body part: Skin.
- Routes added or changed: none.
- Do not edit middleware/logger.js, middleware/otp.js, or middleware/dataStore.js.
