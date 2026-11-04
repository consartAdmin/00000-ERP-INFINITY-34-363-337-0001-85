// ╔══════════════════════════════════════════════════════════════════════╗
// ║ FILE: generationSalesTaxCalculationPdf.js                           ║
// ║ MODULE: SALES TAX CALCULATION                                       ║
// ║ CONSART ERP — layout padrão (consartPdfTheme.js)                    ║
// ║ PDF GENERATION                                                      ║
// ╚══════════════════════════════════════════════════════════════════════╝

'use strict';

import fs from 'node:fs';
import path from 'node:path';
import {
  C, SERIES, PAGE,
  createThemedDoc, drawFullHeader, drawFooters, drawKpis, makeTable, contentWidth, contentBottom, drawSectionTitle, nowBR,
} from './consartPdfTheme.js';


function toNumber(value, fallback = 0) {
  const n = Number(value);
  return Number.isFinite(n) ? n : fallback;
}

function moneyBR(value) {
  return Number(toNumber(value, 0)).toLocaleString('pt-BR', {
    style: 'currency',
    currency: 'BRL'
  });
}

function numberBR(value, digits = 2) {
  return Number(toNumber(value, 0)).toLocaleString('pt-BR', {
    minimumFractionDigits: digits,
    maximumFractionDigits: digits
  });
}

function formatDateBR(value) {
  if (!value) return '-';
  const d = new Date(value);
  if (Number.isNaN(d.getTime())) return String(value);
  return d.toLocaleDateString('pt-BR');
}

function safeText(value) {
  return String(value ?? '').trim();
}

function ensureDir(dirPath) {
  fs.mkdirSync(dirPath, { recursive: true });
}

const REPORT_TITLE = 'Relatório de Cálculo de Impostos';

// columns com width = peso relativo (como no layout antigo)
function weightedTable(doc, y, { title, columns, rows, fontSize = 7.5 }) {
  const total = columns.reduce((sum, col) => sum + col.width, 0);
  const width = contentWidth(doc);
  const table = makeTable(doc, {
    title,
    continuation: { title: REPORT_TITLE, subtitle: `${title} (continuação)` },
    rowH: 17,
    fontSize,
    columns: columns.map((col) => ({ label: col.label, align: col.align, w: (col.width / total) * width })),
  });

  if (!rows.length) {
    if (y + 50 > contentBottom(doc)) y = table.newPage();
    y = drawSectionTitle(doc, y, title);
    doc.font('Helvetica').fontSize(8).fillColor(C.muted).text('Sem registros.', PAGE.margin, y + 2);
    return y + 26;
  }

  y = table.section(y);
  rows.forEach((row, index) => {
    y = table.row(y, columns.map((col) => String((typeof col.value === 'function' ? col.value(row) : row[col.key]) ?? '')), { index });
  });
  return y + 16;
}

export async function generateSalesTaxCalculationPdf(data, outputFilePath) {
  ensureDir(path.dirname(outputFilePath));

  const summary = data?.summary || {};
  const calculations = Array.isArray(data?.calculations) ? data.calculations : [];
  const items = Array.isArray(data?.items) ? data.items : [];
  const reconciliation = Array.isArray(data?.reconciliation) ? data.reconciliation : [];

  const { doc, done } = createThemedDoc({ title: REPORT_TITLE });
  const generatedAt = nowBR();

  let y = drawFullHeader(doc, {
    title: REPORT_TITLE,
    subtitle: 'Carga tributária, custo e margem das vendas',
    info: [
      ['Período', `${formatDateBR(data?.date_from)} a ${formatDateBR(data?.date_to)}`],
      ['Pedidos', numberBR(summary.calculations_count, 0)],
    ],
  }) + 14;

  y = drawKpis(doc, y, [
    { label: 'Venda bruta', value: moneyBR(summary.gross_total), hint: `Desconto ${moneyBR(summary.discount_total)}`, color: SERIES[0] },
    { label: 'Venda líquida', value: moneyBR(summary.net_total), hint: `${numberBR(summary.calculations_count, 0)} pedido(s)`, color: SERIES[5] },
    { label: 'Carga tributária', value: moneyBR(summary.tax_burden_total), hint: `Frete ${moneyBR(summary.freight_total)}`, color: C.red },
    { label: 'Custo total', value: moneyBR(summary.cost_total), hint: 'Custo das mercadorias', color: SERIES[2] },
    { label: 'Lucro bruto', value: moneyBR(summary.gross_profit_total), hint: `Margem ${numberBR(summary.margin_percent, 4)}%`, color: SERIES[1] },
  ]) + 10;

  y = drawKpis(doc, y, [
    { label: 'ICMS', value: moneyBR(summary.icms_total), color: SERIES[0] },
    { label: 'PIS', value: moneyBR(summary.pis_total), color: SERIES[5] },
    { label: 'COFINS', value: moneyBR(summary.cofins_total), color: SERIES[3] },
    { label: 'IPI', value: moneyBR(summary.ipi_total), color: SERIES[2] },
    { label: 'FCP', value: moneyBR(summary.fcp_total), color: SERIES[7] },
  ], { h: 46 }) + 16;

  y = weightedTable(doc, y, {
    title: 'Cálculos Recentes',
    columns: [
        { label: 'ID', key: 'sales_tax_calc_id', width: 6, align: 'center' },
        { label: 'Pedido', key: 'order_number', width: 8, align: 'center' },
        { label: 'Data', value: row => formatDateBR(row.issue_date), width: 8, align: 'center' },
        { label: 'Cliente', key: 'customer_name', width: 24 },
        { label: 'Venda Líquida', value: row => moneyBR(row.net_total), width: 12, align: 'right' },
        { label: 'Carga Trib.', value: row => moneyBR(row.tax_burden_total), width: 12, align: 'right' },
        { label: 'Lucro Bruto', value: row => moneyBR(row.gross_profit_total), width: 12, align: 'right' },
        { label: 'Margem', value: row => `${numberBR(row.margin_percent, 4)}%`, width: 10, align: 'right' }
],
    rows: calculations,
  });

  y = weightedTable(doc, y, {
    title: 'Itens da Apuração',
    columns: [
        { label: 'SKU', key: 'sku', width: 9 },
        { label: 'Descrição', key: 'description', width: 28 },
        { label: 'Qtd', value: row => numberBR(row.quantity, 3), width: 6, align: 'right' },
        { label: 'Un', key: 'unit', width: 5, align: 'center' },
        { label: 'Unitário', value: row => moneyBR(row.unit_price), width: 9, align: 'right' },
        { label: 'Líquido', value: row => moneyBR(row.net_value), width: 9, align: 'right' },
        { label: 'Custo', value: row => moneyBR(row.cost_total), width: 9, align: 'right' },
        { label: 'ICMS', value: row => moneyBR(row.icms_value), width: 8, align: 'right' },
        { label: 'PIS', value: row => moneyBR(row.pis_value), width: 8, align: 'right' },
        { label: 'COFINS', value: row => moneyBR(row.cofins_value), width: 9, align: 'right' },
        { label: 'IPI', value: row => moneyBR(row.ipi_value), width: 8, align: 'right' },
        { label: 'FCP', value: row => moneyBR(row.fcp_value), width: 8, align: 'right' }
],
    rows: items,
    fontSize: 7,
  });

  weightedTable(doc, y, {
    title: 'Reconciliação Fiscal',
    columns: [
        { label: 'ID', key: 'reconciliation_id', width: 7, align: 'center' },
        { label: 'Order', key: 'order_id', width: 8, align: 'center' },
        { label: 'Item', key: 'order_item_id', width: 8, align: 'center' },
        { label: 'SKU', key: 'sku', width: 9 },
        { label: 'Divergência', key: 'divergence_type', width: 16 },
        { label: 'Esperado', value: row => row.expected_value == null ? '-' : moneyBR(row.expected_value), width: 10, align: 'right' },
        { label: 'Atual', value: row => row.actual_value == null ? '-' : moneyBR(row.actual_value), width: 10, align: 'right' },
        { label: 'Diferença', value: row => row.difference_value == null ? '-' : moneyBR(row.difference_value), width: 10, align: 'right' },
        { label: 'Status', key: 'status', width: 8, align: 'center' },
        { label: 'Detalhes', value: row => safeText(row.details), width: 24 }
],
    rows: reconciliation,
    fontSize: 7,
  });

  drawFooters(doc, { title: REPORT_TITLE, generatedAt });
  doc.end();

  await fs.promises.writeFile(outputFilePath, await done);
  return outputFilePath;
}

export default generateSalesTaxCalculationPdf;
