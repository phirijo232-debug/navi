// ─── Zambian / BMF phone validation ──────────────────────────────────────────
// Every borrower must have a WhatsApp-reachable number. Zambia uses the +260
// country code with 9 significant digits:
//   mobiles  : +260 7xx / 9xx xxx xxx   (Airtel 97/99, MTN 95/96, Zamtel 77)
//   landlines : +260 2xx xxx xxx        (Lusaka area codes start with 2)

const ZAMBIA_CODE = '260';
const MOBILE_PREFIXES = ['7', '9'];
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
  normalizeZambianPhone,
  isValidZambianPhone,
  isMobileNumber,
  formatZambianPhone,
  describePhone
};