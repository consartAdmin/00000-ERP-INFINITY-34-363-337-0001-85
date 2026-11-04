'use strict';

import {
  C, SERIES, PAGE,
  createThemedDoc, drawFullHeader, drawFooters, drawKpis, makeTable, nowBR,
} from './consartPdfTheme.js';

const COLUMNS = [
  ['sku', 'SKU', 60, 'left'],
  ['description', 'Produto', 218, 'left'],
  ['movement_type', 'Movimento', 60, 'center'],
  ['invoice_number', 'Nº NF-e', 66, 'center'],
  ['movement_date', 'Data', 66, 'center'],
  ['movement_quantity', 'Qtd. por operação', 92, 'right'],
  ['balance', 'Antes / Depois', 104, 'center'],
  ['quantity_to_buy', 'Comprar', 74, 'right'],
];

const number = new Intl.NumberFormat('pt-BR', { minimumFractionDigits: 0, maximumFractionDigits: 0 });

function num(value) {
  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : 0;
}

function hasValue(value) {
  return value !== null && value !== undefined && value !== '';
}

function dateBR(value) {
  if (!value) return '-';
  const match = String(value).match(/^(\d{4})-(\d{2})-(\d{2})/);
  if (match) return `${match[3]}/${match[2]}/${match[1]}`;
  const date = value instanceof Date ? value : new Date(value);
  if (Number.isNaN(date.getTime())) return '-';
  return `${String(date.getUTCDate()).padStart(2, '0')}/${String(date.getUTCMonth() + 1).padStart(2, '0')}/${date.getUTCFullYear()}`;
}

function movementLabel(value) {
  const normalized = String(value || 'TOTAL').trim().toUpperCase();
  if (['SAIDA', 'SAÍDA', 'OUTBOUND'].includes(normalized)) return 'Saída';
  if (['ENTRADA', 'INBOUND'].includes(normalized)) return 'Entrada';
  return 'Total';
}

function valueFor(row, key) {
  if (key === 'movement_date') return dateBR(row.movement_date);
  if (key === 'movement_type') return movementLabel(row.movement_type);
  if (key === 'balance') {
    if (!hasValue(row.stock_before) && !hasValue(row.stock_after)) return '-';
    return `${hasValue(row.stock_before) ? number.format(num(row.stock_before)) : '-'} / ${hasValue(row.stock_after) ? number.format(num(row.stock_after)) : '-'}`;
  }
  if (['sku', 'description', 'invoice_number'].includes(key)) return String(row[key] ?? '-');
  if (!hasValue(row[key])) return '-';
  return number.format(num(row[key]));
}

const REPORT_TITLE = 'Conciliação Entradas x Saídas';

export async function generateConciliationSalesxStockPdf({ rows = [], summary = {}, filters = {} } = {}) {
  const { doc, done } = createThemedDoc({ title: REPORT_TITLE });
  const generatedAt = nowBR();

  let y = drawFullHeader(doc, {
    title: REPORT_TITLE,
    subtitle: 'Vendas x estoque x necessidade de compra',
    info: [
      ['Período', `${dateBR(filters.dateStart)} a ${dateBR(filters.dateEnd)}`],
      ['Produto', filters.search || 'Todos'],
    ],
  }) + 14;

  y = drawKpis(doc, y, [
    { label: 'Produtos vendidos', value: String(Math.trunc(num(summary.products_count))), color: SERIES[0] },
    { label: 'Produtos para comprar', value: String(Math.trunc(num(summary.products_to_buy))), color: SERIES[2] },
    { label: 'Quantidade vendida', value: number.format(num(summary.quantity_sold)), color: SERIES[5] },
    { label: 'Quantidade recebida', value: number.format(num(summary.quantity_inbound)), color: SERIES[1] },
    { label: 'Quantidade a comprar', value: number.format(num(summary.quantity_to_buy)), color: C.red },
  ], { h: 50 }) + 16;

  const table = makeTable(doc, {
    title: 'Movimentações por produto',
    continuation: { title: REPORT_TITLE, subtitle: 'Movimentações por produto (continuação)' },
    rowH: 16,
    fontSize: 6.8,
    columns: COLUMNS.map(([, label, w, align]) => ({ label, w, align })),
  });

  y = table.section(y);

  if (!rows.length) {
    doc.font('Helvetica').fontSize(9).fillColor(C.muted)
      .text('Nenhuma movimentação encontrada para os filtros informados.', PAGE.margin, y + 16, { width: table.width, align: 'center' });
  }

  rows.forEach((row, index) => {
    y = table.row(y, COLUMNS.map(([key]) => {
      const v = valueFor(row, key);
      if (key === 'quantity_to_buy' && num(row.quantity_to_buy) > 0) return { text: v, color: C.red, bold: true };
      if (key === 'movement_type') return { text: v, color: v === 'Saída' ? C.red : (v === 'Entrada' ? C.green : C.text) };
      return v;
    }), { index });
  });

  drawFooters(doc, { title: REPORT_TITLE, generatedAt });
  doc.end();
  return done;
}

export default generateConciliationSalesxStockPdf;
