// ╔════════════════════════════════════════════════════════════════════╗
// ║ generatePayrollChargesPdf.js — Encargos e Rescisões (CONSART ERP)  ║
// ║ • generatePayrollMonthPdf      → encargos da competência (A4 deit.)║
// ║ • generateTerminationPdf       → demonstrativo da rescisão (A4)    ║
// ╚════════════════════════════════════════════════════════════════════╝

import PDFDocument from 'pdfkit';

const BLUE = '#1d4ed8';
const MUTED = '#6b7280';
const LINE = '#d1d5db';

function money(value) {
  return Number(value || 0).toLocaleString('pt-BR', { minimumFractionDigits: 2, maximumFractionDigits: 2 });
}

function dateBR(value) {
  const text = String(value || '').slice(0, 10);
  const match = text.match(/^(\d{4})-(\d{2})-(\d{2})$/);
  return match ? `${match[3]}/${match[2]}/${match[1]}` : '—';
}

function competenceLabel(competence) {
  const [year, month] = String(competence).split('-');
  return `${month}/${year}`;
}

function startDoc(options) {
  const doc = new PDFDocument({ size: 'A4', margin: 32, bufferPages: true, ...options });
  const chunks = [];
  doc.on('data', (chunk) => chunks.push(chunk));
  const done = new Promise((resolve, reject) => {
    doc.on('end', () => resolve(Buffer.concat(chunks)));
    doc.on('error', reject);
  });
  return { doc, done };
}

function header(doc, title, subtitle) {
  const left = doc.page.margins.left;
  const width = doc.page.width - left - doc.page.margins.right;
  doc.font('Helvetica-Bold').fontSize(14).fillColor('#111').text(title, left, doc.page.margins.top, { width });
  doc.font('Helvetica').fontSize(9).fillColor(MUTED).text(subtitle, { width });
  const y = doc.y + 6;
  doc.moveTo(left, y).lineTo(left + width, y).lineWidth(2).strokeColor(BLUE).stroke();
  doc.y = y + 10;
}

function footer(doc, note) {
  const range = doc.bufferedPageRange();
  for (let i = range.start; i < range.start + range.count; i += 1) {
    doc.switchToPage(i);
    const left = doc.page.margins.left;
    const width = doc.page.width - left - doc.page.margins.right;
    const y = doc.page.height - doc.page.margins.bottom - 10;
    doc.font('Helvetica').fontSize(7).fillColor(MUTED)
      .text(note, left, y, { width: width - 60, lineBreak: false })
      .text(`Página ${i + 1} de ${range.count}`, left, y, { width, align: 'right', lineBreak: false });
  }
}

// ======================================================================
// ENCARGOS DO MÊS
// ======================================================================

const MONTH_COLUMNS = [
  { key: 'full_name', label: 'Colaborador', width: 120, align: 'left' },
  { key: 'gross', label: 'Salário', width: 52 },
  { key: 'dependents', label: 'Dep.', width: 24, int: true },
  { key: 'inss', label: 'INSS', width: 46 },
  { key: 'irrf', label: 'IRRF', width: 46 },
  { key: 'net', label: 'Líquido', width: 54 },
  { key: 'fgts', label: 'FGTS', width: 46 },
  { key: 'patronal', label: 'INSS patr.', width: 50 },
  { key: 'rat_third', label: 'RAT+Terc.', width: 48 },
  { key: 'prov_13', label: 'Prov. 13º', width: 48 },
  { key: 'prov_vacation', label: 'Prov. Férias', width: 52 },
  { key: 'prov_charges', label: 'Enc. prov.', width: 48 },
  { key: 'benefits', label: 'Benefícios', width: 50 },
  { key: 'total_cost', label: 'Custo total', width: 58, bold: true },
];

export async function generatePayrollMonthPdf(report) {
  const { doc, done } = startDoc({ layout: 'landscape' });
  const left = doc.page.margins.left;
  const bottom = () => doc.page.height - doc.page.margins.bottom - 24;

  header(
    doc,
    `Encargos da folha — competência ${competenceLabel(report.competence)}`,
    `Tabelas INSS/IRRF de ${report.table_year} • Regime: ${report.regime_label} • ${report.rows.length} colaborador(es)`,
  );

  const rowHeight = 15;
  const drawRow = (cells, { bold = false, fill = null } = {}) => {
    if (doc.y + rowHeight > bottom()) doc.addPage();
    const y = doc.y;
    let x = left;
    const total = MONTH_COLUMNS.reduce((sum, col) => sum + col.width, 0);
    if (fill) doc.rect(left, y, total, rowHeight).fill(fill);
    MONTH_COLUMNS.forEach((col, index) => {
      doc.font(bold || col.bold ? 'Helvetica-Bold' : 'Helvetica').fontSize(7.2).fillColor('#111')
        .text(cells[index], x + 3, y + 4, { width: col.width - 6, align: col.align || 'right', lineBreak: false, ellipsis: true });
      x += col.width;
    });
    doc.moveTo(left, y + rowHeight).lineTo(left + total, y + rowHeight).lineWidth(0.5).strokeColor(LINE).stroke();
    doc.y = y + rowHeight;
  };

  drawRow(MONTH_COLUMNS.map((col) => col.label), { bold: true, fill: '#eef2ff' });
  report.rows.forEach((row) => {
    drawRow(MONTH_COLUMNS.map((col) => {
      if (col.key === 'full_name') return row.full_name + (row.days < 30 ? ` (${row.days}d)` : '');
      return col.int ? String(row[col.key] || 0) : money(row[col.key]);
    }));
  });
  drawRow(MONTH_COLUMNS.map((col) => {
    if (col.key === 'full_name') return 'Total';
    return col.int ? String(report.totals[col.key] || 0) : money(report.totals[col.key]);
  }), { bold: true, fill: '#f3f4f6' });

  doc.moveDown(1.2);
  if (doc.y + 70 > bottom()) doc.addPage();
  const guides = [
    ['Guia INSS (DCTFWeb): segurados + patronal + RAT + terceiros', report.guides.inss],
    ['Guia FGTS Digital', report.guides.fgts],
    ['DARF IRRF (cód. 0561)', report.guides.irrf],
    ['Folha líquida a pagar', report.guides.net_payroll],
    ['Custo total da folha', report.guides.total_cost],
  ];
  guides.forEach(([label, value]) => {
    const y = doc.y;
    doc.font('Helvetica').fontSize(9).fillColor('#111').text(label, left, y, { width: 330 });
    doc.font('Helvetica-Bold').text(`R$ ${money(value)}`, left + 330, y, { width: 110, align: 'right' });
    doc.y = y + 14;
  });

  footer(doc, 'Estimativa gerencial a partir do cadastro de Colaboradores; não substitui a folha do contador.');
  doc.end();
  return done;
}

// ======================================================================
// RESCISÃO
// ======================================================================

export async function generateTerminationPdf(result, meta = {}) {
  const { doc, done } = startDoc({});
  const left = doc.page.margins.left;
  const width = doc.page.width - left - doc.page.margins.right;

  header(
    doc,
    'Demonstrativo de rescisão (simulação)',
    meta.id ? `Simulação nº ${meta.id} • ${meta.status === 'CONFIRMADA' ? 'Confirmada' : 'Simulação'}` : 'Simulação não salva',
  );

  const info = [
    ['Colaborador', result.full_name],
    ['Cargo', result.position || '—'],
    ['Admissão', dateBR(result.admission_date)],
    ['Desligamento', dateBR(result.termination_date)],
    ['Motivo', result.reason_label],
    ['Aviso prévio', result.notice_days ? `${result.notice_label} • ${result.notice_days} dias` : result.notice_label],
    ['Projeção do aviso', dateBR(result.projected_end)],
    ['Salário base', `R$ ${money(result.salary_base)}`],
  ];
  const colWidth = width / 2;
  info.forEach(([label, value], index) => {
    const x = left + (index % 2) * colWidth;
    const y = doc.y;
    doc.font('Helvetica').fontSize(8).fillColor(MUTED).text(label, x, y, { width: colWidth - 10 });
    doc.font('Helvetica-Bold').fontSize(9.5).fillColor('#111').text(String(value || '—'), x, y + 10, { width: colWidth - 10 });
    doc.y = index % 2 === 1 ? y + 26 : y;
  });
  if (info.length % 2) doc.y += 26;
  doc.moveDown(0.6);

  const section = (title, items, totalLabel, totalValue, negative = false) => {
    doc.font('Helvetica-Bold').fontSize(10).fillColor(BLUE).text(title, left, doc.y, { width });
    doc.moveDown(0.2);
    items.forEach((item) => {
      const y = doc.y;
      doc.font('Helvetica').fontSize(9).fillColor('#111').text(item.label, left, y, { width: width - 200 });
      doc.fillColor(MUTED).text(item.ref || '', left + width - 200, y, { width: 80, align: 'center' });
      doc.fillColor(negative ? '#b91c1c' : '#111')
        .text(`${negative && item.value ? '- ' : ''}${money(item.value)}`, left + width - 120, y, { width: 120, align: 'right' });
      doc.y = y + 14;
      doc.moveTo(left, doc.y - 2).lineTo(left + width, doc.y - 2).lineWidth(0.4).strokeColor(LINE).stroke();
    });
    const y = doc.y + 2;
    doc.font('Helvetica-Bold').fontSize(9.5).fillColor('#111').text(totalLabel, left, y, { width: width - 130 });
    doc.text(money(totalValue), left + width - 120, y, { width: 120, align: 'right' });
    doc.y = y + 20;
  };

  section('Proventos', result.earnings, 'Total de proventos', result.totals.earnings);
  section('Descontos', result.discounts, 'Total de descontos', result.totals.discounts, true);

  const y = doc.y;
  doc.rect(left, y, width, 24).fill('#ecfdf5');
  doc.font('Helvetica-Bold').fontSize(11).fillColor('#065f46')
    .text('Líquido a pagar ao colaborador', left + 8, y + 7, { width: width - 140 })
    .text(`R$ ${money(result.totals.net)}`, left + width - 140, y + 7, { width: 132, align: 'right' });
  doc.y = y + 36;

  section('Custo da empresa', result.company_costs, 'Custo total da rescisão', result.totals.cost);

  doc.font('Helvetica').fontSize(8).fillColor(MUTED).text(
    `Guia FGTS (mês + multa): R$ ${money(result.totals.fgts_guide)}`
      + (result.fgts_balance_estimated ? ' • saldo do FGTS estimado (informe o extrato para o valor exato)' : ''),
    left, doc.y, { width },
  );

  footer(doc, 'Simulação gerencial; confira com o contador antes do pagamento (prazo: 10 dias do desligamento).');
  doc.end();
  return done;
}
