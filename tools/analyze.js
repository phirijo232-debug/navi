const fs = require('fs');

function analyze(path) {
  const lines = fs.readFileSync(path, 'utf8').split(/\r?\n/);
  const out = [`===== ${path} (${lines.length} lines) =====`];
  const patterns = [
    /^function /,
    /^const REPORT_TYPES/,
    /^module\.exports/,
    /^  if \(type ===/,
    /^  \} else if \(type ===/,
    /^  return wb;/,
    /^\}/,
    /\/\/ ── Sheets/,
    /^  const sheetBuilders/,
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
  return out.join('\n') + '\n\n';
}

let result = '';
result += analyze('controllers/reportSpec.js');
result += analyze('controllers/reportSpec.js.bak');
fs.writeFileSync('analysis.txt', result, 'utf8');
console.log('done');
