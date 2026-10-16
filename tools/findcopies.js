const fs = require('fs');
const path = require('path');
const hits = [];
function walk(d, depth) {
  if (depth > 7) return;
  let e;
  try { e = fs.readdirSync(d, { withFileTypes: true }); } catch { return; }
  for (const f of e) {
    const p = path.join(d, f.name);
    if (f.isDirectory()) {
      if (['node_modules', '.git'].includes(f.name)) continue;
      walk(p, depth + 1);
    } else if (/reportSpec/i.test(f.name)) {
      let stat = '';
      try { stat = ` (${fs.statSync(p).size} bytes)`; } catch {}
      hits.push(p + stat);
    }
  }
}
walk('C:/NaviServer', 0);
fs.writeFileSync('found.txt', hits.join('\n') || '(none)', 'utf8');
