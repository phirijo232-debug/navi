const express = require('express');
const router = express.Router();
const fs = require('fs');
const path = require('path');
const { logError } = require('../middleware/logger');
const dataStore = require('../middleware/dataStore');

const USERS_FILE = dataStore.paths.users || path.join(dataStore.DATA_DIR, 'users.json');
const LOANS_FILE = dataStore.paths.loans || path.join(dataStore.DATA_DIR, 'loans.json');

function readUsers() {
  try {
    const raw = fs.readFileSync(USERS_FILE, 'utf8');
    const data = JSON.parse(raw);
    return Array.isArray(data) ? data : [];
  } catch (err) {
    logError(`READ USERS FAILED: ${err.message}`);
    return [];
  }
}

function writeUsers(users) {
  return dataStore.writeJson(USERS_FILE, users);
}

function readLoans() {
  try {
    const raw = fs.readFileSync(LOANS_FILE, 'utf8');
    const data = JSON.parse(raw);
    return Array.isArray(data) ? data : [];
  } catch (err) {
    logError(`READ LOANS FAILED: ${err.message}`);
    return [];
  }
}

function requireStoreAdmin(req, res, next) {
  if (!req.authUser || req.authUser.role !== 'store_admin') {
    return res.status(403).json({ error: 'Store admin access required.' });
  }
  next();
}

// GET /admin/users — returns all users (store_admin only)
router.get('/admin/users', requireStoreAdmin, (req, res) => {
  try {
    const users = readUsers().map(u => {
      const { password, tokens, trustedDevices, ...rest } = u;
      if (trustedDevices && Array.isArray(trustedDevices) && trustedDevices.length) {
        rest._trustedDeviceCount = trustedDevices.length;
        rest._trustedDeviceLastSeen = trustedDevices.map(d => d.lastSeen || d.createdAt).sort().pop();
      }
      return rest;
    });
    res.json(users);
  } catch (err) {
    logError(`GET /admin/users FAILED: ${err.message}`);
    res.status(503).json({ error: 'Unable to load users.' });
  }
});

// POST /admin/users — creates a new user (store_admin only)
// Role must be 'borrower' (user) or 'store_admin' — no super-admin via UI
router.post('/admin/users', requireStoreAdmin, async (req, res) => {
  try {
    const { fullName, email, phone, role } = req.body || {};

    if (!fullName || !email || !phone) {
      return res.status(400).json({ error: 'Full name, email, and phone are required.' });
    }

    const phoneRegex = /^(\+?260|0)(?:(?:9[5-7]|7[6-7]|57)\d{7}|26\d{7})$/;
    if (!phoneRegex.test(phone)) {
      return res.status(400).json({ error: 'Invalid Zambian mobile number.' });
    }

    const normalizedEmail = String(email).trim().toLowerCase();
    const normalizedRole = String(role || 'user').trim().toLowerCase();

    if (normalizedRole !== 'user' && normalizedRole !== 'store_admin') {
      return res.status(400).json({ error: 'Invalid role. Only borrower or store_admin are allowed.' });
    }

    const users = readUsers();
    if (users.some(user => String(user.email || '').trim().toLowerCase() === normalizedEmail)) {
      return res.status(400).json({ error: 'A user with that email already exists.' });
    }

    const nextId = users.length ? Math.max(...users.map(u => Number(u.id) || 0)) + 1 : 1;
    const storeId = req.authUser?.storeId || 'buraza';

    const newUser = {
      id: nextId,
      username: String(fullName).trim(),
      email: normalizedEmail,
      phone: String(phone).trim(),
      role: normalizedRole === 'store_admin' ? 'store_admin' : 'user',
      storeId,
      restrictions: [],
      createdAt: new Date().toISOString(),
      trustedDevices: []
    };

    users.push(newUser);
    writeUsers(users);

    res.status(201).json({
      message: 'User created successfully.',
      user: {
        id: newUser.id,
        username: newUser.username,
        email: newUser.email,
        phone: newUser.phone,
        role: newUser.role,
        storeId: newUser.storeId
      }
    });
  } catch (err) {
    logError(`POST /admin/users FAILED: ${err.message}`);
    res.status(503).json({ error: 'Unable to create the user.' });
  }
});

// PATCH /admin/users/:email/restrict — sets restricted: true/false (store_admin only)
router.patch('/admin/users/:email/restrict', requireStoreAdmin, (req, res) => {
  try {
    const targetEmail = String(req.params.email || '').trim().toLowerCase();
    const { restricted } = req.body || {};

    if (typeof restricted !== 'boolean') {
      return res.status(400).json({ error: 'restricted must be a boolean.' });
    }

    const users = readUsers();
    const index = users.findIndex(u => String(u.email || '').trim().toLowerCase() === targetEmail);
    if (index < 0) {
      return res.status(404).json({ error: 'User not found.' });
    }

    users[index].restricted = restricted === true;
    users[index].updatedAt = new Date().toISOString();
    writeUsers(users);

    res.json({
      message: `User ${restricted === true ? 'restricted' : 'allowed'} successfully.`,
      user: {
        id: users[index].id,
        email: users[index].email,
        restricted: users[index].restricted
      }
    });
  } catch (err) {
    logError(`PATCH /admin/users/:email/restrict FAILED: ${err.message}`);
    res.status(503).json({ error: 'Unable to update user restriction.' });
  }
});

// GET /admin/customers — returns all borrowers merged with their loans (store_admin only)
router.get('/admin/customers', requireStoreAdmin, (req, res) => {
  try {
    const users = readUsers();
    const loans = readLoans();

    const borrowerEmails = new Set(
      loans
        .filter(loan => loan.email)
        .map(loan => String(loan.email).trim().toLowerCase())
    );

    const customers = users
      .filter(user => borrowerEmails.has(String(user.email || '').trim().toLowerCase()))
      .map(user => {
        const userLoans = loans.filter(loan =>
          String(loan.email || '').trim().toLowerCase() === String(user.email || '').trim().toLowerCase()
        );

        let totalOutstanding = 0;
        let status = 'Settled';
        const SEVERITY = { defaulted: 4, liquidated: 3, grace: 2, active: 1, pending: 0, approved: 1 };

        let worstStatus = null;
        let worstRank = -1;

        userLoans.forEach(loan => {
          const bal = Number(loan.outstanding || 0);
          if (bal > 0) totalOutstanding += bal;
          const loanStatus = String(loan.status || 'pending').toLowerCase();
          const rank = SEVERITY[loanStatus] ?? 0;
          if (rank > worstRank) {
            worstRank = rank;
            worstStatus = loanStatus;
          }
        });

        if (userLoans.length === 0) {
          status = 'No loans';
        } else if (worstStatus) {
          const statusMap = {
            'active': 'Active',
            'grace': 'Active',
            'defaulted': 'Defaulted',
            'liquidated': 'Defaulted',
            'pending': 'Pending',
            'approved': 'Active'
          };
          status = statusMap[worstStatus] || 'Active';
        } else {
          status = 'Settled';
        }

        return {
          id: user.id,
          fullName: user.username || 'Unknown',
          email: user.email,
          phone: user.phone || 'N/A',
          role: user.role,
          storeId: user.storeId,
          numberOfLoans: userLoans.length,
          totalOutstanding,
          status,
          loans: userLoans.map(loan => ({
            id: loan.id,
            receiptNumber: loan.receiptNumber || `BMF-${loan.id}`,
            amount: Number(loan.amount || 0),
            totalRepayment: Number(loan.totalRepayment || loan.amount || 0),
            outstanding: Number(loan.outstanding || 0),
            status: loan.status || 'pending',
            approvedAt: loan.approvedAt || null,
            borrowedDate: loan.borrowedDate || null,
            dueDate: loan.dueDate || null,
            product: loan.product || 'Loan',
            urgency: loan.urgency || 'standard'
          }))
        };
      });

    customers.sort((a, b) => String(a.fullName || '').localeCompare(String(b.fullName || '')));

    res.json(customers);
  } catch (err) {
    logError(`GET /admin/customers FAILED: ${err.message}`);
    res.status(503).json({ error: 'Unable to load customers.' });
  }
});

module.exports = router;