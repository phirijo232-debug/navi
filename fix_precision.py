import sys
with open(r'c:\NaviServer\controllers\loanController.js', 'r') as f:
    content = f.read()

# Insert preciseCurrency after the GRACE_DAILY_RATE and PENALTY_CAP_RATIO lines
old = """const GRACE_DAILY_RATE = 0.018;
const PENALTY_CAP_RATIO = 0.5; // cap: 50% additional on the original principal

/** Accepts YYYY-MM-DD or DD/MM/YYYY; returns YYYY-MM-DD or null. */
function parseDateInput(value)"""

new = """const GRACE_DAILY_RATE = 0.018;
const PENALTY_CAP_RATIO = 0.5; // cap: 50% additional on the original principal

/** Format currency as K X,XXX.XX with full decimal precision. */
function preciseCurrency(value) {
  return Number(Number(value || 0).toFixed(2));
}

/** Accepts YYYY-MM-DD or DD/MM/YYYY; returns YYYY-MM-DD or null. */
function parseDateInput(value)"""

if old in content:
    content = content.replace(old, new)
    with open(r'c:\NaviServer\controllers\loanController.js', 'w') as f:
        f.write(content)
    print('Inserted preciseCurrency successfully')
else:
    print('Pattern not found')