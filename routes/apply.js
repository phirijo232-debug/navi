const express = require('express');
const router = express.Router();
const path = require('path');
const fs = require('fs');
const crypto = require('crypto');
const multer = require('multer');
const { logError, logBreakage } = require('../middleware/logger');
const emailService = require('../middleware/email');
const config = require('../config');
const dataStore = require('../middleware/dataStore');
const { getRecordStoreId, getRequestedStoreId, canAccessStore, canAccessRecord, isAdminRole } = require('../middleware/storeScope');
const { calculateInterest, getLoansData, saveLoansData, generateLoanReceiptId } = require('../controllers/loanController');
const { issueSignupInvite } = require('../controllers/authController');
const { imageKind, quickLoanLimits, PHONE_RE, NRC_RE, EMAIL_RE } = require('../middleware/quickLoan');
const supabaseApi = require('../middleware/supabaseApi');

const APPLICATIONS_FILE = dataStore.paths.applications || path.join(dataStore.DATA_DIR, 'applications.json');
const NOTIFICATIONS_FILE = dataStore.paths.notifications;
const USERS_FILE = dataStore.paths.users;
const LOANS_FILE = dataStore.paths.loans;
const UPLOAD_DIR = path.join(__dirname, '../public/uploads');

const memoryUpload = multer({
  storage: multer.memoryStorage(),
  limits: { fileSize: 5 * 1024 * 1024, files: 6 }
});

function receiveQuickLoan(req, res, next) {
  memoryUpload.fields([
    { name: 'nrcFront', maxCount: 1 },
    { name: 'nrcBack', maxCount: 1 },
    { name: 'studentIdPhoto', maxCount: 1 },
    { name: 'collateralFront', maxCount: 1 },
    { name: 'collateralBack', maxCount: 1 }
  ])(req, res, (err) => {
    if (!err) return next();
    const message = err.code === 'LIMIT_FILE_SIZE'
      ? 'Each photo must be 5 MB or smaller.'
      : (err.message || 'Upload rejected.');
    return res.status(400).json({ error: message });
  });
}

function ensureApplicationsFile() {
  try {
    if (!fs.existsSync(APPLICATIONS_FILE)) {
      dataStore.writeJson(APPLICATIONS_FILE, []);
    }
  } catch (err) {
    logError(`APPLICATIONS FILE INIT FAILED: ${err.message}`);
  }
}

function readApplications() {
  try {
    const raw = fs.readFileSync(APPLICATIONS_FILE, 'utf8');
    const data = JSON.parse(raw);
    return Array.isArray(data) ? data : [];
  } catch (err) {
    if (err.code !== 'ENOENT') logError(`APPLICATIONS READ FAILED: ${err.message}`);
    return [];
  }
}

function writeApplications(apps) {
  return dataStore.writeJson(APPLICATIONS_FILE, apps);
}

function generateApplicationId(existing) {
  const used = new Set(existing.map(item => String(item.applicationId || item.id || '')));
  const yyyymmdd = new Date().toISOString().slice(0, 10).replace(/-/g, '');
  let id = '';
  do {
    id = `QS-${yyyymmdd}-${crypto.randomInt(1000, 10000)}`;
  } while (used.has(id));
  return id;
}

function money(amount) {
  return `K ${Number(amount || 0).toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;
}

function fileBuffer(files, name) {
  const list = files && files[name];
  return list && list[0] ? list[0] : null;
}

function saveVerifiedPhoto(file) {
  const kind = imageKind(file.buffer);
  if (!kind) return { error: 'Photos must be JPEG, PNG, or WEBP files.' };
  const filename = `${Date.now()}-${crypto.randomBytes(3).toString('hex')}-${kind === 'jpg' ? 'photo.jpg' : `photo.${kind}`}`;
  if (supabaseApi.enabled()) {
    const type = kind === 'png' ? 'image/png' : (kind === 'webp' ? 'image/webp' : 'image/jpeg');
    supabaseApi.uploadObject(filename, file.buffer, type);
    return { filename };
  }
  if (!fs.existsSync(UPLOAD_DIR)) fs.mkdirSync(UPLOAD_DIR, { recursive: true });
  fs.writeFileSync(path.join(UPLOAD_DIR, filename), file.buffer);
  return { filename };
}

async function verifyTurnstile(req) {
  const secret = String(process.env.TURNSTILE_SECRET_KEY || '').trim();
  if (!secret) return true;
  const token = String(req.body?.turnstileToken || req.body?.['cf-turnstile-response'] || '').trim();
  if (!token) return false;
  const body = new URLSearchParams({ secret, response: token, remoteip: req.ip || '' });
  const response = await fetch('https://challenges.cloudflare.com/turnstile/v0/siteverify', { method: 'POST', body });
  const data = await response.json();
  return Boolean(data.success);
}

function ensureApplicationNotifications(applications) {
  const users = dataStore.readJson(USERS_FILE, [], Array.isArray);
  const notifications = dataStore.readJson(NOTIFICATIONS_FILE, [], Array.isArray);
  let changed = false;
  const applicationsById = new Map(applications.map(application => [
    String(application.applicationId || application.id),
    application
  ]));

  notifications.forEach(notification => {
    if (notification.type !== 'application-request') return;
    const application = applicationsById.get(String(notification.applicationId || ''));
    if (!application) return;
    const status = String(application.status || '').toLowerCase();
    if (notification.applicationStatus !== status) {
      notification.applicationStatus = status;
      changed = true;
    }
    if (status !== 'pending' && !notification.readAt) {
      notification.readAt = application.reviewedAt || application.updatedAt || new Date().toISOString();
      changed = true;
    }
  });

  applications.forEach(application => {
    if (String(application.status || '').toLowerCase() !== 'pending') return;
    const storeId = getRecordStoreId(application);
    const recipients = users.filter(user =>
      isAdminRole(user.role) &&
      canAccessStore({ authUser: user, headers: { 'x-business-unit': storeId } }, storeId)
    );
    recipients.forEach(user => {
      const email = String(user.email || '').trim().toLowerCase();
      if (!email || notifications.some(notification =>
        notification.type === 'application-request' &&
        String(notification.applicationId) === String(application.applicationId || application.id) &&
        String(notification.recipientEmail || '').toLowerCase() === email
      )) return;

      notifications.push({
        id: crypto.randomUUID(),
        kind: 'in-app',
        recipientEmail: email,
        type: 'application-request',
        message: `New Quick Screen application from ${application.fullName || 'an applicant'}.`,
        applicationId: application.applicationId || application.id,
        applicantName: application.fullName || '',
        amount: Number(application.amount) || 0,
        applicationStatus: String(application.status || '').toLowerCase(),
        storeId,
        createdAt: application.createdAt || new Date().toISOString(),
        readAt: null
      });
      changed = true;
    });
  });

  if (changed) dataStore.writeJson(NOTIFICATIONS_FILE, notifications);
}

router.post('/', receiveQuickLoan, async (req, res) => {
  try {
    ensureApplicationsFile();
    const body = req.body || {};
    if (String(body.company || '').trim()) {
      return res.status(201).json({ message: 'Application submitted successfully.', applicationId: 'QS-RECEIVED', status: 'pending' });
    }

    const fullName = String(body.fullName || '').trim();
    const email = String(body.email || '').trim().toLowerCase();
    const phone = String(body.phone || '').trim();
    const nrcNumber = String(body.nrcNumber || '').trim();
    const school = String(body.school || '').trim();
    const studentId = String(body.studentId || '').trim();
    const purpose = String(body.purpose || body.product || '').trim();
    const product = String(body.loanProduct || 'Student Quick Loan').trim() || 'Student Quick Loan';
    const amount = Number(body.amount);
    const minAmount = Number(process.env.QUICK_LOAN_MIN_AMOUNT || 50);
    const maxAmount = Number(process.env.QUICK_LOAN_MAX_AMOUNT || 50000);
    const agreed = body.agreedToTerms === 'true' || body.agreedToTerms === true;

    if (!fullName || !email || !phone || !nrcNumber || !school || !studentId || !purpose) {
      return res.status(400).json({ error: 'All required fields must be filled.' });
    }
    if (!EMAIL_RE.test(email) || !PHONE_RE.test(phone) || !NRC_RE.test(nrcNumber)) {
      return res.status(400).json({ error: 'Enter your name, a valid email, a Zambian mobile number, and an NRC like 123456/78/1.' });
    }
    if (!school || !studentId) {
      return res.status(400).json({ error: 'School and student ID number are required.' });
    }
    if (!purpose) return res.status(400).json({ error: 'Tell us what the loan is for.' });
    if (!Number.isFinite(amount) || amount < minAmount || amount > maxAmount) {
      return res.status(400).json({ error: `Amount must be between K ${minAmount} and K ${maxAmount}.` });
    }
    if (!agreed) return res.status(400).json({ error: 'You must agree to the terms and conditions.' });

    const limitMessage = quickLoanLimits({ ip: req.ip || 'unknown', phone, nrc: nrcNumber });
    if (limitMessage) return res.status(429).json({ error: limitMessage });

    const turnstileOk = await verifyTurnstile(req);
    if (!turnstileOk) return res.status(400).json({ error: 'Please complete the anti-spam check and try again.' });

    const apps = readApplications();
    if (apps.some(item => String(item.nrcNumber || '') === nrcNumber && String(item.status || '').toLowerCase() === 'pending')) {
      return res.status(409).json({ error: 'A pending application already exists for this NRC.' });
    }

    const requiredPhotos = ['nrcFront', 'nrcBack', 'studentIdPhoto'];
    const checked = {};
    for (const name of requiredPhotos) {
      const file = fileBuffer(req.files, name);
      if (!file) return res.status(400).json({ error: 'Attach the NRC front, NRC back, and student ID photo.' });
      if (!imageKind(file.buffer)) return res.status(400).json({ error: 'Photos must be JPEG, PNG, or WEBP files.' });
      checked[name] = file;
    }
    for (const name of ['collateralFront', 'collateralBack']) {
      const file = fileBuffer(req.files, name);
      if (!file) continue;
      if (!imageKind(file.buffer)) return res.status(400).json({ error: 'Photos must be JPEG, PNG, or WEBP files.' });
      checked[name] = file;
    }
    const saved = {};
    for (const [name, file] of Object.entries(checked)) {
      const written = saveVerifiedPhoto(file);
      if (written.error) return res.status(400).json({ error: written.error });
      saved[name] = written.filename;
    }

    const tenure = Math.max(1, Math.min(4, Number(body.tenureWeeks) || 1));
    const quote = calculateInterest(amount, tenure);
    const applicationId = generateApplicationId(apps);
    const application = {
      id: applicationId,
      applicationId,
      fullName,
      email,
      phone,
      nrcNumber,
      school,
      studentId,
      purpose,
      product,
      amount,
      tenureWeeks: tenure,
      urgency: ['low', 'standard', 'urgent', 'emergency'].includes(String(body.urgency || '').toLowerCase())
        ? String(body.urgency).toLowerCase()
        : 'standard',
      agreedToTerms: true,
      status: 'pending',
      storeId: config.DEFAULT_STORE_ID,
      createdAt: new Date().toISOString(),
      updatedAt: new Date().toISOString(),
      interestRate: quote.rate,
      interestAmount: quote.interest,
      totalRepayment: quote.total,
      nrcFront: saved.nrcFront,
      nrcBack: saved.nrcBack,
      studentIdPhoto: saved.studentIdPhoto,
      collateralFront: saved.collateralFront || null,
      collateralBack: saved.collateralBack || null
    };

    apps.push(application);
    await writeApplications(apps);
    try { ensureApplicationNotifications(apps); } catch (notificationErr) {
      logError(`APPLICATION NOTIFICATION CREATE FAILED for ${application.applicationId}: ${notificationErr.message}`);
    }

    try {
      await emailService.sendCustomerEmail({
        to: application.email,
        subject: `BMF Loan Application Received — ${application.applicationId}`,
        text: `Good day ${application.fullName},\n\nYour student quick loan application has been received.\n\nReference: ${application.applicationId}\nPurpose: ${application.purpose}\nAmount: ${money(application.amount)}\nSchool: ${application.school}\n\nA BMF officer will review it and contact you.\n\nWarm regards,\nThe BMF Team`
      });
    } catch (emailErr) {
      logError(`APPLICATION CONFIRMATION EMAIL FAILED for ${application.applicationId}: ${emailErr.message}`);
    }

    try {
      const adminRecipients = emailService.getNotificationRecipients(application.email)
        .filter(recipient => recipient.toLowerCase() !== application.email.toLowerCase());
      await emailService.sendCustomerEmail({
        to: adminRecipients,
        subject: `New BMF Loan Application — ${application.applicationId}`,
        text: `A new student quick loan application is waiting.\n\nApplication ID: ${application.applicationId}\nApplicant: ${application.fullName}\nEmail: ${application.email}\nPhone: ${application.phone}\nNRC: ${application.nrcNumber}\nSchool: ${application.school}\nStudent ID: ${application.studentId}\nPurpose: ${application.purpose}\nAmount: ${money(application.amount)}\n\nReview it under Quick Screen in the admin panel.`
      });
    } catch (adminEmailErr) {
      logError(`APPLICATION ADMIN ALERT EMAIL FAILED: ${adminEmailErr.message}`);
    }

    return res.status(201).json({
      message: 'Application submitted successfully.',
      applicationId: application.id,
      status: 'pending'
    });
  } catch (err) {
    logBreakage('routes/apply.js', 'POST /api/apply', err, 'Loan application submission');
    return res.status(503).json({ error: 'Application temporarily unavailable.' });
  }
});

router.get('/mine', (req, res) => {
  try {
    if (!req.authUser) return res.status(401).json({ error: 'Authentication required.' });
    const apps = readApplications().filter(item => item.email === req.authUser.email || item.fullName === req.authUser.fullName);
    apps.sort((a, b) => new Date(b.createdAt) - new Date(a.createdAt));
    return res.json({ applications: apps, count: apps.length });
  } catch (err) {
    logError(`USER APPLICATIONS LIST FAILED: ${err.message}`);
    return res.status(503).json({ error: 'Unable to load your applications.' });
  }
});

router.get('/', (req, res) => {
  try {
    if (!isAdminRole(req.authUser?.role)) return res.status(403).json({ error: 'Admin access required.' });
    const apps = readApplications();
    const storeId = getRequestedStoreId(req);
    if (!canAccessStore(req, storeId)) return res.status(403).json({ error: 'Access to this store is not allowed.' });
    const scopedApps = apps.filter(application => storeId === 'all' || getRecordStoreId(application) === storeId);
    try {
      ensureApplicationNotifications(scopedApps);
    } catch (notificationErr) {
      logError(`APPLICATION NOTIFICATION SYNC FAILED: ${notificationErr.message}`);
      if (req.query.notificationsOnly === 'true') {
        return res.status(503).json({ error: 'Application notifications are temporarily unavailable.' });
      }
    }
    if (req.query.notificationsOnly === 'true') {
      return res.json({ pendingCount: scopedApps.filter(application => String(application.status || '').toLowerCase() === 'pending').length });
    }
    const list = req.query.status
      ? scopedApps.filter(item => String(item.status || '').toLowerCase() === String(req.query.status).toLowerCase())
      : scopedApps;
    list.sort((a, b) => new Date(b.createdAt) - new Date(a.createdAt));
    return res.json({ applications: list, count: list.length });
  } catch (err) {
    logError(`APPLICATIONS LIST FAILED: ${err.message}`);
    return res.status(503).json({ error: 'Unable to load applications.' });
  }
});

function ensureCustomer(application) {
  const users = dataStore.readJson(USERS_FILE, [], Array.isArray);
  const email = String(application.email || '').trim().toLowerCase();
  const byEmail = users.find(user => String(user.email || '').trim().toLowerCase() === email);
  if (byEmail) return { user: byEmail, created: false };
  const byNrc = users.find(user => String(user.nrc || '') === application.nrcNumber && user.nrc);
  if (byNrc) return { user: byNrc, created: false, nrcConflict: String(byNrc.email || '').toLowerCase() !== email };
  const id = users.reduce((max, user) => Math.max(max, Number(user.id) || 0), 0) + 1;
  const user = {
    id,
    username: application.fullName,
    email,
    phone: application.phone,
    nrc: application.nrcNumber,
    role: 'user',
    storeId: application.storeId || config.DEFAULT_STORE_ID,
    password: null,
    trustedDevices: [],
    school: application.school,
    studentId: application.studentId,
    createdAt: new Date().toISOString(),
    source: 'quick-loan'
  };
  users.push(user);
  dataStore.writeJson(USERS_FILE, users);
  return { user, created: true };
}

function createPendingLoan(application, email) {
  const loans = getLoansData();
  const nextId = loans.reduce((max, loan) => Math.max(max, Number(loan.id) || 0), 0) + 1;
  const receiptIds = new Set(loans.map(loan => String(loan.receiptNumber || '')).filter(Boolean));
  const createdAt = new Date().toISOString();
  const loan = {
    id: nextId,
    receiptNumber: generateLoanReceiptId(receiptIds, new Date()),
    email,
    storeId: application.storeId || config.DEFAULT_STORE_ID,
    product: application.product || 'Student Quick Loan',
    purpose: application.purpose || application.product,
    school: application.school || null,
    studentId: application.studentId || null,
    amount: Number(application.amount) || 0,
    tenureWeeks: application.tenureWeeks,
    interestRate: application.interestRate,
    interestAmount: application.interestAmount,
    totalRepayment: application.totalRepayment,
    outstanding: application.totalRepayment || application.amount,
    urgency: application.urgency || 'standard',
    nrcFront: application.nrcFront || null,
    nrcBack: application.nrcBack || null,
    studentIdPhoto: application.studentIdPhoto || null,
    collateralFront: application.collateralFront || null,
    collateralBack: application.collateralBack || null,
    agreedToTerms: true,
    status: 'pending',
    applicationId: application.applicationId,
    payments: [],
    statusHistory: [{
      status: 'pending',
      reason: 'Created from an approved Quick Screen application. Cash has not been disbursed.',
      actor: email,
      source: 'quick-loan',
      updatedAt: createdAt
    }],
    createdAt
  };
  loans.push(loan);
  saveLoansData(loans);
  return loan;
}

router.patch('/:id', async (req, res) => {
  try {
    if (!req.authUser || !['admin', 'store_admin', 'franchise_admin'].includes(req.authUser.role)) {
      return res.status(403).json({ error: 'Admin access required.' });
    }
    const { action, note } = req.body || {};
    if (!['approve', 'reject', 'request_info'].includes(action)) {
      return res.status(400).json({ error: 'Invalid action. Use approve, reject, or request_info.' });
    }
    if ((action === 'reject' || action === 'request_info') && !String(note || '').trim()) {
      return res.status(400).json({ error: 'A reason is required.' });
    }

    const apps = readApplications();
    const index = apps.findIndex(item => item.id === req.params.id || item.applicationId === req.params.id);
    if (index < 0) return res.status(404).json({ error: 'Application not found.' });
    const app = apps[index];
    if (!canAccessRecord(req, app)) return res.status(403).json({ error: 'Access to this application is not allowed.' });

    let loan = null;
    let invite = null;
    if (action === 'approve') {
      const customer = ensureCustomer(app);
      if (customer.nrcConflict) {
        return res.status(409).json({ error: 'This NRC is already on a different customer record. Review it before approving.' });
      }
      loan = createPendingLoan(app, customer.user.email);
      if (customer.created || !customer.user.password) {
        invite = issueSignupInvite(customer.user.email, req);
      }
    }

    app.status = action === 'approve' ? 'approved' : (action === 'reject' ? 'declined' : 'info_requested');
    app.reviewedAt = new Date().toISOString();
    app.reviewedBy = req.authUser.email;
    app.reviewNote = String(note || '').trim();
    app.updatedAt = new Date().toISOString();
    if (loan) app.loanId = loan.id;
    apps[index] = app;
    await writeApplications(apps);
    try { ensureApplicationNotifications(apps); } catch (notificationErr) {
      logError(`APPLICATION NOTIFICATION UPDATE FAILED for ${app.applicationId}: ${notificationErr.message}`);
    }

    const reason = app.reviewNote;
    try {
      if (action === 'approve') {
        await emailService.sendCustomerEmail({
          to: app.email,
          subject: `BMF Loan Application Approved — ${app.applicationId}`,
          text: `Good day ${app.fullName},\n\nYour application ${app.applicationId} has been approved and a pending loan has been opened. The borrowed date starts only when the cash is disbursed.\n\n${invite ? `Set your own password with this one-time invite:\n${invite.signupUrl}\n\n` : ''}Warm regards,\nThe BMF Team`
        });
      } else if (action === 'reject') {
        await emailService.sendCustomerEmail({
          to: app.email,
          subject: `BMF Loan Application Decision — ${app.applicationId}`,
          text: `Good day ${app.fullName},\n\nWe cannot approve application ${app.applicationId} at this time.\n\nReason: ${reason}\n\nWarm regards,\nThe BMF Team`
        });
      } else {
        await emailService.sendCustomerEmail({
          to: app.email,
          subject: `BMF Loan Application — Additional Information Needed — ${app.applicationId}`,
          text: `Good day ${app.fullName},\n\nWe need more information for application ${app.applicationId}.\n\nRequest: ${reason}\n\nWarm regards,\nThe BMF Team`
        });
      }
    } catch (emailErr) {
      logError(`APPLICATION DECISION EMAIL FAILED: ${emailErr.message}`);
    }

    const verb = action === 'approve' ? 'approved' : (action === 'reject' ? 'rejected' : 'updated');
    return res.json({ message: `Application ${verb} successfully.`, application: app, loanId: loan ? loan.id : null });
  } catch (err) {
    logBreakage('routes/apply.js', 'PATCH /api/apply/:id', err, 'Loan application review');
    return res.status(503).json({ error: 'Application review temporarily unavailable.' });
  }
});

module.exports = router;
