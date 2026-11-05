// ╔═══════════════════════════════════════════════════════════════════════════╗
// ║ 🧾 generationSalesReportOrdersPdf.js — Vendas por Pedido (ESM)           ║
// ║ Caminho: backend/generationPdf/generationSalesReportOrdersPdf.js         ║
// ║ - PDF A4 paisagem                                                        ║
// ║ - 1 BOX por pedido (como “quadrado vermelho”)                             ║
// ║ - Keep-together: pedido não quebra feio no fim da página                  ║
// ║ - Pedido grande: quebra em múltiplos BOXES com “(cont.)”                   ║
// ║ - Colunas: SKU | Descrição | U.M | Qtde | Custo unit. | Venda unit.       ║
// ║          | Total custo | Total vendido | Lucro bruto                      ║
// ╚═══════════════════════════════════════════════════════════════════════════╝

'use strict';

import PDFDocument from 'pdfkit';
import {
  C, SERIES, PAGE,
  drawFullHeader, autoCompactHeader, drawFooters, drawKpis, nowBR,
} from './consartPdfTheme.js';
import { topN, topWithOthers, dailySeries, drawDashboardRow } from './salesPdfDashboard.js';
import {
  getSalesSummary,
  getSalesByDay,
  getSalesByCustomer,
  getSalesByProduct,
  getSalesOrders,
  getSalesOrderItems,
} from '../repositories/salesReport/salesReport.index.js';

// Mesmas tabelas do módulo de pedidos
const TB_ORDERS = 'public."orders"';
const TB_ORDER_ITEMS = 'public."orderItems"';
const TB_PRODUCTS = 'public."products"';

const moneyBR = (v) =>
  Number(v || 0).toLocaleString('pt-BR', {
    style: 'currency',
    currency: 'BRL',
  });

function formatDateBR(d) {
  if (!d) return '-';
  try {
    const date = new Date(d);
    if (Number.isNaN(date.getTime())) return String(d);
    return date.toLocaleDateString('pt-BR');
  } catch {
    return String(d);
  }
}

// Extrai fator da U.M a partir do código (FD.5, CX.12, UN, PC...)
// - Procura um número na string
// - Se não encontrar, assume 1
function parseUnitFactor(unitCode) {
  if (!unitCode) return 1;
  const m = String(unitCode).match(/(\d+(?:[.,]\d+)?)/);
  if (!m) return 1;
  const n = Number(m[1].replace(',', '.'));
  return Number.isFinite(n) && n > 0 ? n : 1;
}

/**
 * Monta condições dinâmicas para filtros (data, cliente, produto)
 * - dateStart / dateEnd: YYYY-MM-DD
 * - customerId: BIGINT
 * - productId: filtro de SKU ou parte da descrição
 *
 * Exclui: cancelados/devolvidos/estornados e NF-e cancelada
 */
function buildWhere({ dateStart, dateEnd, customerId, productId }) {
  const where = [];
  const params = [];
  let idx = 1;

  if (dateStart) {
    where.push(`o.issue_date >= $${idx++}`);
    params.push(dateStart);
  }
  if (dateEnd) {
    where.push(`o.issue_date <= $${idx++}`);
    params.push(dateEnd);
  }
  if (customerId) {
    where.push(`o.customer_id = $${idx++}`);
    params.push(customerId);
  }
  if (productId) {
    const v = String(productId).trim();
    where.push(`(oi.sku ILIKE $${idx} OR oi.description ILIKE $${idx})`);
    params.push(`%${v}%`);
    idx++;
  }

  // 🔒 Sempre excluir pedidos cancelados / devolvidos / estornados
  where.push(
    `COALESCE(o.status, '') NOT IN ('CANCELADO', 'CANCELADA', 'DEVOLVIDO', 'ESTORNADO')`
  );

  // 🔒 Excluir pedidos cuja NF-e esteja cancelada
  where.push(`COALESCE(o.nfe_status, '') <> 'CANCELADA'`);

  const whereSql = where.length ? 'WHERE ' + where.join(' AND ') : '';
  return { whereSql, params };
}

/**
 * Busca itens já “explodidos” por pedido
 */
async function getOrdersWithItems(filters = {}) {
  const { whereSql, params } = buildWhere(filters);

  const sql = `
    SELECT
      o.order_id,
      o.number,
      o.issue_date::date              AS issue_date,
      o.customer_id,
      o.customer_name,

      oi.sku,
      oi.description,
      COALESCE(oi.quantity, 0)        AS quantity,
      COALESCE(oi.unit_price, 0.0)    AS unit_price,      -- venda unit. na U.M
      COALESCE(oi.discount_value, 0)  AS discount_value,
      COALESCE(oi.unit, '')           AS product_unit,    -- código U.M (FD.5, PC, etc.)

      COALESCE(p.cost_price, 0.0)     AS base_cost_price  -- custo na unidade base
    FROM ${TB_ORDERS} o
    JOIN ${TB_ORDER_ITEMS} oi ON oi.order_id = o.order_id
    JOIN ${TB_PRODUCTS}    p  ON p."product_code" = oi.sku
    ${whereSql}
    ORDER BY
      o.issue_date::date ASC,
      o.number ASC,
      oi.sku ASC;
  `;

  const { rows } = await pool.query(sql, params);
  return rows;
}

/**
 * Agrupa as linhas por pedido e calcula totais
 */
function groupRowsByOrder(rows = []) {
  const map = new Map();

  for (const r of rows) {
    const key = r.order_id;
    if (!map.has(key)) {
      map.set(key, {
        order_id: r.order_id,
        number: r.number,
        issue_date: r.issue_date,
        customer_id: r.customer_id,
        customer_name: r.customer_name,
        items: [],
        totalItems: 0,
        totalAmount: 0,
        totalCost: 0,
        grossProfit: 0,
      });
    }

    const group = map.get(key);

    const unitCode = r.product_unit || '';
    const qty = Number(r.quantity || 0);
    const unitPrice = Number(r.unit_price || 0);
    const discount = Number(r.discount_value || 0);
    const baseCost = Number(r.base_cost_price || 0);

    const factor = parseUnitFactor(unitCode);
    const unitCost = baseCost * factor;

    const totalCost = qty * unitCost;
    const totalVal = qty * unitPrice - discount;
    const gross = totalVal - totalCost;

    group.items.push({
      sku: r.sku,
      description: r.description,
      unit: unitCode,
      unitFactor: factor, // debug
      qty,
      unitPrice,
      unitCost,
      totalCost,
      totalValue: totalVal,
      gross,
    });

    group.totalItems += qty;
    group.totalAmount += totalVal;
    group.totalCost += totalCost;
    group.grossProfit += gross;
  }

  return Array.from(map.values()).sort((a, b) => {
    const d1 = new Date(a.issue_date).getTime();
    const d2 = new Date(b.issue_date).getTime();
    if (d1 !== d2) return d1 - d2;
    return String(a.number).localeCompare(String(b.number));
  });
}

/**
 * Título de seção com linha abaixo
 */
function drawSectionTitle(doc, text) {
  doc.fontSize(11).font('Helvetica-Bold').fillColor(C.navy).text(text, doc.page.margins.left, doc.y);
  doc.rect(doc.page.margins.left, doc.y + 1, 34, 2).fill(C.teal);
  doc.y += 3;
  doc.moveDown(0.45);
}

/**
 * Box / “quadrado vermelho”
 */
function drawOrderBox(doc, x, y, w, h) {
  doc
    .roundedRect(x, y, w, h, 8)
    .strokeColor('#cbd5e1')
    .lineWidth(0.9)
    .stroke();
}

/**
 * Header dentro do box do pedido
 */
function drawOrderHeader(doc, x, y, w, order, { cont = false } = {}) {
  const orderNo = order.number ?? order.order_number ?? order.orderNo ?? order.order_id ?? order.id ?? '-';
  const date = formatDateBR(order.issue_date ?? order.created_at ?? order.date ?? order.createdAt);
  const customer = order.customer_name || order.customerName || `(Cliente ID ${order.customer_id || '-'})`;

  doc.rect(x, y, w, 22).fill(C.totalFill);
  doc.rect(x, y, 3, 22).fill(C.teal);

  doc
    .font('Helvetica-Bold')
    .fontSize(11)
    .fillColor(C.navy)
    .text(
      `Pedido ${orderNo}${cont ? ' (cont.)' : ''}  •  ${date}  •  Cliente: ${customer}`,
      x + 10,
      y + 6,
      { width: w - 20, lineBreak: false, ellipsis: true }
    );

  doc
    .moveTo(x, y + 22)
    .lineTo(x + w, y + 22)
    .strokeColor('#cbd5e1')
    .lineWidth(0.6)
    .stroke();
}

function drawOrderTotalsLine(doc, x, y, w, order) {
  doc
    .font('Helvetica')
    .fontSize(9)
    .fillColor('#334155')
    .text(
      `Total vendido: ${moneyBR(order.totalAmount || 0)}   |   Custo total: ${moneyBR(order.totalCost || 0)}   |   Lucro bruto: ${moneyBR(order.grossProfit || 0)}`,
      x + 10,
      y,
      { width: w - 20, lineBreak: false, ellipsis: true }
    );
}

/**
 * Header da tabela dentro do box
 */
function drawItemsHeaderInside(doc, boxX, yTop, boxW, cols) {
  doc.rect(boxX, yTop, boxW, 18).fill(C.blue);

  doc.fontSize(8).font('Helvetica-Bold').fillColor(C.white);
  cols.forEach((c) => doc.text(c.label, c.x, yTop + 5, { width: c.w, lineBreak: false }));
  doc.fillColor(C.text);

  doc
    .moveTo(boxX, yTop + 18)
    .lineTo(boxX + boxW, yTop + 18)
    .strokeColor('#cbd5e1')
    .lineWidth(0.4)
    .stroke();
}

/**
 * Renderiza 1 pedido em 1 ou várias páginas, sempre em BOXES
 * - Se couber no espaço restante, fica tudo no mesmo box (keep together)
 * - Se não couber, pula página antes de desenhar
 * - Se for grande demais para 1 página, quebra em chunks e cria boxes (cont.)
 */
function renderOrderAsBoxes(doc, order, cols) {
  const x = doc.page.margins.left;
  const w = doc.page.width - doc.page.margins.left - doc.page.margins.right;

  const rowH = 14;
  const headerH = 22;
  const totalsH = 16;
  const tableHeaderH = 18;
  const padTop = 10;
  const padBottom = 10;
  const gapAfter = 14;

  const items = Array.isArray(order.items) ? order.items : [];

  const bottom = () => doc.page.height - doc.page.margins.bottom;

  const fixedH = padTop + headerH + totalsH + tableHeaderH + padBottom;

  const availableBodyH = () => {
    const avail = (bottom() - doc.y) - (fixedH + gapAfter);
    return Math.max(0, avail);
  };

  const rowsFitHere = () => Math.max(1, Math.floor(availableBodyH() / rowH));

  // Se não cabe nem 1 linha, pula página antes de começar ✅
  if (availableBodyH() < rowH) doc.addPage();

  // Se cabe tudo na página atual, desenha 1 box e pronto ✅
  if (items.length <= rowsFitHere()) {
    drawOneBox(items, false);
    return;
  }

  // Caso grande: quebra em múltiplos boxes, 1 por página ✅
  let cursor = 0;
  let pageIndex = 0;

  while (cursor < items.length) {
    if (availableBodyH() < rowH) doc.addPage();

    const take = rowsFitHere();
    const chunk = items.slice(cursor, cursor + take);

    drawOneBox(chunk, pageIndex > 0);

    cursor += take;
    pageIndex += 1;
  }

  function drawOneBox(chunkItems, cont) {
    const bodyH = Math.max(1, chunkItems.length) * rowH;
    const boxH = fixedH + bodyH;

    // keep together: se o box não cabe, pula página antes ✅
    const need = boxH + gapAfter;
    if (doc.y + need > bottom()) doc.addPage();

    const topY = doc.y;

    drawOrderBox(doc, x, topY, w, boxH);
    drawOrderHeader(doc, x, topY, w, order, { cont });
    drawOrderTotalsLine(doc, x, topY + headerH + 6, w, order);

    const tableHeaderY = topY + headerH + totalsH + 8;
    drawItemsHeaderInside(doc, x, tableHeaderY, w, cols);

    // Corpo
    let y = tableHeaderY + 20;

    doc.font('Helvetica').fontSize(9).fillColor('#111827');

    if (!chunkItems.length) {
      doc.font('Helvetica-Oblique').fillColor('#6b7280').text('Sem itens.', x + 10, y, { width: w - 20 });
      y += rowH;
    } else {
      chunkItems.forEach((item, idx) => {
        // zebra dentro do box
        if (idx % 2 === 0) {
          doc.rect(x + 1, y - 1, w - 2, rowH).fill('#f9fafb');
          doc.fillColor('#111827');
        }

        // SKU
        doc.fontSize(9).font('Helvetica').fillColor('#111827');
        doc.text(String(item.sku || '-'), cols[0].x, y, { width: cols[0].w, lineBreak: false, ellipsis: true });

        // Descrição
        doc.fontSize(8);
        doc.text(String(item.description || '(Sem descrição)'), cols[1].x, y, { width: cols[1].w, lineBreak: false, ellipsis: true });

        // U.M
        doc.fontSize(9);
        doc.text(String(item.unit || ''), cols[2].x, y, { width: cols[2].w, lineBreak: false });

        // Qtde
        doc.text(String(item.qty ?? 0), cols[3].x, y, { width: cols[3].w, lineBreak: false });

        // Custo unit.
        doc.text(moneyBR(item.unitCost ?? 0), cols[4].x, y, { width: cols[4].w, lineBreak: false });

        // Venda unit.
        doc.text(moneyBR(item.unitPrice ?? 0), cols[5].x, y, { width: cols[5].w, lineBreak: false });

        // Total custo
        doc.text(moneyBR(item.totalCost ?? 0), cols[6].x, y, { width: cols[6].w, lineBreak: false });

        // Total vendido
        doc.text(moneyBR(item.totalValue ?? 0), cols[7].x, y, { width: cols[7].w, lineBreak: false });

        // Lucro bruto
        doc.text(moneyBR(item.gross ?? 0), cols[8].x, y, { width: cols[8].w, lineBreak: false });

        y += rowH;
      });
    }

    doc.y = topY + boxH + gapAfter;
  }
}

/**
 * Gera o PDF de vendas por pedido
 * @param {Object} filters { dateStart, dateEnd, customerId, productId }
 */
export async function generateSalesReportOrdersPdf(filters = {}) {
  const [summary, baseOrders, byDay, byCustomer, byProduct] = await Promise.all([
    getSalesSummary(filters),
    getSalesOrders(filters),
    getSalesByDay(filters),
    getSalesByCustomer(filters),
    getSalesByProduct(filters),
  ]);

  const orders = [];

  for (const order of baseOrders) {
    const items = await getSalesOrderItems(order.order_id, filters);

    orders.push({
      order_id: order.order_id,
      number: order.order_number,
      issue_date: order.issued_date,
      customer_id: order.customer_id,
      customer_name: order.customer_name,

      items: items.map((item) => ({
        sku: item.sku,
        description: item.description,
        unit: item.unit,
        qty: Number(item.quantity || 0),
        unitPrice: Number(item.unit_price || 0),
        unitCost: Number(item.unit_cost || 0),
        totalCost: Number(item.total_cost || 0),
        totalValue: Number(item.total_amount || 0),
        gross: Number(item.gross_profit || 0),
      })),

      totalItems: Number(order.total_items || 0),
      totalAmount: Number(order.total_amount || 0),
      totalCost: Number(order.total_cost || 0),
      grossProfit: Number(order.gross_profit || 0),
    });
  }

  const doc = new PDFDocument({
    size: 'A4',
    layout: 'landscape',
    margins: { top: 40, left: PAGE.margin, right: PAGE.margin, bottom: PAGE.footerH + 20 },
    bufferPages: true,
    info: {
      Title: 'Relatório de Vendas por Pedido - CONSART ERP',
      Author: 'CONSART ERP',
      Subject: 'Vendas detalhadas por pedido',
    },
  });

  const chunks = [];
  return await new Promise((resolve, reject) => {
    doc.on('data', (chunk) => chunks.push(chunk));
    doc.on('end', () => resolve(Buffer.concat(chunks)));
    doc.on('error', reject);

    const startX = doc.page.margins.left;

    // -------------------------------------------------------------------
    // Cabeçalho geral (layout padrão)
    // -------------------------------------------------------------------
    const reportTitle = 'Relatório de Vendas por Pedido';
    const periodStart = filters.dateStart || 'Últimos 30 dias';
    const periodEnd = filters.dateEnd || '';

    const headerInfo = [
      ['Período', `${formatDateBR(periodStart)}${periodEnd ? ' a ' + formatDateBR(periodEnd) : ''}`],
    ];
    if (filters.customerId) headerInfo.push(['Cliente ID', filters.customerId]);
    if (filters.productId) headerInfo.push(['Produto', filters.productId]);

    doc.y = drawFullHeader(doc, {
      title: reportTitle,
      subtitle: 'Vendas detalhadas por pedido',
      info: headerInfo,
    }) + 14;
    autoCompactHeader(doc, { title: reportTitle, subtitle: 'Pedidos (continuação)' });

    // -------------------------------------------------------------------
    // Resumo rápido (KPI)
    // -------------------------------------------------------------------
    const totalPedidos = Number(summary?.orders_count || 0);
    const somaItens = Number(summary?.total_items || 0);
    const somaValor = Number(summary?.total_amount || 0);
    const somaCusto = Number(summary?.total_cost || 0);
    const somaLucro = Number(summary?.gross_profit || 0);

    const ticketMedio = totalPedidos > 0 ? somaValor / totalPedidos : 0;
    const margem = somaValor > 0 ? (somaLucro / somaValor) * 100 : 0;

    const kpiW = doc.page.width - doc.page.margins.left - doc.page.margins.right;

    doc.y = drawKpis(doc, doc.y, [
      { label: 'Total vendido', value: moneyBR(somaValor), hint: `${totalPedidos} pedido(s)`, color: SERIES[0] },
      { label: 'Custo total', value: moneyBR(somaCusto), color: SERIES[2] },
      { label: 'Lucro bruto', value: moneyBR(somaLucro), hint: 'Vendido - custo', color: SERIES[1] },
      { label: 'Margem bruta', value: `${margem.toFixed(1).replace('.', ',')}%`, hint: 'Lucro / vendido', color: SERIES[3] },
      { label: 'Ticket médio', value: moneyBR(ticketMedio), hint: `${somaItens.toLocaleString('pt-BR')} itens vendidos`, color: SERIES[5] },
    ], { x: startX, width: kpiW }) + 12;

    // -------------------------------------------------------------------
    // Dashboard (modelo Comissões por NF-e)
    // -------------------------------------------------------------------
    doc.y = drawDashboardRow(doc, doc.y, [
      {
        type: 'bars', title: 'Vendas por cliente', subtitle: 'Top 5 por valor vendido',
        data: topN((byCustomer || []).map((r) => ({ label: r.customer_name || '(Sem nome)', value: r.total_amount })), 5),
      },
      {
        type: 'donut', title: 'Vendas por produto', subtitle: 'Participação no total vendido (top 4 + outros)', centerLabel: 'vendido',
        data: topWithOthers((byProduct || []).map((r) => ({ label: r.product_description || r.product_sku || 'Produto', value: r.total_amount })), 4),
      },
      { type: 'columns', title: 'Vendas por dia', subtitle: 'Evolução pela data de emissão', data: dailySeries(byDay || []) },
    ]) + 18;
    doc.x = startX;

    // -------------------------------------------------------------------
    // PEDIDOS (BOXES)
    // -------------------------------------------------------------------
    if (!orders.length) {
      doc.fontSize(10).font('Helvetica-Oblique').fillColor('#6b7280').text('Nenhum pedido encontrado no período.');
    } else {
      // colunas (ajuste fino para caber no A4 landscape)
      const cols = [
        { label: 'SKU', x: startX, w: 70 },
        { label: 'Descrição', x: startX + 70, w: 300 }, // +40 na descrição
        { label: 'U.M', x: startX + 370, w: 35 },
        { label: 'Qtde', x: startX + 405, w: 35 },
        { label: 'Custo unit.', x: startX + 440, w: 65 },
        { label: 'Venda unit.', x: startX + 505, w: 65 },
        { label: 'Total custo', x: startX + 570, w: 75 },
        { label: 'Total vendido', x: startX + 645, w: 75 },
        { label: 'Lucro bruto', x: startX + 720, w: 75 },
      ];

      for (const order of orders) {
        renderOrderAsBoxes(doc, order, cols);
      }
    }

    // -------------------------------------------------------------------
    // Rodapé padrão em todas as páginas
    // -------------------------------------------------------------------
    drawFooters(doc, { title: reportTitle, generatedAt: nowBR() });

    doc.end();
  });
}

const generationSalesReportOrdersPdf = {
  generateSalesReportOrdersPdf,
};

export default generationSalesReportOrdersPdf;