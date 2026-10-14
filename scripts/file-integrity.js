// ─── FILE INTEGRITY & ROLLBACK TOOL ─────────────────────────────────────────
// Guards against silent file corruption (e.g. a page truncated to 1 byte).
//
// Usage:
//   node scripts/file-integrity.js            read-only audit (exit 1 on failure)
//   node scripts/file-integrity.js --restore  restore FAILED files from git HEAD
//
// Checks every git-tracked file (data/ and logs/ are runtime-owned and skipped):
//   1. MISSING  — tracked file no longer on disk
//   2. EMPTY    — file is 0 bytes
//   3. TINY     — public HTML under 1000 chars (suspicious truncation)
//   4. NOCTYPE  — public HTML page without <!DOCTYPE html> in its first 64 chars
//   5. BADJS    — a .js file that fails `node --check` (syntax-corrupt)
// `--restore` runs `git checkout -- <file>` for FAILED files only — modified
// but healthy files are reported as WARN and never touched.

const { execSync } = require('child_process');
const fs = require('fs');
const path = require('path');

const ROOT = path.join(__dirname, '..');
const RESTORE = process.argv.includes('--restore');

const SKIP_PREFIXES = ['data/', 'logs/', 'public/uploads/', 'node_modules/'];
const HTML_MIN = 1000;

function git(args) {
  return execSync(`git -C "${ROOT}" ${args}`, { encoding: 'utf8' });
}

function main() {
  const tracked = git('ls-files').split(/\r?\n/).filter(Boolean);
  const failed = [];
  const warned = [];

  for (const rel of tracked) {
    if (SKIP_PREFIXES.some((p) => rel.startsWith(p))) continue;

    const abs = path.join(ROOT, rel);
    if (!fs.existsSync(abs)) { failed.push({ rel, why: 'MISSING (tracked but not on disk)' }); continue; }

    const content = fs.readFileSync(abs);
    if (content.length === 0) { failed.push({ rel, why: 'EMPTY (0 bytes)' }); continue; }

    if (rel.startsWith('public/') && rel.endsWith('.html')) {
      if (content.length < HTML_MIN) failed.push({ rel, why: `TINY (${content.length} chars — suspicious truncation)` });
      else if (!content.slice(0, 64).toString('utf8').match(/^\s*<!DOCTYPE html>/i)) failed.push({ rel, why: 'NOCTYPE (HTML page without <!DOCTYPE html>)' });
    }

    if (rel.endsWith('.js')) {
      try {
        execSync(`node --check "${abs}"`, { stdio: 'pipe' });
      } catch (err) {
        failed.push({ rel, why: 'BADJS (syntax error — file is corrupt)' });
      }
    }
  }

  // Informational: tracked files differing from the last commit (healthy edits).
  const dirty = git('status --porcelain')
    .split(/\r?\n/)
    .map((l) => l.trim())
    .filter(Boolean)
    .map((l) => l.slice(3).trim())
    .filter((rel) => !rel.includes(' -> '))
  for (const rel of dirty) warned.push(rel);

  for (const f of failed) console.log(`FAIL ${f.rel} — ${f.why}`);
  for (const rel of warned) console.log(`WARN ${rel} — modified vs last commit (healthy, uncommitted edit)`);

  if (failed.length === 0) {
    console.log(`OK — ${tracked.length} tracked files audited, no corruption detected.`);
    process.exit(0);
  }

  if (!RESTORE) {
    console.log(`\n${failed.length} corrupted file(s) found. Run with --restore to roll them back from git:`);
    console.log('  node scripts/file-integrity.js --restore');
    process.exit(1);
  }

  console.log(`\nRestoring ${failed.length} file(s) from git HEAD...`);
  for (const f of failed) {
    try {
      git(`checkout -- "${f.rel}"`);
      console.log(`RESTORED ${f.rel}`);
    } catch (err) {
      console.log(`FAILED to restore ${f.rel}: ${err.message}`);
    }
  }
  console.log('Restore complete. Re-run without --restore to verify.');
  process.exit(0);
}

main();
