const PDFDocument = require('pdfkit');
const config = require('../config');
const dataStore = require('../middleware/dataStore');
const { logError } = require('../middleware/logger');
const { canAccessRecord, isAdminRole } = require('../middleware/storeScope');
const { getLoansData, deriveLoanStatus } = require('./loanController');

const USERS_FILE = dataStore.paths.users;

function formatKwacha(value) {
  const amount = Number(value || 0);
  return `K ${amount.toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;
}

function formatDisplayDate(value) {
  const match = String(value || '').slice(0, 10).match(/^(\d{4})-(\d{2})-(\d{2})$/);
  return match ? `${match[3]}/${match[2]}/${match[1]}` : (value ? String(value) : 'Not set');
}

function findLoan(id) {
  return getLoansData().find(loan => loan.id === Number(id)) || null;
}

function findUser(email) {
  const users = dataStore.readJson(USERS_FILE, [], Array.isArray);
  return users.find(user => String(user.email || '').trim().toLowerCase() === String(email || '').trim().toLowerCase()) || null;
}

function canReadLoan(req, loan) {
  const email = String(req.authUser?.email || '').trim().toLowerCase();
  if (email && email === String(loan.email || '').trim().toLowerCase()) return true;
  return isAdminRole(req.authUser?.role) && canAccessRecord(req, loan);
}

function pipePdf(res, filename, draw) {
  const doc = new PDFDocument({ margin: 50, size: 'A4' });
  res.setHeader('Content-Type', 'application/pdf');
  res.setHeader('Content-Disposition', `inline; filename="${filename}"`);
  doc.pipe(res);
  draw(doc);
  doc.end();
}

function scheduleLines(loan) {
  const daily = Number((Number(loan.outstanding || loan.totalRepayment || loan.amount || 0) * Number(config.GRACE_DAILY_RATE || 0.018)).toFixed(2));
  const due = loan.dueDateIsEstimate
    ? `Set on the approval day, plus ${loan.tenureWeeks || 1} weeks`
    : formatDisplayDate(loan.dueDate);
  return [
    `Amount borrowed: ${formatKwacha(loan.amount)}`,
    `Interest: ${loan.interestRate || ''}% for ${loan.tenureWeeks || ''} weeks (${formatKwacha(loan.interestAmount)})`,
    `Total to repay: ${formatKwacha(loan.totalRepayment || loan.amount)}`,
    `Due date: ${due}`,
    'Paying early does not reduce this interest.',
    `Late charge: ${formatKwacha(daily)} per day (1.8% of the balance) from the first day the loan is in grace or default, capped at half the amount borrowed.`
  ];
}

function loanReceipt(req, res) {
  try {
    const loan = findLoan(req.params.id);
    if (!loan) return res.status(404).json({ error: 'Loan not found.' });
    if (!canReadLoan(req, loan)) return res.status(403).json({ error: 'Access denied.' });
    const user = findUser(loan.email);
    pipePdf(res, `${loan.receiptNumber || 'loan'}-receipt.pdf`, (doc) => {
      doc.fontSize(18).text('Buraza Micro Finance');
      doc.moveDown(0.3).fontSize(14).text(loan.dueDateIsEstimate ? 'Loan request receipt' : 'Loan receipt');
      doc.moveDown().fontSize(11);
      doc.text(`Receipt: ${loan.receiptNumber || loan.id}`);
      doc.text(`Customer: ${user?.username || loan.email}`);
      doc.text(`NRC: ${user?.nrc || 'Not on file'}`);
      doc.text(`Purpose: ${loan.product || ''}`);
      doc.text(`Status: ${deriveLoanStatus(loan)}`);
      scheduleLines(loan).forEach(line => doc.text(line));
      doc.moveDown().text('This paper is the shop copy of the figures on the account. It is not a bank transfer.');
    });
  } catch (err) {
    logError(`LOAN RECEIPT FAILED: ${err.message}`);
    if (!res.headersSent) res.status(503).json({ error: 'The receipt could not be prepared.' });
  }
}

function loanAgreement(req, res) {
  try {
    const loan = findLoan(req.params.id);
    if (!loan) return res.status(404).json({ error: 'Loan not found.' });
    if (!canReadLoan(req, loan)) return res.status(403).json({ error: 'Access denied.' });
    const user = findUser(loan.email);
    pipePdf(res, `${loan.receiptNumber || 'loan'}-agreement.pdf`, (doc) => {
      doc.fontSize(18).text('Buraza Micro Finance — Loan agreement');
      doc.moveDown().fontSize(11);
      doc.text(`Borrower: ${user?.username || loan.email}`);
      doc.text(`NRC: ${user?.nrc || 'Not on file'}`);
      doc.text(`Phone: ${user?.phone || ''}`);
      doc.text(`Home area: ${user?.address || 'Not on file'}`);
      doc.text(`Next of kin: ${user?.nextOfKinName || 'Not on file'} ${user?.nextOfKinPhone || ''}`);
      doc.text(`Collateral: ${loan.collateralDescription || 'None described'}`);
      doc.moveDown();
      scheduleLines(loan).forEach(line => doc.text(line));
      doc.moveDown();
      doc.text('By taking this loan the borrower agrees to repay the full total on or before the due date. The shop may record the balance as outstanding and add the daily late charge while the loan is in grace or default.');
      doc.moveDown();
      doc.text('Borrower signature: ________________________    Date: ______________');
      doc.moveDown(0.4);
      doc.text('Shop signature: ____________________________    Date: ______________');
      if (loan.agreedToTerms) {
        doc.moveDown().fontSize(9).text(`Terms accepted on the account on ${formatDisplayDate(loan.createdAt)}.`);
      }
    });
  } catch (err) {
    logError(`LOAN AGREEMENT FAILED: ${err.message}`);
    if (!res.headersSent) res.status(503).json({ error: 'The agreement could not be prepared.' });
  }
}

function customerStatement(req, res) {
  try {
    const email = String(req.authUser?.email || '').trim().toLowerCase();
    if (!email) return res.status(403).json({ error: 'Sign in to open your statement.' });
    if (req.authUser?.role && req.authUser.role !== 'user' && !isAdminRole(req.authUser.role)) {
      return res.status(403).json({ error: 'Access denied.' });
    }
    const target = req.authUser.role === 'user' ? email : String(req.query.email || email).trim().toLowerCase();
    if (req.authUser.role === 'user' && target !== email) {
      return res.status(403).json({ error: 'You can only open your own statement.' });
    }
    const user = findUser(target);
    const loans = getLoansData().filter(loan => String(loan.email || '').trim().toLowerCase() === target);
    if (isAdminRole(req.authUser.role) && loans.some(loan => !canAccessRecord(req, loan))) {
      return res.status(403).json({ error: 'Access to this store is not allowed.' });
    }
    const owed = loans
      .filter(loan => !['pending', 'declined', 'paid'].includes(deriveLoanStatus(loan)))
      .reduce((sum, loan) => sum + (Number(loan.outstanding) || 0), 0);
    pipePdf(res, 'bmf-statement.pdf', (doc) => {
      doc.fontSize(18).text('Buraza Micro Finance — Account statement');
      doc.moveDown(0.4).fontSize(11);
      doc.text(`Customer: ${user?.username || target}`);
      doc.text(`Email: ${target}`);
      doc.text(`NRC: ${user?.nrc || 'Not on file'}`);
      doc.text(`Money owed now: ${formatKwacha(owed)}`);
      doc.moveDown();
      if (!loans.length) doc.text('No loans on this account.');
      loans.forEach(loan => {
        doc.fontSize(12).text(`${loan.product || 'Loan'} · ${loan.receiptNumber || loan.id} · ${deriveLoanStatus(loan)}`);
        doc.fontSize(10);
        doc.text(`Borrowed ${formatKwacha(loan.amount)} · Interest ${formatKwacha(loan.interestAmount)} · Balance ${formatKwacha(loan.outstanding)} · Due ${formatDisplayDate(loan.dueDate)}`);
        (loan.payments || []).forEach(payment => {
          const undone = payment.reversed ? ' (undone)' : '';
          doc.text(`  ${formatDisplayDate(payment.paymentDate || payment.date)}  ${formatKwacha(payment.amount)}  ${payment.mode || ''}${undone}  ${payment.paymentReceiptId || ''}`);
        });
        doc.moveDown(0.4);
      });
    });
  } catch (err) {
    logError(`STATEMENT FAILED: ${err.message}`);
    if (!res.headersSent) res.status(503).json({ error: 'The statement could not be prepared.' });
  }
}

module.exports = { loanReceipt, loanAgreement, customerStatement };
