// ╔════════════════════════════════════════════════════════════════════╗
// ║ generateEmployeesReportPdf.js — Relatórios de Colaboradores        ║
// ║ Tabela em A4 paisagem a partir da definição de colunas do          ║
// ║ employeesReports.repository.js (list | payroll | trial)            ║
// ╚════════════════════════════════════════════════════════════════════╝

import PDFDocument from 'pdfkit';

const BLUE = '#1d4ed8';
const MUTED = '#6b7280';
const LINE = '#d1d5db';

function money(value) {
  return Number(value || 0).toLocaleString('pt-BR', { minimumFractionDigits: 2, maximumFractionDigits: 2 });
}

function dateBR(value) {
  const match = String(value || '').match(/^(\d{4})-(\d{2})-(\d{2})/);
  return match ? `${match[3]}/${match[2]}/${match[1]}` : '';
}

export function formatCell(col, value) {
  if (col.type === 'money') return money(value);
  if (col.type === 'date') return dateBR(value);
  return value === null || value === undefined ? '' : String(value);
}

export function generateEmployeesReportPdf(report) {
  const doc = new PDFDocument({
    size: 'A4',
    layout: 'landscape',
    margin: 32,
    bufferPages: true,
    info: { Title: `Colaboradores — ${report.title}`, Author: 'CONSART ERP' },
  });

  const chunks = [];
  doc.on('data', (chunk) => chunks.push(chunk));
  const done = new Promise((resolve, reject) => {
    doc.on('end', () => resolve(Buffer.concat(chunks)));
    doc.on('error', reject);
  });

  const left = doc.page.margins.left;
  const width = doc.page.width - left - doc.page.margins.right;
  const bottom = () => doc.page.height - doc.page.margins.bottom - 24;
  const tableWidth = report.columns.reduce((sum, col) => sum + col.width, 0);
  const rowHeight = 16;

  // ---------------- CABEÇALHO ----------------
  doc.font('Helvetica-Bold').fontSize(14).fillColor('#111')
    .text(`Colaboradores — ${report.title}`, left, doc.page.margins.top, { width });
  doc.font('Helvetica').fontSize(9).fillColor(MUTED).text(report.subtitle, { width });
  const lineY = doc.y + 6;
  doc.moveTo(left, lineY).lineTo(left + width, lineY).lineWidth(2).strokeColor(BLUE).stroke();
  doc.y = lineY + 10;

  const drawRow = (cells, { bold = false, fill = null } = {}) => {
    const y = doc.y;
    let x = left;
    if (fill) doc.rect(left, y, tableWidth, rowHeight).fill(fill);
    report.columns.forEach((col, index) => {
      const align = col.type === 'money' || col.type === 'int' ? 'right' : 'left';
      doc.font(bold || col.bold ? 'Helvetica-Bold' : 'Helvetica').fontSize(7.5).fillColor('#111')
        .text(cells[index], x + 3, y + 4.5, { width: col.width - 6, align, lineBreak: false, ellipsis: true });
      x += col.width;
    });
    doc.moveTo(left, y + rowHeight).lineTo(left + tableWidth, y + rowHeight).lineWidth(0.5).strokeColor(LINE).stroke();
    doc.y = y + rowHeight;
  };

  const headerRow = () => drawRow(report.columns.map((col) => col.label), { bold: true, fill: '#eef2ff' });

  headerRow();

  if (!report.rows.length) {
    doc.moveDown(0.8);
    doc.font('Helvetica').fontSize(9).fillColor(MUTED)
      .text('Nenhum colaborador encontrado com os filtros escolhidos.', left, doc.y, { width });
  }

  report.rows.forEach((row) => {
    if (doc.y + rowHeight > bottom()) {
      doc.addPage();
      headerRow();
    }
    drawRow(report.columns.map((col) => formatCell(col, row[col.key])));
  });

  if (report.totals && report.rows.length) {
    if (doc.y + rowHeight > bottom()) doc.addPage();
    drawRow(report.columns.map((col, index) => {
      if (index === 0) return 'Total';
      return col.key in report.totals ? money(report.totals[col.key]) : '';
    }), { bold: true, fill: '#f3f4f6' });
  }

  // ---------------- RODAPÉ ----------------
  const range = doc.bufferedPageRange();
  for (let i = range.start; i < range.start + range.count; i += 1) {
    doc.switchToPage(i);
    // escrever abaixo da margem inferior abriria uma página nova
    doc.page.margins.bottom = 0;
    const y = doc.page.height - 32 - 10;
    doc.font('Helvetica').fontSize(7).fillColor(MUTED)
      .text('CONSART ERP — Colaboradores', left, y, { width: width - 60, lineBreak: false })
      .text(`Página ${i + 1} de ${range.count}`, left, y, { width, align: 'right', lineBreak: false });
  }

  doc.end();
  return done;
}
