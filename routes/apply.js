const express = require('express');
const router = express.Router();
const path = require('path');
const fs = require('fs');
const crypto = require('crypto');
const { logError, logBreakage } = require('../middleware/logger');
const emailService = require('../middleware/email');
const config = require('../config');
const dataStore = require('../middleware/dataStore');
const { getRecordStoreId, getRequestedStoreId, canAccessStore, canAccessRecord, isAdminRole } = require('../middleware/storeScope');
const { upload } = require('../controllers/loanController');

const APPLICATIONS_FILE = dataStore.paths.applications || path.join(dataStore.DATA_DIR, 'applications.json');
const NOTIFICATIONS_FILE = dataStore.paths.notifications;
const USERS_FILE = dataStore.paths.users;

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
    logError(`APPLICATIONS READ FAILED: ${err.message}`);
    return [];
  }
}

function writeApplications(apps) {
  return dataStore.writeJson(APPLICATIONS_FILE, apps);
}

function generateApplicationId() {
  const now = new Date();
  const yyyymmdd = now.toISOString().slice(0, 10).replace(/-/g, '');
  const random = Math.floor(1000 + Math.random() * 9000);
  return `QS-${yyyymmdd}-${random}`;
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

router.post('/', upload.fields([
  { name: 'nrcFront', maxCount: 1 },
  { name: 'nrcBack', maxCount: 1 },
  { name: 'collateralFront', maxCount: 1 },
  { name: 'collateralBack', maxCount: 1 }
]), async (req, res) => {
  try {
    ensureApplicationsFile();

    const {
      fullName, email, phone, nrcNumber,
      product, amount, tenureWeeks, dueDate, urgency, agreedToTerms
    } = req.body || {};

    if (!fullName || !email || !phone || !nrcNumber || !product || !amount) {
      return res.status(400).json({ error: 'All required fields must be filled.' });
    }

    const nrcRegex = /^\d{6}\/\d{2}\/\d$/;
    if (!nrcRegex.test(nrcNumber)) {
      return res.status(400).json({ error: 'NRC must look like 123456/78/1.' });
    }

    const phoneRegex = /^(\+?260|0)(?:(?:9[5-7]|7[6-7]|57)\d{7}|26\d{7})$/;
    if (!phoneRegex.test(phone)) {
      return res.status(400).json({ error: 'Invalid Zambian mobile number.' });
    }

    const tenure = tenureWeeks || (dueDate ? Math.ceil((new Date(dueDate) - new Date()) / (1000 * 60 * 60 * 24 * 7)) : 1);
    const clampedTenure = Math.max(1, Math.min(4, tenure));

    const apps = readApplications();
    const applicationId = generateApplicationId();

    const nrcFrontFile = req.files && req.files.nrcFront ? req.files.nrcFront[0] : null;
    const nrcBackFile = req.files && req.files.nrcBack ? req.files.nrcBack[0] : null;
    const collateralFrontFile = req.files && req.files.collateralFront ? req.files.collateralFront[0] : null;
    const collateralBackFile = req.files && req.files.collateralBack ? req.files.collateralBack[0] : null;

    const application = {
      id: applicationId,
      applicationId,
      fullName,
      email,
      phone,
      nrcNumber,
      product,
      amount: Number(amount),
      tenureWeeks: clampedTenure,
      urgency: urgency || 'standard',
      agreedToTerms: agreedToTerms === 'true' || agreedToTerms === true,
      status: 'pending',
      storeId: config.DEFAULT_STORE_ID,
      createdAt: new Date().toISOString(),
      updatedAt: new Date().toISOString(),
      nrcFront: nrcFrontFile ? nrcFrontFile.filename : null,
      nrcBack: nrcBackFile ? nrcBackFile.filename : null,
      collateralFront: collateralFrontFile ? collateralFrontFile.filename : null,
      collateralBack: collateralBackFile ? collateralBackFile.filename : null
    };

    apps.push(application);
    await writeApplications(apps);
    try {
      ensureApplicationNotifications(apps);
    } catch (notificationErr) {
      logError(`APPLICATION NOTIFICATION CREATE FAILED for ${application.applicationId}: ${notificationErr.message}`);
    }

    const weeklyRates = { 1: 0.10, 2: 0.16, 3: 0.24, 4: 0.32 };
    const rate = weeklyRates[application.tenureWeeks] ?? 0.10;
    const interest = application.amount * rate;
    const totalRepayment = application.amount + interest;

    const applicantEmail = {
      to: application.email,
      subject: `BMF Loan Application Received — ${application.applicationId}`,
      text: `Good day ${application.fullName},\n\nThank you for applying for a BMF loan. Your application has been received and is under review.\n\nApplication reference: ${application.applicationId}\nProduct: ${application.product}\nRequested amount: K ${application.amount.toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}\nTenure: ${application.tenureWeeks} week${application.tenureWeeks === 1 ? '' : 's'}\nUrgency: ${application.urgency}\nEstimated interest: K ${interest.toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}\nTotal repayment: K ${totalRepayment.toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}\n\nA BMF loan officer will review your application and contact you shortly.\n\nWarm regards,\nThe BMF Team`
    };
    try {
      const applicantDelivery = await emailService.sendCustomerEmail(applicantEmail);
      if (!applicantDelivery.ok) {
        logError(`APPLICATION CONFIRMATION EMAIL ${applicantDelivery.skipped ? 'SKIPPED' : 'FAILED'} for ${application.applicationId}: ${applicantDelivery.reason || 'delivery failed'}`);
      }
    } catch (emailErr) {
      logError(`APPLICATION CONFIRMATION EMAIL FAILED for ${application.applicationId}: ${emailErr.message}`);
    }

    try {
      const adminRecipients = emailService.getNotificationRecipients(application.email)
        .filter(recipient => recipient.toLowerCase() !== application.email.toLowerCase());
      const adminDelivery = await emailService.sendCustomerEmail({
        to: adminRecipients,
        subject: `New BMF Loan Application — ${application.applicationId}`,
        text: `A new loan application has been submitted and awaits review.\n\nApplication ID: ${application.applicationId}\nApplicant: ${application.fullName}\nEmail: ${application.email}\nPhone: ${application.phone}\nNRC: ${application.nrcNumber}\nPurpose: ${application.product}\nAmount: K ${application.amount.toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}\nTenure: ${application.tenureWeeks} week${application.tenureWeeks === 1 ? '' : 's'}\nUrgency: ${application.urgency}\nSubmitted: ${new Date().toISOString()}\n\nReview this application in the BMF Admin panel under Applications.\n\n— BMF System`
      });
      if (!adminDelivery.ok) {
        logError(`APPLICATION ADMIN EMAIL ${adminDelivery.skipped ? 'SKIPPED' : 'FAILED'} for ${application.applicationId}: ${adminDelivery.reason || 'delivery failed'}`);
      }
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
    if (!req.authUser) {
      return res.status(401).json({ error: 'Authentication required.' });
    }

    const apps = readApplications();
    const userApps = apps.filter(a => a.email === req.authUser.email || a.fullName === req.authUser.fullName);
    userApps.sort((a, b) => new Date(b.createdAt) - new Date(a.createdAt));

    return res.json({ applications: userApps, count: userApps.length });
  } catch (err) {
    logError(`USER APPLICATIONS LIST FAILED: ${err.message}`);
    return res.status(503).json({ error: 'Unable to load your applications.' });
  }
});

router.get('/', (req, res) => {
  try {
    if (!isAdminRole(req.authUser?.role)) {
      return res.status(403).json({ error: 'Admin access required.' });
    }

    const apps = readApplications();
    const storeId = getRequestedStoreId(req);
    if (!canAccessStore(req, storeId)) {
      return res.status(403).json({ error: 'Access to this store is not allowed.' });
    }
    const scopedApps = apps.filter(application =>
      storeId === 'all' || getRecordStoreId(application) === storeId
    );
    try {
      ensureApplicationNotifications(scopedApps);
    } catch (notificationErr) {
      logError(`APPLICATION NOTIFICATION SYNC FAILED: ${notificationErr.message}`);
      if (req.query.notificationsOnly === 'true') {
        return res.status(503).json({ error: 'Application notifications are temporarily unavailable.' });
      }
    }
    if (req.query.notificationsOnly === 'true') {
      return res.json({
        pendingCount: scopedApps.filter(application => String(application.status || '').toLowerCase() === 'pending').length
      });
    }
    // Support callers that need the full pending-application list.
    if (req.query.status) {
      const filtered = scopedApps.filter(a => String(a.status || '').toLowerCase() === String(req.query.status).toLowerCase());
      filtered.sort((a, b) => new Date(b.createdAt) - new Date(a.createdAt));
      return res.json({ applications: filtered, count: filtered.length });
    }
    scopedApps.sort((a, b) => new Date(b.createdAt) - new Date(a.createdAt));
    return res.json({ applications: scopedApps, count: scopedApps.length });
  } catch (err) {
    logError(`APPLICATIONS LIST FAILED: ${err.message}`);
    return res.status(503).json({ error: 'Unable to load applications.' });
  }
});

router.patch('/:id', async (req, res) => {
  try {
    if (!req.authUser || (req.authUser.role !== 'admin' && req.authUser.role !== 'store_admin' && req.authUser.role !== 'franchise_admin')) {
      return res.status(403).json({ error: 'Admin access required.' });
    }

    const { id } = req.params;
    const { action, note } = req.body || {};

    if (!['approve', 'reject', 'request_info'].includes(action)) {
      return res.status(400).json({ error: 'Invalid action. Use approve, reject, or request_info.' });
    }

    const apps = readApplications();
    const index = apps.findIndex(a => a.id === id || a.applicationId === id);
    if (index < 0) {
      return res.status(404).json({ error: 'Application not found.' });
    }

    const app = apps[index];
    if (!canAccessRecord(req, app)) {
      return res.status(403).json({ error: 'Access to this application is not allowed.' });
    }
    app.status = action === 'approve' ? 'approved' : (action === 'reject' ? 'declined' : 'info_requested');
    app.reviewedAt = new Date().toISOString();
    app.reviewedBy = req.authUser.email;
    app.reviewNote = note || '';
    app.updatedAt = new Date().toISOString();

    apps[index] = app;
    await writeApplications(apps);
    try {
      ensureApplicationNotifications(apps);
    } catch (notificationErr) {
      logError(`APPLICATION NOTIFICATION UPDATE FAILED for ${app.applicationId}: ${notificationErr.message}`);
    }

    if (action === 'approve') {
      try {
        await sendCustomerEmail({
          to: app.email,
          subject: `BMF Loan Application Approved — ${app.applicationId}`,
          text: `Good day ${app.fullName},\n\nWe are pleased to inform you that your BMF loan application has been approved.\n\nApplication reference: ${app.applicationId}\nApproved amount: K ${app.amount.toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}\nTenure: ${app.tenureWeeks} week${app.tenureWeeks === 1 ? '' : 's'}\n\nPlease log in to your BMF account to complete the next steps.\n\nWarm regards,\nThe BMF Team`
        }).catch(() => {});
      } catch (e) {
        logError(`APPLICATION APPROVAL EMAIL FAILED: ${e.message}`);
      }
    } else if (action === 'reject') {
      try {
        await sendCustomerEmail({
          to: app.email,
          subject: `BMF Loan Application Decision — ${app.applicationId}`,
          text: `Good day ${app.fullName},\n\nThank you for your BMF loan application. After review, we are unable to approve your application at this time.\n\nApplication reference: ${app.applicationId}\nReason: ${note || 'No reason provided.'}\n\nYou are welcome to reapply in the future.\n\nWarm regards,\nThe BMF Team`
        }).catch(() => {});
      } catch (e) {
        logError(`APPLICATION REJECTION EMAIL FAILED: ${e.message}`);
      }
    } else if (action === 'request_info') {
      try {
        await sendCustomerEmail({
          to: app.email,
          subject: `BMF Loan Application — Additional Information Needed — ${app.applicationId}`,
          text: `Good day ${app.fullName},\n\nThank you for your BMF loan application. To continue processing, we need additional information.\n\nApplication reference: ${app.applicationId}\nRequest: ${note || 'Please contact a BMF loan officer for details.'}\n\nPlease reply with the requested information so we can proceed.\n\nWarm regards,\nThe BMF Team`
        }).catch(() => {});
      } catch (e) {
        logError(`APPLICATION INFO REQUEST EMAIL FAILED: ${e.message}`);
      }
    }

    return res.json({
      message: `Application ${action}d successfully.`,
      application: app
    });
  } catch (err) {
    logBreakage('routes/apply.js', 'PATCH /api/apply/:id', err, 'Loan application review');
    return res.status(503).json({ error: 'Application review temporarily unavailable.' });
  }
});

module.exports = router;