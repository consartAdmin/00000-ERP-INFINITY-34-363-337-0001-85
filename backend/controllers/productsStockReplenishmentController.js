// ╔══════════════════════════════════════════════════════════════════════╗
// ║ productsStockReplenishmentController.js — Reposição de estoque       ║
// ║ Base: /api/productsStock/replenishment                               ║
// ║   GET  /                    lista + cards por situação               ║
// ║   GET  /export              Excel (?format=xlsx)                     ║
// ║   GET  /pdf                 Sugestão de compra (por fabricante)      ║
// ║   GET  /settings            parâmetros + fabricantes                 ║
// ║   PUT  /settings            salva parâmetros + prazo/pedido mínimo   ║
// ║   GET  /orders              pedidos por fabricante + completar       ║
// ║   GET  /dashboard           card "Reposição de estoque" da home      ║
// ║   GET  /product/:productId  linha + cálculo pelo consumo             ║
// ║   GET  /product/:id/movements  últimas movimentações (Kardex)        ║
// ║   PUT  /params              salva mín./máx./prazo (1 ou vários)      ║
// ╚══════════════════════════════════════════════════════════════════════╝

import {
  C, SERIES, PAGE, createThemedDoc, drawFullHeader, drawFooters, drawKpis, makeTable,
  number as themeNumber, money as themeMoney, nowBR as themeNowBR,
} from '../generationPdf/consartPdfTheme.js';

import repo from '../repositories/productsStock/productsStockReplenishment.repository.js';

function userId(req) {
  return req.user?.user_id ?? req.user?.id ?? null;
}

function fail(res, error, op) {
  const status = Number(error?.statusCode ?? error?.status);
  const code = Number.isInteger(status) && status >= 400 && status < 600 ? status : 500;
  if (code >= 500) console.error(`[productsStockReplenishment] ${op}`, error);
  if (res.headersSent) return res.end();
  return res.status(code).json({ ok: false, error: error?.message || 'Erro interno' });
}

function filtersFrom(query = {}) {
  return {
    q: query.q,
    situation: query.situation,
    group_id: query.group_id,
    subgroup_id: query.subgroup_id,
    manufacturer_id: query.manufacturer_id,
    with_sales: query.with_sales,
    sort: query.sort,
    dir: query.dir,
    page: query.page,
    limit: query.limit,
  };
}

const fmtQty = (v) => Number(v || 0).toLocaleString('pt-BR', { minimumFractionDigits: 0, maximumFractionDigits: 3 });
const fmtDaily = (v) => Number(v || 0).toLocaleString('pt-BR', { minimumFractionDigits: 1, maximumFractionDigits: 2 });
const fmtDate = (v) => {
  if (!v) return '';
  const iso = v instanceof Date ? v.toISOString().slice(0, 10) : String(v).slice(0, 10);
  const [y, m, d] = iso.split('-');
  return d ? `${d}/${m}/${y}` : iso;
};
const leadLabel = (r) => `${r.lead_days} d${r.lead_source === 'PRODUCT' ? ' (produto)' : r.lead_source === 'DEFAULT' ? ' (padrão)' : ''}`;

export async function list(req, res) {
  try {
    return res.json(await repo.listReplenishment(filtersFrom(req.query)));
  } catch (error) {
    return fail(res, error, 'list');
  }
}

export async function getSettings(req, res) {
  try {
    const [settings, mf] = await Promise.all([repo.getSettings(), repo.listManufacturersReplenishment()]);
    return res.json({ ok: true, settings, ...mf });
  } catch (error) {
    return fail(res, error, 'getSettings');
  }
}

export async function saveSettings(req, res) {
  try {
    const settings = await repo.saveSettings(req.body || {}, userId(req));
    const mf = await repo.listManufacturersReplenishment();
    return res.json({ ok: true, settings, ...mf });
  } catch (error) {
    return fail(res, error, 'saveSettings');
  }
}

export async function orders(req, res) {
  try {
    return res.json(await repo.listManufacturerOrders({ withComplete: true }));
  } catch (error) {
    return fail(res, error, 'orders');
  }
}

export async function dashboard(req, res) {
  try {
    return res.json(await repo.getReplenishmentDashboard({ limit: req.query.limit }));
  } catch (error) {
    return fail(res, error, 'dashboard');
  }
}

export async function getProduct(req, res) {
  try {
    const row = await repo.getReplenishmentRow(req.params.productId);
    if (!row) return res.status(404).json({ ok: false, error: 'Produto não encontrado.' });
    return res.json({ ok: true, row });
  } catch (error) {
    return fail(res, error, 'getProduct');
  }
}

export async function productMovements(req, res) {
  try {
    return res.json({ ok: true, rows: await repo.listProductMovements(req.params.productId, req.query.limit) });
  } catch (error) {
    return fail(res, error, 'productMovements');
  }
}

export async function saveParams(req, res) {
  try {
    const items = Array.isArray(req.body?.items) ? req.body.items : [req.body || {}];
    return res.json(await repo.saveParams(items));
  } catch (error) {
    return fail(res, error, 'saveParams');
  }
}

const SITUATION_LABEL = new Map(repo.SITUATIONS.map((s) => [s.key, s.label]));

export async function exportExcel(req, res) {
  try {
    const { rows } = await repo.listAllReplenishment(filtersFrom(req.query));
    const columns = [
      { key: 'product_code', label: 'SKU', width: 12 },
      { key: 'product_description', label: 'Produto', width: 46, bold: true },
      { key: 'product_group_name', label: 'Grupo', width: 20 },
      { key: 'manufacturer_name', label: 'Fabricante', width: 20 },
      { key: 'lead', label: 'Prazo', width: 14, value: (r) => leadLabel(r) },
      { key: 'daily', label: 'Consumo/dia', width: 12, value: (r) => Number(r.daily.toFixed(3)), numFmt: '#,##0.00' },
      { key: 'stock_qty', label: 'Atual', width: 11, value: (r) => r.stock_qty, numFmt: '#,##0.###' },
      { key: 'stock_min', label: 'Mínimo', width: 11, value: (r) => r.stock_min, numFmt: '#,##0.###' },
      { key: 'reorder_point', label: 'Ponto de pedido', width: 14, value: (r) => Number(r.reorder_point.toFixed(3)), numFmt: '#,##0.##' },
      { key: 'stock_max', label: 'Máximo', width: 11, value: (r) => r.stock_max, numFmt: '#,##0.###' },
      { key: 'coverage', label: 'Cobertura (dias)', width: 14, value: (r) => (r.coverage_days === null ? '' : Math.floor(r.coverage_days)) },
      { key: 'runs_out_at', label: 'Acaba em', width: 12, value: (r) => fmtDate(r.runs_out_at) },
      { key: 'order_by', label: 'Pedir até', width: 12, value: (r) => fmtDate(r.order_by) },
      { key: 'suggestion', label: 'Comprar', width: 11, value: (r) => r.suggestion, numFmt: '#,##0.###' },
      { key: 'cost_price', label: 'Custo', width: 12, value: (r) => r.cost_price, numFmt: '"R$" #,##0.00' },
      { key: 'suggestion_value', label: 'Total compra', width: 14, value: (r) => r.suggestion_value, numFmt: '"R$" #,##0.00' },
      { key: 'situation', label: 'Reposição', width: 18, value: (r) => SITUATION_LABEL.get(r.situation) || r.situation },
    ];
    const { buildSimpleListWorkbook } = await import('../generationPdf/generationSimpleListExcel.js');
    const buffer = await buildSimpleListWorkbook({
      title: 'Estoque mínimo e máximo — Reposição',
      subtitle: 'Ponto de pedido, prazo de entrega e sugestão de compra',
      sheetName: 'Reposição',
      info: [
        ['Busca', String(req.query.q || '').trim() || 'Todos'],
        ['Reposição', SITUATION_LABEL.get(String(req.query.situation || '').toUpperCase()) || 'Todas'],
      ],
      columns,
      rows,
    });
    const today = new Date().toISOString().slice(0, 10);
    res.setHeader('Content-Type', 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet');
    res.setHeader('Content-Disposition', `attachment; filename="estoque-reposicao-${today}.xlsx"`);
    return res.send(Buffer.from(buffer));
  } catch (error) {
    return fail(res, error, 'exportExcel');
  }
}

/**
 * Sugestão de compra em PDF, agrupada por fabricante, com o pedido mínimo.
 * ?manufacturer_id=ID|none  → só um fabricante
 * ?complete=1               → inclui os itens sugeridos para completar o mínimo
 */
export async function purchaseSuggestionPdf(req, res) {
  try {
    const manufacturerId = String(req.query.manufacturer_id || '').trim() || null;
    const withComplete = String(req.query.complete || '') === '1';
    const filters = { ...filtersFrom(req.query), situation: 'NEED', sort: 'manufacturer', dir: 'asc', page: 1 };
    const [{ rows }, ordersData] = await Promise.all([
      repo.listAllReplenishment(filters),
      repo.listManufacturerOrders({ withComplete, manufacturer_id: manufacturerId }),
    ]);
    const lines = rows.filter((r) => r.suggestion > 0);
    const orderBy = new Map(ordersData.orders.map((o) => [o.manufacturer_id ?? 'none', o]));

    const REPORT_TITLE = 'Sugestão de Compra';
    const { doc } = createThemedDoc({ title: REPORT_TITLE, subject: 'Sugestão de compra por fabricante', collect: false });
    const filename = `sugestao_de_compra_${new Date().toISOString().slice(0, 10)}.pdf`;
    res.setHeader('Content-Type', 'application/pdf');
    res.setHeader('Content-Disposition', `attachment; filename="${filename}"`);
    doc.pipe(res);

    const total = lines.reduce((acc, r) => acc + r.suggestion_value, 0);
    const zero = lines.filter((r) => r.situation === 'ZERO_SALES').length;
    const ready = ordersData.orders.filter((o) => o.reached).length;

    let y = drawFullHeader(doc, {
      title: REPORT_TITLE,
      subtitle: 'Ponto de pedido, prazo de entrega e pedido mínimo do fabricante',
      info: [
        ['Fabricante', manufacturerId ? (orderBy.get(manufacturerId === 'none' ? 'none' : Number(manufacturerId))?.manufacturer_name || '—') : 'Todos'],
        ['Itens', themeNumber(lines.length, 0)],
      ],
    }) + 14;

    y = drawKpis(doc, y, [
      { label: 'Itens para comprar', value: themeNumber(lines.length, 0), hint: 'No ponto de pedido ou abaixo', color: SERIES[0] },
      { label: 'Compra estimada', value: themeMoney(total), hint: 'Comprar × custo do produto', color: SERIES[1] },
      { label: 'Fabricantes prontos', value: `${ready} de ${ordersData.orders.length}`, hint: 'Atingem o pedido mínimo', color: SERIES[6] },
      { label: 'Zerados com venda', value: themeNumber(zero, 0), hint: 'Venderam e estão sem estoque', color: zero ? C.red : SERIES[7] },
    ]) + 16;

    const columns = [
      { label: 'SKU', w: 62 },
      { label: 'Produto' },
      { label: 'Prazo', w: 62, align: 'center' },
      { label: 'Cons./dia', w: 52, align: 'right' },
      { label: 'Atual', w: 52, align: 'right' },
      { label: 'Ponto', w: 52, align: 'right' },
      { label: 'Máx.', w: 52, align: 'right' },
      { label: 'Comprar', w: 58, align: 'right', bold: true },
      { label: 'Custo', w: 66, align: 'right' },
      { label: 'Total', w: 76, align: 'right', bold: true },
    ];

    if (!lines.length) {
      doc.font('Helvetica').fontSize(9).fillColor(C.muted)
        .text('Nenhum produto com sugestão de compra.', PAGE.margin, y + 16, { width: 500, align: 'left' });
    }

    const groups = new Map();
    lines.forEach((r) => {
      const key = r.manufacturer_id ?? 'none';
      if (!groups.has(key)) groups.set(key, []);
      groups.get(key).push(r);
    });

    for (const [key, items] of groups) {
      const order = orderBy.get(key);
      const name = items[0].manufacturer_name || 'Sem fabricante';
      const sub = items.reduce((acc, r) => acc + r.suggestion_value, 0);
      const minTxt = order?.min_order_value
        ? ` · pedido mínimo ${themeMoney(order.min_order_value)} · ${order.reached ? 'atinge o mínimo' : `faltam ${themeMoney(order.missing)}`}`
        : ' · sem pedido mínimo';
      const table = makeTable(doc, {
        columns,
        rowH: 17,
        fontSize: 7.5,
        continuation: { title: REPORT_TITLE, subtitle: `${name} (continuação)` },
      });
      y = table.section(y + 6, `${name}${minTxt}`);
      items.forEach((r, index) => {
        y = table.row(y, [
          r.product_code || '-',
          r.product_description || '-',
          leadLabel(r),
          fmtDaily(r.daily),
          { text: fmtQty(r.stock_qty), color: r.stock_qty <= 0 ? C.red : undefined },
          fmtQty(Math.round(r.reorder_point * 100) / 100),
          fmtQty(r.stock_max),
          fmtQty(r.suggestion),
          r.cost_price > 0 ? themeMoney(r.cost_price) : { text: 'sem custo', color: C.amber },
          themeMoney(r.suggestion_value),
        ], { index });
      });

      if (withComplete && order?.complete?.length) {
        order.complete.forEach((c, index) => {
          y = table.row(y, [
            c.product_code || '-',
            `+ COMPLETAR: ${c.product_description || '-'} (ponto em ${c.days_to_reorder ?? '—'} d)`,
            '', '', '', '', '',
            fmtQty(c.qty),
            themeMoney(c.cost_price),
            themeMoney(c.value),
          ], { index, color: C.amber });
        });
      }
      const subTotal = sub + (withComplete ? (order?.complete_total || 0) : 0);
      y = table.total(y, ['TOTAL', `${items.length} item(ns)`, '', '', '', '', '', '', '', themeMoney(subTotal)]);
    }

    drawFooters(doc, { title: REPORT_TITLE, generatedAt: themeNowBR() });
    doc.end();
  } catch (error) {
    return fail(res, error, 'purchaseSuggestionPdf');
  }
}

export default {
  list,
  getSettings,
  saveSettings,
  orders,
  dashboard,
  getProduct,
  productMovements,
  saveParams,
  exportExcel,
  purchaseSuggestionPdf,
};
