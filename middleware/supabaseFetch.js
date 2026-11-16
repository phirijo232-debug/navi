'use strict';

// One-shot HTTP helper spawned by middleware/supabaseApi.js so the rest of
// the app can keep its synchronous JSON reads. Stdin is a JSON request.
const chunks = [];
process.stdin.on('data', chunk => chunks.push(chunk));
process.stdin.on('end', async () => {
  try {
    const request = JSON.parse(Buffer.concat(chunks).toString('utf8'));
    const headers = request.headers || {};
    const body = request.bodyBase64
      ? Buffer.from(request.bodyBase64, 'base64')
      : (request.body == null ? undefined : JSON.stringify(request.body));
    const response = await fetch(request.url, { method: request.method || 'GET', headers, body });
    const text = await response.text();
    let json = null;
    if (text) {
      try { json = JSON.parse(text); } catch { json = { raw: text }; }
    }
    process.stdout.write(JSON.stringify({ status: response.status, json }));
    if (response.status >= 400) process.exitCode = 1;
  } catch (err) {
    process.stdout.write(JSON.stringify({ status: 0, error: err.message }));
    process.exitCode = 1;
  }
});
