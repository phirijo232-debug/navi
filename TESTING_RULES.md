# Testing rules for BMF

These rules apply to everyone who works on this app.

The live app is on the `Published-BMF-Branch` branch. The test branch is `bmf-staging`. Testing happens on the `bmf-staging` branch. A test website and test database will be set up later. Until then, still start all work on `bmf-staging`, and do not use live customer data.

## How to make a change

1. Start a new feature branch from `bmf-staging`. Do not start from `Published-BMF-Branch`.
2. Make your changes on that feature branch.
3. Open a pull request into `bmf-staging`.
4. Test the change on the `bmf-staging` branch.
5. Only after the change is confirmed to work, open a pull request from `bmf-staging` into `Published-BMF-Branch`.
6. Only after that pull request is merged may the change be deployed to the live app.

Never push straight to `Published-BMF-Branch`.

## What to check before saying it works

- Login with a username or an email, plus a password, and the optional emailed one-time code if you used it
- Forgot password still works
- The public quick loan page at `/` and the back office at `/admin`
- The menu, dashboard, reports, and any other screen you changed
- Light and dark mode
- The app on a phone and on a computer
- Empty screens and forms you changed

## Security

- Never commit secrets, passwords, API keys, or tokens
- Never test with live customer data
- Do not change the master password or the public/private-mode check unless the owner explicitly asks
