const fs = require('fs');
const path = require('path');
const multer = require('multer');
const { logError } = require('../middleware/logger');
const emailService = require('../middleware/email');
const config = require('../config');
const { getRecordStoreId, getRequestedStoreId, canAccessStore, canAccessRecord, isAdminRole } = require('../middleware/storeScope');

const LOANS_FILE = path.join(__dirname, '../data/loans.json');
const UPLOAD_DIR = path.join(__dirname, '../public/uploads');

if (!fs.existsSync(UPLOAD_DIR)) {
  fs.mkdirSync(UPLOAD_DIR, { recursive: true });
}

const storage = multer.diskStorage({
  destination: (req, file, cb) => cb(null, UPLOAD_DIR),
  filename: (req, file, cb) => cb(null, `${Date.now()}-${file.originalname}`)
});
const upload = multer({ storage, limits: { fileSize: 5 * 1024 * 1024 } });

function getLoansData() {
  try {
    return JSON.parse(fs.readFileSync(LOANS_FILE, 'utf8'));
  } catch (err) {
    logError(`LOANS READ FAILED: ${err.message}`);
    return [];
  }
}

function normalizeLoanStatus(status) {
  return String(status || '').trim().toLowerCase().replace(/\s+/g, '_');
}

function ensureStatusHistory(loan) {
  if (!Array.isArray(loan.statusHistory)) {
    loan.statusHistory = [];
  }
  return loan.statusHistory;
}

function recordStatusHistory(loan, status, reason, actor = 'system', source = 'system') {
  const history = ensureStatusHistory(loan);
  history.push({
    status: normalizeLoanStatus(status),
    reason: reason || 'No note provided.',
    actor: actor || 'system',
    source,
    updatedAt: new Date().toISOString()
  });
  loan.statusHistory = history.slice(-25);
}

function calculateSummary(loans) {
  const total = loans.length;
  const outstanding = loans.reduce((sum, loan) => sum + (loan.outstanding || 0), 0);
  return { total, outstanding };
}

function getLoanTimeframeWindow(filter) {
  const normalized = String(filter || '').trim().toLowerCase().replace(/\s+/g, '-');
  const now = new Date();
  const end = new Date(now.getTime());

  if (!normalized || normalized === 'all') return null;

  if (normalized === 'today') {
    const start = new Date(now.getFullYear(), now.getMonth(), now.getDate());
    return { start, end };
  }

  if (normalized === 'yesterday') {
    const start = new Date(now.getFullYear(), now.getMonth(), now.getDate() - 1);
    const endOfYesterday = new Date(now.getFullYear(), now.getMonth(), now.getDate());
    return { start, end: endOfYesterday };
  }

  if (['7', '7-days', 'last-7-days'].includes(normalized)) {
    const start = new Date(now.getTime() - 7 * 24 * 60 * 60 * 1000);
    return { start, end };
  }

  if (['30', '30-days', 'last-30-days'].includes(normalized)) {
    const start = new Date(now.getTime() - 30 * 24 * 60 * 60 * 1000);
    return { start, end };
  }

  if (normalized === 'month' || normalized === 'this-month') {
    const start = new Date(now.getFullYear(), now.getMonth(), 1);
    const endOfMonth = new Date(now.getFullYear(), now.getMonth() + 1, 0, 23, 59, 59, 999);
    return { start, end: endOfMonth };
  }

  if (normalized === 'year' || normalized === 'this-year') {
    const start = new Date(now.getFullYear(), 0, 1);
    const endOfYear = new Date(now.getFullYear(), 11, 31, 23, 59, 59, 999);
    return { start, end: endOfYear };
  }

  const days = parseInt(normalized, 10);
  if (!Number.isNaN(days) && days > 0) {
    const start = new Date(now.getTime() - days * 24 * 60 * 60 * 1000);
    return { start, end };
  }

  return null;
}

function filterLoansByTimeframe(loans, filter) {
  const window = getLoanTimeframeWindow(filter);
  if (!window) return loans;

  return loans.filter(loan => {
    const createdAt = new Date(loan?.createdAt || 0);
    if (Number.isNaN(createdAt.getTime())) return false;
    return createdAt >= window.start && createdAt <= window.end;
  });
}

function saveLoansData(loans) {
  try {
    fs.writeFileSync(LOANS_FILE, JSON.stringify(loans, null, 2));
  } catch (err) {
    logError(`LOANS WRITE FAILED: ${err.message}`);
    throw err;
  }
}

function formatCurrency(value) {
  const amount = Number(value || 0);
  return `K ${amount.toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;
}

function calculateInterest(amount, tenureWeeks) {
  const rates = { 1: 0.10, 2: 0.16, 3: 0.24, 4: 0.32 };
  const rate = rates[parseInt(tenureWeeks)] || 0.10;
  const interest = Number(amount) * rate;
  return {
    rate: rate * 100,
    interest: Number(interest.toFixed(2)),
    total: Number((Number(amount) + interest).toFixed(2))
  };
}

function getApprovalDeadline(urgency) {
  const normalized = (urgency || 'standard').toLowerCase();
  const hours = { low: 72, standard: 48, urgent: 24, emergency: 4 };
  const ms = (hours[normalized] || hours.standard) * 60 * 60 * 1000;
  return new Date(Date.now() + ms).toISOString();
}

async function requestLoan(req, res) {
  try {
    const {
      email, product, amount, dueDate,
      tenureWeeks, urgency, paymentMode,
      nextPayment, collateralDescription, collateralGrade, agreedToTerms
    } = req.body;

    const authEmail = req.authUser?.email;
    const storeId = req.authUser?.storeId || config.DEFAULT_STORE_ID;

    if (!email || !product || !amount || !dueDate) {
      return res.status(400).json({ error: 'All loan request fields are required.' });
    }

    if (!authEmail || authEmail !== email) {
      return res.status(403).json({ error: 'Request denied. Device token does not match this account.' });
    }

    if (agreedToTerms !== 'true' && agreedToTerms !== true) {
      return res.status(400).json({ error: 'You must agree to the terms and conditions.' });
    }

    const requestedAmount = Number(amount);
    if (!requestedAmount || requestedAmount <= 0) {
      return res.status(400).json({ error: 'Loan amount must be a positive number.' });
    }

    const weeks = parseInt(tenureWeeks, 10) || 1;
    if (![1, 2, 3, 4].includes(weeks)) {
      return res.status(400).json({ error: 'Tenure must be between 1 and 4 weeks.' });
    }

    const normalizedUrgency = (urgency || 'standard').toLowerCase();
    if (!['low', 'standard', 'urgent', 'emergency'].includes(normalizedUrgency)) {
      return res.status(400).json({ error: 'Urgency must be low, standard, urgent, or emergency.' });
    }

    const { rate, interest, total } = calculateInterest(requestedAmount, weeks);
    const approvalDeadline = getApprovalDeadline(normalizedUrgency);

    const files = req.files || {};
    const collateralFront = files.collateralFront?.[0]?.filename || null;
    const collateralBack = files.collateralBack?.[0]?.filename || null;

    const loans = getLoansData();
    const nextId = loans.length ? Math.max(...loans.map(l => l.id)) + 1 : 1;

    const createdAt = new Date().toISOString();
    const newLoan = {
      id: nextId,
      email,
      storeId,
      product,
      amount: requestedAmount,
      tenureWeeks: weeks,
      interestRate: rate,
      interestAmount: interest,
      totalRepayment: total,
      outstanding: total || requestedAmount,
      dueDate,
      urgency: normalizedUrgency,
      paymentMode: paymentMode || null,
      nextPayment: nextPayment || null,
      collateralDescription: collateralDescription || null,
      collateralFront,
      collateralBack,
      collateralGrade: collateralGrade || null,
      collateralVerified: false,
      agreedToTerms: true,
      status: 'pending',
      approvalDeadline,
      payments: [],
      statusHistory: [{
        status: 'pending',
        reason: 'Loan request submitted by borrower.',
        actor: email,
        source: 'borrower',
        updatedAt: createdAt
      }],
      createdAt
    };

    loans.push(newLoan);
    saveLoansData(loans);

    const requestEmail = emailService.buildRequestReceivedMessage(product, normalizedUrgency, email, newLoan);
    await emailService.sendCustomerEmail({
      to: email,
      subject: requestEmail.subject,
      text: requestEmail.body
    });

    const adminRecipients = emailService.getNotificationRecipients(email).filter(recipient => recipient.toLowerCase() !== String(email).trim().toLowerCase());
    if (adminRecipients.length) {
      const adminSummary = emailService.buildLoanSummaryText(newLoan);
      const adminAlert = {
        subject: `New loan request alert: ${product} — ${formatCurrency(newLoan.amount)} — ${String(newLoan.urgency || 'standard').toLowerCase()}`,
        text: `A new loan request has been submitted by ${email}.\n\n` +
          adminSummary +
          `Created: ${new Date().toISOString()}\n\n` +
          'Please review the request in the admin dashboard.'
      };

      await emailService.sendCustomerEmail({
        to: adminRecipients,
        subject: adminAlert.subject,
        text: adminAlert.text
      });
    }

    res.json({
      message: 'Loan request submitted successfully.',
      loan: {
        id: newLoan.id,
        amount: requestedAmount,
        interestRate: rate,
        interestAmount: interest,
        totalRepayment: total,
        approvalDeadline
      }
    });
  } catch (err) {
    logError(`LOANS REQUEST FAILED: ${err.message}`);
    res.status(500).json({ error: 'Unable to submit loan request.' });
  }
}

function getLoans(req, res) {
  try {
    const email = req.query.email;
    const filter = req.query.filter;
    const authEmail = req.authUser?.email;
    const isAdmin = isAdminRole(req.authUser?.role);
    const storeId = getRequestedStoreId(req);

    if (isAdmin && !canAccessStore(req, storeId)) {
      return res.status(403).json({ error: 'Access to this store is not allowed.' });
    }

    if (!email && !isAdmin) {
      return res.status(400).json({ error: 'Email is required to retrieve loans.' });
    }

    if (email && authEmail && authEmail !== email && !isAdmin) {
      return res.status(403).json({ error: 'Request denied. Device token does not match this account.' });
    }

    let loans = getLoansData().filter(loan => storeId === 'all' || getRecordStoreId(loan) === storeId);
    if (email) {
      loans = loans.filter(loan => loan.email === email);
    }

    if (filter && filter !== 'all') {
      loans = filterLoansByTimeframe(loans, filter);
    }

    const summary = calculateSummary(loans);
    const totalRequested = loans.reduce((sum, l) => sum + (l.amount || 0), 0);
    const totalInterest = loans.reduce((sum, l) => sum + (Number(l.interestAmount) || 0), 0);
    const totalRepayment = loans.reduce((sum, l) => sum + (Number(l.totalRepayment) || Number(l.amount) || 0), 0);

    res.json({
      loans,
      summary: {
        ...summary,
        totalRequested,
        totalInterest,
        totalRepayment
      }
    });
  } catch (err) {
    logError(`LOANS ROUTE FAILED: ${err.message}`);
    res.status(500).json({ error: 'Unable to load loan information.' });
  }
}

function getLoanById(req, res) {
  try {
    const id = Number(req.params.id);
    const authEmail = req.authUser?.email;
    const isAdmin = isAdminRole(req.authUser?.role);
    const loans = getLoansData();
    const loan = loans.find(l => l.id === id);

    if (!loan) return res.status(404).json({ error: 'Loan not found.' });

    if (!authEmail && !isAdmin) {
      return res.status(403).json({ error: 'Access denied.' });
    }

    if (authEmail !== loan.email && !isAdmin) {
      return res.status(403).json({ error: 'Access denied.' });
    }

    if (isAdmin && !canAccessRecord(req, loan)) {
      return res.status(403).json({ error: 'Access to this store is not allowed.' });
    }

    res.json({ loan });
  } catch (err) {
    logError(`GET LOAN FAILED: ${err.message}`);
    res.status(500).json({ error: 'Unable to load loan.' });
  }
}

async function updateLoanStatus(req, res) {
  try {
    if (req.authUser?.role !== 'store_admin') {
      return res.status(403).json({ error: 'Loan decisions are restricted to the assigned store admin.' });
    }
    const id = Number(req.params.id);
    const { action, amount, collateralGrade, collateralVerified, nextPayment, reason } = req.body;
    const authEmail = req.authUser?.email;
    const isAdmin = req.authUser?.role === 'store_admin';
    const normalizedAction = String(action || '').trim().toLowerCase().replace(/\s+/g, '_');

    const loans = getLoansData();
    const idx = loans.findIndex(l => l.id === id);
    if (idx < 0) return res.status(404).json({ error: 'Loan not found.' });
    const loan = loans[idx];

    if (isAdmin && !canAccessRecord(req, loan)) {
      return res.status(403).json({ error: 'Access to this store is not allowed.' });
    }

    if (!isAdmin && authEmail !== loan.email) {
      return res.status(403).json({ error: 'Access denied.' });
    }

    if (['approve', 'approved'].includes(normalizedAction) && isAdmin) {
      loan.status = 'approved';
      loan.adminReason = reason || loan.adminReason || 'Approved by admin.';
      const approvedAt = new Date();
      const approvalDelayDays = Math.max(0, Math.ceil((approvedAt - new Date(loan.createdAt || Date.now())) / (1000 * 60 * 60 * 24)));
      const adjustedWeeks = Math.max(Number(loan.tenureWeeks) || 1, 1);
      const approvalWindow = approvedAt.getTime() + (adjustedWeeks * 7 + Math.max(0, approvalDelayDays)) * 24 * 60 * 60 * 1000;
      loan.approvedAt = approvedAt.toISOString();
      loan.dueDate = new Date(approvalWindow).toISOString().slice(0, 10);
    } else if (['in_progress', 'in-progress', 'start', 'started'].includes(normalizedAction) && isAdmin) {
      loan.status = 'in_progress';
      loan.adminReason = reason || loan.adminReason || 'Loan is now in progress.';
    } else if (['decline', 'declined', 'reject', 'rejected'].includes(normalizedAction) && isAdmin) {
      loan.status = 'declined';
      loan.adminReason = reason || loan.adminReason || 'Loan declined by admin.';
    } else if (action === 'record-payment') {
      const pay = Number(amount) || 0;
      loan.outstanding = Math.max(0, (loan.outstanding || 0) - pay);
      if (loan.outstanding === 0) loan.status = 'paid';
    } else if (action === 'grade' && isAdmin) {
      loan.collateralGrade = collateralGrade;
      loan.collateralVerified = collateralVerified === 'true';
    } else if (action === 'next-payment') {
      loan.nextPayment = nextPayment;
    } else {
      return res.status(400).json({ error: 'Invalid action or insufficient permissions.' });
    }

    const decisionText = loan.adminReason || reason || 'Reviewed by our team.';
    recordStatusHistory(loan, loan.status, decisionText, req.authUser?.email || 'admin', isAdmin ? 'admin' : 'customer');

    loan.updatedAt = new Date().toISOString();
    loan.reviewedBy = req.authUser?.email || null;
    loan.reviewedAt = new Date().toISOString();
    loans[idx] = loan;
    saveLoansData(loans);

    const decisionEmail = emailService.buildLoanStatusNotification(normalizedAction, loan.product, decisionText, loan.email, loan);
    await emailService.sendCustomerEmail({
      to: loan.email,
      subject: decisionEmail.subject,
      text: decisionEmail.body
    });

    const adminRecipients = emailService.getNotificationRecipients(loan.email).filter(recipient => recipient.toLowerCase() !== String(loan.email).trim().toLowerCase());
    if (adminRecipients.length) {
      const reportLines = getLoansData()
        .map(item => {
          const history = Array.isArray(item.statusHistory) && item.statusHistory.length ? item.statusHistory[item.statusHistory.length - 1].status : item.status || 'pending';
          return `- Loan #${item.id}: ${item.email} | ${item.product || 'Loan'} | ${formatCurrency(item.amount || 0)} | status: ${history} | reason: ${item.adminReason || 'No reason provided'} | updated: ${item.updatedAt || item.createdAt || 'unknown'}`;
        })
        .join('\n');

      await emailService.sendCustomerEmail({
        to: adminRecipients,
        subject: `Loan audit report — ${new Date().toISOString().slice(0, 10)}`,
        text: `Loan audit report for Pryme Vertex\n\n${reportLines || 'No loan activity recorded.'}`
      });
    }

    res.json({ message: 'Loan updated.', loan });
  } catch (err) {
    logError(`UPDATE LOAN FAILED: ${err.message}`);
    res.status(500).json({ error: 'Unable to update loan.' });
  }
}

function getAllLoans(req, res) {
  try {
    const isAdmin = isAdminRole(req.authUser?.role);
    if (!isAdmin) return res.status(403).json({ error: 'Admin access required.' });

    const storeId = getRequestedStoreId(req);
    if (!canAccessStore(req, storeId)) return res.status(403).json({ error: 'Access to this store is not allowed.' });
    const loans = getLoansData().filter(loan => storeId === 'all' || getRecordStoreId(loan) === storeId);
    const summary = {
      total: loans.length,
      pending: loans.filter(l => normalizeLoanStatus(l.status) === 'pending').length,
      in_progress: loans.filter(l => normalizeLoanStatus(l.status) === 'in_progress').length,
      approved: loans.filter(l => normalizeLoanStatus(l.status) === 'approved').length,
      declined: loans.filter(l => normalizeLoanStatus(l.status) === 'declined').length,
      active: loans.filter(l => ['running', 'approved', 'active', 'in_progress', 'in-progress'].includes(normalizeLoanStatus(l.status))).length,
      overdue: loans.filter(l => normalizeLoanStatus(l.status) === 'overdue').length,
      paid: loans.filter(l => normalizeLoanStatus(l.status) === 'paid').length,
      totalOutstanding: loans.reduce((sum, l) => sum + (l.outstanding || 0), 0)
    };
    res.json({ summary, loans });
  } catch (err) {
    logError(`ADMIN LOANS FETCH ERROR: ${err.message}`);
    res.status(500).json({ error: 'Could not load loans.' });
  }
}

function recordPayment(req, res) {
  try {
    const { id, amount, mode, note } = req.body;
    if (req.authUser?.role !== 'store_admin') return res.status(403).json({ error: 'BMF store admin access required.' });

    const screenshot = req.files?.screenshot?.[0]?.filename || null;
    const loans = getLoansData();
    const index = loans.findIndex(l => l.id === Number(id));
    if (index === -1) return res.status(404).json({ error: 'Loan not found.' });
    if (!canAccessRecord(req, loans[index])) return res.status(403).json({ error: 'Access to this store is not allowed.' });

    const paymentAmount = Number(amount);
    if (!Number.isFinite(paymentAmount) || paymentAmount <= 0 || paymentAmount > Number(loans[index].outstanding || 0)) {
      return res.status(400).json({ error: 'Payment must be positive and cannot exceed the outstanding balance.' });
    }

    const recordedAt = new Date().toISOString();
    const payment = {
      amount: paymentAmount,
      mode: mode || 'cash',
      note: note || null,
      screenshot,
      date: recordedAt
    };

    if (!loans[index].payments) loans[index].payments = [];
    loans[index].payments.push(payment);
    loans[index].outstanding = Math.max(0, (loans[index].outstanding || 0) - payment.amount);
    if (loans[index].outstanding === 0) {
      loans[index].status = 'paid';
      loans[index].settledAt = recordedAt;
    }
    recordStatusHistory(loans[index], loans[index].status, `Payment of ${formatCurrency(payment.amount)} recorded.`, req.authUser?.email || 'admin', 'admin');
    loans[index].updatedAt = recordedAt;

    saveLoansData(loans);
    res.json({ message: 'Payment recorded.', outstanding: loans[index].outstanding, payment });
  } catch (err) {
    logError(`PAYMENT RECORD ERROR: ${err.message}`);
    res.status(500).json({ error: 'Could not record payment.' });
  }
}

async function sendLoanNotification(req, res) {
  try {
    const id = Number(req.params.id);
    const { messageType } = req.body; // e.g., 'overdue', 'reminder'
    if (req.authUser?.role !== 'store_admin') return res.status(403).json({ error: 'BMF store admin access required.' });

    const loans = getLoansData();
    const loan = loans.find(l => l.id === id);
    if (!loan) return res.status(404).json({ error: 'Loan not found.' });
    if (!canAccessRecord(req, loan)) return res.status(403).json({ error: 'Access to this store is not allowed.' });

    let subject = 'Loan Update - Pryme Vertex';
    let text = '';

    if (messageType === 'overdue') {
      subject = 'URGENT: Your Loan is Overdue';
      text = `Dear customer,\n\nThis is a notification that your loan for ${loan.product} is currently overdue. \n\nOutstanding Amount: ${formatCurrency(loan.outstanding)}\nDue Date: ${loan.dueDate}\n\nPlease make a payment as soon as possible to avoid further penalties.`;
    } else {
      text = `Hello,\n\nThis is a reminder regarding your loan for ${loan.product}.\n\nOutstanding Amount: ${formatCurrency(loan.outstanding)}\nDue Date: ${loan.dueDate}\n\nThank you.`;
    }

    await emailService.sendCustomerEmail({
      to: loan.email,
      subject,
      text
    });

    res.json({ message: 'Notification sent successfully.' });
  } catch (err) {
    logError(`NOTIFICATION SEND ERROR: ${err.message}`);
    res.status(500).json({ error: 'Could not send notification.' });
  }
}

async function notifyAllOverdue(req, res) {
  try {
    if (req.authUser?.role !== 'store_admin') {
      return res.status(403).json({ error: 'BMF store admin access required.' });
    }

    const storeId = getRequestedStoreId(req);
    if (!canAccessStore(req, storeId)) return res.status(403).json({ error: 'Access to this store is not allowed.' });
    const today = new Date().toISOString().slice(0, 10);
    const overdueLoans = getLoansData().filter(loan => (storeId === 'all' || getRecordStoreId(loan) === storeId)).filter(loan => {
      const status = normalizeLoanStatus(loan.status);
      const outstanding = Number(loan.outstanding || 0);
      const dueDate = String(loan.dueDate || '');
      const pastDue = /^\d{4}-\d{2}-\d{2}$/.test(dueDate) && dueDate < today;
      return outstanding > 0 && !['declined', 'paid'].includes(status) && (status === 'overdue' || pastDue);
    });

    const loansByEmail = new Map();
    overdueLoans.forEach(loan => {
      const email = String(loan.email || '').trim().toLowerCase();
      if (!email) return;
      if (!loansByEmail.has(email)) loansByEmail.set(email, []);
      loansByEmail.get(email).push(loan);
    });

    let sent = 0;
    let failed = 0;
    for (const [email, customerLoans] of loansByEmail) {
      const loanDetails = customerLoans.map(loan =>
        `- ${loan.product || 'Loan'} #${loan.id}: outstanding ${formatCurrency(loan.outstanding)}, due ${loan.dueDate || 'date unavailable'}`
      ).join('\n');
      const result = await emailService.sendCustomerEmail({
        to: email,
        subject: 'Buraza Micro Finance (BMF): overdue loan notice',
        text: `Dear customer,\n\nOur records show the following Buraza loan balance(s) are overdue:\n${loanDetails}\n\nPlease contact Buraza Micro Finance to arrange payment. If you have already paid, please disregard this notice.\n\nRegards,\nBuraza Micro Finance (BMF), a Pryme Vertex subsidiary.`
      });
      if (result?.ok) sent += 1;
      else failed += 1;
    }

    return res.status(failed ? 207 : 200).json({
      message: loansByEmail.size
        ? `Overdue notices sent to ${sent} customer${sent === 1 ? '' : 's'}${failed ? `; ${failed} failed` : ''}.`
        : 'No customers currently have overdue loan balances.',
      sent,
      failed,
      overdueLoans: overdueLoans.length,
      customers: loansByEmail.size
    });
  } catch (err) {
    logError(`BULK OVERDUE NOTIFICATION FAILED: ${err.message}`);
    return res.status(500).json({ error: 'Unable to send overdue notices.' });
  }
}

module.exports = {
  upload,
  getLoans,
  requestLoan,
  getLoanById,
  updateLoanStatus,
  getAllLoans,
  recordPayment,
  sendLoanNotification,
  notifyAllOverdue,
  calculateInterest,
  getApprovalDeadline,
  filterLoansByTimeframe,
  getLoanTimeframeWindow
};