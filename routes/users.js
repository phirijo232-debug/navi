const express = require('express');
const router = express.Router();
const path = require('path');
const { logError } = require('../middleware/logger');
const dataStore = require('../middleware/dataStore');
const { canAccessRecord } = require('../middleware/storeScope');

const USERS_FILE = dataStore.paths.users || path.join(dataStore.DATA_DIR, 'users.json');
const LOANS_FILE = dataStore.paths.loans || path.join(dataStore.DATA_DIR, 'loans.json');

// Read through dataStore so the Supabase copy is used on Vercel.
function readUsers() {
  try {
    return dataStore.readJson(USERS_FILE, [], Array.isArray);
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
    return dataStore.readJson(LOANS_FILE, [], Array.isArray);
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

function inCallerStore(req, record) {
  return canAccessRecord(req, record);
}

// GET /admin/users — store_admin directory, limited to that admin's store.
// POST /admin/users is intentionally not registered here. The hardened handler
// in routes/index.js (createUsersGate + createAdminUser) must own creation so a
// store admin cannot mint another store admin without a password.
router.get('/admin/users', requireStoreAdmin, (req, res) => {
  try {
    const users = readUsers().filter(user => inCallerStore(req, user)).map(u => {
      const { password, tokens, trustedDevices, passwordHash, resetToken, otp, ...rest } = u;
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

// PATCH /admin/users/:email/restrict — customer flag only, and only in this store.
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
    if (!inCallerStore(req, users[index])) {
      return res.status(403).json({ error: 'Access to this store is not allowed.' });
    }
    if (users[index].role && users[index].role !== 'user') {
      return res.status(403).json({ error: 'Only customer accounts can be updated here.' });
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

// GET /admin/customers — borrowers and loans for this store only.
router.get('/admin/customers', requireStoreAdmin, (req, res) => {
  try {
    const users = readUsers().filter(user => inCallerStore(req, user));
    const loans = readLoans().filter(loan => inCallerStore(req, loan));

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