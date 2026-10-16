require('dotenv').config();
const readline = require('readline');
const http = require('http');
const fs = require('fs');
const config = require('./config');
const { checkMasterPassword } = require('./middleware/security');
const { sendOTP, verifyOTP } = require('./middleware/otp');

const rl = readline.createInterface({
  input: process.stdin,
  output: process.stdout
});

console.log('Navi Server CLI — Type "help" for commands');

function sendToServer(path, method = 'GET', headers = {}) {
  // TRUSTED_TOKENS is empty for public access — only send the header when a
  // trusted token actually exists (routes the CLI hits are PUBLIC_PATHS anyway).
  const defaultToken = config.TRUSTED_TOKENS[0];
  const options = {
    hostname: 'localhost',
    port: config.PORT,
    path,
    method,
    headers: {
      ...(defaultToken ? { 'x-device-token': defaultToken } : {}),
      ...headers
    }
  };

  const req = http.request(options, (res) => {
    res.on('data', (d) => process.stdout.write(d));
  });

  req.on('error', () => console.log('Server not reachable. Is it running?'));
  req.end();
}

function handleCommand(input) {
  const parts = input.trim().split(' ');
  const cmd = parts[0].toLowerCase();

  switch (cmd) {
    case 'help':
      console.log(`
Commands:
  status              — check if server is running
  vault               — unlock protected server info via email OTP
  logs access         — view access log
  logs errors         — view error log
  whitelist show      — show trusted tokens
  whitelist add <token>    — add a trusted token
  whitelist remove <token> — remove a trusted token
  shutdown            — stop the server (requires master password)
  clear               — clear the screen
  exit                — exit CLI
      `);
      break;

    case 'status':
      sendToServer('/');
      break;

    case 'vault':
      console.log('Sending OTP to your email...');
      sendOTP('Vault Access').then(() => {
        rl.question('Enter OTP from email: ', (otp) => {
          const result = verifyOTP(otp);
          if (!result.valid) {
            console.log(result.message);
            rl.prompt();
            return;
          }
          console.log('Vault unlocked.');
          sendToServer('/status');
          rl.prompt();
        });
      }).catch(err => {
        console.log('Failed to send OTP:', err.message);
        rl.prompt();
      });
      return;

    case 'logs':
      if (parts[1] === 'access') {
        const log = fs.readFileSync(config.LOGS.ACCESS, 'utf8');
        console.log(log || 'No access logs yet.');
      } else if (parts[1] === 'errors') {
        const log = fs.readFileSync(config.LOGS.ERRORS, 'utf8');
        console.log(log || 'No error logs yet.');
      } else {
        console.log('Usage: logs access  OR  logs errors');
      }
      break;

    case 'whitelist':
      if (parts[1] === 'show') {
        console.log('Trusted tokens:');
        config.TRUSTED_TOKENS.forEach((t, i) => console.log(`  ${i + 1}. ${t}`));
      } else if (parts[1] === 'add' && parts[2]) {
        config.TRUSTED_TOKENS.push(parts[2]);
        console.log(`Token added: ${parts[2]}`);
      } else if (parts[1] === 'remove' && parts[2]) {
        const index = config.TRUSTED_TOKENS.indexOf(parts[2]);
        if (index > -1) {
          config.TRUSTED_TOKENS.splice(index, 1);
          console.log(`Token removed: ${parts[2]}`);
        } else {
          console.log('Token not found.');
        }
      } else {
        console.log('Usage: whitelist show / add <token> / remove <token>');
      }
      break;

    case 'shutdown':
      rl.question('Enter master password: ', (password) => {
        const result = checkMasterPassword(password);
        if (!result.allowed) {
          console.log(result.message);
          return;
        }
        sendToServer('/internal-shutdown', 'POST', {
          'x-admin-key': config.SHUTDOWN_KEY,
          'x-shutdown-key': config.SHUTDOWN_KEY
        });
      });
      return;

    case 'clear':
      console.clear();
      break;

    case 'exit':
      console.log('Exiting CLI.');
      rl.close();
      process.exit(0);
      break;

    default:
      console.log(`Unknown command: "${cmd}". Type "help" for commands.`);
  }

  rl.prompt();
}

rl.prompt();
rl.on('line', handleCommand);
rl.on('close', () => process.exit(0));