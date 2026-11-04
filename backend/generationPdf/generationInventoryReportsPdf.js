// ╔══════════════════════════════════════════════════════════════════════╗
// ║ generationInventoryReportsPdf.js                                    ║
// ║ PDF Report — Inventário / Importação de Inventário                  ║
// ║ CONSART ERP | ESM                                                   ║
// ║ ✅ Barcode                                                          ║
// ║ ✅ Estoque anterior                                                  ║
// ║ ✅ Quantidade contada                                                ║
// ║ ✅ Diferença                                                         ║
// ║ ✅ Novo estoque                                                      ║
// ╚══════════════════════════════════════════════════════════════════════╝

import {
  C, SERIES, PAGE,
  createThemedDoc, drawFullHeader, drawFooters, drawKpis, drawSectionTitle, makeTable, contentBottom, nowBR,
} from './consartPdfTheme.js';

function safe(value, fallback = '') {
  if (value === null || value === undefined || value === '') return fallback;
  return String(value);
}

function qty(value) {
  if (value === null || value === undefined || value === '') return '-';

  const n = Number(value);
  if (!Number.isFinite(n)) return safe(value, '-');

  return n.toLocaleString('pt-BR', {
    minimumFractionDigits: 3,
    maximumFractionDigits: 3,
  });
}

function calcDifference(row) {
  const diff = row.difference_qty ?? row.difference ?? null;
  if (diff !== null && diff !== undefined && diff !== '') return diff;

  const counted = Number(row.counted_qty ?? row.quantity ?? 0);
  const system = Number(row.system_stock_qty ?? row.previous_stock_qty ?? row.old_stock_qty ?? 0);

  if (!Number.isFinite(counted) || !Number.isFinite(system)) return null;
  return counted - system;
}

function calcNewStock(row) {
  const newStock =
    row.new_stock_qty ??
    row.new_stock ??
    row.stock_after ??
    row.counted_qty ??
    row.quantity ??
    null;

  return newStock;
}

function normalizeArray(value) {
  return Array.isArray(value) ? value : [];
}

const REPORT_TITLE = 'Relatório de Inventário';

function section(doc, y, title, columns, rows, emptyMessage, rowValue) {
  const table = makeTable(doc, {
    title: `${title} (${rows.length})`,
    continuation: { title: REPORT_TITLE, subtitle: `${title} (continuação)` },
    rowH: 18,
    fontSize: 6.8,
    columns: columns.map((c) => ({ label: c.label, w: c.width, align: c.align })),
  });

  if (!rows.length) {
    if (y + 50 > contentBottom(doc)) y = table.newPage();
    y = drawSectionTitle(doc, y, `${title} (0)`);
    doc.font('Helvetica').fontSize(8).fillColor(C.muted).text(emptyMessage, PAGE.margin, y + 2);
    return y + 26;
  }

  y = table.section(y);
  rows.forEach((row, index) => {
    y = table.row(y, columns.map((col) => rowValue(col, row)), { index });
  });
  return y + 16;
}

export function generateInventoryImportReportPdf(payload = {}) {
  const inserted = normalizeArray(payload.inserted);
  const ignored = normalizeArray(payload.ignored);
  const errors = normalizeArray(payload.errors);

  const { doc } = createThemedDoc({ title: REPORT_TITLE, subject: 'Inventário', collect: false });
  const generatedAt = nowBR();

  let y = drawFullHeader(doc, {
    title: REPORT_TITLE,
    subtitle: 'Importação / contagem de inventário',
    info: [
      ['Inventário', safe(payload.inventory_id, '-')],
      ['Descrição', safe(payload.inventory_description || payload.description, '-')],
      ['Arquivo', safe(payload.filename, '-')],
      ['Usuário', safe(payload.user_name || payload.user, '-')],
    ],
  }) + 14;

  y = drawKpis(doc, y, [
    { label: 'Itens inseridos', value: String(inserted.length), hint: 'Contagens gravadas', color: SERIES[1] },
    { label: 'Itens ignorados', value: String(ignored.length), hint: 'Linhas não importadas', color: SERIES[2] },
    { label: 'Erros', value: String(errors.length), hint: 'Linhas com erro', color: errors.length ? C.red : SERIES[7] },
  ]) + 16;

  const insertedColumns = [
    { label: 'Linha', key: 'line', width: 34, align: 'center' },
    { label: 'Barcode', width: 95, value: (r) => r.barcode || r.product_barcode || r.ean || '-' },
    { label: 'Código', key: 'product_code', width: 70 },
    { label: 'Produto', key: 'product_name', width: 245 },
    { label: 'Unid.', key: 'unit', width: 45 },
    { label: 'Est. Ant.', width: 70, align: 'right', value: (r) => qty(r.system_stock_qty ?? r.previous_stock_qty ?? r.old_stock_qty) },
    { label: 'Contado', width: 70, align: 'right', value: (r) => qty(r.counted_qty ?? r.quantity) },
    { label: 'Dif.', key: '__diff', width: 65, align: 'right', value: (r) => qty(calcDifference(r)) },
    { label: 'Novo Est.', width: 70, align: 'right', value: (r) => qty(calcNewStock(r)) },
  ];

  const ignoredColumns = [
    { label: 'Linha', key: 'line', width: 35, align: 'center' },
    { label: 'Barcode', key: 'barcode', width: 100 },
    { label: 'Código', key: 'product_code', width: 70 },
    { label: 'Produto', key: 'product_name', width: 220 },
    { label: 'Motivo', key: 'reason', width: 330 },
  ];

  const errorColumns = [
    { label: 'Linha', key: 'line', width: 35, align: 'center' },
    { label: 'Barcode', key: 'barcode', width: 100 },
    { label: 'Código', key: 'product_code', width: 70 },
    { label: 'Erro', width: 550, value: (r) => r.error || r.message || r.reason || '-' },
  ];

  const rowValue = (col, row) => {
    const value = safe(typeof col.value === 'function' ? col.value(row) : row[col.key], '-');
    if (col.key === '__diff') {
      const diff = Number(calcDifference(row));
      if (Number.isFinite(diff) && diff !== 0) return { text: value, color: diff < 0 ? C.red : C.green, bold: true };
    }
    return value;
  };

  y = section(doc, y, 'Itens Inseridos', insertedColumns, inserted, 'Nenhum item inserido.', rowValue);
  y = section(doc, y, 'Itens Ignorados', ignoredColumns, ignored, 'Nenhum item ignorado.', rowValue);
  section(doc, y, 'Erros', errorColumns, errors, 'Nenhum erro encontrado.', rowValue);

  drawFooters(doc, { title: REPORT_TITLE, generatedAt });
  doc.end();

  return doc;
}

export default generateInventoryImportReportPdf;
