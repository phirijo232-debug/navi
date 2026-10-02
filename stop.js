const http = require('http');

const password = process.argv[2];
const expectedKey = process.env.MASTER_KEY || 'phirii26';

if (!password) {
  console.log(`Usage: node stop.js ${expectedKey}`);
  process.exit(1);
}

if (password !== expectedKey) {
  console.log('Wrong password. Access denied.');
  process.exit(1);
}

const options = {
  hostname: 'localhost',
  port: 3000,
  path: '/internal-shutdown',
  method: 'POST',
  headers: {
    'x-admin-key': password,
    'x-shutdown-key': password
  }
};

const req = http.request(options, (res) => {
  res.on('data', (d) => {
    process.stdout.write(d);
  });
});

req.on('error', (e) => {
  console.log('Could not reach server. Is it running?');
});

req.end();