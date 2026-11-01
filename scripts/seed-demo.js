#!/usr/bin/env node
/**
 * Writes gitignored demo data so the screens can be opened with a device token.
 * Does not send email and does not change application code.
 *
 *   node scripts/seed-demo.js
 *
 * Then sign the browser in by setting localStorage (see the printed tokens).
 */
const fs = require('fs');
const path = require('path');
const bcrypt = require('bcryptjs');

const dataDir = path.join(__dirname, '..', 'data');
const logsDir = path.join(__dirname, '..', 'logs');
fs.mkdirSync(dataDir, { recursive: true });
fs.mkdirSync(logsDir, { recursive: true });

const now = new Date().toISOString();
const password = bcrypt.hashSync('Demo#2026', 10);

function user(id, username, email, role, token, phone) {
  return {
    id,
    username,
    email,
    phone,
    nrc: `12345${id}/10/1`,
    password,
    role,
    storeId: 'buraza',
    restrictions: [],
    createdAt: now,
    trustedDevices: [{
      token,
      createdAt: now,
      lastSeen: now,
      ip: '127.0.0.1'
    }]
  };
}

const users = [
  user(1, 'Chipo Banda', 'customer@bmf.test', 'user', 'demo-customer-token', '0977000001'),
  user(2, 'Store Admin', 'store@bmf.test', 'store_admin', 'demo-store-token', '0977000002'),
  user(3, 'Franchise Admin', 'franchise@bmf.test', 'franchise_admin', 'demo-franchise-token', '0977000003'),
  user(4, 'Main Admin', 'admin@bmf.test', 'admin', 'demo-admin-token', '0977000004')
];

const loans = [
  {
    id: 1,
    email: 'customer@bmf.test',
    storeId: 'buraza',
    product: 'School fees',
    amount: 1500,
    interestRate: 16,
    interestAmount: 240,
    totalRepayment: 1740,
    outstanding: 1740,
    paidTotal: 0,
    tenureWeeks: 2,
    urgency: 'standard',
    status: 'pending',
    receiptNumber: 'BMF-20261101-1001',
    dueDate: '2026-11-15',
    createdAt: now,
    payments: []
  },
  {
    id: 2,
    email: 'customer@bmf.test',
    storeId: 'buraza',
    product: 'Market stock',
    amount: 3500,
    interestRate: 32,
    interestAmount: 1120,
    totalRepayment: 4620,
    outstanding: 3620,
    paidTotal: 1000,
    tenureWeeks: 4,
    urgency: 'urgent',
    status: 'active',
    receiptNumber: 'BMF-20261010-1002',
    approvedAt: '2026-10-10T08:00:00.000Z',
    borrowedDate: '2026-10-10',
    dueDate: '2026-12-01',
    createdAt: '2026-10-10T08:00:00.000Z',
    payments: [{
      paymentReceiptId: 'PAY-20261020-2001',
      receiptNumber: 'PAY-20261020-2001',
      amount: 1000,
      paymentDate: '2026-10-20T10:00:00.000Z',
      balanceBefore: 4620,
      balanceAfter: 3620,
      mode: 'Airtel Money',
      note: 'First instalment',
      screenshot: '',
      recordedBy: 'store@bmf.test'
    }]
  },
  {
    id: 3,
    email: 'customer@bmf.test',
    storeId: 'buraza',
    product: 'Farm inputs',
    amount: 800,
    interestRate: 10,
    interestAmount: 80,
    totalRepayment: 880,
    outstanding: 880,
    paidTotal: 0,
    tenureWeeks: 1,
    urgency: 'standard',
    status: 'active',
    receiptNumber: 'BMF-20261028-1003',
    approvedAt: '2026-10-28T08:00:00.000Z',
    borrowedDate: '2026-10-28',
    dueDate: '2026-11-03',
    createdAt: '2026-10-28T08:00:00.000Z',
    payments: []
  },
  {
    id: 4,
    email: 'customer@bmf.test',
    storeId: 'buraza',
    product: 'Settled tools',
    amount: 500,
    interestRate: 10,
    interestAmount: 50,
    totalRepayment: 550,
    outstanding: 0,
    paidTotal: 550,
    tenureWeeks: 1,
    urgency: 'standard',
    status: 'paid',
    receiptNumber: 'BMF-20260901-1004',
    approvedAt: '2026-09-01T08:00:00.000Z',
    borrowedDate: '2026-09-01',
    dueDate: '2026-09-08',
    createdAt: '2026-09-01T08:00:00.000Z',
    payments: [{
      paymentReceiptId: 'PAY-20260905-2002',
      receiptNumber: 'PAY-20260905-2002',
      amount: 550,
      paymentDate: '2026-09-05T10:00:00.000Z',
      balanceBefore: 550,
      balanceAfter: 0,
      mode: 'Cash',
      note: 'Paid in full',
      screenshot: '',
      recordedBy: 'store@bmf.test'
    }]
  }
];

const feedback = [
  {
    id: 1,
    email: 'customer@bmf.test',
    storeId: 'buraza',
    category: 'complaint',
    message: 'The balance on my market stock loan looked wrong after the last payment.',
    status: 'new',
    createdAt: now,
    reviewedBy: null,
    reviewNote: null
  },
  {
    id: 2,
    email: 'customer@bmf.test',
    storeId: 'buraza',
    category: 'inquiry',
    message: 'When is the next due date for the school fees request?',
    status: 'new',
    createdAt: now,
    reviewedBy: null,
    reviewNote: null
  }
];

fs.writeFileSync(path.join(dataDir, 'users.json'), JSON.stringify(users, null, 2));
fs.writeFileSync(path.join(dataDir, 'loans.json'), JSON.stringify(loans, null, 2));
fs.writeFileSync(path.join(dataDir, 'feedback.json'), JSON.stringify(feedback, null, 2));
fs.writeFileSync(path.join(dataDir, 'notifications.json'), '[]\n');
if (!fs.existsSync(path.join(logsDir, 'access.log'))) fs.writeFileSync(path.join(logsDir, 'access.log'), '');
if (!fs.existsSync(path.join(logsDir, 'errors.log'))) fs.writeFileSync(path.join(logsDir, 'errors.log'), '');

console.log('Demo data written. Password for every account: Demo#2026');
console.log('customer@bmf.test  token demo-customer-token  → user.html');
console.log('store@bmf.test     token demo-store-token     → admin.html');
console.log('franchise@bmf.test token demo-franchise-token → admin.html');
console.log('admin@bmf.test     token demo-admin-token     → dashboard.html');
