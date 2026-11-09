'use strict';
const fs = require('fs');
const html = fs.readFileSync('public/user.html', 'utf8');
const match = html.match(/<script>([\s\S]*?)<\/script>/);
if (!match) throw new Error('inline script missing');
fs.writeFileSync('tmp/user-inline-check.js', match[1]);
console.log(`inline script bytes: ${match[1].length}`);
