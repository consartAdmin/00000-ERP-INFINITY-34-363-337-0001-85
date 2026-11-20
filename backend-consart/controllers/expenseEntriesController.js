// ╔══════════════════════════════════════════════════════════════════════╗
// ║ expenseEntriesController.js — Controller — CONSART ERP              ║
// ║ Path: backend/controllers/expenseEntriesController.js                ║
// ║ ESM • CRUD + Import XML (NF-e) + POST -> accountsPayable + Caixa    ║
// ╚══════════════════════════════════════════════════════════════════════╝

import {
  expenseEntriesApi,
  parseNfeXmlToExpenseEntryDraft,
} from '../repositories/expenseEntries/expenseEntries.index.js';

import caixaApi from '../repositories/cashMoviments/cashMoviments.index.js';
import pool from '../config/db.js';

function ok(res, data, extra = {}) {
  return res.json({ ok: true, ...extra, data });
}

function fail(res, status, message, extra = {}) {
  return res.status(status).json({ ok: false, message, ...extra });
}

function toNumber(v, def = 0) {
  const n = Number(v);
  return Number.isFinite(n) ? n : def;
}

function buildCaixaObservation(entry, expenseEntryId) {
  return [
    'Lançamento automático via Entrada de Despesa/XML',
    `expenseEntryId=${expenseEntryId}`,
    entry?.documentType ? `Documento: ${entry.documentType}` : null,
    entry?.documentNumber ? `Número: ${entry.documentNumber}` : null,
    entry?.documentSeries ? `Série: ${entry.documentSeries}` : null,
    entry?.documentKey ? `Chave NF-e: ${entry.documentKey}` : null,
  ]
    .filter(Boolean)
    .join('\n');
}

// Movimentação do Caixa gerada pela entrada: a observação leva a linha
// "expenseEntryId=N". O regex evita que a entrada 1 encontre a 12.
async function findCashMovementIdForEntry(expenseEntryId) {
  const id = Number(expenseEntryId);
  if (!id) return null;
  const { rows } = await pool.query(
    `SELECT id FROM "cashMoviments" WHERE notes ~ $1 ORDER BY id ASC LIMIT 1`,
    [`expenseEntryId=${id}([^0-9]|$)`]
  );
  return rows[0]?.id || null;
}

// Plano de contas / Categoria / Subcategoria escolhidos no modal (vão para o Caixa)
function readClassification(body = {}) {
  const c = body?.cashClassification;
  if (!c || typeof c !== 'object') return null;
  const chartId = Number(c.chart_account_id);
  const text = (v) => {
    const t = String(v ?? '').trim();
    return t || null;
  };
  return {
    chart_account_id: Number.isInteger(chartId) && chartId > 0 ? chartId : null,
    categoria: text(c.categoria),
    subcategoria: text(c.subcategoria),
  };
}

async function applyClassificationToMovement(movementId, classification) {
  if (!movementId || !classification) return;
  await pool.query(
    `UPDATE "cashMoviments"
        SET category = $2, subcategory = $3, chart_account_id = $4
      WHERE id = $1`,
    [Number(movementId), classification.categoria, classification.subcategoria, classification.chart_account_id]
  );
}

async function ensureCaixaMovementFromExpenseEntry({ expenseEntry, classification = null }) {
  if (!expenseEntry?.expenseEntryId) {
    throw new Error('expenseEntryId não encontrado para lançar no Caixa.');
  }

  const expenseEntryId = expenseEntry.expenseEntryId;
  const total = toNumber(expenseEntry.totalExpenseValue, 0);

  if (total <= 0) {
    throw new Error('Valor da despesa inválido para lançar no Caixa.');
  }

  const existingId = await findCashMovementIdForEntry(expenseEntryId);
  if (existingId) {
    return (await caixaApi.getMovementById(existingId)) || { id: existingId };
  }

  return await caixaApi.createMovement({
    data_hora: expenseEntry.entryDate || expenseEntry.issueDate || new Date(),
    tipo_movimentacao: 'SAIDA',
    conta_caixa: 'CAIXA',
    valor: total,
    tipo_documento: expenseEntry.documentType || 'NF-e',
    numero_documento:
      expenseEntry.documentKey ||
      expenseEntry.documentNumber ||
      String(expenseEntryId),
    fornecedor: expenseEntry.supplierName || null,
    observacao: buildCaixaObservation(expenseEntry, expenseEntryId),
    multa: 0,
    juros: 0,
    encargos: 0,
    categoria: classification?.categoria ?? null,
    subcategoria: classification?.subcategoria ?? null,
    chart_account_id: classification?.chart_account_id ?? null,
    is_active: true,
  });
}

export const expenseEntriesController = {
  async list(req, res) {
    try {
      const result = await expenseEntriesApi.list({
        page: req.query.page,
        pageSize: req.query.pageSize,
        orderBy: req.query.orderBy,
        status: req.query.status,
        supplierDocument: req.query.supplierDocument,
        q: req.query.q,
        dateFrom: req.query.dateFrom,
        dateTo: req.query.dateTo,
      });

      return ok(res, result.rows, { paging: result.paging });
    } catch (e) {
      console.error('[expenseEntries] list error', e);
      return fail(res, 500, e.message || 'Internal error');
    }
  },

  async getById(req, res) {
    try {
      const expenseEntryId = Number(req.params.id);
      if (!expenseEntryId) return fail(res, 400, 'Invalid id');

      const row = await expenseEntriesApi.getById({ expenseEntryId });
      if (!row) return fail(res, 404, 'Not found');

      return ok(res, row);
    } catch (e) {
      console.error('[expenseEntries] getById error', e);
      return fail(res, 500, e.message || 'Internal error');
    }
  },

  async create(req, res) {
    try {
      // ─────────────────────────────────────────────
      // Cria entrada da despesa
      // ─────────────────────────────────────────────
      const created = await expenseEntriesApi.create(req.body || {});

      // ─────────────────────────────────────────────
      // Lança automaticamente no Caixa
      // ─────────────────────────────────────────────
      let caixaMovement = null;

      try {
        const classification = readClassification(req.body);
        caixaMovement = await ensureCaixaMovementFromExpenseEntry({
          expenseEntry: created,
          classification,
        });
        // Se a movimentação já existia, aplica a classificação escolhida
        await applyClassificationToMovement(caixaMovement?.id, classification);

        console.log('[expenseEntries][CAIXA][AUTO_CREATED]', {
          expenseEntryId: created?.expenseEntryId,
          caixaMovementId: caixaMovement?.id,
        });

      } catch (caixaError) {
        console.error('[expenseEntries][CAIXA][ERROR]', caixaError);

        return ok(res, created, {
          warning: 'Entrada salva, mas não foi lançada no Caixa.',
          caixaError: caixaError.message,
        });
      }

      // ─────────────────────────────────────────────
      // Retorno final
      // ─────────────────────────────────────────────
      return ok(res, {
        ...created,
        caixaMovement,
      });

    } catch (e) {
      console.error('[expenseEntries] create error', e);
      return fail(res, 400, e.message || 'Invalid payload');
    }
  },

  async update(req, res) {
    try {
      const expenseEntryId = Number(req.params.id);
      if (!expenseEntryId) return fail(res, 400, 'Invalid id');

      const updated = await expenseEntriesApi.update({
        expenseEntryId,
        body: req.body || {},
      });

      if (!updated) return fail(res, 404, 'Not found');

      // Plano de contas / Categoria / Subcategoria → movimentação do Caixa
      const classification = readClassification(req.body);
      if (classification) {
        try {
          const movement = await ensureCaixaMovementFromExpenseEntry({ expenseEntry: updated, classification });
          await applyClassificationToMovement(movement?.id, classification);
        } catch (caixaError) {
          console.error('[expenseEntries][CAIXA][CLASSIFICATION]', caixaError);
          return ok(res, updated, { warning: 'Entrada salva, mas a classificação não foi gravada no Caixa.' });
        }
      }

      return ok(res, updated);
    } catch (e) {
      console.error('[expenseEntries] update error', e);
      return fail(res, 400, e.message || 'Invalid payload');
    }
  },

  async cancel(req, res) {
    try {
      const expenseEntryId = Number(req.params.id);
      if (!expenseEntryId) return fail(res, 400, 'Invalid id');

      const row = await expenseEntriesApi.cancel({ expenseEntryId });
      if (!row) return fail(res, 404, 'Not found');

      return ok(res, row);
    } catch (e) {
      console.error('[expenseEntries] cancel error', e);
      return fail(res, 400, e.message || 'Internal error');
    }
  },

  async remove(req, res) {
    try {
      const expenseEntryId = Number(req.params.id);
      if (!expenseEntryId) return fail(res, 400, 'Invalid id');

      const r = await expenseEntriesApi.remove({ expenseEntryId });
      if (!r) return fail(res, 404, 'Not found');

      return ok(res, {
        expenseEntryId: r.expenseentryid ?? r.expenseEntryId ?? expenseEntryId,
      });
    } catch (e) {
      console.error('[expenseEntries] remove error', e);
      return fail(res, 400, e.message || 'Internal error');
    }
  },

  async post(req, res) {
    try {
      const expenseEntryId = Number(req.params.id);
      if (!expenseEntryId) return fail(res, 400, 'Invalid id');

      const result = await expenseEntriesApi.post({
        expenseEntryId,
        dueDate: req.body?.dueDate || null,
      });

      const caixaMovement = await ensureCaixaMovementFromExpenseEntry({
        expenseEntry: result.expenseEntry,
      });

      return ok(res, {
        ...result,
        caixaMovement,
      });
    } catch (e) {
      console.error('[expenseEntries] post error', e);
      return fail(res, 400, e.message || 'Internal error');
    }
  },

  // GET /api/expense-entries/:id/cash-movement → { id } ou { id: null }
  async getCashMovement(req, res) {
    try {
      const expenseEntryId = Number(req.params.id);
      if (!expenseEntryId) return fail(res, 400, 'Invalid id');
      const id = await findCashMovementIdForEntry(expenseEntryId);
      const movement = id ? await caixaApi.getMovementById(id) : null;
      return ok(res, {
        id,
        movement: movement ? {
          chart_account_id: movement.chart_account_id ?? null,
          chart_account_code: movement.chart_account_code ?? null,
          chart_account_description: movement.chart_account_description ?? null,
          category: movement.categoria_nome ?? movement.category ?? movement.categoria ?? null,
          subcategory: movement.subcategoria_nome ?? movement.subcategory ?? movement.subcategoria ?? null,
        } : null,
      });
    } catch (e) {
      console.error('[expenseEntries] getCashMovement error', e);
      return fail(res, 500, e.message || 'Internal error');
    }
  },

  // POST /api/expense-entries/:id/cash-movement → garante a movimentação (para anexos)
  async ensureCashMovement(req, res) {
    try {
      const expenseEntryId = Number(req.params.id);
      if (!expenseEntryId) return fail(res, 400, 'Invalid id');
      const entry = await expenseEntriesApi.getById({ expenseEntryId });
      if (!entry) return fail(res, 404, 'Not found');
      const movement = await ensureCaixaMovementFromExpenseEntry({ expenseEntry: entry });
      return ok(res, { id: movement?.id || null });
    } catch (e) {
      console.error('[expenseEntries] ensureCashMovement error', e);
      return fail(res, 400, e.message || 'Internal error');
    }
  },

  async importXml(req, res) {
    try {
      if (!req.file || !req.file.buffer) {
        return fail(res, 400, 'XML file is required (multipart field: xml)');
      }

      const { entryDraft, items } = await parseNfeXmlToExpenseEntryDraft(req.file.buffer);

      return ok(res, {
        entryDraft,
        items,
        fileName: req.file.originalname,
      });
    } catch (e) {
      console.error('[expenseEntries] importXml error', e);
      return fail(res, 400, e.message || 'Invalid XML');
    }
  },
};