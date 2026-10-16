const fs = require('fs');
const start = Number(process.argv[2]);
const end = Number(process.argv[3]);
const s = fs.readFileSync('c:/NaviServer/controllers/reportSpec.js', 'utf8');
const lines = s.split('\n');
for (let i = start; i < end; i++) {
  console.log((i + 1) + ': ' + lines[i]);
}
