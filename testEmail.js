require('dotenv').config();
const nodemailer = require('nodemailer');

const transporter = nodemailer.createTransport({
  service: 'gmail',
  auth: {
    user: process.env.GMAIL_USER,
    pass: process.env.GMAIL_APP_PASSWORD?.replace(/\s/g, '')
  }
});

transporter.sendMail({
  from: process.env.GMAIL_USER,
  to: process.env.GMAIL_USER,
  subject: 'Test Email',
  text: 'If you receive this, email sending works.'
}).then(() => {
  console.log('Email sent successfully!');
}).catch((err) => {
  console.log('Email failed:', err.message);
});