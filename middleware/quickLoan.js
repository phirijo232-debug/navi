'use strict';

const buckets = new Map();

const PHONE_RE = /^(\+?260|0)(?:(?:9[5-7]|7[6-7]|57)\d{7}|26\d{7})$/;
const NRC_RE = /^\d{6}\/\d{2}\/\d$/;
const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

function imageKind(buffer) {
  if (!buffer || buffer.length < 12) return null;
  if (buffer[0] === 0xFF && buffer[1] === 0xD8 && buffer[2] === 0xFF) return 'jpg';
  if (buffer[0] === 0x89 && buffer[1] === 0x50 && buffer[2] === 0x4E && buffer[3] === 0x47) return 'png';
  if (buffer.toString('ascii', 0, 4) === 'RIFF' && buffer.toString('ascii', 8, 12) === 'WEBP') return 'webp';
  return null;
}

function allow(key, limit, windowMs, now = Date.now()) {
  const recent = (buckets.get(key) || []).filter(stamp => now - stamp < windowMs);
  if (recent.length >= limit) {
    buckets.set(key, recent);
    return false;
  }
  recent.push(now);
  buckets.set(key, recent);
  return true;
}

function quickLoanLimits({ ip, phone, nrc }) {
  const windowMs = 60 * 60 * 1000;
  if (ip && !allow(`ip:${ip}`, 8, windowMs)) return 'Too many applications from this network. Please wait and try again.';
  if (phone && !allow(`phone:${phone}`, 4, windowMs)) return 'Too many applications for this phone number. Please wait and try again.';
  if (nrc && !allow(`nrc:${nrc}`, 4, windowMs)) return 'Too many applications for this NRC. Please wait and try again.';
  return '';
}

function resetQuickLoanLimits() {
  buckets.clear();
}

module.exports = {
  PHONE_RE,
  NRC_RE,
  EMAIL_RE,
  imageKind,
  quickLoanLimits,
  resetQuickLoanLimits
};
