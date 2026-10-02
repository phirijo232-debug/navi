const path = require('path');
require('dotenv').config({ path: path.resolve(__dirname, '../.env') });
const crypto = require('crypto');
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
  Object.keys(otpStore).forEach((key) => {
    if (otpStore[key].expiry <= now) {
      delete otpStore[key];
    }
  });
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

  return otp;
}

async function sendOTP(purpose = 'Account Verification', targetEmail = null, forceNew = false, recipientOverride = null) {
  const normalizedEmail = normalizeEmailAddress(targetEmail);
  const key = buildOtpKey(normalizedEmail, purpose);
  const otp = generateOTP(key, forceNew);
  const recipient = normalizeEmailAddress(recipientOverride) || normalizedEmail || process.env.GMAIL_USER;

  if (!process.env.GMAIL_USER || !process.env.GMAIL_APP_PASSWORD || !recipient) {
    throw new Error('OTP email configuration is incomplete.');
  }

  try {
    await transporter.sendMail({
      from: process.env.GMAIL_USER,
      to: recipient,
      subject: `BURAZA MICRO FINANCE (BMF) — Pryme Vertex OTP for ${purpose}`,
      text: `Your OTP code is: ${otp}\n\nThis code is for: ${purpose}\nExpires in 5 minutes.\n\nBURAZA MICRO FINANCE (BMF) is a Pryme Vertex subsidiary.\n\nIMPORTANT: This email may land in your Spam or Promotions folder. Please move it to your Primary inbox and mark it as "Not Spam" so future codes arrive on time.\n\nIf you did not request this, ignore this email.`
    });

    return otp;
  } catch (error) {
    delete otpStore[key];
    throw error;
  }
}

function verifyOTP(input, targetEmail = null, purpose = null) {
  const key = buildOtpKey(targetEmail, purpose);
  const record = otpStore[key];

  if (!record || Date.now() > record.expiry) {
    delete otpStore[key];
    return { valid: false, message: 'OTP expired or not generated.' };
  }

  if (input !== record.code) {
    return { valid: false, message: 'Incorrect OTP.' };
  }

  delete otpStore[key];
  return { valid: true };
}
module.exports = { sendOTP, verifyOTP, generateOTP, buildOtpKey };