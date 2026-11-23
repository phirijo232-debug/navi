const path = require('path');
require('dotenv').config({ path: path.resolve(__dirname, '../.env') });
const crypto = require('crypto');
const supabaseApi = require('./supabaseApi');
const nodemailer = require('nodemailer');

// HEAD: transporter configuration
const transporter = nodemailer.createTransport({
  host: 'smtp.gmail.com',
  port: 465,
  secure: true,
  family: 4,
  auth: {
    user: process.env.GMAIL_USER,
    pass: process.env.GMAIL_APP_PASSWORD?.replace(/\s/g, '')
  }
});

// HEART: in-memory OTP store, scoped by email and purpose so different flows do not collide
const OTP_NAMESPACE = '__global_otp__';
const otpStore = {};
// Plain codes live only long enough to email a resend. The store itself keeps a hash.
const issuedPlain = new Map();

function hashOtp(code) {
  return crypto.createHash('sha256').update(String(code)).digest('hex');
}

function otpMatches(input, codeHash) {
  const presented = Buffer.from(hashOtp(input));
  const stored = Buffer.from(String(codeHash || ''));
  if (presented.length !== stored.length) {
    crypto.timingSafeEqual(presented, presented);
    return false;
  }
  return crypto.timingSafeEqual(presented, stored);
}

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
  if (supabaseApi.enabled()) {
    supabaseApi.deleteExpiredOtps();
    return;
  }
  const now = Date.now();
  Object.keys(otpStore).forEach((key) => {
    if (otpStore[key].expiry <= now) {
      delete otpStore[key];
      issuedPlain.delete(key);
    }
  });
}

// ARMS: reuse the currently active OTP for a given email/purpose unless a fresh resend is explicitly requested
function generateOTP(key, forceNew = false) {
  const normalizedKey = buildOtpKey(key);
  if (supabaseApi.enabled()) {
    const existing = supabaseApi.getOtp(normalizedKey);
    if (!forceNew && existing && Date.parse(existing.expires_at) > Date.now() && issuedPlain.has(normalizedKey)) {
      return issuedPlain.get(normalizedKey);
    }
    const otp = crypto.randomInt(100000, 1000000).toString();
    const expiry = Date.now() + 300000;
    supabaseApi.saveOtp(normalizedKey, hashOtp(otp), expiry);
    issuedPlain.set(normalizedKey, otp);
    return otp;
  }
  cleanupExpiredOtps();

  const active = otpStore[normalizedKey];
  if (!forceNew && active && active.expiry > Date.now() && issuedPlain.has(normalizedKey)) {
    return issuedPlain.get(normalizedKey);
  }

  let otp;
  const existingHashes = new Set(Object.values(otpStore).map(entry => entry.codeHash));
  do {
    otp = crypto.randomInt(100000, 1000000).toString();
  } while (!forceNew && existingHashes.has(hashOtp(otp)));

  otpStore[normalizedKey] = {
    codeHash: hashOtp(otp),
    expiry: Date.now() + 300000,
    createdAt: new Date().toISOString()
  };
  issuedPlain.set(normalizedKey, otp);

  return otp;
}

async function sendOTP(purpose = 'Account Verification', targetEmail = null, forceNew = false, recipientOverride = null) {
  const normalizedEmail = normalizeEmailAddress(targetEmail);
  const key = buildOtpKey(normalizedEmail, purpose);
  const recipient = normalizeEmailAddress(recipientOverride) || normalizedEmail || process.env.GMAIL_USER;

  // Check mail settings before a code is stored, so no unsent code is left behind.
  if (!process.env.GMAIL_USER || !process.env.GMAIL_APP_PASSWORD || !recipient) {
    throw new Error('OTP email configuration is incomplete.');
  }
  const otp = generateOTP(key, forceNew);

  try {
    await transporter.sendMail({
      from: process.env.GMAIL_USER,
      to: recipient,
      subject: `BURAZA MICRO FINANCE (BMF) OTP for ${purpose}`,
      text: `Your OTP code is: ${otp}\n\nThis code is for: ${purpose}\nExpires in 5 minutes.\n\nBMF values your security and privacy.\n\nIMPORTANT: This email may land in your Spam or Promotions folder. Please move it to your Primary inbox and mark it as "Not Spam" so future codes arrive on time.\n\nIf you did not request this, ignore this email.`
    });

    return otp;
  } catch (error) {
    delete otpStore[key];
    issuedPlain.delete(key);
    if (supabaseApi.enabled()) supabaseApi.deleteOtp(key);
    throw error;
  }
}

const OTP_MAX_ATTEMPTS = 5;
const otpAttempts = new Map();

function registerOtpFailure(key) {
  const attempts = (otpAttempts.get(key) || 0) + 1;
  if (attempts >= OTP_MAX_ATTEMPTS) {
    delete otpStore[key];
    issuedPlain.delete(key);
    otpAttempts.delete(key);
    if (supabaseApi.enabled()) supabaseApi.deleteOtp(key);
    return { valid: false, message: 'OTP expired or not generated.' };
  }
  otpAttempts.set(key, attempts);
  return { valid: false, message: 'Incorrect OTP.' };
}

function verifyOTP(input, targetEmail = null, purpose = null) {
  const key = buildOtpKey(targetEmail, purpose);
  if (supabaseApi.enabled()) {
    const row = supabaseApi.getOtp(key);
    if (!row || Date.parse(row.expires_at) <= Date.now()) {
      if (row) supabaseApi.deleteOtp(key);
      issuedPlain.delete(key);
      otpAttempts.delete(key);
      return { valid: false, message: 'OTP expired or not generated.' };
    }
    if (!otpMatches(input, row.code_hash)) {
      return registerOtpFailure(key);
    }
    supabaseApi.deleteOtp(key);
    issuedPlain.delete(key);
    otpAttempts.delete(key);
    return { valid: true };
  }
  const record = otpStore[key];

  if (!record || Date.now() > record.expiry) {
    delete otpStore[key];
    issuedPlain.delete(key);
    otpAttempts.delete(key);
    return { valid: false, message: 'OTP expired or not generated.' };
  }

  if (!otpMatches(input, record.codeHash)) {
    return registerOtpFailure(key);
  }

  delete otpStore[key];
  issuedPlain.delete(key);
  otpAttempts.delete(key);
  return { valid: true };
}
module.exports = { sendOTP, verifyOTP, generateOTP, buildOtpKey, cleanupExpiredOtps };