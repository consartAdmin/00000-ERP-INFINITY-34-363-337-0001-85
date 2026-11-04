// ╔════════════════════════════════════════════════════════════════════╗
// ║ generatePayrollChargesPdf.js — Encargos e Rescisões (CONSART ERP)  ║
// ║ • generatePayrollMonthPdf      → encargos da competência (A4 deit.)║
// ║ • generateTerminationPdf       → demonstrativo da rescisão (A4)    ║
// ╚════════════════════════════════════════════════════════════════════╝

import {
  C, PAGE,
  SERIES, createThemedDoc, drawFullHeader, autoCompactHeader, drawFooters, drawKpis, contentBottom, nowBR,
} from './consartPdfTheme.js';

// Paleta do layout padrão
const BLUE = C.blue;
const MUTED = C.muted;
const LINE = C.border;

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

function startDoc({ layout = 'portrait', title = 'Encargos e Rescisões' } = {}) {
  const started = createThemedDoc({ title, layout });
  started.title = title;
  return started;
}

// Cabeçalho padrão (azul-marinho + faixa verde-água); páginas novas ganham o cabeçalho compacto
function header(doc, title, subtitle, info = []) {
  doc.y = drawFullHeader(doc, { title, subtitle, info }) + 14;
  autoCompactHeader(doc, { title, subtitle });
}

// Observação no fim do conteúdo + rodapé padrão em todas as páginas
function footer(doc, note, title) {
  if (note) {
    const left = doc.page.margins.left;
    const width = doc.page.width - left - doc.page.margins.right;
    if (doc.y + 24 > contentBottom(doc)) doc.addPage();
    doc.font('Helvetica-Oblique').fontSize(7.5).fillColor(MUTED).text(note, left, doc.y + 8, { width });
  }
  drawFooters(doc, { title, generatedAt: nowBR() });
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
  const { doc, done } = startDoc({ layout: 'landscape', title: 'Encargos da folha' });
  const left = doc.page.margins.left;
  const bottom = () => contentBottom(doc);

  header(
    doc,
    `Encargos da folha — competência ${competenceLabel(report.competence)}`,
    `Tabelas INSS/IRRF de ${report.table_year} · Regime: ${report.regime_label}`,
    [
      ['Competência', competenceLabel(report.competence)],
      ['Regime', report.regime_label],
      ['Colaboradores', String(report.rows.length)],
    ],
  );

  doc.y = drawKpis(doc, doc.y, [
    { label: 'Guia INSS', value: `R$ ${money(report.guides.inss)}`, hint: 'Segurados + patronal + RAT + terceiros', color: SERIES[0] },
    { label: 'FGTS', value: `R$ ${money(report.guides.fgts)}`, hint: 'FGTS Digital', color: SERIES[1] },
    { label: 'IRRF', value: `R$ ${money(report.guides.irrf)}`, hint: 'DARF cód. 0561', color: SERIES[2] },
    { label: 'Folha líquida', value: `R$ ${money(report.guides.net_payroll)}`, hint: 'A pagar aos colaboradores', color: SERIES[5] },
    { label: 'Custo total', value: `R$ ${money(report.guides.total_cost)}`, hint: 'Custo da folha', color: C.red },
  ]) + 16;

  const rowHeight = 15;
  const headCells = MONTH_COLUMNS.map((col) => col.label);
  const drawRow = (cells, { bold = false, fill = null, color = C.text, isHead = false } = {}) => {
    if (doc.y + rowHeight > bottom()) {
      doc.addPage();
      if (!isHead) drawRow(headCells, { bold: true, fill: C.blue, color: C.white, isHead: true });
    }
    const y = doc.y;
    let x = left;
    const total = MONTH_COLUMNS.reduce((sum, col) => sum + col.width, 0);
    if (fill) doc.rect(left, y, total, rowHeight).fill(fill);
    MONTH_COLUMNS.forEach((col, index) => {
      doc.font(bold || col.bold ? 'Helvetica-Bold' : 'Helvetica').fontSize(7.2).fillColor(color)
        .text(cells[index], x + 3, y + 4, { width: col.width - 6, align: col.align || 'right', lineBreak: false, ellipsis: true });
      x += col.width;
    });
    doc.moveTo(left, y + rowHeight).lineTo(left + total, y + rowHeight).lineWidth(0.5).strokeColor(LINE).stroke();
    doc.y = y + rowHeight;
  };

  drawRow(headCells, { bold: true, fill: C.blue, color: C.white, isHead: true });
  report.rows.forEach((row, index) => {
    drawRow(MONTH_COLUMNS.map((col) => {
      if (col.key === 'full_name') return row.full_name + (row.days < 30 ? ` (${row.days}d)` : '');
      return col.int ? String(row[col.key] || 0) : money(row[col.key]);
    }), { fill: index % 2 ? C.zebra : null });
  });
  drawRow(MONTH_COLUMNS.map((col) => {
    if (col.key === 'full_name') return 'Total';
    return col.int ? String(report.totals[col.key] || 0) : money(report.totals[col.key]);
  }), { bold: true, fill: C.totalFill, color: C.navy });

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

  footer(doc, 'Estimativa gerencial a partir do cadastro de Colaboradores; não substitui a folha do contador.', 'Encargos da folha');
  doc.end();
  return done;
}

// ======================================================================
// RESCISÃO
// ======================================================================

export async function generateTerminationPdf(result, meta = {}) {
  const { doc, done } = startDoc({ title: 'Demonstrativo de rescisão' });
  const left = doc.page.margins.left;
  const width = doc.page.width - left - doc.page.margins.right;

  header(
    doc,
    'Demonstrativo de rescisão (simulação)',
    meta.id ? `Simulação nº ${meta.id} · ${meta.status === 'CONFIRMADA' ? 'Confirmada' : 'Simulação'}` : 'Simulação não salva',
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
    doc.font('Helvetica-Bold').fontSize(11).fillColor(C.navy).text(title, left, doc.y, { width });
    doc.rect(left, doc.y + 1, 34, 2).fill(C.teal);
    doc.moveDown(0.5);
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
  doc.rect(left, y, width, 24).fill(C.navy);
  doc.rect(left, y + 24, width, 2).fill(C.teal);
  doc.font('Helvetica-Bold').fontSize(11).fillColor(C.white)
    .text('Líquido a pagar ao colaborador', left + 8, y + 7, { width: width - 140 })
    .text(`R$ ${money(result.totals.net)}`, left + width - 140, y + 7, { width: 132, align: 'right' });
  doc.y = y + 36;

  section('Custo da empresa', result.company_costs, 'Custo total da rescisão', result.totals.cost);

  doc.font('Helvetica').fontSize(8).fillColor(MUTED).text(
    `Guia FGTS (mês + multa): R$ ${money(result.totals.fgts_guide)}`
      + (result.fgts_balance_estimated ? ' • saldo do FGTS estimado (informe o extrato para o valor exato)' : ''),
    left, doc.y, { width },
  );

  footer(doc, 'Simulação gerencial; confira com o contador antes do pagamento (prazo: 10 dias do desligamento).', 'Demonstrativo de rescisão');
  doc.end();
  return done;
}
