// Lightweight end-to-end test: signup -> confirm -> login -> confirm
const base = 'http://localhost:3000';

async function run() {
  const email = `e2e+${Date.now()}@example.com`;
  const password = 'StrongTest1!';
  console.log('E2E test email:', email);

  // 1) Signup
  let r = await fetch(base + '/signup', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ username: 'e2euser', email, password, confirmPassword: password })
  });
  console.log('/signup', r.status, await r.text());
  if (r.status !== 200) return process.exit(1);

  // small pause to allow OTP generation
  await new Promise(r => setTimeout(r, 300));

  // 2) Retrieve OTP via debug route
  r = await fetch(base + '/__dev_debug_otp__?email=' + encodeURIComponent(email));
  let dbg;
  const dbgText = await r.text();
  try {
    dbg = JSON.parse(dbgText);
  } catch (e) {
    console.error('/debug/otp returned non-json:', dbgText);
    return process.exit(1);
  }
  console.log('/debug/otp', dbg);
  if (!dbg.found) return process.exit(1);
  const otp = dbg.code;

  // 3) Confirm signup
  r = await fetch(base + '/signup/confirm', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ email, otp })
  });
  console.log('/signup/confirm', r.status, await r.text());
  if (r.status !== 200) return process.exit(1);

  // 4) Request login
  r = await fetch(base + '/login', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ email, password })
  });
  console.log('/login', r.status, await r.text());
  if (r.status !== 200) return process.exit(1);

  // wait then fetch login OTP
  await new Promise(r => setTimeout(r, 300));
  r = await fetch(base + '/__dev_debug_otp__?email=' + encodeURIComponent(email));
  let dbg2;
  const dbg2Text = await r.text();
  try {
    dbg2 = JSON.parse(dbg2Text);
  } catch (e) {
    console.error('/debug/otp (login) returned non-json:', dbg2Text);
    return process.exit(1);
  }
  console.log('/debug/otp (login)', dbg2);
  if (!dbg2.found) return process.exit(1);
  const otp2 = dbg2.code;

  // 5) Confirm login
  r = await fetch(base + '/login/confirm', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ email, otp: otp2 })
  });
  const final = await r.json();
  console.log('/login/confirm', r.status, final);
  if (r.status !== 200) return process.exit(1);

  console.log('E2E completed successfully. deviceToken:', final.deviceToken);
  process.exit(0);
}

run().catch(err => { console.error(err); process.exit(1); });
