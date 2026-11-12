// ╔════════════════════════════════════════════════════════════════════╗
// ║ generateEmployeesReportPdf.js — Relatórios de Colaboradores        ║
// ║ Tabela em A4 paisagem a partir da definição de colunas do          ║
// ║ employeesReports.repository.js (list | payroll | trial)            ║
// ╚════════════════════════════════════════════════════════════════════╝

import {
  C, SERIES, PAGE,
  createThemedDoc, drawFullHeader, drawFooters, drawKpis, makeTable, number, nowBR,
} from './consartPdfTheme.js';


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

export async function generateEmployeesReportPdf(report) {
  const title = `Colaboradores — ${report.title}`;
  const { doc, done } = createThemedDoc({ title });
  const generatedAt = nowBR();

  let y = drawFullHeader(doc, {
    title,
    subtitle: report.subtitle || 'R.H',
    info: [['Colaboradores', number(report.rows.length, 0)]],
  }) + 14;

  // KPIs: quantidade + até 4 colunas de valor totalizadas
  const moneyCols = report.columns.filter((col) => report.totals && col.key in report.totals).slice(0, 4);
  y = drawKpis(doc, y, [
    { label: 'Colaboradores', value: number(report.rows.length, 0), hint: 'Registros no relatório', color: SERIES[0] },
    ...moneyCols.map((col, i) => ({ label: col.label, value: `R$ ${money(report.totals[col.key])}`, hint: 'Total', color: SERIES[(i + 1) % SERIES.length] })),
  ]) + 16;

  const table = makeTable(doc, {
    title: report.title,
    continuation: { title, subtitle: `${report.title} (continuação)` },
    rowH: 16,
    fontSize: 7.5,
    columns: report.columns.map((col) => ({
      label: col.label,
      w: col.width,
      bold: col.bold,
      align: col.type === 'money' || col.type === 'int' ? 'right' : 'left',
    })),
  });

  y = table.section(y);

  if (!report.rows.length) {
    doc.font('Helvetica').fontSize(9).fillColor(C.muted)
      .text('Nenhum colaborador encontrado com os filtros escolhidos.', PAGE.margin, y + 16, { width: table.width, align: 'center' });
  }

  report.rows.forEach((row, index) => {
    y = table.row(y, report.columns.map((col) => formatCell(col, row[col.key])), { index });
  });

  if (report.totals && report.rows.length) {
    table.total(y, report.columns.map((col, index) => {
      if (index === 0) return 'Total';
      return col.key in report.totals ? money(report.totals[col.key]) : '';
    }));
  }

  drawFooters(doc, { title, generatedAt });
  doc.end();
  return done;
}
