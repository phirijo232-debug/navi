const fs = require('fs');
const path = require('path');
const crypto = require('crypto');
const bcrypt = require('bcryptjs');
const { logError, logHr, logBreakage } = require('../middleware/logger');
const dataStore = require('../middleware/dataStore');
const otpService = require('../middleware/otp');
const emailService = require('../middleware/email');
const config = require('../config');
const { normalizeZambianPhone, isValidZambianMobile } = require('../middleware/phoneNumber');
const { getRecordStoreId, getRequestedStoreId, canAccessStore, isAdminRole, isFranchiseAdmin } = require('../middleware/storeScope');

const NRC_PATTERN = /^\d{6}\/\d{2}\/\d$/;

function isValidNrc(value) {
  if (value === null || value === undefined || value === '') return true;
  return NRC_PATTERN.test(String(value).trim());
}

// Decide which role a newly-created account actually receives, so nobody can
// elevate beyond their own level:
//   - main admin (admin)            → may create franchise_admin, store_admin, user
//   - franchise_admin               → may create store_admin, user
//   - store_admin (restricted)      → may only create customer (user)
function resolveAssignedRole(requestedRole, actorRole) {
  if (requestedRole === 'franchise_admin') {
    return actorRole === 'admin' ? 'franchise_admin' : 'user';
  }
  if (requestedRole === 'store_admin') {
    return actorRole === 'admin' || actorRole === 'franchise_admin' ? 'store_admin' : 'user';
  }
  return 'user';
}

function normalizeEmail(value) {
  return String(value || '').trim().toLowerCase();
}

const USERS_FILE = dataStore.paths.users;
const pendingSignups = {};
const pendingLogins = {};
const pendingResets = {};
// KIDNEYS: pending-auth entries older than this are dead weight (OTP windows
// are 5 minutes) — the hourly sweep drops them so the maps never grow forever.
const PENDING_AUTH_TTL_MS = 15 * 60 * 1000;
// Invites are persisted to data/invites.json so a server restart can never
// silently invalidate a link already shared with a customer. Reads/writes go
// through dataStore (atomic write + .bak recovery) — dataStore.js untouched.
const INVITES_FILE = path.join(dataStore.DATA_DIR, 'invites.json');
const INVITE_EXPIRY_MS = 24 * 60 * 60 * 1000;

function loadInvites() {
  return dataStore.readJson(INVITES_FILE, {}, (v) => v && typeof v === 'object' && !Array.isArray(v));
}

function saveInvites(invites) {
  dataStore.writeJson(INVITES_FILE, invites);
}

function cleanupExpiredInvites() {
  const invites = loadInvites();
  const now = Date.now();
  let removed = 0;
  Object.keys(invites).forEach((token) => {
    if (invites[token].expiresAt <= now) {
      delete invites[token];
      removed++;
    }
  });
  if (removed > 0) saveInvites(invites);
  return removed;
}

// ─── KIDNEYS: sweep dead pending-auth state ─────────────────────────────────
// Drops pending signups/logins/resets older than PENDING_AUTH_TTL_MS (their
// OTPs expire in 5 minutes anyway) and prunes trusted device tokens that have
// not been seen for DEVICE_TOKEN_TTL_MS. Returns counts only — never any
// email/token material — so the log line can never leak user data.
const DEVICE_TOKEN_TTL_MS = 90 * 24 * 60 * 60 * 1000;

function sweepExpiredAuth(now = Date.now()) {
  const cutoff = now - PENDING_AUTH_TTL_MS;
  const deviceCutoff = now - DEVICE_TOKEN_TTL_MS;
  let deadSignups = 0;
  let deadLogins = 0;
  let deadResets = 0;

  for (const [email, entry] of Object.entries(pendingSignups)) {
    if (!(entry.createdAt > cutoff)) { delete pendingSignups[email]; deadSignups++; }
  }
  for (const [email, entry] of Object.entries(pendingLogins)) {
    if (!(entry.createdAt > cutoff)) { delete pendingLogins[email]; deadLogins++; }
  }
  for (const [email, entry] of Object.entries(pendingResets)) {
    if (!(entry.expiresAt > now) || !(entry.createdAt > cutoff)) { delete pendingResets[email]; deadResets++; }
  }

  let staleDevices = 0;
  try {
    const users = getUsers();
    let changed = false;
    for (const user of users) {
      if (!Array.isArray(user.trustedDevices) || !user.trustedDevices.length) continue;
      const before = user.trustedDevices.length;
      user.trustedDevices = user.trustedDevices.filter((device) => {
        const lastSeen = Date.parse(device?.lastSeen || device?.createdAt || '');
        // Never prune a device with no readable timestamp (defensive) — only
        // clearly stale ones with a parseable lastSeen/createdAt past 90 days.
        return !(Number.isFinite(lastSeen) && lastSeen < deviceCutoff);
      });
      if (user.trustedDevices.length !== before) {
        staleDevices += before - user.trustedDevices.length;
        changed = true;
      }
    }
    if (changed) saveUsers(users);
  } catch {
    // Device pruning is best-effort; pending-auth sweep already succeeded.
  }

  return { deadSignups, deadLogins, deadResets, staleDevices };
}

function generateInviteToken(email) {
  const invites = loadInvites();
  const token = crypto.randomBytes(16).toString('hex');
  invites[token] = {
    email,
    createdAt: new Date().toISOString(),
    expiresAt: Date.now() + INVITE_EXPIRY_MS,
    used: false
  };
  saveInvites(invites);
  return token;
}

function getInviteByToken(token) {
  if (!token) return null;
  const invites = loadInvites();
  const invite = invites[String(token).trim()];
  if (!invite || invite.used || invite.expiresAt <= Date.now()) {
    return null;
  }
  return invite;
}

function markInviteUsed(token) {
  const invites = loadInvites();
  const key = String(token).trim();
  if (invites[key]) {
    invites[key].used = true;
    saveInvites(invites);
  }
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
  const parsed = dataStore.readJson(USERS_FILE, [], Array.isArray);

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
}

function saveUsers(users) {
  dataStore.writeJson(USERS_FILE, users);
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
  const normalized = normalizeZambianPhone(phone);
  if (normalized) return normalized;
  if (phone === null || phone === undefined) return '';
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
    const { username, email, password, confirmPassword, phone, nrc, inviteToken } = req.body;

    if (!username || !email || !password || !confirmPassword) {
      return res.status(400).json({ error: 'All required fields must be filled.' });
    }

    // Phone is MANDATORY (Task 6): Zambia-only mobile numbers in
    // 09XXXXXXXX or +2609XXXXXXXX form (Airtel/MTN/Zamtel ranges).
    if (!isValidZambianMobile(phone)) {
      return res.status(400).json({ error: 'Please enter a valid Zambian mobile number (e.g. 0977123456)' });
    }
    const normalizedPhone = normalizeZambianPhone(phone);

    if (!nrc || !isValidNrc(nrc)) {
      return res.status(400).json({ error: 'NRC/ID number is required and must look like 123456/78/1.' });
    }

    if (password !== confirmPassword) {
      return res.status(400).json({ error: 'Passwords do not match.' });
    }

    if (!isStrongPassword(password)) {
      return res.status(400).json({ error: passwordRequirementsText() });
    }

    // Invite enforcement: signup is closed to the public. A customer may only
    // register through an admin-generated link bound to their exact email.
    // Checked BEFORE the email-exists probe so an uninvited caller cannot
    // enumerate which emails are already registered.
    if (!inviteToken) {
      return res.status(400).json({ error: 'Signup requires an invitation. Ask the administrator for your invite link.' });
    }
    const invite = getInviteByToken(inviteToken);
    if (!invite || normalizeEmail(invite.email) !== normalizeEmail(email)) {
      return res.status(400).json({ error: 'Invalid or expired signup token.' });
    }

    const users = getUsers();
    const exists = users.find(u => u.email === email);
    if (exists) {
      return res.status(400).json({ error: 'Email already registered.' });
    }

    pendingSignups[email] = { username, email, password, phone: normalizedPhone, nrc: nrc ? String(nrc).trim() : null, inviteToken, createdAt: Date.now() };
    await otpService.sendOTP('Account Signup Verification', email, false);
    res.json({ message: 'OTP sent to your email. Please verify to complete signup.' });

  } catch (err) {
    logBreakage('authController.js', 'requestSignup', err, 'SIGNUP CIRCUIT TRIPPED');
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

    const invite = getInviteByToken(pending.inviteToken);
    if (!invite || normalizeEmail(invite.email) !== normalizeEmail(email)) {
      return res.status(400).json({ error: 'Invalid signup invitation token.' });
    }
    markInviteUsed(pending.inviteToken);

    const users = getUsers();
    const hashedPassword = await bcrypt.hash(pending.password, 10);
    const userNumber = users.length + 1;
    const tokens = generateUserTokens(userNumber);

    const newUser = {
      id: userNumber,
      username: pending.username,
      email: pending.email,
      phone: pending.phone,
      nrc: pending.nrc || null,
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
    logBreakage('authController.js', 'confirmSignup', err, 'SIGNUP CONFIRM CIRCUIT TRIPPED');
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
    logBreakage('authController.js', 'resendOTP', err, 'RESEND OTP CIRCUIT TRIPPED');
    res.status(503).json({ error: 'Resend is temporarily unavailable. Please try again shortly.' });
  }
}

// Classify mail-send failures so the client sees an honest message instead of
// one generic "check credentials" line: Gmail auth rejections point at the app
// password, DNS/network faults say the mail server is unreachable, and missing
// env says email is not configured.
function classifyMailError(err, action = 'send the OTP') {
  const message = String(err?.message || err || '');
  const authRejected = /535|5\.7\.8|invalid login|username and password not accepted|authentication failed/i.test(message);
  const unreachable = /ENOTFOUND|EAI_AGAIN|ETIMEDOUT|ESOCKETTIMEDOUT|ECONNREFUSED|EHOSTUNREACH|ENETUNREACH|ENETDOWN|socket hang up|timed out|timeout/i.test(message);
  const notConfigured = /configuration is incomplete|credentials are not configured|missing email recipients/i.test(message);
  if (authRejected) {
    return { status: 503, error: `Unable to ${action}. The company mailbox rejected our credentials — an admin needs to check the email app password.` };
  }
  if (unreachable) {
    return { status: 503, error: `Unable to ${action}. The mail server is unreachable right now — please try again shortly.` };
  }
  if (notConfigured) {
    return { status: 503, error: `Unable to ${action}. Outgoing email is not configured on the server.` };
  }
  return { status: 503, error: `Unable to ${action}. Please try again shortly.` };
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
      return res.status(400).json({ error: 'Invalid email or password.' });
    }

    const match = await bcrypt.compare(password, user.password);
    if (!match) {
      return res.status(400).json({ error: 'Invalid email or password.' });
    }

    const otpEmail = String(user.email || '').trim();
    if (!otpEmail) {
      return res.status(503).json({ error: 'This account does not have a registered email address.' });
    }

    delete pendingLogins[email];
    await otpService.sendOTP('Login Verification', email, false, otpEmail);
    pendingLogins[email] = {
      email,
      otpEmail,
      username: user.username,
      role: user.role,
      storeId: user.storeId || config.DEFAULT_STORE_ID,
      createdAt: Date.now()
    };
    res.json({
      message: 'OTP sent. Please verify to complete login.',
      otpSentTo: otpEmail,
      otpChannel: 'account'
    });

  } catch (err) {
    const { status, error } = classifyMailError(err, 'send the login OTP');
    logBreakage('authController.js', 'requestLogin', err, 'LOGIN CIRCUIT TRIPPED');
    res.status(status).json({ error });
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
    logBreakage('authController.js', 'confirmLogin', err, 'LOGIN CONFIRM CIRCUIT TRIPPED');
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

    const otpEmail = String(user.email || '').trim();
    if (!otpEmail) {
      return res.status(503).json({ error: 'This account does not have a registered email address.' });
    }

    await otpService.sendOTP('Password Reset', email, false, otpEmail);
    pendingResets[email] = {
      email,
      otpEmail,
      expiresAt: Date.now() + 5 * 60 * 1000,
      createdAt: Date.now()
    };
    return res.json({
      message: 'OTP sent for password reset.',
      otpSentTo: otpEmail,
      otpChannel: 'account'
    });

  } catch (err) {
    const { status, error } = classifyMailError(err, 'send the password reset OTP');
    logBreakage('authController.js', 'requestPasswordReset', err, 'PASSWORD RESET CIRCUIT TRIPPED');
    return res.status(status).json({ error });
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
    logBreakage('authController.js', 'confirmPasswordReset', err, 'PASSWORD RESET CONFIRM CIRCUIT TRIPPED');
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
    logBreakage('authController.js', 'createInvite', err, 'INVITE GENERATION FAILED');
    res.status(500).json({ error: 'Unable to generate invite token.' });
  }
}

async function createAdminUser(req, res) {
  try {
    if (!isAdminRole(req.authUser?.role)) {
      return res.status(403).json({ error: 'Admin access required.' });
    }

    const { username, email, password, confirmPassword, phone, role, nrc } = req.body || {};

    if (!username || !email || !password || !confirmPassword) {
      return res.status(400).json({ error: 'Username, email, password, and confirmation are required.' });
    }

    if (!nrc || !isValidNrc(nrc)) {
      return res.status(400).json({ error: 'NRC/ID number is required and must look like 123456/78/1.' });
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
    const assignedRole = resolveAssignedRole(role, req.authUser.role);
    let storeId;
    if (assignedRole === 'store_admin' || assignedRole === 'franchise_admin') {
      storeId = req.authUser.role === 'admin'
        ? getRequestedStoreId(req)
        : getRecordStoreId(req.authUser);
    } else if (req.authUser.role === 'store_admin') {
      storeId = getRecordStoreId(req.authUser);
    } else {
      storeId = getRequestedStoreId(req);
    }
    const nextId = users.length ? Math.max(...users.map(user => Number(user.id) || 0)) + 1 : 1;
    const hashedPassword = await bcrypt.hash(password, 10);
    const newUser = {
      id: nextId,
      username: String(username).trim(),
      email: String(email).trim().toLowerCase(),
      phone: normalizedPhone,
      nrc: String(nrc).trim(),
      password: hashedPassword,
      tokens: generateUserTokens(nextId),
      role: assignedRole,
      storeId,
      restrictions: [],
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
    logBreakage('authController.js', 'createAdminUser', err, 'ADMIN USER CREATION FAILED');
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
      // SECURITY: strip ALL credential material — password (hash), tokens
      // (legacy blind credentials), and trustedDevices (LIVE device tokens that
      // would let anyone reading /users impersonate the user). Keep only a safe
      // summary (device count + last-seen) for the admin customer directory.
      const { password, tokens, trustedDevices, ...rest } = u;
      if (trustedDevices && Array.isArray(trustedDevices) && trustedDevices.length) {
        rest._trustedDeviceCount = trustedDevices.length;
        rest._trustedDeviceLastSeen = trustedDevices.map(d => d.lastSeen || d.createdAt).sort().pop();
      }
      return rest;
    });
    res.json(users);
  } catch (err) {
    logError(`GET ALL USERS FAILED: ${err.message}`);
    res.status(500).json({ error: 'Unable to load users.' });
  }
}

async function sendAdminAnnouncement(req, res) {
  try {
    const role = req.authUser?.role;
    // Tested franchise policy (test/notificationFlow.test.js): only the BMF
    // store-operator level may broadcast — role 'admin' is refused with 403.
    if (role !== 'store_admin' && role !== 'franchise_admin') {
      return res.status(403).json({ error: 'BMF store admin access required.' });
    }
    if (isRestricted(req.authUser, 'notifyAll')) {
      return res.status(403).json({ error: 'You are not permitted to send notifications to all customers. Ask the franchise admin to lift this restriction.' });
    }

    const storeId = getRequestedStoreId(req);
    if (!canAccessStore(req, storeId)) return res.status(403).json({ error: 'Access to this store is not allowed.' });

    const subject = String(req.body?.subject || '').trim();
    const message = String(req.body?.message || '').trim();
    if (!subject || !message || subject.length > 120 || message.length > 5000) {
      return res.status(400).json({ error: 'A subject (up to 120 characters) and message (up to 5000 characters) are required.' });
    }

    const recipients = [...new Set(getUsers()
      .filter(user => !['admin', 'franchise_admin', 'store_admin'].includes(user.role) && user.email &&
        (storeId === 'all' || getRecordStoreId(user) === storeId))
      .map(user => String(user.email).trim().toLowerCase())
      .filter(Boolean))];
    const results = await Promise.all(recipients.map(to => emailService.sendCustomerEmail({
      to,
      subject: `[Buraza Micro Finance (BMF)] ${subject}`,
      text: `Dear valued BMF customer,\n\n${message}\n\nRegards,\nBuraza Micro Finance (BMF)`
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
    logBreakage('authController.js', 'sendAdminAnnouncement', err, 'ADMIN ANNOUNCEMENT FAILED');
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

function listInvites(req, res) {
  try {
    if (!isAdminRole(req.authUser?.role)) return res.status(403).json({ error: 'Admin access required.' });

    cleanupExpiredInvites();
    const invites = Object.entries(loadInvites())
      .map(([token, invite]) => ({
        token,
        email: invite.email,
        createdAt: invite.createdAt,
        expiresAt: new Date(invite.expiresAt).toISOString(),
        used: Boolean(invite.used),
        signupUrl: `/signup.html?invite=${token}`
      }))
      .sort((a, b) => String(b.createdAt).localeCompare(String(a.createdAt)));

    res.json({ invites });
  } catch (err) {
    logError(`INVITE LIST FAILED: ${err.message}`);
    res.status(500).json({ error: 'Unable to load invites.' });
  }
}

// ─── HR / Employee Securities ────────────────────────────────────────────────
// Only the main admin (admin) and the Franchise Employee Admin (franchise_admin)
// may manage employees. The restricted store_admin is refused with a clear
// message. Every mutation is written to the HR audit log with the acting admin.

const RESTRICTABLE_ACTIONS = ['notifyAll'];

function isRestricted(user, key) {
  return Array.isArray(user?.restrictions) && user.restrictions.includes(key);
}

function findStoreAuthority(storeId) {
  const users = getUsers();
  const franchise = users.find(u => u.role === 'franchise_admin' && getRecordStoreId(u) === storeId);
  if (franchise) return franchise;
  return users.find(u => u.role === 'admin') || null;
}

function publicEmployee(user) {
  return {
    id: user.id,
    username: user.username,
    email: user.email,
    phone: user.phone,
    nrc: user.nrc || null,
    role: user.role,
    storeId: getRecordStoreId(user),
    restrictions: Array.isArray(user.restrictions) ? user.restrictions : [],
    createdAt: user.createdAt
  };
}

function listEmployees(req, res) {
  try {
    if (!isFranchiseAdmin(req.authUser?.role)) {
      return res.status(403).json({ error: 'Only the main admin or a Franchise Employee Admin can manage employees.' });
    }

    const storeId = getRequestedStoreId(req);
    if (!canAccessStore(req, storeId)) {
      return res.status(403).json({ error: 'Access to this store is not allowed.' });
    }

    const employees = getUsers()
      .filter(user => ['admin', 'franchise_admin', 'store_admin'].includes(user.role))
      .filter(user => req.authUser.role === 'admin' || storeId === 'all' || getRecordStoreId(user) === storeId)
      .map(publicEmployee);

    res.json({ employees });
  } catch (err) {
    logError(`HR LIST EMPLOYEES FAILED: ${err.message}`);
    res.status(500).json({ error: 'Unable to load employees.' });
  }
}

async function editEmployee(req, res) {
  try {
    if (!isFranchiseAdmin(req.authUser?.role)) {
      return res.status(403).json({ error: 'Only the main admin or a Franchise Employee Admin can edit employees.' });
    }

    const targetId = Number(req.params.id);
    const { username, email, phone, nrc, password } = req.body || {};
    const users = getUsers();
    const index = users.findIndex(user => Number(user.id) === targetId);
    if (index < 0) return res.status(404).json({ error: 'Employee not found.' });

    const target = users[index];
    if (!canAccessStore(req, getRecordStoreId(target))) {
      return res.status(403).json({ error: 'Access to this employee is not allowed.' });
    }
    // A Franchise Employee Admin may not edit the main admin account.
    if (target.role === 'admin' && req.authUser.role !== 'admin') {
      return res.status(403).json({ error: 'You cannot edit the main admin account.' });
    }

    if (email && users.some((u, i) => i !== index && String(u.email).toLowerCase() === String(email).trim().toLowerCase())) {
      return res.status(400).json({ error: 'Another account already uses that email.' });
    }
    if (nrc && !isValidNrc(nrc)) {
      return res.status(400).json({ error: 'NRC/ID number must look like 123456/78/1.' });
    }

    if (username) target.username = String(username).trim();
    if (email) target.email = String(email).trim().toLowerCase();
    if (phone !== undefined) target.phone = normalizePhoneNumber(phone || '');
    if (nrc) target.nrc = String(nrc).trim();
    if (password) {
      if (!isStrongPassword(password)) return res.status(400).json({ error: passwordRequirementsText() });
      target.password = await bcrypt.hash(password, 10);
      target.trustedDevices = []; // force re-login on the changed account
    }

    users[index] = target;
    saveUsers(users);
    logHr(`EDIT EMPLOYEE id=${targetId}`, req.authUser);

    res.json({ message: 'Employee updated successfully.', employee: publicEmployee(target) });
  } catch (err) {
    logBreakage('authController.js', 'editEmployee', err, 'HR EDIT EMPLOYEE FAILED');
    res.status(500).json({ error: 'Unable to update the employee.' });
  }
}

function setEmployeeRestriction(req, res) {
  try {
    if (!isFranchiseAdmin(req.authUser?.role)) {
      return res.status(403).json({ error: 'Only the main admin or a Franchise Employee Admin can change permissions.' });
    }

    const targetId = Number(req.params.id);
    const { action, restricted } = req.body || {};
    if (!RESTRICTABLE_ACTIONS.includes(action)) {
      return res.status(400).json({ error: 'Unknown permission.' });
    }

    const users = getUsers();
    const index = users.findIndex(user => Number(user.id) === targetId);
    if (index < 0) return res.status(404).json({ error: 'Employee not found.' });

    const target = users[index];
    if (target.role === 'admin') {
      return res.status(400).json({ error: 'The main admin cannot be restricted.' });
    }
    if (!canAccessStore(req, getRecordStoreId(target))) {
      return res.status(403).json({ error: 'Access to this employee is not allowed.' });
    }

    const restrictions = new Set(Array.isArray(target.restrictions) ? target.restrictions : []);
    if (restricted) restrictions.add(action);
    else restrictions.delete(action);
    target.restrictions = [...restrictions];

    users[index] = target;
    saveUsers(users);
    logHr(`${restricted ? 'RESTRICT' : 'UNRESTRICT'} ${action} on employee id=${targetId}`, req.authUser);

    res.json({ message: 'Permissions updated.', employee: publicEmployee(target) });
  } catch (err) {
    logBreakage('authController.js', 'setEmployeeRestriction', err, 'HR SET RESTRICTION FAILED');
    res.status(500).json({ error: 'Unable to update permissions.' });
  }
}

// Store switching is OTP-gated: a store-scoped admin cannot switch to a store
// they don't own until the OTP sent to that store's Franchise Employee Admin (or
// the main admin) is verified. Codes expire after 5 minutes (shared OTP service).
async function requestStoreSwitch(req, res) {
  try {
    if (!isAdminRole(req.authUser?.role)) {
      return res.status(403).json({ error: 'Admin access required.' });
    }

    const targetStore = getRequestedStoreId(req);
    if (req.authUser.role === 'admin' || canAccessStore(req, targetStore)) {
      return res.json({ otpRequired: false, storeId: targetStore, message: 'Switch approved.' });
    }

    const authority = findStoreAuthority(targetStore);
    if (!authority || !authority.email) {
      return res.status(400).json({ error: 'No franchise admin is available to approve this switch.' });
    }
    try {
      await otpService.sendOTP('Store Switch', authority.email, true);
    } catch (mailErr) {
      logBreakage('authController.js', 'requestStoreSwitch', mailErr, 'STORE SWITCH OTP FAILED');
      return res.status(502).json({ error: 'Could not send the approval code. Please try again.' });
    }
    return res.json({
      otpRequired: true,
      otpSentTo: authority.email,
      storeId: targetStore,
      message: 'Approval code sent to the franchise admin. Enter it to switch stores.'
    });
  } catch (err) {
    logBreakage('authController.js', 'requestStoreSwitch', err, 'HR STORE SWITCH REQUEST FAILED');
    res.status(500).json({ error: 'Unable to start the store switch.' });
  }
}

function verifyStoreSwitch(req, res) {
  try {
    if (!isAdminRole(req.authUser?.role)) {
      return res.status(403).json({ error: 'Admin access required.' });
    }

    const { otp, storeId } = req.body || {};
    const targetStore = String(storeId || getRequestedStoreId(req)).trim().toLowerCase();
    const authority = findStoreAuthority(targetStore);
    if (!authority) return res.status(400).json({ error: 'No franchise admin is available to approve this switch.' });

    const result = otpService.verifyOTP(otp, authority.email, 'Store Switch');
    if (!result.valid) return res.status(400).json({ error: result.message });

    logHr(`STORE SWITCH APPROVED to ${targetStore}`, req.authUser);
    res.json({ authorized: true, storeId: targetStore, message: 'Store switch approved.' });
  } catch (err) {
    logBreakage('authController.js', 'verifyStoreSwitch', err, 'HR STORE SWITCH VERIFY FAILED');
    res.status(500).json({ error: 'Unable to verify the store switch.' });
  }
}

module.exports = { requestSignup, confirmSignup, resendOTP, requestLogin, confirmLogin, requestPasswordReset, confirmPasswordReset, createInvite, createAdminUser, validateInvite, getAllUsers, sendAdminAnnouncement, listInvites, listEmployees, editEmployee, setEmployeeRestriction, requestStoreSwitch, verifyStoreSwitch, classifyMailError, sweepExpiredAuth, cleanupExpiredInvites };
