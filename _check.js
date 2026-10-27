const fs = require('fs');
const content = fs.readFileSync('c:\\NaviServer\\public\\user.html', 'utf8');
const regex = /<script([^>]*)>([\s\S]*?)<\/script>/gi;
let match;
let i = 0;
while ((match = regex.exec(content)) !== null) {
    i++;
    const scriptContent = match[1];
    if (scriptContent.trim()) {
        console.log('Script ' + i + ' length: ' + scriptContent.length);
        try {
            new Function(scriptContent);
            console.log('  OK');
        } catch(e) {
            console.log('  FAIL: ' + e.message);
        }
    }
}