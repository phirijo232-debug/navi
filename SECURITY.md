# Security notes for BMF

Secrets live only in the environment (see `.env.example`). Do not commit `.env`, customer JSON, or uploaded photos.

## What a token must do

- Device sessions are signed, expire after 90 days, and are stored as a hash. The raw token is shown once at login. A guessed or edited token is rejected. Clearing the device list (password reset, or removing the device) revokes it.
- One-time email codes are stored as a hash, expire in 5 minutes, and are single-use. Comparison is constant-time.
- Photo links are signed, expire in 10 minutes, are bound to the user they were issued for, and can be revoked. The device token is never put in the image address.
- In public mode the process will not start unless `SIGNING_SECRET` is set and at least 32 characters. Private mode can still boot for the shop computer.

## What this note does not change

The master-key check and the public/private network check are unchanged. If those need a different rule, that is a separate decision.

## After this update

Existing device sessions in `users.json` were stored in full. They no longer sign in. Everyone signs in again with their password and email code. Old plaintext session values are hashed the next time that user record is saved, so a copy of the file no longer contains a usable session token.

Invite links are still the signup door. Approving a student application emails an invite so the student sets their own password. The server never emails a generated password.

## History scan (16 November 2026)

gitleaks 8.28.0 read 68 commits. No Gmail app password and no real private key were found. The dotenv readme example inside the old `node_modules` folder is a sample, not a BMF key.

Real session tokens were committed and are still in history:

- `test/serverMode.test.js` around the old status test (fingerprint `7fbd…8b3e`). This copy is removed in this change. Older commits still have it.
- `data/users.json` before it was taken out of git (commit `b7ce0d4`). Fingerprints include `7fbd…8b3e`, `0565…d6f1`, `8957…9b59`, `d424…ec12`, `3744…1d6f`, `a861…fc2a`, `d7f7…822a`, and `776f…08e9`.

History was not rewritten. After this code is what the shop runs, those old tokens cannot sign in, because a session must be signed and only its hash is kept. Until then, anyone who copied a token from GitHub and can reach the server could still use it. Have every staff member and customer sign in again once this is deployed.

The startup check still refuses the old built-in master key when `PUBLIC_DEPLOY=true`. That check was not changed. If the live `.env` still uses that old value, replace `MASTER_KEY` with a new long random string. The value itself is in older commits of `server.js` and `docs/plans/public-internet-access.md`.
