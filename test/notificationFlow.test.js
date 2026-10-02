const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const emailService = require('../middleware/email');
const { getGreetingByTime, buildLoanSummaryText, buildLoanStatusNotification, buildWelcomeMessage, buildRequestReceivedMessage, getNotificationRecipients } = emailService;
const { sendAdminAnnouncement } = require('../controllers/authController');

const USERS_FILE = path.join(__dirname, '../data/users.json');

test('notification helpers return the right messaging and greetings', () => {
  assert.match(getGreetingByTime(9), /morning/i);
  assert.match(getGreetingByTime(15), /afternoon/i);
  assert.match(getGreetingByTime(20), /evening/i);

  const approved = buildLoanStatusNotification('approve', 'Business Advance', 'We approved your request because the information provided matches the required documentation.', 'test@example.com', {
    amount: 2500,
    totalRepayment: 2900,
    dueDate: '2026-10-02',
    tenureWeeks: 2,
    urgency: 'urgent'
  });
  assert.match(approved.subject, /approved/i);
  assert.match(approved.body, /reason/i);
  assert.match(approved.body, /loan summary/i);
  assert.match(approved.body, /total repayment/i);
  assert.match(approved.body, /thank you/i);

  const declined = buildLoanStatusNotification('decline', 'Business Advance', 'The supporting documents were incomplete.', 'test@example.com', {
    amount: 2500,
    totalRepayment: 2900,
    dueDate: '2026-10-02'
  });
  assert.match(declined.body, /declined/i);
  assert.match(declined.body, /loan summary/i);
  assert.match(declined.body, /warmly/i);

  const welcome = buildWelcomeMessage('user@example.com', 'Pryme Vertex');
  assert.match(welcome.body, /Thank you for contacting Pryme Vertex/i);
  assert.match(welcome.body, /Welcome to a partnership built on integrity and excellence/i);

  const requestReceived = buildRequestReceivedMessage('Business Advance', 'emergency', 'user@example.com', {
    amount: 2500,
    totalRepayment: 2900,
    dueDate: '2026-10-02',
    tenureWeeks: 2,
    urgency: 'emergency'
  });
  assert.match(requestReceived.subject, /request received/i);
  assert.match(requestReceived.body, /loan summary/i);
  assert.match(requestReceived.body, /requested amount/i);
  assert.match(requestReceived.body, /urgent|emergency|review/i);

  const adminSummary = buildLoanSummaryText({
    product: 'Business Advance',
    amount: 2500,
    totalRepayment: 2900,
    dueDate: '2026-10-02',
    tenureWeeks: 2,
    urgency: 'emergency'
  });
  assert.match(adminSummary, /loan summary/i);
  assert.match(adminSummary, /total repayment/i);
  assert.match(adminSummary, /emergency/i);

  const recipients = getNotificationRecipients('customer@example.com');
  assert.ok(recipients.includes('customer@example.com'));
  assert.ok(recipients.includes('jophiri223@gmail.com'));
  assert.equal(new Set(recipients).size, recipients.length);
});

test('admin announcements target deduplicated non-admin users and report delivery results', async (t) => {
  const originalUsers = fs.readFileSync(USERS_FILE, 'utf8');
  fs.writeFileSync(USERS_FILE, JSON.stringify([
    { id: 1, email: 'admin@example.test', role: 'admin' },
    { id: 2, email: 'customer@example.test', role: 'user' },
    { id: 3, email: 'CUSTOMER@example.test', role: 'user' },
    { id: 4, email: 'second@example.test', role: 'user' }
  ], null, 2));

  try {
    const sendMail = t.mock.method(emailService, 'sendCustomerEmail', async () => ({ ok: true }));
    const req = {
      authUser: { role: 'admin' },
      body: { subject: 'Interest update', message: 'Rates change next month.' }
    };
    const res = {
      statusCode: 200,
      status(code) { this.statusCode = code; return this; },
      json(payload) { this.body = payload; return this; }
    };

    await sendAdminAnnouncement(req, res);

    assert.equal(res.statusCode, 200);
    assert.equal(res.body.sent, 2);
    assert.equal(res.body.failed, 0);
    assert.deepEqual(sendMail.mock.calls.map(call => call.arguments[0].to).sort(), [
      'customer@example.test',
      'second@example.test'
    ]);
    assert.ok(sendMail.mock.calls.every(call => /Buraza Micro Finance \(BMF\)/.test(call.arguments[0].subject)));
  } finally {
    fs.writeFileSync(USERS_FILE, originalUsers);
  }
});
