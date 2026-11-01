// One list of the shop's data files.
// BUSINESS files are backed up and mirrored into the database copy.
// EPHEMERAL files (login codes, half-finished signups) are saved so a restart
// does not throw them away, and they are NOT put in a backup snapshot.

const CORE_DATA_FILES = ['users.json', 'loans.json', 'feedback.json'];

const BUSINESS_DATA_FILES = [
  ...CORE_DATA_FILES,
  'notifications.json',
  'dailyReportState.json',
  'invites.json',
  'expenses.json'
];

const EPHEMERAL_DATA_FILES = ['otp-store.json', 'pending-auth.json'];

const KNOWN_DATA_FILES = [...BUSINESS_DATA_FILES, ...EPHEMERAL_DATA_FILES];

module.exports = {
  CORE_DATA_FILES,
  BUSINESS_DATA_FILES,
  EPHEMERAL_DATA_FILES,
  KNOWN_DATA_FILES
};
