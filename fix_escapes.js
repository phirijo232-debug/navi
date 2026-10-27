const fs = require('fs');
let c = fs.readFileSync('controllers/loanController.js', 'utf8');

// Replace the problematic escape sequences
// \n in JavaScript source = newline, \\n = literal backslash+n
// We want proper \n for join separators

// Fix line 1280: }).join('\\\\n'); -> }).join('\n');
c = c.replace(/\\\\\\\\n/g, '\\n');

// Fix line 1284: .join('\\n'); -> .join('\n');
c = c.replace(/\\n(?=;)/g, '\n');

// Fix line 1289: ).join('\\\\n'); -> ).join('\n');
c = c.replace(/\\\\\\\\n/g, '\\n');

fs.writeFileSync('controllers/loanController.js', c);
console.log('Fixed');