'use strict';

const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const { sendSms } = require('../middleware/messaging');
const { addStore, listStores } = require('../middleware/stores');

test('sms without a provider is saved to the preview log', async () => {
  const previous = process.env.SMS_MODE;
  process.env.SMS_MODE = 'preview';
  const result = await sendSms({ to: '0977000001', text: 'Balance reminder for the test' });
  process.env.SMS_MODE = previous;
  assert.equal(result.ok, true);
  assert.equal(result.mode, 'preview');
  assert.match(fs.readFileSync(result.preview, 'utf8'), /Balance reminder for the test/);
});

test('adding a store keeps Buraza and rejects a duplicate id', () => {
  const stores = listStores();
  assert.ok(stores.some(store => store.id === 'buraza'));
  const created = addStore({ id: 'kitwe', name: 'Kitwe Desk', code: 'KTW' });
  assert.equal(created.store.id, 'kitwe');
  assert.ok(listStores().some(store => store.id === 'buraza'));
  const again = addStore({ id: 'kitwe', name: 'Kitwe Desk', code: 'KTW' });
  assert.match(again.error, /already exists/);
});
