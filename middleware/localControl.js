// Operator-only controls must remain on a private client network in PUBLIC mode.
function isPrivateControlClient(ip = '') {
  const normalized = String(ip).startsWith('::ffff:') ? String(ip).slice(7) : String(ip);
  return normalized === '127.0.0.1' || normalized === '::1' ||
    /^10\./.test(normalized) || /^192\.168\./.test(normalized) ||
    /^172\.(1[6-9]|2[0-9]|3[0-1])\./.test(normalized) ||
    /^fc00:/i.test(normalized) || /^fd00:/i.test(normalized);
}

module.exports = { isPrivateControlClient };
