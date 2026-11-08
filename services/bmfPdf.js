// BMF PDF rendering (PDFKit) — A4, Arial, 2cm margins, per-page BMF header +
// "CONFIDENTIAL" footer with page numbers. Same data as the Excel builders.
'use strict';

const PDFDocument = require('pdfkit');
const R = require('./bmfReports');

const MARGIN = 56.7; // ~2cm in points
const STATEMENT_COLORS = {
  navy: '#0D1117', card: '#161B22', blue: '#2F81F7', green: '#3FB950',
  amber: '#D29922', red: '#F85149', white: '#E6EDF3', muted: '#8B949E'
};

function newDoc(landscape) {
  const doc = new PDFDocument({ size: 'A4', layout: landscape ? 'landscape' : 'portrait', bufferPages: true, margins: { top: MARGIN, bottom: MARGIN, left: MARGIN, right: MARGIN } });
  let pages = 1;
  doc.on('pageAdded', () => { pages += 1; });
  doc._bmfPages = () => pages;
  return doc;
}

function formatPdfDate(value) {
  const text = String(value || '').slice(0, 10);
  if (!/^\d{4}-\d{2}-\d{2}$/.test(text)) return String(value || '');
  const date = new Date(`${text}T00:00:00Z`);
  return Number.isNaN(date.getTime())
    ? String(value)
    : date.toLocaleDateString('en-GB', { day: '2-digit', month: '2-digit', year: 'numeric', timeZone: 'UTC' });
}

function header(doc, title, dateStr, period) {
  doc.font('Helvetica-Bold').fontSize(13).text('BURAZA MICRO FINANCE (BMF)', { align: 'center' });
  doc.font('Helvetica').fontSize(10).text('Pryme Vertex Holdings', { align: 'center' });
  doc.moveDown(0.3);
  doc.font('Helvetica-Bold').fontSize(12).text(title, { align: 'center' });
  const periodLabel = period && (period.from || period.to)
    ? `Period: ${period.from ? formatPdfDate(period.from) : 'Beginning'} to ${period.to ? formatPdfDate(period.to) : 'Current'} · As at ${formatPdfDate(dateStr)}`
    : `As at: ${formatPdfDate(dateStr)}`;
  doc.font('Helvetica').fontSize(9).text(periodLabel, { align: 'center' });
  doc.moveDown(0.5);
  doc.moveTo(doc.page.margins.left, doc.y).lineTo(doc.page.width - doc.page.margins.right, doc.y).stroke();
  doc.moveDown(0.5);
}

function footerAll(doc) {
  const pages = doc.bufferedPageRange().count;
  for (let i = 0; i < pages; i += 1) {
    doc.switchToPage(i);
    const y = doc.page.height - doc.page.margins.bottom - 12;
    doc.font('Helvetica').fontSize(8).fillColor('#555555')
      .text(`CONFIDENTIAL — page ${i + 1} of ${pages}`, doc.page.margins.left, y, {
        align: 'center',
        width: doc.page.width - doc.page.margins.left - doc.page.margins.right,
        lineBreak: false
      });
    doc.fillColor('#000000');
  }
}

function table(doc, headers, rows, opts = {}) {
  const widths = opts.widths || headers.map(() => null);
  const totalW = doc.page.width - doc.page.margins.left - doc.page.margins.right;
  const flex = widths.filter(w => !w).length || 1;
  const fixed = widths.reduce((s, w) => s + (w || 0), 0);
  const cols = widths.map(w => w || Math.max(40, (totalW - fixed) / flex));
  const drawRow = (cells, bold, shade) => {
    const h = 16;
    if (doc.y + h > doc.page.height - doc.page.margins.bottom - 10) doc.addPage();
    const rowY = doc.y;
    let x = doc.page.margins.left;
    if (shade) { doc.save().fillColor('#F2F2F2').rect(x, rowY, totalW, h).fill().restore(); }
    cells.forEach((v, i) => {
      doc.save().rect(x, rowY, cols[i], h).stroke();
      doc.font(bold ? 'Helvetica-Bold' : 'Helvetica').fontSize(8.5)
        .text(String(v == null ? '' : v), x + 3, rowY + 3, {
          width: cols[i] - 6,
          height: h - 6,
          ellipsis: true,
          lineBreak: false
        });
      doc.restore();
      x += cols[i];
    });
    doc.y = rowY + h;
  };
  drawRow(headers, true, false);
  if (!rows.length) {
    doc.font('Helvetica-Oblique').fontSize(9).text(opts.emptyText || '(No records)', { align: 'center' });
    doc.moveDown(0.5);
    return;
  }
  rows.forEach((r, i) => drawRow(r, false, i % 2 === 1));
  doc.moveDown(0.5);
}

function businessPdf(sections, opts = {}) {
  return new Promise((resolve, reject) => {
    try {
      const doc = newDoc(true);
      const chunks = [];
      doc.on('data', c => chunks.push(c));
      doc.on('end', () => resolve(Buffer.concat(chunks)));
      doc.on('error', reject);
      header(doc, opts.title || 'BMF BUSINESS REPORT', opts.date || new Date().toISOString().slice(0, 10), opts.period);
      sections.forEach(s => {
        doc.font('Helvetica-Bold').fontSize(11).text(s.title);
        doc.moveDown(0.3);
        if (s.text) { doc.font('Helvetica').fontSize(9.5).text(s.text); doc.moveDown(0.3); }
        if (s.headers) table(doc, s.headers, s.rows || [], { emptyText: s.emptyText, widths: s.widths });
      });
      doc.font('Helvetica').fontSize(9.5).text('Sign-off: ______________________    Date: __________');
      footerAll(doc);
      doc.end();
    } catch (err) { reject(err); }
  });
}

function trackerPdf(loan, user) {
  return new Promise((resolve, reject) => {
    try {
      const t = R.repaymentTrackerRows(loan, user);
      const doc = newDoc(true);
      const chunks = [];
      doc.on('data', c => chunks.push(c));
      doc.on('end', () => resolve(Buffer.concat(chunks)));
      doc.on('error', reject);
      header(doc, 'LOAN REPAYMENT TRACKING SHEET', new Date().toISOString().slice(0, 10));
      const info = [
        ['Lender', t.header.lender], ['Borrower', t.header.borrower],
        ['NRC/ID No.', t.header.nrc], ['Phone Number', t.header.phone],
        ['Loan Amount', `K ${Number(t.header.principal).toFixed(2)}`],
        ['Interest', `K ${Number(t.header.interest).toFixed(2)}`],
        ['Total Amount Payable', `K ${Number(t.header.total).toFixed(2)}`],
        ['Loan Date', t.header.loanDate], ['Due Date', t.header.dueDate]
      ];
      info.forEach(([k, v]) => {
        doc.font('Helvetica-Bold').fontSize(9.5).text(`${k}: `, { continued: true });
        doc.font('Helvetica').text(String(v == null ? '' : v));
      });
      doc.moveDown(0.5);
      table(doc, t.tableHeaders, t.rows, { emptyText: '(No payments recorded)' });
      doc.font('Helvetica').fontSize(9.5).text('Borrower signature: ______________________    Date: __________');
      footerAll(doc);
      doc.end();
    } catch (err) { reject(err); }
  });
}

function statementPdf(statement, statementDate = new Date().toISOString().slice(0, 10)) {
  return new Promise((resolve, reject) => {
    try {
      const difference = Math.abs((Number(statement.paid) + Number(statement.outstanding)) - Number(statement.total));
      if (difference > 0.01) throw new Error(`PDF aborted: loan ${statement.loanId} does not reconcile.`);
      const progress = Number(statement.total) > 0
        ? Number(statement.paid) / Number(statement.total) * 100
        : 0;
      if (!(progress >= 0 && progress <= 100)) throw new Error(`PDF aborted: progress ${progress.toFixed(1)}% is out of range.`);
      const transactions = Array.isArray(statement.transactions) ? statement.transactions : [];
      if (transactions.length > 22) {
        throw new Error('This loan has too many transactions to fit the required two-page statement. Download the Excel workbook for the complete history.');
      }

      const doc = new PDFDocument({
        size: 'A4',
        layout: 'portrait',
        margins: { top: 36, bottom: 36, left: 40, right: 40 },
        bufferPages: true
      });
      const chunks = [];
      doc.on('data', chunk => chunks.push(chunk));
      doc.on('end', () => resolve(Buffer.concat(chunks)));
      doc.on('error', reject);
      const pageWidth = 595.28;
      const contentWidth = pageWidth - 80;
      const rightEdge = pageWidth - 40;
      const dateText = value => {
        if (!value) return '—';
        const parsed = new Date(`${String(value).slice(0, 10)}T00:00:00Z`);
        return Number.isNaN(parsed.getTime())
          ? String(value)
          : parsed.toLocaleDateString('en-GB', { day: '2-digit', month: 'short', year: 'numeric', timeZone: 'UTC' });
      };
      const money = value => `K ${Number(value || 0).toLocaleString('en-ZM', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;
      const labelValue = (x, y, label, value, width = 220) => {
        doc.font('Helvetica-Bold').fontSize(8).fillColor(STATEMENT_COLORS.muted).text(`${label}:`, x, y, { width: 92, lineBreak: false });
        doc.font('Helvetica').fontSize(9).fillColor(STATEMENT_COLORS.white).text(String(value == null || value === '' ? '—' : value), x + 94, y, { width: width - 94, ellipsis: true, lineBreak: false });
      };

      doc.rect(0, 0, pageWidth, 60).fill(STATEMENT_COLORS.navy);
      doc.font('Helvetica-Bold').fontSize(14).fillColor(STATEMENT_COLORS.white).text('BURAZA MICRO FINANCE', 40, 7, { lineBreak: false });
      doc.font('Helvetica').fontSize(9).fillColor(STATEMENT_COLORS.muted).text('LOAN ACCOUNT STATEMENT', 40, 27, { lineBreak: false });
      doc.font('Helvetica').fontSize(8).text('PRYME VERTEX HOLDINGS', 40, 41, { lineBreak: false });
      doc.font('Helvetica').fontSize(8).fillColor(STATEMENT_COLORS.muted)
        .text(`Statement Date: ${dateText(statementDate)}`, 360, 25, { width: 195, align: 'right', lineBreak: false });

      const infoY = 72;
      doc.rect(40, infoY, contentWidth, 148).fillAndStroke(STATEMENT_COLORS.card, STATEMENT_COLORS.muted);
      const left = [
        ['Borrower Name', statement.borrower],
        ['National ID', statement.nrc],
        ['Phone', statement.phone],
        ['Branch', statement.branch],
        ['Loan Officer', statement.officer]
      ];
      const right = [
        ['Loan Reference No.', statement.loanId],
        ['Loan Type', statement.loanType || ''],
        ['Amount Given Out', money(statement.principal)],
        ['Interest Rate', Number.isFinite(statement.interestRate) ? `${statement.interestRate}% flat` : 'Not recorded'],
        ['Total to Pay Back', money(statement.total)]
      ];
      left.forEach((item, index) => labelValue(50, infoY + 13 + index * 24, item[0], item[1], 245));
      right.forEach((item, index) => labelValue(307, infoY + 13 + index * 24, item[0], item[1], 245));

      const detailsY = 232;
      const details = [
        ['Date Money Given', dateText(statement.loanDate)],
        ['Final Payment Date', dateText(statement.dueDate)],
        ['Loan Length', statement.tenureLabel || (statement.tenureWeeks ? `${statement.tenureWeeks} weeks` : 'Not recorded')],
        ['No. of Instalments', statement.installmentCount || 'Not recorded'],
        ['Status', statement.status]
      ];
      const cellWidth = contentWidth / details.length;
      details.forEach((item, index) => {
        const x = 40 + index * cellWidth;
        doc.rect(x, detailsY, cellWidth, 48).fillAndStroke(STATEMENT_COLORS.card, STATEMENT_COLORS.muted);
        doc.font('Helvetica-Bold').fontSize(7).fillColor(STATEMENT_COLORS.muted)
          .text(item[0], x + 4, detailsY + 7, { width: cellWidth - 8, align: 'center', ellipsis: true });
        const statusColor = item[0] !== 'Status' ? STATEMENT_COLORS.white
          : ['Repaid', 'Active'].includes(statement.status) ? STATEMENT_COLORS.green
            : statement.status === 'Overdue' ? STATEMENT_COLORS.amber
              : statement.status === 'Default' || statement.status === 'Write-Off' ? STATEMENT_COLORS.red : STATEMENT_COLORS.white;
        doc.font('Helvetica-Bold').fontSize(8).fillColor(statusColor)
          .text(String(item[1]), x + 4, detailsY + 25, { width: cellWidth - 8, align: 'center', ellipsis: true });
      });

      const headers = ['#', 'Date', 'What Happened', 'Receipt No.', 'Amount Due', 'Amount Paid', 'Balance Left', 'Days Late', 'Officer'];
      const widths = [22, 57, 101, 83, 54, 54, 70, 34, 38];
      let y = 293;
      const rowHeight = 16;
      let x = 40;
      headers.forEach((value, index) => {
        doc.rect(x, y, widths[index], rowHeight).fillAndStroke(STATEMENT_COLORS.navy, STATEMENT_COLORS.muted);
        doc.font('Helvetica-Bold').fontSize(8).fillColor(STATEMENT_COLORS.white)
          .text(value, x + 2, y + 4, { width: widths[index] - 4, height: rowHeight - 4, ellipsis: true });
        x += widths[index];
      });
      y += rowHeight;
      transactions.forEach((item, index) => {
        const background = item.kind === 'disbursement' ? STATEMENT_COLORS.amber
          : item.kind === 'payment' ? STATEMENT_COLORS.green
            : item.kind === 'overdue' ? STATEMENT_COLORS.red
            : index % 2 ? STATEMENT_COLORS.card : STATEMENT_COLORS.navy;
        const values = [
          index + 1, dateText(item.date), item.description, item.receipt,
          item.due ? money(item.due) : '—', item.paid ? money(item.paid) : '—',
          money(item.balance), item.daysLate || 0, item.officer || '—'
        ];
        let colX = 40;
        values.forEach((value, column) => {
          doc.rect(colX, y, widths[column], rowHeight).fillAndStroke(background, STATEMENT_COLORS.muted);
          const color = item.kind === 'disbursement' && column === 5 ? STATEMENT_COLORS.red
            : background === STATEMENT_COLORS.amber || background === STATEMENT_COLORS.green ? STATEMENT_COLORS.navy
              : item.kind === 'upcoming' ? STATEMENT_COLORS.amber : STATEMENT_COLORS.white;
          const rowFont = item.kind === 'overdue' ? 'Helvetica-Bold'
            : item.kind === 'upcoming' ? 'Helvetica-Oblique' : 'Helvetica';
          doc.font(rowFont).fontSize(8).fillColor(color)
            .text(String(value), colX + 2, y + 4, { width: widths[column] - 4, height: rowHeight - 4, ellipsis: true });
          colX += widths[column];
        });
        y += rowHeight;
      });

      const summaryY = Math.max(y + 12, 585);
      doc.rect(248, summaryY, 307, 104).fillAndStroke(STATEMENT_COLORS.card, STATEMENT_COLORS.blue);
      const summaryLines = [
        ['Amount Given Out (Principal)', money(statement.principal)],
        ['Interest Charged', money(statement.interest)],
        ['Total to Pay Back', money(statement.total)],
        ['Total Paid So Far', money(statement.paid)],
        ['Still Owed', money(statement.outstanding)],
        ['Next Payment Due', statement.nextAmount == null ? 'Not recorded' : `${money(statement.nextAmount)} by ${dateText(statement.nextDate)}`],
        ['Payments Completed', statement.installmentCount ? `${statement.completedCount} of ${statement.installmentCount}` : 'Not recorded']
      ];
      summaryLines.forEach((item, index) => {
        const lineY = summaryY + 6 + index * 13;
        if (lineY > 788) return;
        doc.font('Helvetica-Bold').fontSize(7).fillColor(STATEMENT_COLORS.muted).text(item[0], 258, lineY, { width: 170, lineBreak: false });
        const valColor = item[0] === 'Still Owed' && statement.outstanding > 0 ? STATEMENT_COLORS.amber : STATEMENT_COLORS.white;
        doc.font('Helvetica').fontSize(8).fillColor(valColor).text(item[1], 428, lineY, { width: 118, align: 'right', lineBreak: false, ellipsis: true });
      });

      doc.addPage();
      const barX = 40;
      const barY = 105;
      const barWidth = contentWidth;
      const barHeight = 18;
      doc.font('Helvetica-Bold').fontSize(9).fillColor(STATEMENT_COLORS.white).text('REPAYMENT PROGRESS', barX, 78);
      doc.rect(barX, barY, barWidth, barHeight).fill(STATEMENT_COLORS.card);
      doc.rect(barX, barY, barWidth * progress / 100, barHeight).fill(STATEMENT_COLORS.green);
      doc.font('Helvetica-Bold').fontSize(9).fillColor(STATEMENT_COLORS.white)
        .text(`${progress.toFixed(1)}%`, barX, barY + 5, { width: barWidth, align: 'center' });

      const notice = 'This statement is confidential and intended solely for the named borrower and authorised Buraza Micro Finance staff. Unauthorised disclosure, copying, or distribution is strictly prohibited. For queries, contact: prymebmf@gmail.com';
      doc.font('Helvetica').fontSize(7).fillColor(STATEMENT_COLORS.muted)
        .text(notice, 55, 165, { width: contentWidth - 30, align: 'center', lineGap: 3 });
      const signatureY = 290;
      doc.moveTo(55, signatureY).lineTo(245, signatureY).strokeColor(STATEMENT_COLORS.muted).lineWidth(0.5).stroke();
      doc.moveTo(350, signatureY).lineTo(540, signatureY).stroke();
      doc.font('Helvetica-Bold').fontSize(8).fillColor(STATEMENT_COLORS.white)
        .text('Loan Officer Signature', 55, signatureY + 8, { width: 190, align: 'center' })
        .text('Branch Manager Signature', 350, signatureY + 8, { width: 190, align: 'center' });
      doc.font('Helvetica').fontSize(9).text(statement.officer || 'Loan Officer', 55, signatureY + 32, { width: 190, align: 'center' })
        .text('Branch Manager', 350, signatureY + 32, { width: 190, align: 'center' });
      doc.font('Helvetica').fontSize(8).fillColor(STATEMENT_COLORS.muted)
        .text('Buraza Micro Finance', 55, signatureY + 47, { width: 190, align: 'center' })
        .text('Buraza Micro Finance', 350, signatureY + 47, { width: 190, align: 'center' });
      const pageRange = doc.bufferedPageRange();
      for (let index = 0; index < pageRange.count; index += 1) {
        doc.switchToPage(index);
        doc.font('Helvetica').fontSize(7).fillColor(STATEMENT_COLORS.muted)
          .text(`Page ${index + 1} of ${pageRange.count}`, 40, 792, { width: 100, height: 8, lineBreak: false });
        doc.text('BURAZA MICRO FINANCE · PRYME VERTEX HOLDINGS · Confidential', 150, 792, {
          width: contentWidth - 110, height: 8, align: 'right', lineBreak: false
        });
      }
      doc.end();
    } catch (err) {
      reject(err);
    }
  });
}

module.exports = { businessPdf, trackerPdf, statementPdf, table, header, footerAll };
