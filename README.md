# Navi Server

Navi is the web app and API for Pryme Vertex / Buraza Micro Finance.

## Run

```bash
npm install
cp .env.example .env
node scripts/seed-demo.js   # optional local accounts, password Demo#2026
node server.js
```

Open `http://localhost:3000`.

## Email

Real messages go out only when SMTP credentials are set. With `MAIL_MODE=auto` (the default) and no credentials, every email is appended to `logs/mail-preview.log` and the screen says that mail was saved on the server instead of being sent. Set `MAIL_MODE=smtp` on a live server so a missing password is an error rather than a silent preview.

The owner needs these values for real delivery:

| Variable | Purpose |
|---|---|
| `SMTP_HOST` | Mail server. Defaults to `smtp.gmail.com`. |
| `SMTP_PORT` | Defaults to `465`. |
| `SMTP_SECURE` | `true` for TLS on 465. Set `false` for STARTTLS on 587. |
| `SMTP_USER` | Mailbox that sends. `GMAIL_USER` is used when this is empty. |
| `SMTP_PASS` | Password or app password. `GMAIL_APP_PASSWORD` is used when this is empty. |
| `MAIL_FROM` | From address. Defaults to the SMTP user. |
| `MAIL_MODE` | `auto`, `smtp`, or `preview`. |
| `ADMIN_EMAILS` | Inbox for admin reports and alerts. Not the sender. |
| `ERROR_EMAIL_RECIPIENT` | Optional override for breakage alerts. |
| `DAILY_REPORT_EMAIL` | Optional override for the daily loan report. |

`GMAIL_USER` sends. `ADMIN_EMAILS` receives reports. Do not swap them.

Login, signup, password reset, announcements, overdue notices, loan updates, and breakage alerts all use this mailer.

## SMS and WhatsApp

Reminders also try a phone message. With no provider filled in, the text is saved to `logs/sms-preview.log` and `logs/whatsapp-preview.log` and nothing is sent.

| Variable | Purpose |
|---|---|
| `MESSAGE_MODE` | `preview` (default) or used when a channel mode is empty. |
| `SMS_MODE` | `preview` or `live`. |
| `SMS_PROVIDER_URL` | Where a live SMS is posted as JSON `{to, text, from}`. |
| `SMS_PROVIDER_TOKEN` | Bearer token for that URL. |
| `SMS_FROM` | Sender name or number the provider expects. |
| `WHATSAPP_MODE` | `preview` or `live`. |
| `WHATSAPP_PROVIDER_URL` | Where a live WhatsApp message is posted. |
| `WHATSAPP_PROVIDER_TOKEN` | Bearer token. |
| `WHATSAPP_FROM` | Sender the provider expects. |
| `UPLOAD_SIGNING_KEY` | Secret for short-lived photo links. Not required on the shop network. |

## Starting with Windows

`scripts/start-on-logon.cmd` starts Navi from the folder that contains it. Point Task Scheduler at that file with the trigger "At log on" so the 23:58 reminders still run when nobody has a terminal open. Leave the task set to "Run whether the user is logged on or not" only after you have chosen which Windows account should own the data folder.
