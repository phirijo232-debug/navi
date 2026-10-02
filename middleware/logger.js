const path = require('path');
require('dotenv').config({ path: path.resolve(__dirname, '../.env') });
const fs = require('fs');
const nodemailer = require('nodemailer');
const config = require('../config');

const emailTransporter = nodemailer.createTransport({
  host: 'smtp.gmail.com',
  port: 465,
  secure: true,
  auth: {
    user: process.env.GMAIL_USER,
    pass: process.env.GMAIL_APP_PASSWORD?.replace(/\s/g, '')
  }
});

async function sendErrorAlert(subject, body) {
  if (!process.env.ERROR_EMAIL_RECIPIENT || !process.env.GMAIL_USER || !process.env.GMAIL_APP_PASSWORD) {
    return;
  }

  try {
    await emailTransporter.sendMail({
      from: process.env.GMAIL_USER,
      to: process.env.ERROR_EMAIL_RECIPIENT,
      subject,
      text: body
    });
  } catch (err) {
    console.error('Error alert failed:', err.message);
  }
}

function logError(message, notify = false) {
  const time = new Date().toISOString();
  const entry = `[${time}] ${message}\n`;
  fs.appendFileSync(config.LOGS.ERRORS, entry);
  console.error(entry);
  if (notify) {
    sendErrorAlert('Navi Server Error Alert', `${entry}\nCheck the server logs for more details.`).catch(() => {});
  }
}

function logAccess(req, res, next) {
  const skip = ['/status', '/sessions', '/logs/access', '/logs/errors'];
  if (!skip.includes(req.url)) {
    const time = new Date().toISOString();
    const entry = `[${time}] ${req.method} ${req.url} - ${req.ip}\n`;
    fs.appendFileSync(config.LOGS.ACCESS, entry);
  }
  next();
}

module.exports = { logError, logAccess };