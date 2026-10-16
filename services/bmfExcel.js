// BMF Excel rendering (ExcelJS) — spec styling: yellow/red/dark-red/dark-blue/
// dark-green/purple headers, merged banners, fixed column widths, thin borders.
'use strict';

const ExcelJS = require('exceljs');
const R = require('./bmfReports');

const ARIAL = 'Arial';
const THIN = { style: 'thin', color: { argb: 'FF000000' } };
const BORDER_ALL = { top: THIN, left: THIN, bottom: THIN, right: THIN };

function styleHeaderCell(cell, fillArgb, fontColorArgb) {
  cell.font = { name: ARIAL, size: 11, bold: true, color: { argb: fontColorArgb || 'FF000000' } };
  cell.fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: fillArgb } };
  cell.alignment = { horizontal: 'center', vertical: 'middle', wrapText: true };
  cell.border = BORDER_ALL;
}

function styleDataCell(cell, opts = {}) {
  cell.font = { name: ARIAL, size: 11, bold: Boolean(opts.bold), italic: Boolean(opts.italic) };
  cell.alignment = { horizontal: opts.align || 'left', vertical: 'middle', wrapText: true };
  cell.border = BORDER_ALL;
  if (opts.fill) cell.fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: opts.fill } };
  if (opts.color) cell.font.color = { argb: opts.color };
}

function headerRow(ws, rowNum, headers, fillArgb, fontColorArgb) {
  const row = ws.getRow(rowNum);
  headers.forEach((h, i) => {
    const cell = row.getCell(i + 1);
    cell.value = h;
    styleHeaderCell(cell, fillArgb, fontColorArgb);
  });
  row.height = 35;
  row.commit();
}

function dataRows(ws, startRow, rows, opts = {}) {
  rows.forEach((r, ri) => {
    const row = ws.getRow(startRow + ri);
    r.forEach((v, ci) => {
      const cell = row.getCell(ci + 1);
      cell.value = v == null ? '' : v;
      styleDataCell(cell, { align: opts.align && opts.align[ci] });
    });
    row.commit();
  });
  return startRow + rows.length;
}

function emptyRow(ws, rowNum, colCount, text) {
  ws.mergeCells(rowNum, 1, rowNum, colCount);
  const cell = ws.getRow(rowNum).getCell(1);
  cell.value = text;
  styleDataCell(cell, { italic: true, align: 'center' });
  ws.getRow(rowNum).commit();
}

function titleBanner(ws, text, colCount) {
  ws.mergeCells(1, 1, 2, colCount);
  const cell = ws.getRow(1).getCell(1);
  cell.value = String(text || '').toUpperCase();
  cell.font = { name: ARIAL, size: 14, bold: true };
  cell.fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: 'FFFFFF00' } };
  cell.alignment = { horizontal: 'center', vertical: 'middle' };
  cell.border = BORDER_ALL;
  ws.getRow(1).height = 37;
  ws.getRow(1).commit();
  ws.getRow(2).commit();
}

const STATUS_COLORS = {
  pending: 'FFFF8C00', active: 'FF006400', overdue: 'FFFF0000',
  default: 'FF8B0000', repaid: 'FF0000FF', liquidated: 'FF6A0DAD', declined: 'FF808080'
};

function statusCell(cell, status) {
  styleDataCell(cell, { align: 'center' });
  const key = String(status || '').toLowerCase();
  if (STATUS_COLORS[key]) {
    cell.font = { name: ARIAL, size: 11, bold: true, color: { argb: STATUS_COLORS[key] } };
  }
}

function buildTrackerSheet(wb, loan, user) {
  const t = R.repaymentTrackerRows(loan, user);
  const ws = wb.addWorksheet('Repayment Tracker');
  ws.columns = [
    { width: 22.43 }, { width: 14.57 }, { width: 19.86 }, { width: 18 },
    { width: 16 }, { width: 15.86 }, { width: 14.57 }, { width: 16.71 }
  ];
  titleBanner(ws, 'LOAN REPAYMENT TRACKING SHEET', 8);
  const labels = [
    ['Lender', t.header.lender], ['Borrower', t.header.borrower],
    ['NRC/ID No.', t.header.nrc], ['Phone Number', t.header.phone],
    ['Loan Amount', t.header.principal], ['Interest', t.header.interest],
    ['Total Amount Payable', t.header.total], ['Loan Date', t.header.loanDate],
    ['Due Date', t.header.dueDate]
  ];
  labels.forEach(([label, value], i) => {
    const r = 3 + i;
    ws.mergeCells(r, 2, r, 8);
    const lc = ws.getRow(r).getCell(1);
    lc.value = label;
    lc.font = { name: ARIAL, size: 11, bold: true };
    lc.border = BORDER_ALL;
    const vc = ws.getRow(r).getCell(2);
    vc.value = value == null ? '' : value;
    vc.font = { name: ARIAL, size: 11 };
    vc.border = BORDER_ALL;
    ws.getRow(r).commit();
  });
  headerRow(ws, 14, t.tableHeaders, 'FFFFFF00');
  dataRows(ws, 15, t.rows);
  return ws;
}

function genericSheet(wb, name, headers, rows, opts = {}) {
  const ws = wb.addWorksheet(name);
  ws.columns = headers.map(() => ({ width: opts.width || 20 }));
  if (opts.title) titleBanner(ws, opts.title, headers.length);
  const hr = opts.title ? 4 : 1;
  headerRow(ws, hr, headers, opts.fill || 'FFFFFF00', opts.fontColor);
  if (!rows.length && opts.emptyText) emptyRow(ws, hr + 1, headers.length, opts.emptyText);
  else dataRows(ws, hr + 1, rows);
  return ws;
}

async function buildDailyWorkbook(loans, users, today) {
  const wb = new ExcelJS.Workbook();
  wb.creator = 'BMF';
  const d = R.dailySummaryRows(loans, users, today);
  genericSheet(wb, 'Daily Summary', d.headers, d.rows, { title: 'BMF DAILY SUMMARY', width: 26 });
  const a = R.allLoansRows(loans, users, today);
  const wsAll = genericSheet(wb, 'All Loans', a.headers, a.rows, { title: 'BMF ALL LOANS', width: 18 });
  const statusCol = a.headers.findIndex(h => /status/i.test(h)) + 1;
  if (statusCol > 0) {
    wsAll.eachRow((row, n) => { if (n > 4) statusCell(row.getCell(statusCol), row.getCell(statusCol).value); });
  }
  const p = R.paymentsTodayRows(loans, users, today);
  genericSheet(wb, 'Payments Today', p.headers, p.rows, { title: 'BMF PAYMENTS TODAY', width: 20, emptyText: '(No payments recorded on this date)' });
  const o = R.overdueRows(loans, users, today);
  genericSheet(wb, 'Overdue', o.headers, o.rows, { title: 'BMF OVERDUE LOANS', width: 19, fill: 'FFFF0000', fontColor: 'FFFFFFFF', emptyText: '(No overdue loans on this date)' });
  const df = R.defaulterRows(loans, users, today);
  genericSheet(wb, 'Defaulters', df.headers, df.rows, { title: 'BMF DEFAULTERS', width: 19, fill: 'FF8B0000', fontColor: 'FFFFFFFF', emptyText: '(No defaulters on this date)' });
  const mc = R.monthlyCollectionsRows(loans, users, String(today || '').slice(0, 7));
  const wsMc = genericSheet(wb, 'Monthly Collections', mc.headers, mc.rows, { title: 'BMF MONTHLY COLLECTIONS', width: 20, fill: 'FF00008B', fontColor: 'FFFFFFFF', emptyText: '(No collections in this month)' });
  if (mc.rows.length) {
    const r = wsMc.getRow(mc.rows.length + 2);
    r.getCell(1).value = 'TOTAL';
    r.getCell(4).value = mc.meta.total;
    [1, 4].forEach(c => { const cell = r.getCell(c); cell.font = { name: ARIAL, size: 11, bold: true }; cell.fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: 'FFFFFF00' } }; cell.border = BORDER_ALL; });
    r.commit();
  }
  const bs = R.borrowerStatementRows(loans, users);
  const wsBs = wb.addWorksheet('Borrower Statements');
  wsBs.columns = [22, 18, 16, 16, 16].map(width => ({ width }));
  titleBanner(wsBs, 'BMF BORROWER STATEMENTS', 5);
  let r = 4;
  if (!bs.sections.length) { emptyRow(wsBs, r, 5, '(No borrowers)'); }
  bs.sections.forEach(s => {
    wsBs.mergeCells(r, 1, r, 5);
    const c = wsBs.getRow(r).getCell(1);
    c.value = `${s.borrower} — ${s.email} — ${s.phone}`;
    c.font = { name: ARIAL, size: 11, bold: true };
    c.border = BORDER_ALL; wsBs.getRow(r).commit(); r += 1;
    headerRow(wsBs, r, ['Loan ID', 'Principal (K)', 'Interest (K)', 'Paid (K)', 'Outstanding (K)'], 'FFFFFF00'); r += 1;
    dataRows(wsBs, r, s.loans); r += s.loans.length;
  });
  const al = R.approvalLogRows(loans, users);
  genericSheet(wb, 'Loan Approval Log', al.headers, al.rows, { title: 'BMF LOAN APPROVAL LOG', width: 18, fill: 'FF006400', fontColor: 'FFFFFFFF', emptyText: '(No approvals in range)' });
  const ir = R.interestRevenueRows(loans, users, String(today || '').slice(0, 7));
  const wsIr = wb.addWorksheet('Interest & Revenue');
  wsIr.columns = [30, 20, 20, 20, 20, 20].map(width => ({ width }));
  titleBanner(wsIr, 'BMF INTEREST & REVENUE', 6);
  headerRow(wsIr, 4, ir.summaryHeaders, 'FF006400', 'FFFFFFFF');
  dataRows(wsIr, 5, ir.summary);
  headerRow(wsIr, 5 + ir.summary.length + 1, ir.detailHeaders, 'FFFFFF00');
  dataRows(wsIr, 5 + ir.summary.length + 2, ir.detail);
  const rp = R.repaymentPerformanceRows(loans, users, today);
  const wsRp = wb.addWorksheet('Repayment Performance');
  wsRp.columns = [26, 24, 12, 12, 12, 18, 14].map(width => ({ width }));
  titleBanner(wsRp, 'BMF REPAYMENT PERFORMANCE', 7);
  headerRow(wsRp, 4, rp.summaryHeaders, 'FF6A0DAD', 'FFFFFFFF');
  dataRows(wsRp, 5, rp.summary);
  headerRow(wsRp, 5 + rp.summary.length + 1, rp.tableHeaders, 'FFFFFF00');
  const start = 5 + rp.summary.length + 2;
  dataRows(wsRp, start, rp.table);
  const riskCol = rp.tableHeaders.findIndex(h => /risk/i.test(h)) + 1;
  const RISK_FILL = { Low: 'FF008000', Medium: 'FFFFA500', High: 'FFFF0000', Critical: 'FF8B0000' };
  rp.table.forEach((row, i) => {
    const cell = wsRp.getRow(start + i).getCell(riskCol);
    const key = String(row[riskCol - 1]);
    if (RISK_FILL[key]) {
      cell.fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: RISK_FILL[key] } };
      cell.font = { name: ARIAL, size: 11, bold: key === 'Critical', color: { argb: 'FFFFFFFF' } };
    }
  });
  return wb;
}

async function workbookToBuffer(wb) {
  return Buffer.from(await wb.xlsx.writeBuffer());
}

module.exports = {
  buildTrackerSheet, genericSheet, buildDailyWorkbook, workbookToBuffer,
  headerRow, dataRows, emptyRow, titleBanner, styleHeaderCell, styleDataCell
};
