// ╔══════════════════════════════════════════════════════════════════════╗
// ║ generationSalesReportExcel.js — Exportação Excel                    ║
// ║ CONSART ERP — Relatório de Vendas (Completo / Produto / Pedido)     ║
// ║ Usa os mesmos dados dos PDFs (repositories/salesReport).            ║
// ╚══════════════════════════════════════════════════════════════════════╝

import ExcelJS from 'exceljs';
import {
  getFullSalesReport,
  getSalesByProduct,
  getSalesOrders,
  getSalesOrderItems,
} from '../repositories/salesReport/salesReport.index.js';

const MONEY_FMT = 'R$ #,##0.00';
const QTY_FMT = '#,##0.###';
const DATE_FMT = 'dd/mm/yyyy';

function num(value) {
  const n = Number(value);
  return Number.isFinite(n) ? n : 0;
}

function toDate(value) {
  if (!value) return null;
  if (value instanceof Date) return Number.isNaN(value.getTime()) ? null : value;
  const iso = String(value).slice(0, 10);
  const d = new Date(`${iso}T12:00:00`);
  return Number.isNaN(d.getTime()) ? null : d;
}

function costModeLabel(costMode) {
  return costMode === 'saleDay' ? 'Custo do dia da venda' : 'Custo atual';
}

function brDate(iso) {
  if (!iso) return '';
  const [y, m, d] = String(iso).slice(0, 10).split('-');
  return d && m && y ? `${d}/${m}/${y}` : String(iso);
}

/**
 * Cria uma aba com cabeçalho no padrão dos outros Excels (azul, congelado, filtro).
 * columns: [{ header, key, width, fmt? }]
 */
function addSheet(workbook, name, columns, rows) {
  const sheet = workbook.addWorksheet(name);
  sheet.columns = columns.map(({ header, key, width }) => ({ header, key, width }));
  rows.forEach((row) => sheet.addRow(row));

  const head = sheet.getRow(1);
  head.font = { bold: true, color: { argb: 'FFFFFFFF' } };
  head.fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: 'FF174A7E' } };
  head.alignment = { vertical: 'middle' };
  sheet.views = [{ state: 'frozen', ySplit: 1 }];
  if (rows.length) {
    sheet.autoFilter = { from: { row: 1, column: 1 }, to: { row: 1, column: columns.length } };
  }

  columns.forEach((col, index) => {
    if (col.fmt) sheet.getColumn(index + 1).numFmt = col.fmt;
  });
  return sheet;
}

function addSummarySheet(workbook, filters, summary = {}) {
  const orders = num(summary.orders_count);
  const total = num(summary.total_amount);
  const cost = num(summary.total_cost);
  const profit = summary.gross_profit != null && Number.isFinite(Number(summary.gross_profit))
    ? num(summary.gross_profit)
    : total - cost;

  const period = filters.dateStart || filters.dateEnd
    ? `${brDate(filters.dateStart) || 'início'} a ${brDate(filters.dateEnd) || 'hoje'}`
    : 'Últimos 30 dias';

  const rows = [
    { label: 'Período', value: period },
    { label: 'Modo de custo', value: costModeLabel(filters.costMode) },
    { label: 'Total vendido', value: total, fmt: MONEY_FMT },
    { label: 'Pedidos', value: orders },
    { label: 'Itens vendidos', value: num(summary.total_items), fmt: QTY_FMT },
    { label: 'Ticket médio', value: orders > 0 ? total / orders : 0, fmt: MONEY_FMT },
    { label: 'Custo total', value: cost, fmt: MONEY_FMT },
    { label: 'Lucro bruto', value: profit, fmt: MONEY_FMT },
    { label: 'Margem bruta (%)', value: total > 0 ? profit / total : 0, fmt: '0.00%' },
  ];

  const sheet = addSheet(
    workbook,
    'Resumo',
    [
      { header: 'Indicador', key: 'label', width: 22 },
      { header: 'Valor', key: 'value', width: 26 },
    ],
    rows.map(({ label, value }) => ({ label, value })),
  );
  rows.forEach((row, index) => {
    if (row.fmt) sheet.getCell(index + 2, 2).numFmt = row.fmt;
    sheet.getCell(index + 2, 2).alignment = { horizontal: 'left' };
  });
  sheet.autoFilter = undefined;
}

const PRODUCT_COLUMNS = [
  { header: 'Código', key: 'sku', width: 16 },
  { header: 'Descrição', key: 'description', width: 44 },
  { header: 'U.M.', key: 'unit', width: 9 },
  { header: 'Qtd.', key: 'qty', width: 11, fmt: QTY_FMT },
  { header: 'Preço méd. unit.', key: 'avgPrice', width: 16, fmt: MONEY_FMT },
  { header: 'Custo méd. unit.', key: 'avgCost', width: 16, fmt: MONEY_FMT },
  { header: 'Total vendido', key: 'total', width: 16, fmt: MONEY_FMT },
  { header: 'Custo total', key: 'cost', width: 16, fmt: MONEY_FMT },
  { header: 'Lucro bruto', key: 'profit', width: 16, fmt: MONEY_FMT },
];

function productRows(byProduct = []) {
  return byProduct.map((item) => {
    const total = num(item.total_amount);
    const cost = num(item.total_cost);
    const profit = Number.isFinite(Number(item.gross_profit)) ? num(item.gross_profit) : total - cost;
    return {
      sku: item.product_sku || item.product_code || item.product_id || '',
      description: item.product_description || '',
      unit: item.product_unit || item.unit || '',
      qty: num(item.total_items),
      avgPrice: num(item.avg_unit_price),
      avgCost: num(item.avg_unit_cost ?? item.avg_cost_price),
      total,
      cost,
      profit,
    };
  });
}

async function buildFull(workbook, filters) {
  const data = await getFullSalesReport(filters);
  addSummarySheet(workbook, filters, data.summary || {});

  addSheet(
    workbook,
    'Por dia',
    [
      { header: 'Data', key: 'day', width: 13, fmt: DATE_FMT },
      { header: 'Pedidos', key: 'orders', width: 10 },
      { header: 'Itens', key: 'items', width: 12, fmt: QTY_FMT },
      { header: 'Total vendido', key: 'total', width: 16, fmt: MONEY_FMT },
    ],
    (data.byDay || []).map((item) => ({
      day: toDate(item.day),
      orders: num(item.orders_count),
      items: num(item.total_items),
      total: num(item.total_amount),
    })),
  );

  addSheet(
    workbook,
    'Por cliente',
    [
      { header: 'Cliente', key: 'name', width: 44 },
      { header: 'ID', key: 'id', width: 10 },
      { header: 'Pedidos', key: 'orders', width: 10 },
      { header: 'Total vendido', key: 'total', width: 16, fmt: MONEY_FMT },
    ],
    (data.byCustomer || []).map((item) => ({
      name: item.customer_name || '(Sem nome)',
      id: item.customer_id ?? '',
      orders: num(item.orders_count),
      total: num(item.total_amount),
    })),
  );

  addSheet(workbook, 'Por produto', PRODUCT_COLUMNS, productRows(data.byProduct));
}

async function buildProducts(workbook, filters) {
  addSheet(workbook, 'Por produto', PRODUCT_COLUMNS, productRows(await getSalesByProduct(filters)));
}

async function buildOrders(workbook, filters) {
  const orders = await getSalesOrders(filters);

  const orderRows = orders.map((order) => ({
    number: order.order_number,
    date: toDate(order.issued_date),
    customer: order.customer_name || '',
    nfe: order.nfe_number || '',
    items: num(order.total_items),
    total: num(order.total_amount),
    cost: num(order.total_cost),
    profit: num(order.gross_profit),
  }));

  addSheet(
    workbook,
    'Pedidos',
    [
      { header: 'Pedido', key: 'number', width: 11 },
      { header: 'Data', key: 'date', width: 13, fmt: DATE_FMT },
      { header: 'Cliente', key: 'customer', width: 40 },
      { header: 'NF-e', key: 'nfe', width: 12 },
      { header: 'Itens', key: 'items', width: 10, fmt: QTY_FMT },
      { header: 'Total', key: 'total', width: 16, fmt: MONEY_FMT },
      { header: 'Custo', key: 'cost', width: 16, fmt: MONEY_FMT },
      { header: 'Lucro bruto', key: 'profit', width: 16, fmt: MONEY_FMT },
    ],
    orderRows,
  );

  const itemRows = [];
  for (const order of orders) {
    const items = await getSalesOrderItems(order.order_id, filters);
    items.forEach((item) => itemRows.push({
      number: order.order_number,
      date: toDate(order.issued_date),
      customer: order.customer_name || '',
      sku: item.sku || '',
      description: item.description || '',
      unit: item.unit || '',
      qty: num(item.quantity),
      unitPrice: num(item.unit_price),
      unitCost: num(item.unit_cost),
      total: num(item.total_amount),
      cost: num(item.total_cost),
      profit: num(item.gross_profit),
    }));
  }

  addSheet(
    workbook,
    'Itens dos pedidos',
    [
      { header: 'Pedido', key: 'number', width: 11 },
      { header: 'Data', key: 'date', width: 13, fmt: DATE_FMT },
      { header: 'Cliente', key: 'customer', width: 34 },
      { header: 'Código', key: 'sku', width: 16 },
      { header: 'Descrição', key: 'description', width: 40 },
      { header: 'U.M.', key: 'unit', width: 9 },
      { header: 'Qtd.', key: 'qty', width: 10, fmt: QTY_FMT },
      { header: 'Preço unit.', key: 'unitPrice', width: 14, fmt: MONEY_FMT },
      { header: 'Custo unit.', key: 'unitCost', width: 14, fmt: MONEY_FMT },
      { header: 'Total', key: 'total', width: 15, fmt: MONEY_FMT },
      { header: 'Custo total', key: 'cost', width: 15, fmt: MONEY_FMT },
      { header: 'Lucro bruto', key: 'profit', width: 15, fmt: MONEY_FMT },
    ],
    itemRows,
  );
}

/**
 * Gera o Excel do Relatório de Vendas.
 * @param {object} filters mesmos filtros do PDF (buildFiltersFromQuery)
 * @param {'full'|'products'|'orders'} mode
 * @returns {Promise<Buffer>}
 */
export async function generateSalesReportExcel(filters = {}, mode = 'full') {
  const workbook = new ExcelJS.Workbook();
  workbook.creator = 'CONSART ERP';
  workbook.created = new Date();

  if (mode === 'products') await buildProducts(workbook, filters);
  else if (mode === 'orders') await buildOrders(workbook, filters);
  else await buildFull(workbook, filters);

  return Buffer.from(await workbook.xlsx.writeBuffer());
}

export default { generateSalesReportExcel };
