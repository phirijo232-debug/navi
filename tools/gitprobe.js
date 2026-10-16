const cp = require('child_process');
const fs = require('fs');
const out = [];
function run(cmd) {
  out.push(`> ${cmd}`);
  try {
    out.push(cp.execSync(cmd, { shell: 'cmd.exe', encoding: 'utf8', maxBuffer: 1e7, cwd: 'C:/NaviServer' }));
  } catch (e) {
    out.push('ERR: ' + (e.stdout || '') + (e.stderr || e.message));
  }
  out.push('');
}
run('git branch -a');
run('git stash list');
run('git log --all --oneline -- controllers/reportSpec.js');
run('git log --all --oneline -- "*reportSpec*"');
run('git rev-list --all --count');

// find backup archives
const path = require('path');
const hits = [];
function walk(d, depth) {
  if (depth > 6) return;
  let e;
  try { e = fs.readdirSync(d, { withFileTypes: true }); } catch { return; }
  for (const f of e) {
    const p = path.join(d, f.name);
    if (f.isDirectory()) {
      if (['node_modules', '.git'].includes(f.name)) continue;
      walk(p, depth + 1);
    } else if (/\.(zip|tar|gz|7z|rar|bak|backup)$/i.test(f.name)) {
      let sz = '';
      try { sz = ` (${fs.statSync(p).size})`; } catch {}
      hits.push(p + sz);
    }
  }
}
walk('C:/NaviServer', 0);
out.push('=== backup-like files ===');
out.push(hits.join('\n') || '(none)');
fs.writeFileSync('gitprobe.txt', out.join('\n'), 'utf8');
