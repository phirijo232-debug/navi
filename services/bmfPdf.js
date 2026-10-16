// BMF PDF rendering (PDFKit) — A4, Arial, 2cm margins, per-page BMF header +
// "CONFIDENTIAL" footer with page numbers. Same data as the Excel builders.
'use strict';

const PDFDocument = require('pdfkit');
const R = require('./bmfReports');

const MARGIN = 56.7; // ~2cm in points

function newDoc(landscape) {
  const doc = new PDFDocument({ size: 'A4', layout: landscape ? 'landscape' : 'portrait', margins: { top: MARGIN, bottom: MARGIN, left: MARGIN, right: MARGIN } });
  let pages = 1;
  doc.on('pageAdded', () => { pages += 1; });
  doc._bmfPages = () => pages;
  return doc;
}

function header(doc, title, dateStr) {
  doc.font('Helvetica-Bold').fontSize(13).text('BURAZA MICRO FINANCE (BMF)', { align: 'center' });
  doc.font('Helvetica').fontSize(10).text('Pryme Vertex Holdings', { align: 'center' });
  doc.moveDown(0.3);
  doc.font('Helvetica-Bold').fontSize(12).text(title, { align: 'center' });
  doc.font('Helvetica').fontSize(9).text(`Date: ${dateStr}`, { align: 'center' });
  doc.moveDown(0.5);
  doc.moveTo(doc.page.margins.left, doc.y).lineTo(doc.page.width - doc.page.margins.right, doc.y).stroke();
  doc.moveDown(0.5);
}

function footerAll(doc) {
  const pages = doc.bufferedPageRange().count;
  for (let i = 0; i < pages; i += 1) {
    doc.switchToPage(i);
    const y = doc.page.height - 36;
    doc.font('Helvetica').fontSize(8).fillColor('#555555')
      .text(`CONFIDENTIAL — page ${i + 1} of ${pages}`, doc.page.margins.left, y, { align: 'center', width: doc.page.width - doc.page.margins.left - doc.page.margins.right });
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
    let x = doc.page.margins.left;
    if (shade) { doc.save().fillColor('#F2F2F2').rect(x, doc.y, totalW, h).fill().restore(); }
    cells.forEach((v, i) => {
      doc.save().rect(x, doc.y, cols[i], h).stroke();
      doc.font(bold ? 'Helvetica-Bold' : 'Helvetica').fontSize(8.5)
        .text(String(v == null ? '' : v), x + 3, doc.y + 3, { width: cols[i] - 6, height: h - 6, ellipsis: true });
      doc.restore();
      x += cols[i];
    });
    doc.y += h;
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
      doc.bufferPages = true;
      const chunks = [];
      doc.on('data', c => chunks.push(c));
      doc.on('end', () => resolve(Buffer.concat(chunks)));
      doc.on('error', reject);
      header(doc, opts.title || 'BMF BUSINESS REPORT', opts.date || new Date().toISOString().slice(0, 10));
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
      doc.bufferPages = true;
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

module.exports = { businessPdf, trackerPdf, table, header, footerAll };
