# ExecPlan: Slate Monochrome Re-theme

## Purpose
Replace the purple/cyan brand identity across the entire UI with a 6-step slate
monochrome scale, giving the product a neutral, professional look. Loan-status
pills keep their semantic green/amber/red/blue so financial states stay readable
at a glance. No behavior changes — Skin layer only.

Body part: Skin (public HTML/CSS/JS styling only). No routes added or changed.

## Progress
- [x] (2026-10-14) Full color inventory of public/ (249 color lines catalogued)
- [x] (2026-10-14) Build old→new mapping table; every line mapped or kept
- [x] (2026-10-14) Apply via .retheme-apply.js to style.css, admin.html, login.html, admin.js
- [x] (2026-10-14) Add test/palette.test.js guard, run full suite — 116/116 pass
- [x] (2026-10-14) Boot check `node server.js` on PORT=3199 OK, cleanup temp files, commit

## Decision Log
1. **Palette (2026-10-14)** — 6-step slate scale:
   `#06141B` (dark bg / light text), `#0B1D26`/`#11212D` (surfaces via rgba),
   `#1B2F3D` (dark accent), `#4A5C6A` (mid accent / filled controls),
   `#9BA8AB` (light accent, text, borders), `#CCD0CF` (primary text on dark),
   `#DDE1E0` (light-theme bg).
2. **Status pills keep hues (user-approved)** — pending/active/grace/defaulted/
   liquidated/paid/declined pills, loan badges, feedback tag hues, warning
   colors (`#ffb74d`, `#ff4444`, `#ffaa00`, `#00ff88`) and the print template
   (`#111/#999/#eee`) are excluded from mapping.
3. **White-alpha neutrals kept** — `rgba(255,255,255,·)` surfaces/borders and
   `rgba(0,0,0,·)` shadows are compositional neutrals, not brand hue.
4. **Timeframe-chip → slate** (989-991 style.css) — it is an info chip, not a
   status pill; cyan is a retired brand hue.
5. **Dual-role `#f5f7ff`** split by context: `color:` → `#CCD0CF` (dark text),
   `background` → `#DDE1E0` (light textarea).
6. **Active tab pills (775/777)** line-targeted → `#4A5C6A` with white text;
   hover borders (243/323) → `#9BA8AB` for pop.
7. **login.html included** (one token `#1a1a2e`) for consistency even though the
   original scope named 3 files; dashboard.html needs no change (white-alpha only).

## Surprises and Discoveries
- `#7b2fff` had three different roles (stat text, loader dots, filled active
  tab) requiring line-targeted overrides instead of one global token swap.
- Cloud glow alphas reduced (0.25–0.40 → 0.08–0.14) because slate hues read
  stronger than the old saturated purple/cyan at equal alpha.
- The whole re-theme is expressible as ~60 ordered substring replacements; no
  structural CSS edits needed.

## Concrete Steps
1. Run `node .retheme-apply.js` — applies ordered GLOBAL map + line overrides
   (style.css:775 `background: #7b2fff`, :777 `border-color: #7b2fff` →
   `#4A5C6A`), then admin.js `'#d6e7ff'` → `'#CCD0CF'`; writes
   `.retheme-apply-report.txt`; exits non-zero if any retired token remains.
2. `node --check public/admin.js` (only JS touched).
3. `node --test` full suite; add `test/palette.test.js` (retired-token guard).
4. Boot check on isolated port (PORT=3199), confirm `[server-mode]` line.
5. Delete temp files (`.retheme-*`), commit public/*, docs/plans, test.

## Validation
- `.retheme-apply-report.txt`: every map rule applied with expected counts,
  retired-token scan = 0 hits across all four files.
- `node --test`: 114/114 (113 existing + palette guard) green.
- Boot log shows `[server-mode] started in ...` on PORT=3199.
- Grep confirms `#06141B`/`#4A5C6A`/`#9BA8AB` present; `#7b2fff`/`#00cfff`
  absent.

## Outcomes and Retrospective
All four theme files re-themed to the slate palette; retired-token scan shows
zero leaks; 116/116 tests green (113 existing + 3 new palette guards in
test/palette.test.js). Boot verified on PORT=3199 with `[server-mode] started
in PRIVATE mode`. Semantic colors (status pills, feedback tags except inquiry,
threat/warning/safe, print template) preserved. Retrospective: expressing the
whole re-theme as one ordered, idempotent replacement map made it atomic,
reviewable and re-runnable; the single sharp edge was `#7b2fff` having three
roles, solved with line-targeted overrides.