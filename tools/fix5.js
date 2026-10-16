const fs = require('fs');
const p = 'c:/NaviServer/controllers/reportSpec.js';
let s = fs.readFileSync(p, 'utf8');

// Remove the second duplicate monthly collections block.
// It starts with: "// ── Monthly collections: per-month aggregates ─────────────────────────────" followed by "  const fixedYear"
// and ends before "  const ws = new ExcelJS.Worksheet();"

const commentMarker = '// ── Monthly collections: per-month aggregates ─────────────────────────────';
const wsMarker = '  const ws = new ExcelJS.Worksheet();';

const firstComment = s.indexOf(commentMarker);
if (firstComment === -1) {
  console.error('FIRST COMMENT NOT FOUND');
  process.exit(1);
}

const secondComment = s.indexOf(commentMarker, firstComment + 1);
if (secondComment === -1) {
  console.error('SECOND COMMENT NOT FOUND');
  process.exit(1);
}

const wsIdx = s.indexOf(wsMarker);
if (wsIdx === -1) {
  console.error('WS MARKER NOT FOUND');
  process.exit(1);
}

// The duplicate block is from secondComment to wsIdx.
// But we should also check: after the first fixedYear block completes, the next line is
// the second comment (duplicate), then the fixedYear block again, then ws.
// Remove from secondComment up to (not including) wsIdx.
const duplicateBlock = s.slice(secondComment, wsIdx);
console.log('Removing duplicate block of ' + duplicateBlock.length + ' chars');
console.log('--- duplicate block ---');
console.log(duplicateBlock);

s = s.slice(0, secondComment) + s.slice(wsIdx);

fs.writeFileSync(p, s);
console.log('New length=' + s.length);
