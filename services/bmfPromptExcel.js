'use strict';

const ExcelJS = require('exceljs');
const P = require('./bmfPromptReports');

const C = {
  navy: 'FF0D1117',
  card: 'FF161B22',
  alternate: 'FF1C2128',
  blue: 'FF2F81F7',
  yellow: 'FFFFFF00',
  green: 'FF3FB950',
  amber: 'FFD29922',
  red: 'FFF85149',
  purple: 'FFA371F7',
  white: 'FFE6EDF3',
  muted: 'FF8B949E'
};
const MONEY = '"K "#,##0.00;[Red]("K "#,##0.00)';
const PERCENT = '0.0%';
const FONT = 'Arial';

function style(cell, { fill, color, bold = false, italic = false, align = 'left', size = 10, format } = {}) {
  cell.font = { name: FONT, size, bold, italic, color: { argb: color || C.white } };
  cell.alignment = { vertical: 'middle', horizontal: align, wrapText: true };
  cell.border = {
    top: { style: 'thin', color: { argb: C.alternate } },
    bottom: { style: 'thin', color: { argb: C.alternate } },
    left: { style: 'thin', color: { argb: C.alternate } },
    right: { style: 'thin', color: { argb: C.alternate } }
  };
  if (fill) cell.fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: fill } };
  if (format) cell.numFmt = format;
}

function setValue(cell, value, options = {}) {
  cell.value = value == null ? '' : value;
  style(cell, options);
}

function setFormula(cell, formula, result, options = {}) {
  cell.value = { formula, result: result == null ? '' : result };
  style(cell, { ...options, color: C.blue });
}

function dateValue(value) {
  const text = String(value || '').slice(0, 10);
  if (!/^\d{4}-\d{2}-\d{2}$/.test(text)) return value;
  const date = new Date(`${text}T00:00:00Z`);
  return Number.isNaN(date.getTime()) ? value : date;
}

function dateSerial(value) {
  const date = dateValue(value);
  return date instanceof Date ? (date.getTime() - Date.UTC(1899, 11, 30)) / 86400000 : value;
}

function dateLabel(value) {
  const date = dateValue(value);
  return date instanceof Date
    ? date.toLocaleDateString('en-GB', { day: '2-digit', month: '2-digit', year: 'numeric', timeZone: 'UTC' })
    : value;
}

function makeHeader(ws, title, subtitle, report, columnCount = 13) {
  const lastColumn = String.fromCharCode(64 + columnCount);
  ws.mergeCells(`A1:${lastColumn}1`);
  setValue(ws.getCell('A1'), 'BURAZA MICRO FINANCE · PRYME VERTEX HOLDINGS', {
    fill: C.navy, bold: true, size: 15
  });
  ws.mergeCells(`A2:${lastColumn}2`);
  setValue(ws.getCell('A2'), title.toUpperCase(), { fill: C.navy, bold: true, size: 13 });
  ws.mergeCells(`A3:${lastColumn}3`);
  const period = report.from || report.to
    ? `Period: ${report.from ? dateLabel(report.from) : 'Beginning'} to ${report.to ? dateLabel(report.to) : 'Current'}`
    : `As at ${dateLabel(report.today)}`;
  setValue(ws.getCell('A3'), `${subtitle} · ${period} · Generated ${report.generatedAt}`, {
    fill: C.card, color: C.muted, italic: true
  });
  ws.getRow(1).height = 28;
  ws.getRow(2).height = 25;
  ws.getRow(3).height = 24;
}

function tableHeader(ws, rowNumber, headers) {
  headers.forEach((value, index) => setValue(ws.getRow(rowNumber).getCell(index + 1), value, {
    fill: C.card, bold: true, align: 'center', size: 9
  }));
  ws.getRow(rowNumber).height = 34;
}

function writeRows(ws, start, rows, { moneyColumns = [], percentColumns = [], dateColumns = [], formulaColumns = [] } = {}) {
  rows.forEach((values, rowIndex) => {
    const row = ws.getRow(start + rowIndex);
    values.forEach((value, columnIndex) => {
      const cell = row.getCell(columnIndex + 1);
      const isDate = dateColumns.includes(columnIndex + 1);
      if (value && typeof value === 'object' && value.formula) {
        setFormula(cell, value.formula, isDate ? dateSerial(value.result) : value.result, {
          fill: rowIndex % 2 ? C.alternate : C.card,
          format: isDate ? 'dd mmm yyyy' : undefined
        });
      } else {
        setValue(cell, isDate && value ? dateValue(value) : value, {
          fill: rowIndex % 2 ? C.alternate : C.card,
          color: formulaColumns.includes(columnIndex + 1) ? C.blue : C.white,
          format: moneyColumns.includes(columnIndex + 1) ? MONEY
            : percentColumns.includes(columnIndex + 1) ? PERCENT
              : isDate ? 'dd mmm yyyy' : undefined
        });
      }
    });
  });
}

function totalsFormula(first, last, column) {
  return `SUM(${column}${first}:${column}${last})`;
}

function directorySheet(wb, report) {
  const ws = wb.addWorksheet('Report Directory');
  ws.columns = [{ width: 5 }, { width: 35 }, { width: 52 }, { width: 28 }, { width: 18 }];
  ws.mergeCells('A1:E1');
  setValue(ws.getCell('A1'), 'BURAZA MICRO FINANCE', { fill: C.navy, bold: true, size: 16 });
  ws.mergeCells('A2:E2');
  setValue(ws.getCell('A2'), 'PRYME VERTEX HOLDINGS', { fill: C.navy, color: C.muted, size: 11 });
  ws.mergeCells('A3:E3');
  const month = new Date(`${report.today}T00:00:00Z`).toLocaleDateString('en-GB', { month: 'long', year: 'numeric', timeZone: 'UTC' });
  setValue(ws.getCell('A3'), `Loan Management Reports — ${month}`, { fill: C.navy, color: C.muted, italic: true, size: 11 });
  ws.getRow(1).height = 30;
  ws.getRow(2).height = 23;
  ws.getRow(3).height = 23;
  setValue(ws.getCell('A5'), 'REPORT DIRECTORY', { fill: C.yellow, color: C.navy, bold: true });
  ['#', 'Plain-English Report Name', 'What It Shows', 'Who Should Read It'].forEach((value, index) =>
    setValue(ws.getRow(6).getCell(index + 1), value, { fill: C.card, bold: true }));
  const descriptions = [
    ['Shows overdue loans by risk bucket and loss reserve', 'Management / Board'],
    ['Every borrower’s arrears breakdown', 'Daily Operations'],
    ['Full ledger for the selected loan', 'Borrower / Audit'],
    ['Every loan issued in the selected date range', 'Compliance'],
    ['Editable instalment plan for the selected loan', 'Borrower / Collections'],
    ['Officer collection rate versus available schedule data', 'Management'],
    ['Defaulted loans and recorded recoveries', 'Board / Compliance'],
    ['Recorded payment receipts and disbursements', 'Cashier / Management'],
    ['Key performance indicators for each loan officer', 'Management']
  ];
  P.REPORTS.forEach((item, index) => {
    const row = index + 7;
    [index + 1, item.title, descriptions[index][0], descriptions[index][1]].forEach((value, col) =>
      setValue(ws.getRow(row).getCell(col + 1), value, { fill: index % 2 ? C.alternate : C.card }));
  });
  setValue(ws.getCell('A17'), 'Colour Guide', { fill: C.card, bold: true });
  [
    ['B17', 'Formula cell', C.blue],
    ['C17', 'Input cell', C.yellow],
    ['D17', 'Healthy', C.green],
    ['E17', 'Caution', C.amber],
    ['B18', 'Problem', C.red],
    ['C18', 'Write-Off', C.purple]
  ].forEach(([address, text, fill]) => {
    setValue(ws.getCell(address), text, { fill, color: fill === C.yellow ? C.navy : C.white, bold: true });
  });
  ws.mergeCells('A19:E19');
  setValue(ws.getCell('A19'), report.note, { fill: C.card, color: C.muted, italic: true });
  ws.views = [{ state: 'frozen', ySplit: 6 }];
  return ws;
}

function parSheet(wb, report) {
  const ws = wb.addWorksheet('PAR Report');
  const headers = ['Loan ID', 'Borrower Name', 'Loan Officer', 'Amount Given Out', 'Total They Must Pay', 'Still Outstanding', 'Total Paid So Far', 'Days Overdue', 'Amount Overdue', 'Risk Bucket', 'Loss Reserve %', 'Loss Reserve Amount', 'Loan Status'];
  makeHeader(ws, 'How Risky Are Our Loans? — Portfolio at Risk', 'CGAP standard aging buckets', report, headers.length);
  tableHeader(ws, 5, headers);
  const rows = report.parRows.map(item => [
    item.loanId, item.borrower, item.officer, item.principal, item.payable, item.outstanding,
    item.paid, item.daysOverdue, item.overdueAmount, item.riskBucket, item.reserveRate,
    { formula: `F${6 + report.parRows.indexOf(item)}*K${6 + report.parRows.indexOf(item)}`, result: item.reserve },
    item.status
  ]);
  writeRows(ws, 6, rows, { moneyColumns: [4, 5, 6, 7, 9, 12], percentColumns: [11] });
  report.parRows.forEach((item, index) => {
    const fill = item.daysOverdue === 0 ? C.green
      : item.daysOverdue <= 30 ? C.amber
        : item.daysOverdue <= 60 ? C.amber : C.red;
    style(ws.getCell(`J${index + 6}`), {
      fill,
      color: fill === C.red ? C.white : C.navy,
      bold: item.daysOverdue > 30
    });
  });
  const last = Math.max(6, report.parRows.length + 5);
  const total = last + 2;
  setValue(ws.getCell(`A${total}`), 'TOTALS', { fill: C.navy, bold: true });
  [4, 5, 6, 9, 12].forEach(column => {
    const letter = String.fromCharCode(64 + column);
    setFormula(ws.getCell(`${letter}${total}`), totalsFormula(6, last, letter),
      report.parRows.reduce((sum, item) => sum + Number([null, null, null, item.principal, item.payable, item.outstanding, item.paid, null, item.overdueAmount, null, null, item.reserve][column] || 0), 0),
      { fill: C.navy, bold: true, format: MONEY });
  });
  const summary = [
    ['Any Late Loans (PAR > 1 day)', `IFERROR(SUMIF(J6:J${last},"<>Current",F6:F${last})/SUM(F6:F${last}),0)`, report.parRows.filter(item => item.daysOverdue > 0).reduce((s, item) => s + item.outstanding, 0) / (report.parRows.reduce((s, item) => s + item.outstanding, 0) || 1), 'Healthy: below 5%'],
    ['Seriously Late (PAR > 30 days)', `IFERROR(SUMIFS(F6:F${last},H6:H${last},">30")/SUM(F6:F${last}),0)`, report.parRows.filter(item => item.daysOverdue > 30).reduce((s, item) => s + item.outstanding, 0) / (report.parRows.reduce((s, item) => s + item.outstanding, 0) || 1), 'Target: below 2%'],
    ['Very Serious (PAR > 90 days)', `IFERROR(SUMIFS(F6:F${last},H6:H${last},">90")/SUM(F6:F${last}),0)`, report.parRows.filter(item => item.daysOverdue > 90).reduce((s, item) => s + item.outstanding, 0) / (report.parRows.reduce((s, item) => s + item.outstanding, 0) || 1), 'Target: 0%'],
    ['Loans Written Off', `IFERROR(SUMIF(M6:M${last},"Write-Off",F6:F${last})/SUM(D6:D${last}),0)`,
      report.parRows.filter(item => item.status === 'Write-Off').reduce((sum, item) => sum + item.outstanding, 0) /
        (report.parRows.reduce((sum, item) => sum + item.principal, 0) || 1), 'Acceptable: below 3%']
  ];
  summary.forEach((item, index) => {
    const row = total + index + 2;
    setValue(ws.getCell(`A${row}`), item[0], { fill: C.card, bold: true });
    setFormula(ws.getCell(`B${row}`), item[1], item[2], { fill: C.card, format: PERCENT });
    setValue(ws.getCell(`C${row}`), item[3], { fill: C.card, color: C.muted });
  });
  ws.columns = headers.map(() => ({ width: 19 }));
  ws.getColumn(1).width = 23;
  ws.getColumn(2).width = 24;
  ws.getColumn(10).width = 18;
  ws.views = [{ state: 'frozen', ySplit: 5 }];
  return ws;
}

function agingSheet(wb, report) {
  const ws = wb.addWorksheet('Aging Schedule');
  const headers = ['Loan ID', 'Borrower Name', 'Total They Must Pay', 'Still Outstanding', 'Not Yet Late (Current)', '1–7 Days Late', '8–30 Days Late', '31–60 Days Late', '61–90 Days Late', '91–180 Days Late', 'Over 180 Days Late', 'Total Arrears', 'Loan Status'];
  makeHeader(ws, 'Who Owes What and How Late? — Loan Aging Schedule', 'Arrears by days late', report, headers.length);
  tableHeader(ws, 5, headers);
  const rows = report.agingRows.map((item, index) => [
    item.loanId, item.borrower, item.payable, item.outstanding,
    item.buckets[0], item.buckets[1], item.buckets[2], item.buckets[3],
    item.buckets[4], item.buckets[5], item.buckets[6],
    { formula: `SUM(F${index + 6}:K${index + 6})`, result: item.arrears }, item.status
  ]);
  writeRows(ws, 6, rows, { moneyColumns: [3, 4, 5, 6, 7, 8, 9, 10, 11, 12] });
  report.agingRows.forEach((item, index) => {
    const row = index + 6;
    [6, 7].forEach(column => {
      const cell = ws.getRow(row).getCell(column);
      if (Number(cell.value) > 0) style(cell, { fill: C.amber, color: C.navy, format: MONEY });
    });
    [8, 9, 10, 11].forEach(column => {
      const cell = ws.getRow(row).getCell(column);
      if (Number(cell.value) > 0) style(cell, { fill: C.red, color: C.white, format: MONEY });
    });
  });
  const last = Math.max(6, report.agingRows.length + 5);
  const total = last + 2;
  setValue(ws.getCell(`A${total}`), 'PORTFOLIO TOTAL', { fill: C.navy, bold: true });
  for (let column = 3; column <= 12; column += 1) {
    const letter = String.fromCharCode(64 + column);
    setFormula(ws.getCell(`${letter}${total}`), totalsFormula(6, last, letter),
      report.agingRows.reduce((sum, item) => {
        if (column === 3) return sum + item.payable;
        if (column === 4) return sum + item.outstanding;
        if (column === 12) return sum + item.arrears;
        return sum + Number(item.buckets[column - 5] || 0);
      }, 0), { fill: C.navy, bold: true, format: MONEY });
  }
  ws.columns = headers.map(() => ({ width: 19 }));
  ws.getColumn(2).width = 24;
  ws.getColumn(1).width = 23;
  ws.views = [{ state: 'frozen', ySplit: 5 }];
  return ws;
}

function statementSheet(wb, report) {
  const ws = wb.addWorksheet('Loan Statement');
  const statement = report.statement;
  ws.columns = [{ width: 8 }, { width: 19 }, { width: 35 }, { width: 24 }, { width: 18 }, { width: 18 }, { width: 18 }, { width: 13 }, { width: 24 }];
  ws.mergeCells('A1:I1');
  setValue(ws.getCell('A1'), 'BURAZA MICRO FINANCE — ONE BORROWER\'S FULL HISTORY', { fill: C.navy, bold: true, size: 15 });
  ws.mergeCells('A3:I3');
  setValue(ws.getCell('A3'), 'Full record of recorded payments and current balance. Missing schedule data is not inferred.', { fill: C.card, color: C.muted, italic: true });
  if (!statement) {
    ws.mergeCells('A5:I5');
    setValue(ws.getCell('A5'), 'Select a loan in the report card to populate this sheet.', { fill: C.card, color: C.amber });
    return ws;
  }
  const dateLabel = value => {
    const date = dateValue(value);
    return date instanceof Date
      ? date.toLocaleDateString('en-GB', { day: '2-digit', month: 'short', year: 'numeric', timeZone: 'UTC' })
      : '';
  };
  const fields = [
    ['Borrower Name', statement.borrower, 'Loan Reference No.', statement.loanId],
    ['National ID', statement.nrc, 'Loan Type', statement.loanType || ''],
    ['Phone', statement.phone, 'Amount Given Out', statement.principal],
    ['Branch', statement.branch, 'Interest Rate', statement.interestRate == null ? '' : statement.interestRate / 100],
    ['Loan Officer', statement.officer, 'Total to Pay Back', statement.total],
    ['', '', 'Dates Given / Final Due', [dateLabel(statement.loanDate), dateLabel(statement.dueDate)].filter(Boolean).join(' / ')],
    ['', '', 'Loan Length', statement.tenureWeeks ? `${statement.tenureWeeks} weeks` : ''],
    ['', '', 'Number of Instalments', statement.installmentCount],
    ['', '', 'Loan Status', statement.status]
  ];
  fields.forEach((field, index) => {
    const row = index + 5;
    setValue(ws.getCell(`A${row}`), field[0], { fill: C.card, bold: true, color: C.muted });
    ws.mergeCells(`B${row}:C${row}`);
    setValue(ws.getCell(`B${row}`), field[1], { fill: C.card });
    setValue(ws.getCell(`D${row}`), field[2], { fill: C.card, bold: true, color: C.muted });
    ws.mergeCells(`E${row}:I${row}`);
    setValue(ws.getCell(`E${row}`), field[3], {
      fill: C.card,
      format: index === 3 ? PERCENT : typeof field[3] === 'number' ? MONEY : undefined
    });
    if (index === 8) {
      const status = String(field[3] || '').toLowerCase();
      const fill = status === 'repaid' || status === 'active' ? C.green
        : status === 'overdue' ? C.amber
          : status === 'default' || status === 'write-off' ? C.red : C.card;
      style(ws.getCell(`E${row}`), {
        fill,
        color: fill === C.amber ? C.navy : C.white,
        bold: fill !== C.card
      });
    }
  });
  tableHeader(ws, 14, ['#', 'Date', 'What Happened', 'Receipt Number', 'Amount Due', 'Amount Paid', 'Balance Left', 'Days Late', 'Received By']);
  const transactions = statement.transactions.map((item, index) => {
    const row = 15 + index;
    const previous = row - 1;
    return [
      index + 1, item.date, item.description, item.receipt, item.due, item.paid,
      index === 0 ? item.balance : { formula: `MAX(0,G${previous}-F${row})`, result: item.balance },
      item.daysLate, item.officer
    ];
  });
  writeRows(ws, 15, transactions, { moneyColumns: [5, 6, 7], dateColumns: [2] });
  statement.transactions.forEach((item, index) => {
    const row = ws.getRow(15 + index);
    if (item.kind === 'disbursement') {
      row.eachCell(cell => style(cell, { fill: C.amber, color: C.navy }));
      style(row.getCell(6), { fill: C.amber, color: C.red, format: MONEY });
      style(row.getCell(7), { fill: C.amber, color: C.blue, format: MONEY });
    } else if (item.kind === 'payment') {
      row.eachCell(cell => style(cell, { fill: C.green, color: C.navy }));
      style(row.getCell(6), { fill: C.green, color: C.navy, format: MONEY });
    } else if (item.kind === 'overdue') {
      row.eachCell(cell => style(cell, { fill: C.red, color: C.white, bold: true }));
    } else if (item.kind === 'upcoming') {
      row.eachCell(cell => {
        style(cell, { fill: C.card, color: C.amber });
        cell.font = { ...cell.font, italic: true };
      });
    }
  });
  const after = 17 + statement.transactions.length;
  const summary = [
    ['Amount Given Out (Principal)', `=${statement.principal}`, statement.principal],
    ['Interest Charged', `=${statement.interest}`, statement.interest],
    ['Total to Pay Back', `=${statement.principal}+${statement.interest}`, statement.total],
    ['Total Paid So Far', `=SUMIF(F15:F${14 + statement.transactions.length},">0",F15:F${14 + statement.transactions.length})`, statement.paid],
    ['Still Owed', `=MAX(0,I${after + 2}-I${after + 3})`, statement.outstanding]
  ];
  summary.forEach((item, index) => {
    const row = after + index;
    setValue(ws.getCell(`F${row}`), item[0], { fill: C.card, bold: true });
    setFormula(ws.getCell(`I${row}`), item[1].replace(/^=/, ''), item[2], { fill: C.card, format: MONEY });
  });
  const nextRow = after + summary.length;
  setValue(ws.getCell(`F${nextRow}`), 'Next Payment Due', { fill: C.card, bold: true });
  setValue(ws.getCell(`I${nextRow}`), statement.nextAmount == null
    ? 'Not recorded'
    : `K ${Number(statement.nextAmount).toLocaleString('en-ZM', { minimumFractionDigits: 2, maximumFractionDigits: 2 })} by ${statement.nextDate}`,
  { fill: C.card, color: statement.nextAmount == null ? C.muted : C.amber });
  setValue(ws.getCell(`F${nextRow + 1}`), 'Payments Completed', { fill: C.card, bold: true });
  setValue(ws.getCell(`I${nextRow + 1}`), statement.installmentCount ? `${statement.completedCount} of ${statement.installmentCount}` : 'Not recorded', { fill: C.card });
  return ws;
}

function disbursementSheet(wb, report) {
  const ws = wb.addWorksheet('Disbursement Register');
  const headers = ['#', 'Date Given', 'Loan ID', 'Borrower Name', 'National ID', 'Phone', 'Loan Officer', 'Purpose of Loan', 'Amount Given Out', 'Interest Rate', 'Total to Pay Back', 'Loan Length', 'Final Due Date', 'Collateral Held', 'Payment Method', 'Approval Reference', 'Running Total Given Out'];
  makeHeader(ws, 'All Loans We Gave Out This Period — Disbursement Register', 'Issued loans · audit trail', report, headers.length);
  tableHeader(ws, 5, headers);
  const rows = report.disbursements.map((item, index) => [
    item.rowNumber, item.date, item.loanId, item.borrower, item.nrc, item.phone,
    item.officer, item.purpose, item.principal,
    Number.isFinite(item.interestRate) ? (item.interestRate > 1 ? item.interestRate / 100 : item.interestRate) : '',
    item.total, item.tenure, item.dueDate, item.collateral, item.paymentMethod,
    item.approvalReference,
    { formula: index ? `Q${index + 5}+I${index + 6}` : `I${index + 6}`, result: item.runningPrincipal }
  ]);
  writeRows(ws, 6, rows, { moneyColumns: [9, 11, 17], percentColumns: [10], dateColumns: [2, 13] });
  report.disbursements.forEach((item, index) => {
    const fill = item.status === 'Default' || item.status === 'Write-Off'
      ? C.red
      : item.status === 'Overdue' ? C.amber : null;
    if (fill) ws.getRow(index + 6).eachCell(cell => style(cell, {
      fill,
      color: fill === C.red ? C.white : C.navy
    }));
  });
  const total = report.disbursements.length + 7;
  setValue(ws.getCell(`A${total}`), 'PERIOD TOTAL', { fill: C.navy, bold: true });
  ['I', 'K'].forEach(letter => setFormula(ws.getCell(`${letter}${total}`), totalsFormula(6, total - 2, letter),
    report.disbursements.reduce((sum, item) => sum + (letter === 'I' ? item.principal : item.total), 0),
    { fill: C.navy, bold: true, format: MONEY }));
  setFormula(ws.getCell(`Q${total}`), report.disbursements.length ? `Q${total - 1}` : '0',
    report.disbursements.length ? report.disbursements[report.disbursements.length - 1].runningPrincipal : 0,
    { fill: C.navy, bold: true, format: MONEY });
  ws.columns = headers.map(() => ({ width: 18 }));
  ws.getColumn(4).width = 25;
  ws.getColumn(8).width = 25;
  ws.getColumn(14).width = 28;
  ws.views = [{ state: 'frozen', xSplit: 3, ySplit: 5 }];
  return ws;
}

function scheduleSheet(wb, report) {
  const ws = wb.addWorksheet('Repayment Schedule');
  ws.columns = [{ width: 15 }, { width: 20 }, { width: 21 }, { width: 18 }, { width: 18 }, { width: 20 }, { width: 20 }, { width: 20 }, { width: 17 }];
  ws.mergeCells('A1:I1');
  setValue(ws.getCell('A1'), 'PAYMENT SCHEDULE PER LOAN — REPAYMENT SCHEDULE', { fill: C.navy, bold: true, size: 14 });
  setValue(ws.getCell('A3'), 'Loan ID', { fill: C.card, bold: true });
  ws.mergeCells('B3:C3');
  setValue(ws.getCell('B3'), report.schedule ? report.schedule.loanId : 'Select a loan in the report card', { fill: C.card });
  const schedule = report.schedule;
  const inputs = [
    ['Principal (K)', schedule ? schedule.principal : '', 'B5'],
    ['Interest Rate', schedule ? schedule.interestRate : '', 'B6'],
    ['Number of Instalments', schedule ? schedule.installmentCount : '', 'B7'],
    ['First Payment Date', schedule ? schedule.firstPaymentDate : '', 'B8'],
    ['Payment Frequency', schedule ? schedule.frequency : '', 'B9']
  ];
  inputs.forEach(([label, value, address]) => {
    const row = Number(address.slice(1));
    setValue(ws.getCell(`A${row}`), label, { fill: C.card, bold: true });
    setValue(ws.getCell(address), value, {
      fill: row >= 8 ? C.amber : C.yellow,
      color: C.navy,
      bold: true,
      format: row === 5 ? MONEY : row === 6 ? PERCENT : row === 8 ? 'dd mmm yyyy' : undefined
    });
    if (row === 8 && value) ws.getCell(address).value = dateValue(value);
  });
  setValue(ws.getCell('D5'), 'Total Interest', { fill: C.card, bold: true });
  setFormula(ws.getCell('E5'), 'B5*B6', schedule ? schedule.interest : '');
  setValue(ws.getCell('D6'), 'Total to Pay Back', { fill: C.card, bold: true });
  setFormula(ws.getCell('E6'), 'B5+E5', schedule ? schedule.total : '');
  tableHeader(ws, 12, ['Instalment #', 'Due Date', 'Opening Balance', 'Amount Due', 'Amount Paid', 'Date Paid', 'Closing Balance', 'Running Balance', 'Status']);
  const rowCount = Math.max(20, Math.min(Number(schedule?.installmentCount) || 0, 120));
  const items = schedule ? schedule.installments : [];
  for (let index = 0; index < rowCount; index += 1) {
    const row = 13 + index;
    const installment = items[index] || {};
    const due = installmentAmountForExcel(installment);
    const actualPaid = installment.amountPaid ?? installment.paidAmount;
    const paid = actualPaid == null || Number(actualPaid) === 0 ? '' : Number(actualPaid);
    const dueDate = installment.dueDate || installment.dueAt || '';
    const formulaDue = `IF(OR($B$7="",A${row}=""),"",IF(A${row}<$B$7,ROUND($E$6/$B$7,2),$E$6-ROUND($E$6/$B$7,2)*($B$7-1)))`;
    const formulaDate = `IF(OR($B$8="",$B$9=""),"",IF(LOWER($B$9)="monthly",EDATE($B$8,A${row}-1),$B$8+(A${row}-1)*IF(LOWER($B$9)="fortnightly",14,7)))`;
    const formulaOpen = index === 0 ? '$E$6' : `G${row - 1}`;
    const formulaClose = `IF(D${row}="","",MAX(0,C${row}-IF(E${row}="",0,E${row})))`;
    const formulaStatus = `IF(A${row}="","",IF(B${row}="","Upcoming",IF(E${row}>=D${row},"Paid ✓",IF(E${row}>0,"Partial",IF(B${row}<TODAY(),"OVERDUE",IF(B${row}=TODAY(),"DUE","Upcoming"))))))`;
    const storedStatus = String(installment.status || '').toLowerCase();
    const calculatedStatus = index >= (Number(schedule?.installmentCount) || 0) ? ''
      : storedStatus === 'paid' || (due !== '' && Number(due) > 0 && paid !== '' && paid >= due) ? 'Paid ✓'
        : storedStatus === 'partial' || (paid !== '' && paid > 0) ? 'Partial'
          : dueDate && dueDate < schedule?.today ? 'OVERDUE'
            : dueDate === schedule?.today ? 'DUE' : 'Upcoming';
    writeRows(ws, row, [[
      { formula: `IF(ROW()-12<=$B$7,ROW()-12,"")`, result: schedule && schedule.installmentCount ? index + 1 <= schedule.installmentCount ? index + 1 : '' : '' },
      { formula: formulaDate, result: dueDate },
      { formula: `IF(A${row}="","",${formulaOpen})`, result: index === 0 ? schedule?.total : items[index - 1]?.closingBalance },
      { formula: formulaDue, result: due },
      paid,
      installment.datePaid || installment.paidAt || '',
      { formula: formulaClose, result: Number.isFinite(Number(installment.closingBalance)) ? Number(installment.closingBalance) : '' },
      { formula: `IF(G${row}="","",G${row})`, result: Number.isFinite(Number(installment.closingBalance)) ? Number(installment.closingBalance) : '' },
      { formula: formulaStatus, result: calculatedStatus }
    ]], { moneyColumns: [3, 4, 5, 7, 8], dateColumns: [2, 6] });
    setFormula(ws.getRow(row).getCell(3), `IF(A${row}="","",${formulaOpen})`, index === 0 ? schedule?.total : items[index - 1]?.closingBalance, { format: MONEY });
    setFormula(ws.getRow(row).getCell(7), formulaClose, Number.isFinite(Number(installment.closingBalance)) ? Number(installment.closingBalance) : '', { format: MONEY });
    setFormula(ws.getRow(row).getCell(8), `IF(G${row}="","",G${row})`, Number.isFinite(Number(installment.closingBalance)) ? Number(installment.closingBalance) : '', { format: MONEY });
    setFormula(ws.getRow(row).getCell(9), formulaStatus, calculatedStatus);
    if (paid !== '' && Number(paid) > 0) style(ws.getRow(row).getCell(5), { fill: C.green, color: C.navy, format: MONEY });
    const statusText = calculatedStatus;
    const statusFill = statusText === 'Paid ✓'
      ? C.green
      : statusText === 'Partial' || statusText === 'DUE'
        ? C.amber
        : statusText === 'OVERDUE' ? C.red : C.card;
    style(ws.getRow(row).getCell(9), {
      fill: statusFill,
      color: statusFill === C.red ? C.white : C.navy,
      bold: statusFill === C.red || statusFill === C.amber
    });
  }
  const first = 13;
  const last = 12 + rowCount;
  setValue(ws.getCell(`A${last + 2}`), 'Check — All Instalments Add Up To:', { fill: C.card, bold: true });
  setFormula(ws.getCell(`D${last + 2}`), `SUM(D${first}:D${last})`, '', { format: MONEY });
  setFormula(ws.getCell(`E${last + 2}`), `IF(ROUND(D${last + 2},2)=ROUND($E$6,2),"✓ Schedule Correct","⚠ Schedule Does Not Match Total — Check Rounding")`, '');
  ws.getCell(`E${last + 2}`).alignment = { wrapText: true };
  return ws;
}

function installmentAmountForExcel(item) {
  const value = item.amountDue ?? item.dueAmount ?? item.amount;
  return Number.isFinite(Number(value)) ? Number(value) : '';
}

function collectionSheet(wb, report) {
  const ws = wb.addWorksheet('Collection Efficiency');
  const headers = ['Officer Name', 'Branch', 'Active Loans', 'Total Portfolio Value', 'Amount Due This Period', 'Amount Collected This Period', 'Collection Rate', 'On-Time Rate', 'Missed Payments', 'Missed Amount', 'PAR > 30 Days', 'New Loans Started', 'Loans Closed', 'Rating'];
  makeHeader(ws, 'How Well Is Money Being Collected? — Collection Efficiency', 'Loan officer performance', report, headers.length);
  tableHeader(ws, 5, headers);
  report.collections.forEach((item, index) => {
    const row = index + 6;
    writeRows(ws, row, [[
      item.officer, item.branch, item.activeLoans, item.portfolio,
      item.amountDue == null ? '' : item.amountDue, item.amountCollected,
      { formula: `IFERROR(F${row}/E${row},"")`, result: item.collectionRate },
      item.onTimeRate == null ? '' : item.onTimeRate, item.missedPayments,
      item.missedAmount, item.par30, item.newLoans, item.closedLoans,
      { formula: `IF(G${row}="","Not available — no installment schedule",IF(G${row}>=0.95,"Excellent",IF(G${row}>=0.90,"Good","Needs Review")))`, result: item.rating }
    ]], { moneyColumns: [4, 5, 6, 10], percentColumns: [7, 8, 11] });
    if (item.dataNote) setValue(ws.getCell(`E${row}`), item.dataNote, { fill: C.amber, color: C.navy });
    const fill = item.collectionRate == null ? C.card
      : item.collectionRate >= 0.95 ? C.green
        : item.collectionRate >= 0.90 ? C.amber : C.red;
    style(ws.getCell(`G${row}`), { fill, color: fill === C.amber ? C.navy : C.white, format: PERCENT, bold: true });
    const ratingFill = item.rating === 'Excellent' ? C.green : item.rating === 'Good' ? C.amber : item.rating === 'Needs Review' ? C.red : C.card;
    style(ws.getCell(`N${row}`), { fill: ratingFill, color: ratingFill === C.amber ? C.navy : C.white, bold: true });
  });
  const noteRow = report.collections.length + 8;
  ws.mergeCells(`A${noteRow}:N${noteRow}`);
  setValue(ws.getCell(`A${noteRow}`), 'CGAP Benchmarks: Collection Rate ≥ 95% Excellent · 90–94% Good · Below 90% Management Review Required · PAR > 30 days below 5% Healthy. Collection/on-time rates remain unavailable when installment schedules are not recorded.', { fill: C.card, color: C.muted, italic: true });
  ws.columns = headers.map(() => ({ width: 20 }));
  ws.getColumn(1).width = 25;
  ws.getColumn(14).width = 36;
  ws.views = [{ state: 'frozen', ySplit: 5 }];
  return ws;
}

function defaultsSheet(wb, report) {
  const ws = wb.addWorksheet('Default Register');
  const headers = ['Loan ID', 'Borrower', 'Amount Given Out', 'Total They Owed', 'Last Payment Date', 'Last Payment Amount', 'Days Since Last Payment', 'Outstanding at Default', 'Date Written Off', 'Reason for Write-Off', 'Authorised By', 'Recovery Action Taken', 'Amount Recovered', 'Net Loss', 'Status'];
  makeHeader(ws, 'Problem Loans & Write-Offs — Default Register', 'Defaulted loans and recorded recoveries', report, headers.length);
  tableHeader(ws, 5, headers);
  report.defaults.forEach((item, index) => {
    const row = index + 6;
    writeRows(ws, row, [[item.loanId, item.borrower, item.principal, item.totalOwed,
      item.lastPaymentDate, item.lastPaymentAmount, item.daysSinceLastPayment,
      item.outstandingAtDefault == null ? '' : item.outstandingAtDefault,
      item.writtenOffDate, item.reason, item.authorizedBy, item.recoveryAction,
      item.recovered == null ? '' : item.recovered,
      item.outstandingAtDefault == null || item.recovered == null ? '' : {
        formula: `MAX(0,H${row}-M${row})`, result: item.netLoss
      }, item.status]], { moneyColumns: [3, 4, 6, 8, 13, 14], dateColumns: [5, 9] });
    const fill = item.status === 'Write-Off' ? C.purple : item.status === 'Recovered' ? C.green : C.red;
    style(ws.getCell(`O${row}`), { fill, color: C.white, bold: true });
    if (item.netLoss != null) style(ws.getCell(`N${row}`), { fill: C.red, color: C.white, bold: true, format: MONEY });
  });
  const total = report.defaults.length + 7;
  setValue(ws.getCell(`A${total}`), 'TOTAL EXPOSURE', { fill: C.navy, bold: true });
  [3, 4, 8, 13, 14].forEach(column => {
    const letter = String.fromCharCode(64 + column);
    const known = report.defaults.reduce((sum, row) => {
      const value = column === 3 ? row.principal : column === 4 ? row.totalOwed
        : column === 8 ? row.outstandingAtDefault : column === 13 ? row.recovered : row.netLoss;
      return sum + (Number.isFinite(Number(value)) ? Number(value) : 0);
    }, 0);
    setFormula(ws.getCell(`${letter}${total}`), totalsFormula(6, total - 2, letter), known, { fill: C.navy, bold: true, format: MONEY });
  });
  ws.columns = headers.map(() => ({ width: 19 }));
  ws.getColumn(10).width = 30;
  ws.getColumn(12).width = 28;
  ws.getColumn(15).width = 16;
  ws.views = [{ state: 'frozen', ySplit: 5 }];
  return ws;
}

function cashbookSheet(wb, report) {
  const ws = wb.addWorksheet('Cash Collections');
  const headers = ['Date', 'Loan ID', 'Borrower', 'Receipt Number', 'Officer', 'Amount Received (Money In)', 'Goes to Principal', 'Goes to Interest', 'Goes to Penalty', 'Money Paid Out (Disbursement)', 'Net Cash This Row', 'Running Cash Total', 'Notes'];
  makeHeader(ws, 'Daily Money In and Out — Cash Collections Register', 'System-recorded activity · cashbook reconciliation', report, headers.length);
  tableHeader(ws, 5, headers);
  report.cashbook.entries.forEach((item, index) => {
    const row = index + 6;
    writeRows(ws, row, [[item.date, item.loanId, item.borrower, item.receipt, item.officer,
      item.received, item.principal == null ? '' : item.principal,
      item.interest == null ? '' : item.interest, item.penalty == null ? '' : item.penalty,
      item.disbursed, { formula: `ROUND(F${row}-J${row},2)`, result: item.net },
      { formula: index ? `ROUND(L${row - 1}+K${row},2)` : `K${row}`, result: item.running },
      item.note]], { moneyColumns: [6, 7, 8, 9, 10, 11, 12], dateColumns: [1] });
    if (item.received > 0) style(ws.getCell(`F${row}`), { fill: C.green, color: C.white, format: MONEY });
    if (item.disbursed > 0) style(ws.getCell(`J${row}`), { fill: C.red, color: C.white, format: MONEY });
    style(ws.getCell(`K${row}`), { color: C.blue, format: MONEY });
    style(ws.getCell(`L${row}`), { color: C.blue, format: MONEY });
  });
  const last = Math.max(6, report.cashbook.entries.length + 5);
  const total = last + 2;
  setValue(ws.getCell(`A${total}`), 'PERIOD TOTALS', { fill: C.navy, bold: true });
  [6, 7, 8, 9, 10].forEach(column => {
    const letter = String.fromCharCode(64 + column);
    const computed = report.cashbook.entries.reduce((sum, item) => sum +
      Math.round(Number(column === 6 ? item.received : column === 7 ? item.principal || 0
        : column === 8 ? item.interest || 0 : column === 9 ? item.penalty || 0 : item.disbursed) * 100), 0) / 100;
    setFormula(ws.getCell(`${letter}${total}`), totalsFormula(6, last, letter), computed, { fill: C.navy, bold: true, format: MONEY });
  });
  setFormula(ws.getCell(`K${total}`), `ROUND(SUM(F6:F${last})-SUM(J6:J${last}),2)`,
    (report.cashbook.received - report.cashbook.disbursed) / 100, { fill: C.navy, bold: true, format: MONEY });
  setFormula(ws.getCell(`L${total}`), report.cashbook.entries.length ? `L${last}` : '0', report.cashbook.running / 100, { fill: C.navy, bold: true, format: MONEY });
  const check = total + 1;
  ws.mergeCells(`A${check}:M${check}`);
  const endingBalance = report.cashbook.entries.length ? `L${last}` : '0';
  setFormula(ws.getCell(`A${check}`), `IF(ROUND(SUM(F6:F${last})-SUM(J6:J${last}),2)=ROUND(${endingBalance},2),"✓ Cashbook Balanced","⚠ CASHBOOK DOES NOT BALANCE — CHECK ENTRIES")`,
    report.cashbook.balanced ? '✓ System-recorded cashbook balanced' : '⚠ Cashbook does not balance', {
      fill: report.cashbook.balanced ? C.green : C.red,
      color: C.white,
      bold: true
    });
  const note = check + 1;
  ws.mergeCells(`A${note}:M${note}`);
  setValue(ws.getCell(`A${note}`), 'Reconciles system-recorded transactions from a zero opening balance; no external/physical cash balance is stored in the application.', { fill: C.card, color: C.muted, italic: true });
  ws.columns = headers.map(() => ({ width: 20 }));
  ws.getColumn(3).width = 25;
  ws.getColumn(13).width = 36;
  ws.views = [{ state: 'frozen', xSplit: 2, ySplit: 5 }];
  return ws;
}

function officerSheet(wb, report) {
  const ws = wb.addWorksheet('Officer Scorecard');
  const headers = ['Officer Name', 'Branch', 'Active Loans', 'Portfolio Value', 'Disbursed This Month', 'Collected This Month', 'Collection Rate', 'On-Time Rate', 'Overdue Loans', 'PAR > 30 Days', 'Defaults', 'New Loans Started', 'Loans Closed', 'Client Visits', 'Ranking'];
  makeHeader(ws, 'Officer Scorecard — Loan Officer Performance', 'Key performance indicators and portfolio summary', report, headers.length);
  tableHeader(ws, 5, headers);
  const rankable = report.officers.map(row => row.collectionRate).filter(value => value != null);
  report.officers.forEach((item, index) => {
    const row = index + 6;
    const rank = item.collectionRate == null ? '' : rankable.filter(value => value > item.collectionRate).length + 1;
    writeRows(ws, row, [[item.officer, item.branch, item.activeLoans, item.portfolioValue,
      item.disbursedThisMonth, item.collectedThisMonth,
      { formula: `IFERROR(F${row}/E${row},"")`, result: item.collectionRate },
      item.onTimeRate == null ? '' : item.onTimeRate,
      item.overdueLoans, item.par30, item.defaults, item.newLoans, item.closedLoans,
      item.clientVisits == null ? 'Not recorded' : item.clientVisits,
      { formula: `IF(G${row}="","",RANK(G${row},G$6:G$${Math.max(6, report.officers.length + 5)},0)&"st")`, result: rank ? `${rank}st` : '' }
    ]], { moneyColumns: [4, 5, 6], percentColumns: [7, 8, 10] });
    const fill = item.collectionRate == null ? C.card : item.collectionRate >= 0.95 ? C.green : item.collectionRate >= 0.90 ? C.amber : C.red;
    style(ws.getCell(`G${row}`), { fill, color: fill === C.amber ? C.navy : C.white, format: PERCENT });
  });
  const row = report.officers.length + 8;
  const targets = [
    ['KPI Targets', 'Minimum', 'Excellent'],
    ['Collection Rate', '≥ 90%', '≥ 95%'],
    ['PAR > 30 Days', '< 10%', '< 5%'],
    ['On-Time Payment Rate', '≥ 75%', '≥ 85%'],
    ['Client Visits Per Month', '≥ 15', '≥ 20'],
    ['New Loans Started Per Month', '≥ 5', '≥ 10'],
    ['Source', 'CGAP Microfinance Performance Standards', 'MIX Market benchmarks']
  ];
  targets.forEach((values, index) => values.forEach((value, column) =>
    setValue(ws.getRow(row + index).getCell(column + 1), value, {
      fill: index === 0 ? C.card : C.alternate, bold: index === 0 || column === 0, color: index === 0 ? C.white : C.muted
    })));
  ws.columns = headers.map(() => ({ width: 18 }));
  ws.getColumn(1).width = 25;
  ws.getColumn(15).width = 16;
  ws.views = [{ state: 'frozen', ySplit: 5 }];
  return ws;
}

function buildPromptWorkbook(report) {
  const wb = new ExcelJS.Workbook();
  wb.creator = 'Buraza Micro Finance';
  wb.subject = 'BMF loan management reports';
  wb.calculation = { fullCalcOnLoad: true, forceFullCalc: true, calcMode: 'auto' };
  directorySheet(wb, report);
  parSheet(wb, report);
  agingSheet(wb, report);
  statementSheet(wb, report);
  disbursementSheet(wb, report);
  scheduleSheet(wb, report);
  collectionSheet(wb, report);
  defaultsSheet(wb, report);
  cashbookSheet(wb, report);
  officerSheet(wb, report);
  return wb;
}

module.exports = { buildPromptWorkbook, C, MONEY, PERCENT };
