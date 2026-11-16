'use strict';
// Guards the slate re-theme: retired purple/cyan brand tokens must never
// return to the theme files. Status-pill semantic colors and the print
// template are intentionally NOT checked here.
const { test } = require('node:test');
const assert = require('node:assert');
const fs = require('fs');
const path = require('path');

const THEME_FILES = [
  'public/style.css',
  'public/admin.html',
  'public/login.html',
  'public/admin.js'
];

const RETIRED_TOKENS = [
  '#050510', '#e0e0ff', '#eaeaf9', '#f0f4ff', '#1a1a2e', '#0d1320', '#1b1236',
  '#5500cc', '#0099cc', '#3a1a88', '#0ea5e9', '#38bdf8', '#f5f7ff', '#18181b',
  '#1f2937', '#7b2fff', '#00cfff', '#9f7cff', '#d9cbff', '#b7a8ff', '#6edbff',
  'rgba(123, 47, 255', 'rgba(123,47,255', 'rgba(0, 207, 255', 'rgba(0,207,255',
  'rgba(145, 129, 255', 'rgba(145,129,255', 'rgba(18, 199, 254', 'rgba(18,199,254',
  'rgba(82, 55, 180', 'rgba(82,55,180', 'rgba(59, 26, 94', 'rgba(59,26,94',
  'rgba(120, 0, 255', 'rgba(120,0,255', 'rgba(0, 200, 255', 'rgba(0,200,255',
  'rgba(180, 0, 255', 'rgba(180,0,255', 'rgba(0, 150, 255', 'rgba(0,150,255',
  'd6e7ff'
];

const SLATE_TOKENS = ['#10141a', '#e6eaf0', '#5b94d6'];

function read(rel) {
  return fs.readFileSync(path.join(__dirname, '..', rel), 'utf8').toLowerCase();
}

test('slate retheme: retired purple/cyan tokens are absent from theme files', () => {
  for (const rel of THEME_FILES) {
    const txt = read(rel);
    for (const token of RETIRED_TOKENS) {
      assert.ok(
        !txt.includes(token.toLowerCase()),
        `${rel} still contains retired token "${token}"`
      );
    }
  }
});

test('slate retheme: new palette is present in the master stylesheet', () => {
  const css = read('public/style.css');
  for (const token of SLATE_TOKENS) {
    assert.ok(css.includes(token), `style.css missing slate token "${token}"`);
  }
});

test('slate retheme: status pills keep their semantic colors', () => {
  const css = read('public/style.css');
  // pill tints use no-space rgba in style.css — assert exact in-file forms
  assert.ok(css.includes('#f0c56a'), 'grace/warning colour missing');
  assert.ok(css.includes('#8fdcb0'), 'paid/success colour missing');
  assert.ok(css.includes('#ffb4ab'), 'declined/error colour missing');
  assert.ok(css.includes('#5b94d6'), 'active/primary colour missing');
});