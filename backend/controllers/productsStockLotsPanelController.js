// ╔══════════════════════════════════════════════════════════════════════╗
// ║ productsStockLotsPanelController.js — Painel de lotes e validades    ║
// ║ Base: /api/productsStockLots                                         ║
// ║   GET  /panel               lista + cards por situação               ║
// ║   GET  /panel/export        PDF / Excel (?format=pdf|xlsx)           ║
// ║   GET  /alert-settings      parâmetros de alerta                     ║
// ║   PUT  /alert-settings      salva parâmetros                         ║
// ║   GET  /:id/panel           lote + situação                          ║
// ║   GET  /:id/kardex          movimentações do lote                    ║
// ║   POST /:id/block|unblock   bloqueia / libera o lote                 ║
// ║   POST /:id/move            reservar / desreservar / baixar c/ regra ║
// ╚══════════════════════════════════════════════════════════════════════╝

import productsStockManager, { requireLotMode } from '../repositories/productsStock/productsStock.manager.js';
import panelRepo from '../repositories/productsStockLots/productsStockLotsPanel.repository.js';
import { registerProductMovement } from '../repositories/productMovements/productMovementsCreate.repository.js';

function scope(req) {
  return {
    scopeType: req.appFeatureScope?.scopeType ?? req.user?.scopeType ?? 'GLOBAL',
    scopeId: req.appFeatureScope?.scopeId ?? req.user?.scopeId ?? 1,
  };
}

function userId(req) {
  return req.user?.user_id ?? req.user?.id ?? null;
}

function fail(res, error, op, fallback = 500) {
  const status = Number(error?.statusCode ?? error?.status);
  console.error(`[productsStockLotsPanel:${op}]`, error?.message || error);
  return res.status(Number.isFinite(status) && status >= 100 ? status : fallback).json({
    ok: false,
    error: error?.code || 'PRODUCT_STOCK_LOT_PANEL_FAILED',
    message: error?.message || 'Falha no painel de lotes.',
    ...(error?.details ? { details: error.details } : {}),
  });
}

function panelFilters(query = {}) {
  return {
    q: query.q,
    situation: query.situation,
    balance: query.balance || 'positive',
    blocked: query.blocked,
    product_stock_id: query.product_stock_id,
    expires_from: query.expires_from,
    expires_to: query.expires_to,
    sort: query.sort,
    dir: query.dir,
    page: query.page,
    limit: query.limit,
  };
}

/* ─────────────────────────── Lista ─────────────────────────── */
export async function panel(req, res) {
  try {
    await requireLotMode(scope(req));
    const data = await panelRepo.listPanel(panelFilters(req.query));
    return res.json({ ok: true, ...data });
  } catch (error) {
    return fail(res, error, 'panel');
  }
}

/* ─────────────────────── Parâmetros ─────────────────────── */
export async function getAlertSettings(req, res) {
  try {
    const settings = await panelRepo.getAlertSettings();
    return res.json({ ok: true, settings, situations: panelRepo.describeSituations(settings) });
  } catch (error) {
    return fail(res, error, 'getAlertSettings');
  }
}

export async function saveAlertSettings(req, res) {
  try {
    const settings = await panelRepo.saveAlertSettings(req.body || {}, userId(req));
    return res.json({ ok: true, settings, situations: panelRepo.describeSituations(settings) });
  } catch (error) {
    return fail(res, error, 'saveAlertSettings', 400);
  }
}

/* ─────────────────────── Dashboard da home ─────────────────────── */
export async function dashboard(req, res) {
  try {
    await requireLotMode(scope(req));
    const data = await panelRepo.getDashboard({ upcomingLimit: req.query.limit, months: req.query.months });
    return res.json({ ok: true, ...data });
  } catch (error) {
    return fail(res, error, 'dashboard');
  }
}

/* ─────────────────────── Produto (lupa) ─────────────────────── */
export async function productLookup(req, res) {
  try {
    const product = await panelRepo.lookupProduct(req.query.code);
    if (!product) return res.status(404).json({ ok: false, error: 'PRODUCT_NOT_FOUND', message: 'Produto não encontrado.' });
    if (!product.product_stock_id) {
      return res.status(409).json({ ok: false, error: 'PRODUCT_WITHOUT_STOCK', message: 'Produto sem registro de estoque (product_stock_id).' });
    }
    return res.json({ ok: true, product });
  } catch (error) {
    return fail(res, error, 'productLookup');
  }
}

/* ─────────────────────── Lote / Kardex ─────────────────────── */
export async function lotPanel(req, res) {
  try {
    const { row, settings } = await panelRepo.getLotPanelRow(req.params.id);
    if (!row) return res.status(404).json({ ok: false, error: 'LOT_NOT_FOUND', message: 'Lote não encontrado.' });
    return res.json({ ok: true, row, situations: panelRepo.describeSituations(settings) });
  } catch (error) {
    return fail(res, error, 'lotPanel');
  }
}

export async function kardex(req, res) {
  try {
    const data = await panelRepo.listLotKardex(req.params.id);
    if (!data.lot) return res.status(404).json({ ok: false, error: 'LOT_NOT_FOUND', message: 'Lote não encontrado.' });
    return res.json({ ok: true, ...data });
  } catch (error) {
    return fail(res, error, 'kardex');
  }
}

export async function block(req, res) {
  try {
    const row = await panelRepo.setLotBlocked(req.params.id, true, req.body?.reason);
    if (!row) return res.status(404).json({ ok: false, error: 'LOT_NOT_FOUND', message: 'Lote não encontrado.' });
    return res.json({ ok: true, row });
  } catch (error) {
    return fail(res, error, 'block', 400);
  }
}

export async function unblock(req, res) {
  try {
    const row = await panelRepo.setLotBlocked(req.params.id, false);
    if (!row) return res.status(404).json({ ok: false, error: 'LOT_NOT_FOUND', message: 'Lote não encontrado.' });
    return res.json({ ok: true, row });
  } catch (error) {
    return fail(res, error, 'unblock', 400);
  }
}

/** Salva a data de fabricação (chamado após criar/editar o lote). */
export async function saveExtras(req, res) {
  try {
    const row = await panelRepo.updateLotExtras(req.params.id, req.body || {});
    if (!row) return res.status(404).json({ ok: false, error: 'LOT_NOT_FOUND', message: 'Lote não encontrado.' });
    return res.json({ ok: true, row });
  } catch (error) {
    return fail(res, error, 'saveExtras', 400);
  }
}

/* ─────────────── Movimentar com as regras de validade ─────────────── */
const MOVE_OPS = new Set(['reserve', 'unreserve', 'consume']);

function ruleForReserve(row, settings) {
  if (row.blocked_at) {
    return { level: 'BLOCK', manual: true, message: `Lote bloqueado${row.block_reason ? `: ${row.block_reason}` : ''}. Libere o lote para reservar.` };
  }

  const situations = panelRepo.describeSituations(settings);
  const current = situations.find((s) => s.key === row.situation);
  const days = row.days_left === null || row.days_left === undefined ? null : Number(row.days_left);

  if (current && (current.action === 'BLOCK' || current.action === 'CONFIRM')) {
    const when = days === null ? '' : days < 0 ? ` (vencido há ${-days} dia(s))` : ` (faltam ${days} dia(s))`;
    return { level: current.action, message: `Lote na faixa "${current.label}"${when}.` };
  }

  if (days !== null && settings.min_days_to_sell > 0 && days < settings.min_days_to_sell) {
    return { level: 'CONFIRM', message: `Faltam ${days} dia(s) para vencer; a validade mínima para vender é ${settings.min_days_to_sell} dia(s).` };
  }

  return null;
}

export async function move(req, res) {
  try {
    const op = String(req.body?.op || '').toLowerCase();
    const qty = Number(req.body?.qty);
    const reason = String(req.body?.reason || '').trim().slice(0, 200);
    const confirmed = req.body?.confirm === true;

    if (!MOVE_OPS.has(op)) return res.status(400).json({ ok: false, error: 'INVALID_OP', message: 'Operação inválida.' });
    if (!(qty > 0)) return res.status(400).json({ ok: false, error: 'INVALID_QTY', message: 'Informe uma quantidade maior que zero.' });

    const { row: lot, settings } = await panelRepo.getLotPanelRow(req.params.id);
    if (!lot) return res.status(404).json({ ok: false, error: 'LOT_NOT_FOUND', message: 'Lote não encontrado.' });

    if (op === 'reserve') {
      const rule = ruleForReserve(lot, settings);
      if (rule?.level === 'BLOCK') {
        return res.status(409).json({ ok: false, error: 'LOT_RESERVE_BLOCKED', message: rule.manual ? rule.message : `${rule.message} Reserva bloqueada pelos parâmetros de validade.` });
      }
      if (rule?.level === 'CONFIRM' && !confirmed) {
        return res.status(409).json({ ok: false, error: 'LOT_NEEDS_CONFIRM', needsConfirm: true, message: `${rule.message} Deseja reservar mesmo assim?` });
      }
    }

    const opts = scope(req);
    let row;
    if (op === 'reserve') row = await productsStockManager.reserveLot({ lot_id: lot.lot_id, qty }, opts);
    if (op === 'unreserve') row = await productsStockManager.unreserveLot({ lot_id: lot.lot_id, qty }, opts);
    if (op === 'consume') {
      row = await productsStockManager.consumeLot({ lot_id: lot.lot_id, qty }, opts);

      if (lot.product_code) {
        try {
          await registerProductMovement({
            product_code: lot.product_code,
            movement_type: 'SAIDA',
            origin_module: 'PRODUCTS_STOCK_LOTS',
            origin_table: 'productsStockLots',
            origin_id: lot.lot_id,
            quantity: qty,
            lot_code: lot.lot_code,
            notes: `Baixa manual do lote ${lot.lot_code}${reason ? ` — ${reason}` : ''}`,
            user_id: userId(req),
            metadata: {
              lot_id: lot.lot_id,
              lot_code: lot.lot_code,
              product_grade_id: lot.product_grade_id,
              expires_at: lot.expires_at,
              situation: lot.situation,
              reason: reason || null,
            },
          });
        } catch (error) {
          console.warn('[productsStockLotsPanel:move] Kardex não registrado:', error?.message);
        }
      }
    }

    return res.json({ ok: true, row });
  } catch (error) {
    return fail(res, error, 'move', 400);
  }
}

/* ─────────────────────── Exportar ─────────────────────── */
function fmtQty(v) {
  return Number(v || 0).toLocaleString('pt-BR', { minimumFractionDigits: 3, maximumFractionDigits: 3 });
}

function fmtDate(v) {
  if (!v) return '';
  const iso = v instanceof Date ? v.toISOString().slice(0, 10) : String(v).slice(0, 10);
  const [y, m, d] = iso.split('-');
  return d ? `${d}/${m}/${y}` : iso;
}

function fmtMoney(v) {
  return Number(v || 0).toLocaleString('pt-BR', { style: 'currency', currency: 'BRL' });
}

export async function exportPanel(req, res) {
  try {
    const format = String(req.query.format || 'pdf').toLowerCase();
    if (!['pdf', 'xlsx'].includes(format)) {
      return res.status(400).json({ ok: false, error: 'format deve ser pdf ou xlsx.' });
    }

    await requireLotMode(scope(req));
    const data = await panelRepo.listPanel({ ...panelFilters(req.query), page: 1, limit: 10000 });
    const labelBy = new Map(data.situations.map((s) => [s.key, s.label]));

    const rows = data.rows.map((r) => ({
      ...r,
      product: `${r.product_code || ''} ${r.product_description || ''}`.trim() || `Stock ${r.product_stock_id}`,
      situation_label: r.blocked_at ? `${labelBy.get(r.situation) || ''} (bloqueado)` : labelBy.get(r.situation) || '',
      origin: r.invoice_number ? `NF-e ${r.invoice_number}${r.supplier_name ? ` · ${r.supplier_name}` : ''}` : (r.supplier_name || 'Manual'),
    }));

    const columns = [
      { key: 'fefo_rank', label: 'FEFO', w: 34, width: 7, align: 'center', format: (v) => (v ? `${v}º` : '') },
      { key: 'product', label: 'Produto', width: 44, bold: true },
      { key: 'grade_name', label: 'Grade', w: 50, width: 12 },
      { key: 'lot_code', label: 'Lote', w: 70, width: 16 },
      { key: 'expires_at', label: 'Validade', w: 56, width: 12, align: 'center', format: (v) => fmtDate(v), value: (r) => fmtDate(r.expires_at) },
      { key: 'days_left', label: 'Dias', w: 36, width: 8, align: 'center', format: (v) => (v === null || v === undefined ? '' : String(v)) },
      { key: 'situation_label', label: 'Situação', w: 70, width: 18 },
      { key: 'qty_on_hand', label: 'Em mãos', w: 54, width: 12, align: 'right', format: fmtQty, value: (r) => Number(r.qty_on_hand || 0), numFmt: '#,##0.000' },
      { key: 'qty_reserved', label: 'Reserv.', w: 50, width: 12, align: 'right', format: fmtQty, value: (r) => Number(r.qty_reserved || 0), numFmt: '#,##0.000' },
      { key: 'qty_available', label: 'Disp.', w: 54, width: 12, align: 'right', format: fmtQty, value: (r) => Number(r.qty_available || 0), numFmt: '#,##0.000' },
      { key: 'origin', label: 'Origem', w: 110, width: 30 },
    ];

    const situationKey = String(req.query.situation || '').toUpperCase();
    const situationLabel = situationKey === 'WITH_EXPIRY' ? 'Com data de vencimento' : labelBy.get(situationKey);
    const info = [
      ['Busca', String(req.query.q || '').trim() || 'Todos'],
      ['Situação', situationLabel || 'Todas'],
      ['Saldo', { all: 'Todos', zero: 'Zerados' }[req.query.balance] || 'Com saldo'],
    ];
    const today = new Date().toISOString().slice(0, 10);

    if (format === 'xlsx') {
      const { buildSimpleListWorkbook } = await import('../generationPdf/generationSimpleListExcel.js');
      const buffer = await buildSimpleListWorkbook({
        title: 'Estoque por Lote — Validades',
        subtitle: 'Lotes, vencimentos e ordem FEFO',
        sheetName: 'Lotes',
        info,
        columns,
        rows,
      });
      res.setHeader('Content-Type', 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet');
      res.setHeader('Content-Disposition', `attachment; filename="lotes-validade-${today}.xlsx"`);
      return res.send(Buffer.from(buffer));
    }

    const kpis = data.situations
      .filter((s) => s.key !== 'OK' || s.lots)
      .slice(0, 6)
      .map((s) => ({ label: s.label, value: `${s.lots} lote(s)`, hint: `${fmtQty(s.qty)} un. · ${fmtMoney(s.value)}` }));

    const { generateSimpleListPdf } = await import('../generationPdf/generationSimpleListPdf.js');
    const pdf = await generateSimpleListPdf({
      title: 'Estoque por Lote — Validades',
      subtitle: 'Lotes, vencimentos e ordem FEFO',
      info,
      kpis,
      columns,
      rows,
      layout: 'landscape',
      emptyText: 'Nenhum lote encontrado com os filtros escolhidos.',
    });
    res.setHeader('Content-Type', 'application/pdf');
    res.setHeader('Content-Disposition', `attachment; filename="lotes-validade-${today}.pdf"`);
    return res.send(pdf);
  } catch (error) {
    return fail(res, error, 'exportPanel');
  }
}

export default {
  dashboard,
  productLookup,
  panel,
  exportPanel,
  getAlertSettings,
  saveAlertSettings,
  lotPanel,
  kardex,
  block,
  unblock,
  saveExtras,
  move,
};
