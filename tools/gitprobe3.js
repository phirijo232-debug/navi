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
run('git branch --contains 1d1c052');
run('git show 1d1c052 --stat --oneline');
try {
  const content = cp.execSync('git show 1d1c052:controllers/reportSpec.js', { shell: 'cmd.exe', encoding: 'utf8', maxBuffer: 5e7, cwd: 'C:/NaviServer' });
  fs.writeFileSync('checkpoint_reportSpec.js', content, 'utf8');
  out.push('extracted checkpoint_reportSpec.js bytes=' + content.length);
} catch (e) {
  out.push('extract ERR: ' + (e.stdout || '').slice(0, 500) + (e.stderr || e.message).slice(0, 500));
}
fs.writeFileSync('gitprobe3.txt', out.join('\n'), 'utf8');
