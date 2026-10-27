const fs = require('fs');
let c = fs.readFileSync('controllers/loanController.js', 'utf8');
// Replace the problematic join escape: change \\n to \n for proper newline
c = c.replace(/\\(\\n)(?=\\))/g, '\\n');
fs.writeFileSync('controllers/loanController.js', c);
console.log('Fixed');