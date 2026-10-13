// ─── Zambian / BMF phone validation ──────────────────────────────────────────
// Every borrower must have a WhatsApp-reachable number. Zambia uses the +260
// country code with 9 significant digits:
//   mobiles  : +260 7xx / 9xx xxx xxx   (Airtel 97/99, MTN 95/96, Zamtel 77)
//   landlines : +260 2xx xxx xxx        (Lusaka area codes start with 2)

const ZAMBIA_CODE = '260';
// Airtel 095-097, MTN 076-077 and 057, Zamtel 026x landline/mobile ranges.
const MOBILE_PREFIXES = ['5', '7', '9'];
const LANDLINE_PREFIXES = ['2'];

/** Strip spaces, dashes, brackets and a leading 00 international prefix. */
function toRawDigits(value) {
  if (value === null || value === undefined) return '';
  return String(value).replace(/[\s().-]/g, '').trim();
}

/**
 * Normalise any accepted Zambian input into E.164 (+260XXXXXXXXX).
 * Returns null when the number is not a valid Zambian number.
 */
function normalizeZambianPhone(value) {
  const raw = toRawDigits(value);
  if (!raw) return null;

  let national = raw;
  if (national.startsWith('00' + ZAMBIA_CODE)) {
    national = national.slice(('00' + ZAMBIA_CODE).length);
  } else if (national.startsWith('+' + ZAMBIA_CODE)) {
    national = national.slice(ZAMBIA_CODE.length + 1);
  } else if (national.startsWith(ZAMBIA_CODE) && national.length === 12) {
    // Bare country code with no plus/00, e.g. 26097xxxxxxx
    national = national.slice(ZAMBIA_CODE.length);
  }

  // 097xxxxxxx / 09xxxxxxx local dialling form -> drop the trunk 0
  if (national.length === 10 && national.startsWith('0')) {
    national = national.slice(1);
  }

  if (!/^\d{9}$/.test(national)) return null;

  const prefix = national[0];
  if (!MOBILE_PREFIXES.includes(prefix) && !LANDLINE_PREFIXES.includes(prefix)) return null;

  return `+${ZAMBIA_CODE}${national}`;
}

function isValidZambianPhone(value) {
  return normalizeZambianPhone(value) !== null;
}

/**
 * Strict BMF signup rule (Task 6):
 *   accepted: 09XXXXXXXX / +2609XXXXXXXX (Airtel 095-097, MTN 076-077, 057),
 *             026x (Zamtel) national formats.
 *   exact spec regex base: /^(\+?260|0)(9[5-7]|7[6-7])\d{7}$/
 *   extended with the 057 and 026x prefixes listed as valid MTN/Zamtel ranges.
 */
const ZAMBIAN_MOBILE_REGEX = /^(\+?260|0)(?:(?:9[5-7]|7[6-7]|57)\d{7}|26\d{7})$/;

function isValidZambianMobile(value) {
  if (value === null || value === undefined || value === '') return false;
  const raw = String(value).replace(/[\s().-]/g, '');
  return ZAMBIAN_MOBILE_REGEX.test(raw);
}

function isMobileNumber(value) {
  const e164 = normalizeZambianPhone(value);
  return Boolean(e164) && MOBILE_PREFIXES.includes(e164.charAt(ZAMBIA_CODE.length + 1));
}

/** Human-friendly rendering for documents and reports: 097 123 4567 */
function formatZambianPhone(value) {
  const e164 = normalizeZambianPhone(value);
  if (!e164) return value || '';
  const national = e164.slice(ZAMBIA_CODE.length + 1);
  return `0${national.slice(0, 3)} ${national.slice(3, 6)} ${national.slice(6)}`;
}

function describePhone(value) {
  if (isValidZambianPhone(value)) {
    return isMobileNumber(value)
      ? 'Valid Zambian mobile number — WhatsApp can be enabled on it.'
      : 'Valid Zambian landline. A mobile/WhatsApp number is required for borrower notifications.';
  }
  return 'Enter a valid Zambian number, e.g. +260 977 123 456 or 0977 123 456.';
}

module.exports = {
  ZAMBIA_CODE,
  ZAMBIAN_MOBILE_REGEX,
  normalizeZambianPhone,
  isValidZambianPhone,
  isValidZambianMobile,
  isMobileNumber,
  formatZambianPhone,
  describePhone
};