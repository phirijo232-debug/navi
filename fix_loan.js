import re

with open('c:\\NaviServer\\controllers\\loanController.js', 'r') as f:
    content = f.read()

old = """    const activeLoans = loans.filter(loan => Number(loan.outstanding || 0) > 0);
    const totalInterestAdded = loans.reduce((sum, loan) => sum + Number(loan.graceInterestAdded || 0), 0);

      const today = new Date().toISOString().slice(0, 10);
      const interestBefore = Number(loan.graceAccrued || 0);
      applyGraceAccrual(loan, today);
      const interestAfter = Number(loan.graceAccrued || 0);
      const interestAdded = Number((interestAfter - interestBefore).toFixed(2));
      Object.assign(loan, { graceInterestBefore: interestBefore, graceInterestAfter: interestAfter, graceInterestAdded: interestAdded });
      const outstanding = Number(loan.outstanding || 0);
      return `- ${loan.product || 'Loan'} ${loan.receiptNumber || `#${loan.id}`}: outstanding ${formatCurrency(outstanding)}, due ${loan.dueDate || 'date unavailable'}, grace interest: K ${preciseCurrency(interestAdded)} (1.8%/day)`;
    }).join('\\\\n');
    const loanDetails = activeLoans.map(loan =>
      `- ${loan.product || 'Loan'} ${loan.receiptNumber || `#${loan.id}`}: ` +
      `outstanding ${formatCurrency(loan.outstanding)}, due ${loan.dueDate || 'date unavailable'}` +
    ).join('\\n');"""

new = """    const activeLoans = loans.filter(loan => Number(loan.outstanding || 0) > 0);
    const totalInterestAdded = loans.reduce((sum, loan) => sum + Number(loan.graceInterestAdded || 0), 0);

    // Apply grace accrual to each active loan and capture interest metrics
    const interestAddedList = activeLoans.map(loan => {
      const interestBefore = Number(loan.graceAccrued || 0);
      applyGraceAccrual(loan, new Date().toISOString().slice(0, 10));
      const interestAfter = Number(loan.graceAccrued || 0);
      const interestAdded = Number((interestAfter - interestBefore).toFixed(2));
      Object.assign(loan, { graceInterestBefore: interestBefore, graceInterestAfter: interestAfter, graceInterestAdded: interestAdded });
      return interestAdded;
    });

    const outstandingTotal = activeLoans.reduce((sum, loan) => sum + Number(loan.outstanding || 0), 0);

    // Build loanDetails with grace interest info for email body
    const loanDetails = activeLoans.map(loan =>
      `- ${loan.product || 'Loan'} ${loan.receiptNumber || `#${loan.id}`}: ` +
      `outstanding ${formatCurrency(loan.outstanding)}, due ${loan.dueDate || 'date unavailable'}, grace interest: K ${preciseCurrency(loan.graceInterestAdded || 0)} (1.8%/day)`
    ).join('\\n');"""

if old in content:
    content = content.replace(old, new)
    with open('c:\\NaviServer\\controllers\\loanController.js', 'w') as f:
        f.write(content)
    print('Replaced successfully')
else:
    print('Old text not found')