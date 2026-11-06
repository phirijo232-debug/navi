'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const controller = require('../controllers/accessApprovalController');
const emailService = require('../middleware/email');
emailService.sendCustomerEmail = async () => ({ ok: true });

function response() {
  return {
    statusCode: 200,
    payload: null,
    status(code) { this.statusCode = code; return this; },
    json(payload) { this.payload = payload; return this; }
  };
}

function request(user, body = {}, params = {}, query = {}) {
  return { authUser: user, body, params, query };
}

test('requests are feature-whitelisted and visible only to the requester and scoped admins', async () => {
  const requester = { role: 'store_admin', email: 'worker@example.com', username: 'worker', storeId: 'buraza' };
  const bad = response();
  await controller.requestApproval(request(requester, { feature: 'promote_to_admin' }), bad);
  assert.equal(bad.statusCode, 400);

  const created = response();
  await controller.requestApproval(request(requester, { feature: 'generate_reports', reason: 'Monthly work' }), created);
  assert.equal(created.statusCode, 201);
  const id = created.payload.approval.id;

  const scopedAdmin = response();
  controller.listApprovals(request({ role: 'franchise_admin', email: 'fa@example.com', storeId: 'buraza' }), scopedAdmin);
  assert.ok(scopedAdmin.payload.approvals.some(item => item.id === id));

  const otherStore = response();
  controller.listApprovals(request({ role: 'franchise_admin', email: 'fa2@example.com', storeId: 'other-store' }), otherStore);
  assert.equal(otherStore.payload.approvals.some(item => item.id === id), false);
});

test('only scoped admin/franchise_admin can approve and approval is requester-bound', async () => {
  const requester = { role: 'user', email: 'customer@example.com', username: 'customer', storeId: 'buraza' };
  const created = response();
  await controller.requestApproval(request(requester, { feature: 'view_revenue' }), created);
  assert.equal(created.statusCode, 201);
  const id = created.payload.approval.id;

  const requesterList = response();
  controller.listApprovals(request(requester), requesterList);
  assert.ok(requesterList.payload.approvals.some(item => item.id === id));

  const deniedRole = response();
  await controller.decideApproval(request({ role: 'store_admin', email: 'staff@example.com', storeId: 'buraza' }, { decision: 'approve' }, { id }), deniedRole);
  assert.equal(deniedRole.statusCode, 403);

  const wrongStore = response();
  await controller.decideApproval(request({ role: 'franchise_admin', email: 'fa@example.com', storeId: 'other-store' }, { decision: 'approve' }, { id }), wrongStore);
  assert.equal(wrongStore.statusCode, 403);

  const approver = { role: 'franchise_admin', email: 'fa@example.com', storeId: 'buraza' };
  const approved = response();
  await controller.decideApproval(request(approver, { decision: 'approve' }, { id }), approved);
  assert.equal(approved.statusCode, 200);
  assert.equal(approved.payload.approval.status, 'approved');
  assert.ok(Date.parse(approved.payload.approval.expiresAt) - Date.parse(approved.payload.approval.decidedAt) <= 15 * 60 * 1000);

  assert.equal(controller.hasActiveApproval(requesterReq(requester), 'view_revenue'), true);
  const otherUser = request({ ...requester, email: 'someone-else@example.com' });
  assert.equal(controller.hasActiveApproval(otherUser, 'view_revenue'), false);

  const check = response();
  controller.checkApproval({ ...request(requester), query: { feature: 'view_revenue' } }, check);
  assert.equal(check.payload.approved, true);
});

function requesterReq(user) { return request(user); }

test('requesters cannot decide their own approvals and unknown permissions fail closed', async () => {
  const requester = { role: 'admin', email: 'admin@example.com', storeId: 'buraza' };
  const created = response();
  await controller.requestApproval(request(requester, { feature: 'force_loan_close' }), created);
  assert.equal(created.statusCode, 201);
  const selfDecision = response();
  await controller.decideApproval(request(requester, { decision: 'approve' }, { id: created.payload.approval.id }), selfDecision);
  assert.equal(selfDecision.statusCode, 403);
  assert.equal(controller.hasActiveApproval(request(requester), 'unknown_feature'), false);
});

