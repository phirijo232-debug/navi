const fs = require('fs');
const loans = JSON.parse(fs.readFileSync('data/loans.json', 'utf8'));
const users = JSON.parse(fs.readFileSync('data/users.json', 'utf8'));
const out = {
  loansCount: loans.length,
  usersCount: users.length,
  loanKeys: loans[0] ? Object.keys(loans[0]) : [],
  firstLoan: loans[0] || null,
  userKeys: users[0] ? Object.keys(users[0]) : []
};
fs.writeFileSync('shapes.txt', JSON.stringify(out, null, 1), 'utf8');
