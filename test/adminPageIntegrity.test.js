const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

// ─── FILE INTEGRITY GUARD ────────────────────────────────────────────────────
// public/admin.html was once corrupted down to a single byte with no working
// copy left in git history. These tests make that class of corruption
// impossible to go unnoticed: every future `node --test` run re-verifies the
// page structure and every DOM id admin.js binds to.

const ROOT = path.join(__dirname, '..');
const PUBLIC_DIR = path.join(ROOT, 'public');

const html = fs.readFileSync(path.join(PUBLIC_DIR, 'admin.html'), 'utf8');
const js = fs.readFileSync(path.join(PUBLIC_DIR, 'admin.js'), 'utf8');

test('admin.html is structurally intact (not corrupted or truncated)', () => {
  assert.ok(html.length > 15000, `admin.html is suspiciously small (${html.length} chars)`);
  assert.match(html.slice(0, 64), /^\s*<!DOCTYPE html>/i, 'admin.html must start with <!DOCTYPE html>');
  assert.equal((html.match(/<!DOCTYPE/gi) || []).length, 1, 'admin.html must contain exactly one DOCTYPE');
  assert.equal((html.match(/<script[^>]*src="admin\.js"/g) || []).length, 1, 'admin.html must load admin.js exactly once');
  assert.ok(!html.includes('@@APPEND@@'), 'leftover append marker found — rebuild was incomplete');
  assert.match(html, /<\/html>\s*$/, 'admin.html must end with </html>');
});

test('every id bound by admin.js exists in admin.html', () => {
  const ids = new Set();

  // document.getElementById('someId') — literal targets
  for (const match of js.matchAll(/getElementById\(\s*['"]([^'"]+)['"]\s*\)/g)) {
    ids.add(match[1]);
  }

  // ['a', 'b', 'c'].forEach(id => ... getElementById(id)) — array-driven targets
  for (const match of js.matchAll(/\[([^\]]*)\]\.forEach\(\s*id\s*=>/g)) {
    for (const literal of match[1].matchAll(/['"]([^'"]+)['"]/g)) {
      ids.add(literal[1]);
    }
  }

  assert.ok(ids.size >= 50, `expected many id bindings in admin.js, found ${ids.size}`);

  const missing = [...ids].filter((id) => !html.includes(`id="${id}"`));
  assert.deepEqual(missing, [], `admin.html is missing ids bound by admin.js: ${missing.join(', ')}`);
});

test('every data-attribute selector used by admin.js exists in admin.html', () => {
  const attrs = new Set();
  for (const match of js.matchAll(/querySelectorAll\(\s*['"]\[([a-zA-Z0-9_-]+)\]['"]/g)) {
    attrs.add(match[1]);
  }
  assert.ok(attrs.size > 0, 'expected data-attribute selectors in admin.js');
  const missing = [...attrs].filter((attr) => !html.includes(attr));
  assert.deepEqual(missing, [], `admin.html is missing data attributes used by admin.js: ${missing.join(', ')}`);
});

test('all public HTML pages are non-trivial and start with a doctype', () => {
  const pages = ['admin.html', 'dashboard.html', 'index.html', 'login.html', 'signup.html', 'forgot-password.html', 'user.html'];
  for (const page of pages) {
    const file = path.join(PUBLIC_DIR, page);
    assert.ok(fs.existsSync(file), `${page} is missing`);
    const content = fs.readFileSync(file, 'utf8');
    assert.ok(content.length > 1000, `${page} is suspiciously small (${content.length} chars)`);
    assert.match(content.slice(0, 64), /^\s*<!DOCTYPE html>/i, `${page} must start with <!DOCTYPE html>`);
  }
});
