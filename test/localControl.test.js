const test = require('node:test');
const assert = require('node:assert/strict');
const { isPrivateControlClient } = require('../middleware/localControl');

test('operator control IP check accepts loopback and private networks only', () => {
  for (const ip of ['127.0.0.1', '::1', '::ffff:127.0.0.1', '10.1.2.3', '192.168.1.5', '172.20.0.1', 'fd00::5', 'fc00::7']) {
    assert.equal(isPrivateControlClient(ip), true, `${ip} should be private`);
  }
  for (const ip of ['8.8.8.8', '172.15.0.1', '172.32.0.1', '2001:4860:4860::8888', '']) {
    assert.equal(isPrivateControlClient(ip), false, `${ip} should not be private`);
  }
});
