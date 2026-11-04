// ╔══════════════════════════════════════════════════════════════════════╗
// ║ generationSimpleListPdf.js — PDF de listas de cadastro simples        ║
// ║ (Grades, Unidades...) no padrão consartPdfTheme.js                    ║
// ║                                                                      ║
// ║ generateSimpleListPdf({                                              ║
// ║   title, subtitle, info: [[label, valor]], kpis: [{label,value,hint}],║
// ║   columns: [{ key, label, w?, align?, bold?, format?(v,row) }],      ║
// ║   rows, emptyText,                                                   ║
// ║ }) -> Promise<Buffer>                                                ║
// ╚══════════════════════════════════════════════════════════════════════╝

import {
  C, SERIES, PAGE,
  createThemedDoc, drawFullHeader, drawFooters, drawKpis, makeTable, nowBR,
} from './consartPdfTheme.js';

function cellValue(col, row) {
  const raw = row?.[col.key];
  if (typeof col.format === 'function') return col.format(raw, row);
  return raw === null || raw === undefined ? '' : String(raw);
}

export async function generateSimpleListPdf({
  title = 'Relatório',
  subtitle = '',
  info = [],
  kpis = [],
  columns = [],
  rows = [],
  emptyText = 'Nenhum registro encontrado com os filtros escolhidos.',
  layout = 'portrait',
} = {}) {
  const { doc, done } = createThemedDoc({ title, layout });
  const generatedAt = nowBR();

  let y = drawFullHeader(doc, {
    title,
    subtitle,
    info: [...info, ['Emitido em', generatedAt]],
  }) + 14;

  if (kpis.length) {
    y = drawKpis(doc, y, kpis.map((k, i) => ({ color: SERIES[i % SERIES.length], ...k }))) + 16;
  }

  const table = makeTable(doc, {
    title: 'Registros',
    continuation: { title, subtitle: `${title} (continuação)` },
    rowH: 17,
    fontSize: 8,
    headFontSize: 8,
    columns: columns.map((col) => ({ label: col.label, w: col.w, align: col.align, bold: col.bold })),
  });

  y = table.section(y);

  if (!rows.length) {
    doc.font('Helvetica').fontSize(9).fillColor(C.muted)
      .text(emptyText, PAGE.margin, y + 16, { width: table.width, align: 'center' });
  }

  rows.forEach((row, index) => {
    y = table.row(y, columns.map((col) => {
      const text = cellValue(col, row);
      const color = typeof col.color === 'function' ? col.color(row) : undefined;
      return color ? { text, color } : text;
    }), { index });
  });

  drawFooters(doc, { title, generatedAt });
  doc.end();
  return done;
}

export default generateSimpleListPdf;
