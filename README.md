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
