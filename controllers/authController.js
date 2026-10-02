const fs = require('fs');
const path = require('path');
const crypto = require('crypto');
const bcrypt = require('bcryptjs');
const { logError } = require('../middleware/logger');
const otpService = require('../middleware/otp');
const emailService = require('../middleware/email');
const config = require('../config');
const { getRecordStoreId, getRequestedStoreId, canAccessStore, isAdminRole } = require('../middleware/storeScope');

const USERS_FILE = path.join(__dirname, '../data/users.json');
const pendingSignups = {};
const pendingLogins = {};
const pendingResets = {};
const pendingInvites = {};
const INVITE_EXPIRY_MS = 24 * 60 * 60 * 1000;

function cleanupExpiredInvites() {
  const now = Date.now();
  Object.keys(pendingInvites).forEach((token) => {
    if (pendingInvites[token].expiresAt <= now) {
      delete pendingInvites[token];
    }
  });
}

function generateInviteToken(email) {
  const token = crypto.randomBytes(16).toString('hex');
  pendingInvites[token] = {
    email,
    createdAt: new Date().toISOString(),
    expiresAt: Date.now() + INVITE_EXPIRY_MS,
    used: false
  };
  return token;
}

function getInviteByToken(token) {
  if (!token) return null;
  cleanupExpiredInvites();
  const invite = pendingInvites[token];
  if (!invite || invite.used || invite.expiresAt <= Date.now()) {
    return null;
  }
  return invite;
}

function isStrongPassword(password) {
  return typeof password === 'string'
    && password.length >= 8
    && /[a-z]/.test(password)
    && /[A-Z]/.test(password)
    && /[0-9]/.test(password)
    && /[!@#$%^&*(),.?"{}|<>]/.test(password);
}

function passwordRequirementsText() {
  return 'Password must be at least 8 characters and include uppercase, lowercase, number, and special character.';
}

function normalizeTrustedDevices(user) {
  if (!user || typeof user !== 'object') {
    return user;
  }

  const devices = Array.isArray(user.trustedDevices) ? user.trustedDevices : [];
  const uniqueByToken = new Map();
  const uniqueByIp = new Map();

  devices.forEach((device) => {
    if (!device || typeof device !== 'object') {
      return;
    }

    const token = device.token;
    const ip = device.ip || 'unknown';

    if (token && !uniqueByToken.has(token)) {
      uniqueByToken.set(token, device);
    }

    if (ip !== 'unknown') {
      const existing = uniqueByIp.get(ip);
      if (!existing || new Date(device.lastSeen || device.createdAt || 0) > new Date(existing.lastSeen || existing.createdAt || 0)) {
        uniqueByIp.set(ip, device);
      }
    }
  });

  const deduped = [...new Map(
    [...uniqueByToken.values()].map((device) => [device.token || `${device.ip}-${device.createdAt || Date.now()}`, device])
  ).values()];

  const preferredDevices = deduped.filter((device) => {
    const ip = device.ip || 'unknown';
    return !uniqueByIp.has(ip) || uniqueByIp.get(ip).token === device.token;
  });

  const normalized = preferredDevices
    .sort((a, b) => new Date(b.lastSeen || b.createdAt || 0) - new Date(a.lastSeen || a.createdAt || 0))
    .slice(0, 5);

  user.trustedDevices = normalized;
  return user;
}

function getUsers() {
  try {
    const raw = fs.readFileSync(USERS_FILE, 'utf8').trim();
    if (!raw) {
      return [];
    }

    const parsed = JSON.parse(raw);
    if (!Array.isArray(parsed)) {
      throw new TypeError('User store root must be an array.');
    }

    let needsWrite = false;
    const normalized = parsed.map((user) => {
      const originalDevices = Array.isArray(user.trustedDevices) ? JSON.stringify(user.trustedDevices) : null;
      const normalizedUser = normalizeTrustedDevices({ ...user });
      const currentDevices = Array.isArray(normalizedUser.trustedDevices) ? JSON.stringify(normalizedUser.trustedDevices) : null;

      if (originalDevices !== currentDevices) {
        needsWrite = true;
      }

      return normalizedUser;
    });

    if (needsWrite) {
      saveUsers(normalized);
    }

    return normalized;
  } catch (err) {
    logError(`USER STORE RECOVERY: ${err.message}. Falling back to an empty list.`);
    try {
      fs.writeFileSync(USERS_FILE, JSON.stringify([], null, 2));
    } catch (writeErr) {
      logError(`USER STORE RECOVERY WRITE FAILED: ${writeErr.message}`);
    }
    return [];
  }
}

function saveUsers(users) {
  fs.writeFileSync(USERS_FILE, JSON.stringify(users, null, 2));
}

function generateUserTokens(userNumber) {
  const num = userNumber.toString().padStart(2, '0');
  return {
    laptop: `LAPTOP-Solojjktitazeckjomerali${num}`,
    phone: `PHONE-Alimercjoezectitjjksolo${num}`
  };
}

function generateDeviceToken() {
  return crypto.randomBytes(32).toString('hex');
}

function normalizePhoneNumber(phone) {
  if (phone === null || phone === undefined) {
    return '';
  }

  return String(phone).replace(/[\s().-]/g, '').trim();
}

function isValidWhatsAppNumber(phone) {
  const normalized = normalizePhoneNumber(phone);
  if (!normalized) return false;
  if (!/^\+?[0-9]+$/.test(normalized)) return false;

  const digits = normalized.replace(/^\+/, '');
  return digits.length >= 9 && digits.length <= 15;
}

async function requestSignup(req, res) {
  try {
    const { username, email, password, confirmPassword, phone, inviteToken } = req.body;

    if (!username || !email || !password || !confirmPassword) {
      return res.status(400).json({ error: 'All required fields must be filled.' });
    }

    if (!phone || !isValidWhatsAppNumber(phone)) {
      return res.status(400).json({ error: 'Please enter a valid WhatsApp phone number that can receive messages.' });
    }

    if (password !== confirmPassword) {
      return res.status(400).json({ error: 'Passwords do not match.' });
    }

    if (!isStrongPassword(password)) {
      return res.status(400).json({ error: passwordRequirementsText() });
    }

    const users = getUsers();
    const exists = users.find(u => u.email === email);
    if (exists) {
      return res.status(400).json({ error: 'Email already registered.' });
    }

    if (inviteToken) {
      const invite = getInviteByToken(inviteToken);
      if (!invite || invite.email !== email) {
        return res.status(400).json({ error: 'Invalid or expired signup token.' });
      }
    }

    const normalizedPhone = normalizePhoneNumber(phone);
    pendingSignups[email] = { username, email, password, phone: normalizedPhone, inviteToken };
    await otpService.sendOTP('Account Signup Verification', email, false);
    res.json({ message: 'OTP sent to your email. Please verify to complete signup.' });

  } catch (err) {
    logError(`SIGNUP CIRCUIT TRIPPED: ${err.message}`);
    res.status(503).json({ error: 'Signup is temporarily unavailable. Please try again shortly.' });
  }
}

async function confirmSignup(req, res) {
  try {
    const { email, otp } = req.body;
    const pending = pendingSignups[email];

    if (!pending) {
      return res.status(400).json({ error: 'No pending signup found for this email.' });
    }

    const result = otpService.verifyOTP(otp, email, 'Account Signup Verification');
    if (!result.valid) {
      return res.status(400).json({ error: result.message });
    }

    if (pending.inviteToken) {
      const invite = getInviteByToken(pending.inviteToken);
      if (!invite || invite.email !== email) {
        return res.status(400).json({ error: 'Invalid signup invitation token.' });
      }
      invite.used = true;
    }

    const users = getUsers();
    const hashedPassword = await bcrypt.hash(pending.password, 10);
    const userNumber = users.length + 1;
    const tokens = generateUserTokens(userNumber);

    const newUser = {
      id: userNumber,
      username: pending.username,
      email: pending.email,
      phone: pending.phone,
      password: hashedPassword,
      tokens,
      role: 'user',
      storeId: config.DEFAULT_STORE_ID,
      createdAt: new Date().toISOString()
    };

    users.push(newUser);
    saveUsers(users);
    delete pendingSignups[email];

    const welcome = emailService.buildWelcomeMessage(newUser.email, 'Pryme Vertex');
    await emailService.sendCustomerEmail({
      to: newUser.email,
      subject: welcome.subject,
      text: welcome.body
    });

    res.json({ message: 'Account created successfully.', username: newUser.username });

  } catch (err) {
    logError(`SIGNUP CONFIRM CIRCUIT TRIPPED: ${err.message}`);
    res.status(503).json({ error: 'Signup verification is temporarily unavailable. Please try again shortly.' });
  }
}

async function resendOTP(req, res) {
  try {
    const { email } = req.body;
    const pending = pendingSignups[email];

    if (!pending) {
      return res.status(400).json({ error: 'No pending signup found.' });
    }

    await otpService.sendOTP('Account Signup Verification', email, true);
    res.json({ message: `OTP resent to ${email}` });

  } catch (err) {
    logError(`RESEND OTP CIRCUIT TRIPPED: ${err.message}`);
    res.status(503).json({ error: 'Resend is temporarily unavailable. Please try again shortly.' });
  }
}

async function requestLogin(req, res) {
  try {
    const { email, password } = req.body;

    if (!email || !password) {
      return res.status(400).json({ error: 'Email and password required.' });
    }

    const users = getUsers();
    const user = users.find(u => u.email === email);

    if (!user) {
      return res.status(400).json({ error: 'Email not found.' });
    }

    const match = await bcrypt.compare(password, user.password);
    if (!match) {
      return res.status(400).json({ error: 'Incorrect password.' });
    }

    const isStaff = isAdminRole(user.role);
    const otpEmail = isStaff ? process.env.GMAIL_USER : user.email;
    if (!otpEmail) {
      return res.status(503).json({ error: 'The company OTP mailbox is not configured.' });
    }

    delete pendingLogins[email];
    await otpService.sendOTP('Login Verification', email, false, otpEmail);
    pendingLogins[email] = {
      email,
      otpEmail,
      username: user.username,
      role: user.role,
      storeId: user.storeId || config.DEFAULT_STORE_ID
    };
    res.json({
      message: 'OTP sent. Please verify to complete login.',
      otpSentTo: otpEmail,
      otpChannel: isStaff ? 'company' : 'account'
    });

  } catch (err) {
    logError(`LOGIN CIRCUIT TRIPPED: ${err.message}`);
    res.status(503).json({ error: 'Unable to send the login OTP. Check the configured company email credentials and try again.' });
  }
}

function getUserByDeviceToken(token) {
  if (!token) return null;
  const users = getUsers();
  return users.find(u => u.trustedDevices?.some(device => device.token === token));
}

async function confirmLogin(req, res) {
  try {
    const { email, otp } = req.body;
    const pending = pendingLogins[email];

    if (!pending) {
      return res.status(400).json({ error: 'No pending login found.' });
    }

    const result = otpService.verifyOTP(otp, email, 'Login Verification');
    if (!result.valid) {
      return res.status(400).json({ error: result.message });
    }

    const users = getUsers();
    const userIndex = users.findIndex(u => u.email === email);
    if (userIndex < 0) {
      return res.status(400).json({ error: 'Unable to locate your account.' });
    }

    const now = new Date().toISOString();
    users[userIndex].trustedDevices = users[userIndex].trustedDevices || [];

    const normalizedUser = normalizeTrustedDevices(users[userIndex]);
    const existingDevice = normalizedUser.trustedDevices.find(device => device.ip === req.ip);
    const deviceToken = existingDevice?.token || generateDeviceToken();

    if (existingDevice) {
      existingDevice.lastSeen = now;
      existingDevice.ip = req.ip;
      existingDevice.createdAt = existingDevice.createdAt || now;
    } else {
      normalizedUser.trustedDevices.push({
        token: deviceToken,
        createdAt: now,
        lastSeen: now,
        ip: req.ip
      });
    }

    normalizedUser.trustedDevices = normalizeTrustedDevices({ ...normalizedUser }).trustedDevices;
    users[userIndex] = normalizedUser;

    saveUsers(users);
    delete pendingLogins[email];

    res.json({
      message: 'Login successful.',
      username: pending.username,
      role: pending.role,
      storeId: pending.storeId,
      deviceToken
    });

  } catch (err) {
    logError(`LOGIN CONFIRM CIRCUIT TRIPPED: ${err.message}`);
    res.status(503).json({ error: 'Login verification is temporarily unavailable. Please try again shortly.' });
  }
}

async function requestPasswordReset(req, res) {
  try {
    const email = String(req.body?.email || '').trim().toLowerCase();
    if (!email) return res.status(400).json({ error: 'Email is required.' });

    const users = getUsers();
    const user = users.find(u => String(u.email || '').trim().toLowerCase() === email);

    if (!user) {
      return res.status(400).json({ error: 'Email not found.' });
    }

    if (req.body?.adminOnly && !isAdminRole(user.role)) {
      return res.status(400).json({ error: 'No admin account was found for that email.' });
    }

    const isStaff = isAdminRole(user.role);
    const otpEmail = isStaff ? process.env.GMAIL_USER : user.email;
    if (!otpEmail) {
      return res.status(503).json({ error: 'The company OTP mailbox is not configured.' });
    }

    await otpService.sendOTP('Password Reset', email, false, otpEmail);
    pendingResets[email] = {
      email,
      otpEmail,
      expiresAt: Date.now() + 5 * 60 * 1000
    };
    return res.json({
      message: 'OTP sent for password reset.',
      otpSentTo: otpEmail,
      otpChannel: isStaff ? 'company' : 'account'
    });

  } catch (err) {
    logError(`PASSWORD RESET CIRCUIT TRIPPED: ${err.message}`);
    return res.status(503).json({ error: 'Unable to send the password reset OTP. Please check the configured email service and try again.' });
  }
}

async function confirmPasswordReset(req, res) {
  try {
    const email = String(req.body?.email || '').trim().toLowerCase();
    const { otp, newPassword, confirmNewPassword } = req.body || {};
    const pending = pendingResets[email];

    if (!pending) {
      return res.status(400).json({ error: 'No pending reset request found.' });
    }

    if (pending.expiresAt <= Date.now()) {
      delete pendingResets[email];
      return res.status(400).json({ error: 'Password reset request expired. Request a new OTP.' });
    }

    if (newPassword !== confirmNewPassword) {
      return res.status(400).json({ error: 'Passwords do not match.' });
    }

    if (!isStrongPassword(newPassword)) {
      return res.status(400).json({ error: passwordRequirementsText() });
    }

    const users = getUsers();
    const userIndex = users.findIndex(user => String(user.email || '').trim().toLowerCase() === email);
    if (userIndex < 0) {
      delete pendingResets[email];
      return res.status(400).json({ error: 'Unable to locate your account.' });
    }

    const result = otpService.verifyOTP(otp, email, 'Password Reset');
    if (!result.valid) {
      return res.status(400).json({ error: result.message });
    }

    const hashedPassword = await bcrypt.hash(newPassword, 10);
    users[userIndex].password = hashedPassword;
    users[userIndex].trustedDevices = [];
    saveUsers(users);

    delete pendingResets[email];
    res.json({ message: 'Password reset successfully. You can now login.' });

  } catch (err) {
    logError(`PASSWORD RESET CONFIRM CIRCUIT TRIPPED: ${err.message}`);
    res.status(503).json({ error: 'Password reset verification is temporarily unavailable. Please try again shortly.' });
  }
}

async function createInvite(req, res) {
  try {
    const { email, secret } = req.body;
    const isAdmin = req.authUser?.role === 'admin';
    const hasSecret = secret && secret === process.env.INVITE_SECRET;

    if (!email || (!isAdmin && !hasSecret)) {
      return res.status(403).json({ error: 'Invite generation requires admin access or a valid invite secret.' });
    }

    const token = generateInviteToken(email);
    return res.json({ message: 'Invite generated.', inviteToken: token, signupUrl: `/signup.html?invite=${token}` });
  } catch (err) {
    logError(`INVITE GENERATION FAILED: ${err.message}`);
    res.status(500).json({ error: 'Unable to generate invite token.' });
  }
}

async function createAdminUser(req, res) {
  try {
    if (!isAdminRole(req.authUser?.role)) {
      return res.status(403).json({ error: 'Admin access required.' });
    }

    const { username, email, password, confirmPassword, phone, role } = req.body || {};

    if (!username || !email || !password || !confirmPassword) {
      return res.status(400).json({ error: 'Username, email, password, and confirmation are required.' });
    }

    if (password !== confirmPassword) {
      return res.status(400).json({ error: 'Passwords do not match.' });
    }

    if (!isStrongPassword(password)) {
      return res.status(400).json({ error: passwordRequirementsText() });
    }

    const users = getUsers();
    if (users.some(user => user.email.toLowerCase() === String(email).trim().toLowerCase())) {
      return res.status(400).json({ error: 'A user with that email already exists.' });
    }

    const normalizedPhone = normalizePhoneNumber(phone || '');
    const assignedRole = role === 'store_admin' && req.authUser.role === 'admin' ? 'store_admin' : 'user';
    const storeId = assignedRole === 'store_admin'
      ? config.DEFAULT_STORE_ID
      : req.authUser.role === 'store_admin'
        ? getRecordStoreId(req.authUser)
        : getRequestedStoreId(req);
    const nextId = users.length ? Math.max(...users.map(user => Number(user.id) || 0)) + 1 : 1;
    const hashedPassword = await bcrypt.hash(password, 10);
    const newUser = {
      id: nextId,
      username: String(username).trim(),
      email: String(email).trim().toLowerCase(),
      phone: normalizedPhone,
      password: hashedPassword,
      tokens: generateUserTokens(nextId),
      role: assignedRole,
      storeId,
      createdAt: new Date().toISOString(),
      trustedDevices: []
    };

    users.push(newUser);
    saveUsers(users);

    return res.status(201).json({
      message: 'User created successfully.',
      user: {
        id: newUser.id,
        username: newUser.username,
        email: newUser.email,
        role: newUser.role,
        storeId: newUser.storeId
      }
    });
  } catch (err) {
    logError(`ADMIN USER CREATION FAILED: ${err.message}`);
    return res.status(500).json({ error: 'Unable to create the user.' });
  }
}

function getAllUsers(req, res) {
  try {
    if (!isAdminRole(req.authUser?.role)) return res.status(403).json({ error: 'Admin access required.' });

    const storeId = getRequestedStoreId(req);
    if (!canAccessStore(req, storeId)) return res.status(403).json({ error: 'Access to this store is not allowed.' });

    const users = getUsers()
      .filter(user => storeId === 'all' || getRecordStoreId(user) === storeId)
      .map(u => {
      const { password, ...safeUser } = u; // Don't send passwords
      return safeUser;
    });
    res.json(users);
  } catch (err) {
    logError(`GET ALL USERS FAILED: ${err.message}`);
    res.status(500).json({ error: 'Unable to load users.' });
  }
}

async function sendAdminAnnouncement(req, res) {
  try {
    if (req.authUser?.role !== 'store_admin') {
      return res.status(403).json({ error: 'BMF store admin access required.' });
    }

    const storeId = getRequestedStoreId(req);
    if (!canAccessStore(req, storeId)) return res.status(403).json({ error: 'Access to this store is not allowed.' });

    const subject = String(req.body?.subject || '').trim();
    const message = String(req.body?.message || '').trim();
    if (!subject || !message || subject.length > 120 || message.length > 5000) {
      return res.status(400).json({ error: 'A subject (up to 120 characters) and message (up to 5000 characters) are required.' });
    }

    const recipients = [...new Set(getUsers()
      .filter(user => user.role !== 'admin' && user.role !== 'store_admin' && user.email &&
        (storeId === 'all' || getRecordStoreId(user) === storeId))
      .map(user => String(user.email).trim().toLowerCase())
      .filter(Boolean))];
    const results = await Promise.all(recipients.map(to => emailService.sendCustomerEmail({
      to,
      subject: `[Buraza Micro Finance (BMF)] ${subject}`,
      text: `Buraza Micro Finance (BMF), a Pryme Vertex subsidiary, shares this update:\n\n${message}\n\nRegards,\nBuraza Micro Finance (BMF)`
    })));
    const sent = results.filter(result => result?.ok).length;
    const failed = results.length - sent;

    return res.status(failed ? 207 : 200).json({
      message: `Announcement sent to ${sent} customer${sent === 1 ? '' : 's'}${failed ? `; ${failed} failed` : ''}.`,
      sent,
      failed,
      total: recipients.length
    });
  } catch (err) {
    logError(`ADMIN ANNOUNCEMENT FAILED: ${err.message}`);
    return res.status(500).json({ error: 'Unable to send the announcement.' });
  }
}

function validateInvite(req, res) {

  try {
    const token = req.params.token || req.body.token;
    const invite = getInviteByToken(token);
    if (!invite) {
      return res.status(400).json({ error: 'Invalid or expired signup token.' });
    }
    res.json({ valid: true, email: invite.email, expiresAt: invite.expiresAt });
  } catch (err) {
    logError(`INVITE VALIDATION FAILED: ${err.message}`);
    res.status(500).json({ error: 'Unable to validate invite token.' });
  }
}

module.exports = { requestSignup, confirmSignup, resendOTP, requestLogin, confirmLogin, requestPasswordReset, confirmPasswordReset, createInvite, createAdminUser, validateInvite, getAllUsers, sendAdminAnnouncement };