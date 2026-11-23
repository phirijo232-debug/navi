'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const http = require('http');
const fs = require('fs');
const path = require('path');
const app = require('../server');

function listen(server) {
  return new Promise((resolve) => server.listen(0, '127.0.0.1', () => resolve(server.address().port)));
}

async function request(port, target) {
  return new Promise((resolve, reject) => {
    const req = http.request({
      hostname: '127.0.0.1',
      port,
      path: target,
      method: 'GET',
      headers: { host: '127.0.0.1' }
    }, (res) => {
      const chunks = [];
      res.on('data', (chunk) => chunks.push(chunk));
      res.on('end', () => resolve({
        status: res.statusCode,
        location: res.headers.location || '',
        type: res.headers['content-type'] || '',
        body: Buffer.concat(chunks).toString('utf8')
      }));
    });
    req.on('error', reject);
    req.end();
  });
}

test('clean pages are served and old HTML paths redirect', async () => {
  const server = http.createServer(app);
  const port = await listen(server);
  try {
    const home = await request(port, '/');
    assert.equal(home.status, 200);
    assert.match(home.body, /id="qsForm"/);
    assert.match(home.body, /PRYME LOAN/);
    assert.match(home.body, /Powered by PRYME LOAN/);
    assert.doesNotMatch(home.body, /Buraza Micro Finance/);
    assert.doesNotMatch(home.body, /Pryme Vertex/);

    const admin = await request(port, '/admin');
    assert.equal(admin.status, 200);
    assert.match(admin.body, /id="adminLoginForm"/);
    assert.match(admin.body, /Email me a one-time code/);
    assert.doesNotMatch(admin.body, /Back to stores/);
    assert.doesNotMatch(admin.body, /Other stores/);

    const login = await request(port, '/login');
    assert.equal(login.status, 200);
    assert.match(login.body, /id="loginForm"/);
    assert.match(login.body, /Email me a one-time code/);

    const oldAdmin = await request(port, '/admin.html');
    assert.equal(oldAdmin.status, 302);
    assert.equal(oldAdmin.location, '/admin');

    const oldDash = await request(port, '/dashboard.html');
    assert.equal(oldDash.status, 302);
    assert.equal(oldDash.location, '/admin');

    const oldQuick = await request(port, '/quick-screen.html?ref=1');
    assert.equal(oldQuick.status, 302);
    assert.equal(oldQuick.location, '/?ref=1');

    const oldUser = await request(port, '/user.html');
    assert.equal(oldUser.status, 302);
    assert.equal(oldUser.location, '/account');

    const account = await request(port, '/account');
    assert.equal(account.status, 200);
    assert.match(account.body, /customer-portal|id="loanNrcFront"/);

    const signup = await request(port, '/signup?invite=abc');
    assert.equal(signup.status, 200);
    assert.match(signup.body, /id="signupForm"/);

    const loans = await request(port, '/loans/public-rates');
    assert.equal(loans.status, 200);
    assert.match(loans.type, /json/);
    const rates = JSON.parse(loans.body);
    assert.ok(rates.weeklyRates || rates.error);
  } finally {
    await new Promise((resolve) => server.close(resolve));
  }
});

test('vercel.json redirects the old HTML paths and still rewrites to the app', () => {
  const config = JSON.parse(fs.readFileSync(path.join(__dirname, '..', 'vercel.json'), 'utf8'));
  const redirects = new Map(config.redirects.map((item) => [item.source, item.destination]));
  assert.equal(redirects.get('/admin.html'), '/admin');
  assert.equal(redirects.get('/dashboard.html'), '/admin');
  assert.equal(redirects.get('/quick-screen.html'), '/');
  assert.equal(redirects.get('/login.html'), '/login');
  assert.equal(config.rewrites[0].destination, '/api');
  assert.ok(config.crons.length >= 4);
});
