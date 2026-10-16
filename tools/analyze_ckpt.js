const fs = require('fs');
const lines = fs.readFileSync('checkpoint_reportSpec.js', 'utf8').split(/\r?\n/);
const out = [`===== checkpoint_reportSpec.js (${lines.length} lines) =====`];
const patterns = [
  /^function /,
  /^const REPORT_TYPES/,
  /^module\.exports/,
  /^  if \(type ===/,
  /^  \} else if \(type ===/,
  /\/\/ ── Sheets/,
  /\/\/ ─── Report registry/
];
for (let i = 0; i < lines.length; i++) {
  for (const p of patterns) {
    if (p.test(lines[i])) {
      out.push(`${i + 1}: ${lines[i]}`);
      break;
    }
  }
}
fs.writeFileSync('checkpoint_analysis.txt', out.join('\n'), 'utf8');
