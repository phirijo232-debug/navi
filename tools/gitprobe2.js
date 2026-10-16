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
run('git log --all -S "buildReportDataset" --oneline');
run('git log --all -S "buildRepaymentPerformanceSheet" --oneline');
run('git log --all -S "reportSpec" --oneline');
run('git grep -l "buildReportDataset" main Published-BMF-Branch backup-e77d090 feature/your-change 2>&1');
fs.writeFileSync('gitprobe2.txt', out.join('\n'), 'utf8');
