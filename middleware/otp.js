const path = require('path');
require('dotenv').config({ path: path.resolve(__dirname, '../.env') });
const crypto = require('crypto');
const { sendMail } = require('./email');
const dataStore = require('./dataStore');

// HEART: OTP store, scoped by email and purpose so different flows do not collide.
// Codes are written to disk so a restart does not throw away a code that was
// just emailed. The file is not part of the business backup.
const OTP_NAMESPACE = '__global_otp__';
const OTP_FILE = path.join(dataStore.DATA_DIR, 'otp-store.json');
const otpStore = {};

function loadOtpStore() {
  const saved = dataStore.readJson(OTP_FILE, {}, (value) => value && typeof value === 'object' && !Array.isArray(value));
  Object.keys(otpStore).forEach((key) => { delete otpStore[key]; });
  Object.assign(otpStore, saved || {});
}

function saveOtpStore() {
  try {
    dataStore.writeJson(OTP_FILE, otpStore);
  } catch (err) {
    // A failed save must not block login; the in-memory code still works
    // until the process stops.
  }
}

loadOtpStore();

function normalizeEmailAddress(targetEmail = null) {
  if (typeof targetEmail !== 'string') return null;
  return targetEmail.trim().toLowerCase();
}

function normalizeKeyInput(targetEmail = null, purpose = null) {
  if (typeof targetEmail !== 'string') {
    return { email: null, purpose: typeof purpose === 'string' ? purpose.trim() : '' };
  }

  const trimmedValue = targetEmail.trim();
  if (trimmedValue.includes(':') && !purpose) {
    const [rawEmail, ...rawPurposeParts] = trimmedValue.split(':');
    return {
      email: normalizeEmailAddress(rawEmail),
      purpose: rawPurposeParts.join(':').trim()
    };
  }

  return {
    email: normalizeEmailAddress(targetEmail),
    purpose: typeof purpose === 'string' ? purpose.trim() : ''
  };
}

function buildOtpKey(targetEmail = null, purpose = null) {
  const { email, purpose: normalizedPurpose } = normalizeKeyInput(targetEmail, purpose);

  if (!email) return OTP_NAMESPACE;
  if (!normalizedPurpose) return email;
  return `${email}:${normalizedPurpose}`;
}

// LEGS: cleanup expired entries so active codes stay unique and current
function cleanupExpiredOtps() {
  const now = Date.now();
  let removed = 0;
  Object.keys(otpStore).forEach((key) => {
    if (!otpStore[key] || otpStore[key].expiry <= now) {
      delete otpStore[key];
      removed += 1;
    }
  });
  if (removed) saveOtpStore();
  return removed;
}

// ARMS: reuse the currently active OTP for a given email/purpose unless a fresh resend is explicitly requested
function generateOTP(key, forceNew = false) {
  cleanupExpiredOtps();

  const normalizedKey = buildOtpKey(key);
  const active = otpStore[normalizedKey];
  if (!forceNew && active && active.expiry > Date.now()) {
    return active.code;
  }

  let otp;
  const existingCodes = new Set(Object.values(otpStore).map(entry => entry.code));
  do {
    otp = crypto.randomInt(100000, 1000000).toString();
  } while (!forceNew && existingCodes.has(otp));

  otpStore[normalizedKey] = {
    code: otp,
    expiry: Date.now() + 300000,
    createdAt: new Date().toISOString()
  };
  saveOtpStore();

  return otp;
}

async function sendOTP(purpose = 'Account Verification', targetEmail = null, forceNew = false, recipientOverride = null) {
  const normalizedEmail = normalizeEmailAddress(targetEmail);
  const key = buildOtpKey(normalizedEmail, purpose);
  const otp = generateOTP(key, forceNew);
  const recipient = normalizeEmailAddress(recipientOverride) || normalizedEmail || process.env.MAIL_FROM || process.env.SMTP_USER || process.env.GMAIL_USER;

  if (!recipient) {
    throw new Error('OTP email configuration is incomplete.');
  }

  const result = await sendMail({
    to: recipient,
    subject: `BURAZA MICRO FINANCE (BMF) OTP for ${purpose}`,
    text: `Your OTP code is: ${otp}\n\nThis code is for: ${purpose}\nExpires in 5 minutes.\n\nBMF values your security and privacy.\n\nIMPORTANT: This email may land in your Spam or Promotions folder. Please move it to your Primary inbox and mark it as "Not Spam" so future codes arrive on time.\n\nIf you did not request this, ignore this email.`
  });
  if (!result.ok) {
    delete otpStore[key];
    saveOtpStore();
    throw new Error(result.reason || 'OTP email configuration is incomplete.');
  }

  return otp;
}

function verifyOTP(input, targetEmail = null, purpose = null) {
  const key = buildOtpKey(targetEmail, purpose);
  const record = otpStore[key];

  if (!record || Date.now() > record.expiry) {
    delete otpStore[key];
    saveOtpStore();
    return { valid: false, message: 'OTP expired or not generated.' };
  }

  if (input !== record.code) {
    return { valid: false, message: 'Incorrect OTP.' };
  }

  delete otpStore[key];
  saveOtpStore();
  return { valid: true };
}
module.exports = { sendOTP, verifyOTP, generateOTP, buildOtpKey, cleanupExpiredOtps };