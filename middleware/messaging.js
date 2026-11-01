const fs = require('fs');
const path = require('path');
const { logError } = require('./logger');

// Provider-agnostic SMS and WhatsApp. With no credentials, messages are
// appended to a preview log the same way email is. Nothing is sent.

function logsDir() {
  return path.resolve(__dirname, '../logs');
}

function channelConfig(channel) {
  const prefix = channel === 'whatsapp' ? 'WHATSAPP' : 'SMS';
  const mode = String(process.env[`${prefix}_MODE`] || process.env.MESSAGE_MODE || 'preview').toLowerCase();
  return {
    channel,
    mode: mode === 'live' ? 'live' : 'preview',
    url: process.env[`${prefix}_PROVIDER_URL`] || '',
    token: process.env[`${prefix}_PROVIDER_TOKEN`] || '',
    from: process.env[`${prefix}_FROM`] || ''
  };
}

function previewFile(channel) {
  return path.join(logsDir(), `${channel}-preview.log`);
}

function writePreview(channel, message) {
  fs.mkdirSync(logsDir(), { recursive: true });
  fs.appendFileSync(previewFile(channel), `${JSON.stringify({ at: new Date().toISOString(), ...message })}\n`);
}

async function deliver(channel, { to, text }) {
  const config = channelConfig(channel);
  const payload = { to: String(to || '').trim(), text: String(text || ''), from: config.from };
  if (!payload.to || !payload.text) {
    return { ok: false, mode: config.mode, reason: 'A recipient and a message are required.' };
  }
  if (config.mode !== 'live' || !config.url) {
    writePreview(channel, payload);
    return { ok: true, mode: 'preview', preview: previewFile(channel) };
  }
  try {
    const response = await fetch(config.url, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        ...(config.token ? { Authorization: `Bearer ${config.token}` } : {})
      },
      body: JSON.stringify(payload)
    });
    if (!response.ok) {
      const reason = `Provider answered ${response.status}`;
      writePreview(channel, { ...payload, error: reason });
      return { ok: false, mode: 'live', reason };
    }
    return { ok: true, mode: 'live' };
  } catch (err) {
    logError(`${channel.toUpperCase()} SEND FAILED: ${err.message}`);
    writePreview(channel, { ...payload, error: err.message });
    return { ok: false, mode: 'live', reason: err.message };
  }
}

function sendSms(message) {
  return deliver('sms', message);
}

function sendWhatsApp(message) {
  return deliver('whatsapp', message);
}

module.exports = { sendSms, sendWhatsApp, channelConfig, previewFile };
