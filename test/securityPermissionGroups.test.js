'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const security = require('../controllers/securityController');

const permissions = {
  bulk_notify: false, generate_invite: true, view_revenue: false, generate_reports: true,
  create_users: false, view_premium_customers: false, force_loan_close: false
};

function call(handler, req) {
  const result = { statusCode: 200, body: null };
  const res = {
    status(code) { result.statusCode = code; return this; },
    json(body) { result.body = body; return this; }
  };
  handler(req, res);
  return result;
}

function actor(role = 'admin') {
  return { authUser: { role, email: 'test-actor@example.test', storeId: 'buraza' }, ip: '127.0.0.1', body: {}, query: { storeId: 'buraza' }, params: {} };
}

test('permission groups include immutable Franchise Admin and support custom group CRUD', () => {
  const initial = call(security.listPermissionGroups, actor());
  assert.equal(initial.statusCode, 200);
  assert.ok(initial.body.groups.some(group => group.id === 'builtin:franchise_admin' && group.locked));

  const createReq = actor();
  createReq.body = { name: 'Test Operations', description: 'Local test group', permissions, storeId: 'buraza' };
  const created = call(security.createPermissionGroup, createReq);
  assert.equal(created.statusCode, 201);
  assert.equal(created.body.group.name, 'Test Operations');

  const updateBuiltIn = actor();
  updateBuiltIn.params.id = 'builtin:franchise_admin';
  updateBuiltIn.body = { name: 'Renamed' };
  assert.equal(call(security.updatePermissionGroup, updateBuiltIn).statusCode, 403);

  const deleteCustom = actor();
  deleteCustom.params.id = created.body.group.id;
  assert.equal(call(security.deletePermissionGroup, deleteCustom).statusCode, 200);
});

test('store_admin cannot manage groups and cannot request another store', () => {
  assert.equal(call(security.listPermissionGroups, actor('store_admin')).statusCode, 403);
  const foreignStore = actor();
  foreignStore.query.storeId = 'another-store';
  assert.equal(call(security.listPermissionGroups, foreignStore).statusCode, 403);
});
