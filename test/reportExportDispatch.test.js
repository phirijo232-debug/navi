const test = require('node:test');
const assert = require('node:assert/strict');
const express = require('express');
const http = require('node:http');
const routes = require('../routes');

function get(server, pathname) {
  const address = server.address();
  return new Promise((resolve, reject) => {
    http.get({ host: '127.0.0.1', port: address.port, path: pathname }, response => {
      const chunks = [];
      response.on('data', chunk => chunks.push(chunk));
      response.on('end', () => resolve({
        status: response.statusCode,
        contentType: response.headers['content-type'],
        body: Buffer.concat(chunks).toString('utf8')
      }));
    }).on('error', reject);
  });
}

test('report export route keeps scoped and typed exports distinct', async t => {
  const app = express();
  app.use((req, res, next) => {
    req.authUser = { role: 'admin', email: 'admin@example.test' };
    next();
  });
  app.use('/', routes);
  const server = app.listen(0, '127.0.0.1');
  t.after(() => new Promise(resolve => server.close(resolve)));
  await new Promise(resolve => server.once('listening', resolve));

  const scoped = await get(server, '/reports/buraza/export?format=invalid');
  assert.equal(scoped.status, 400);
  assert.match(scoped.body, /Export format must be xlsx or pdf/);

  const typed = await get(server, '/reports/daily/export?scope=buraza');
  assert.equal(typed.status, 200);
  assert.match(typed.contentType, /spreadsheetml/);
});
