'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const os = require('os');
const path = require('path');
const express = require('express');
const supabaseApi = require('../middleware/supabaseApi');
const dataStore = require('../middleware/dataStore');
const otp = require('../middleware/otp');
const { summarise, loanTotals } = require('../scripts/import-to-supabase');

function memoryTransport() {
  const db = { documents: new Map(), rows: {}, rpc: [] };
  return {
    db,
    transport(op) {
      if (op.op === 'putDocument') {
        db.documents.set(op.key, op.body);
        return { status: 200, json: null };
      }
      if (op.op === 'getDocument') {
        const body = db.documents.get(op.key);
        return { status: 200, json: body == null ? [] : [{ body }] };
      }
      if (op.op === 'upsert') {
        const table = db.rows[op.table] || new Map();
        table.set(op.row[op.onConflict], { ...op.row });
        db.rows[op.table] = table;
        return { status: 201, json: null };
      }
      if (op.op === 'select') {
        const table = db.rows[op.table] || new Map();
        const key = decodeURIComponent(String(op.query).split('=eq.')[1].split('&')[0]);
        const row = table.get(key) || null;
        return { status: 200, json: row ? [row] : [] };
      }
      if (op.op === 'delete') {
        const table = db.rows[op.table];
        if (table && String(op.query).includes('=eq.')) {
          const key = decodeURIComponent(String(op.query).split('=eq.')[1].split('&')[0]);
          table.delete(key);
        }
        return { status: 204, json: null };
      }
      if (op.op === 'rpc') {
        db.rpc.push(op.args.p_bucket);
        return { status: 200, json: db.rpc.filter(bucket => bucket === op.args.p_bucket).length };
      }
      if (op.op === 'upload') return { status: 200, json: { Key: op.name } };
      if (op.op === 'sign') return { status: 200, json: { signedURL: `/object/sign/bmf-uploads/${op.name}?token=1` } };
      return { status: 200, json: null };
    }
  };
}

test('document storage round-trips through the same JSON interface', () => {
  const previous = process.env.STORAGE;
  const fake = memoryTransport();
  process.env.STORAGE = 'supabase';
  supabaseApi.setTransport(fake.transport);
  try {
    dataStore.writeJson(dataStore.paths.loans, [{ id: 7, storeId: 'buraza', amount: 100, outstanding: 40 }]);
    const loans = dataStore.readJson(dataStore.paths.loans, []);
    assert.equal(loans[0].outstanding, 40);
    assert.equal(fake.db.documents.get('loans.json')[0].id, 7);
  } finally {
    if (previous == null) delete process.env.STORAGE;
    else process.env.STORAGE = previous;
    supabaseApi.setTransport(null);
  }
});

test('shared OTP rows expire after a successful check', () => {
  const previous = process.env.STORAGE;
  const fake = memoryTransport();
  process.env.STORAGE = 'supabase';
  supabaseApi.setTransport(fake.transport);
  try {
    const code = otp.generateOTP('shared@example.test:Login Verification', true);
    assert.equal(otp.verifyOTP('000000', 'shared@example.test', 'Login Verification').valid, false);
    assert.equal(otp.verifyOTP(code, 'shared@example.test', 'Login Verification').valid, true);
    assert.equal(otp.verifyOTP(code, 'shared@example.test', 'Login Verification').valid, false);
  } finally {
    if (previous == null) delete process.env.STORAGE;
    else process.env.STORAGE = previous;
    supabaseApi.setTransport(null);
  }
});

test('service role requests stay on the server URL', () => {
  process.env.SUPABASE_URL = 'https://hokbxbkmsstseefchmhi.supabase.co';
  process.env.SUPABASE_SERVICE_ROLE_KEY = 'service-role-test-key';
  const request = supabaseApi.buildHttp({ op: 'putDocument', key: 'users.json', body: [] });
  assert.match(request.url, /\/rest\/v1\/documents/);
  assert.equal(request.headers.Authorization, 'Bearer service-role-test-key');
  assert.equal(request.url.includes('service-role-test-key'), false);
  delete process.env.SUPABASE_URL;
  delete process.env.SUPABASE_SERVICE_ROLE_KEY;
});

test('dry-run totals add up loan by loan for each store', () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'bmf-import-'));
  fs.writeFileSync(path.join(dir, 'loans.json'), JSON.stringify([
    { id: 1, receiptNumber: 'BMF-1', storeId: 'buraza', amount: 1000, outstanding: 800, status: 'active' },
    { id: 2, receiptNumber: 'BMF-2', storeId: 'buraza', amount: 500, outstanding: 0, status: 'paid' },
    { id: 3, receiptNumber: 'BMF-3', storeId: 'other', amount: 200, outstanding: 200, status: 'pending' }
  ]));
  const plan = summarise(
    [{ key: 'loans.json', body: JSON.parse(fs.readFileSync(path.join(dir, 'loans.json'), 'utf8')) }],
    []
  );
  assert.equal(plan.stores.buraza.count, 2);
  assert.equal(plan.stores.buraza.outstanding, 800);
  assert.equal(plan.stores.other.count, 1);
  assert.deepEqual(loanTotals(JSON.parse(fs.readFileSync(path.join(dir, 'loans.json'), 'utf8'))).buraza.loans.map(loan => loan.id), ['BMF-1', 'BMF-2']);
});

test('cron endpoints reject a missing or wrong secret', async () => {
  const previous = process.env.CRON_SECRET;
  process.env.CRON_SECRET = 'cron-secret-for-tests-0123456789';
  const app = express();
  app.use('/api/cron', require('../routes/cron'));
  const server = app.listen(0);
  const base = `http://127.0.0.1:${server.address().port}/api/cron/kidneys`;
  try {
    const open = await fetch(base);
    assert.equal(open.status, 401);
    const wrong = await fetch(base, { headers: { 'x-cron-secret': 'nope' } });
    assert.equal(wrong.status, 401);
    const ok = await fetch(base, { headers: { authorization: `Bearer ${process.env.CRON_SECRET}` } });
    assert.equal(ok.status, 200);
  } finally {
    await new Promise(resolve => server.close(resolve));
    if (previous == null) delete process.env.CRON_SECRET;
    else process.env.CRON_SECRET = previous;
  }
});
