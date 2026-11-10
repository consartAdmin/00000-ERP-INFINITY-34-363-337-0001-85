// ╔══════════════════════════════════════════════════════════════════════╗
// ║ backend/controllers/betterDateToBuyController.js                   ║
// ║ Melhor Data de Compra (lembrete mensal de recompra) | CONSART ERP  ║
// ╚══════════════════════════════════════════════════════════════════════╝

import * as api from '../repositories/betterDateToBuy/betterDateToBuy.index.js';

function fail(res, tag, err) {
  console.error(`[betterDateToBuy][${tag}]`, err);
  res.status(500).json({ ok: false, error: err.message });
}

function parseDay(value) {
  const day = Number(value);
  return Number.isInteger(day) && day >= 1 && day <= 31 ? day : null;
}

function parseId(value) {
  const id = Number(value);
  return Number.isInteger(id) && id > 0 ? id : null;
}


// ──────────────────────────────────────────────────────────────────────
// LISTA (com situação do mês e histórico de compras)
// ──────────────────────────────────────────────────────────────────────
export async function list(req, res) {
  try {
    const data = await api.getAllBetterDates();
    res.json({ ok: true, lead_days: api.SUGGESTION_LEAD_DAYS, data });
  } catch (err) {
    fail(res, 'LIST', err);
  }
}


// ──────────────────────────────────────────────────────────────────────
// UM ALERTA
// ──────────────────────────────────────────────────────────────────────
export async function getById(req, res) {
  try {
    const item = await api.getBetterDateById(req.params.id);
    if (!item) {
      return res.status(404).json({ ok: false, error: 'Alerta não encontrado.' });
    }
    res.json({ ok: true, data: item });
  } catch (err) {
    fail(res, 'GET BY ID', err);
  }
}


// ──────────────────────────────────────────────────────────────────────
// HISTÓRICO DE COMPRAS DE UM CLIENTE (dia sugerido no modal)
// ──────────────────────────────────────────────────────────────────────
export async function purchaseProfile(req, res) {
  try {
    const customerId = parseId(req.params.customerId);
    if (!customerId) {
      return res.status(400).json({ ok: false, error: 'Cliente inválido.' });
    }

    const stats = await api.getPurchaseStats([customerId]);
    const existing = await api.findByCustomer(customerId);

    res.json({
      ok: true,
      lead_days: api.SUGGESTION_LEAD_DAYS,
      data: stats.get(customerId) || null,
      existing_alert_id: existing?.better_date_to_buy_id ?? null
    });
  } catch (err) {
    fail(res, 'PURCHASE PROFILE', err);
  }
}


// ──────────────────────────────────────────────────────────────────────
// SUGESTÕES PELO HISTÓRICO (clientes frequentes sem alerta)
// ──────────────────────────────────────────────────────────────────────
export async function suggestions(req, res) {
  try {
    const minPurchases = Math.max(2, Number(req.query.minPurchases) || 3);
    const data = await api.getSuggestions({ minPurchases });
    res.json({ ok: true, lead_days: api.SUGGESTION_LEAD_DAYS, data });
  } catch (err) {
    fail(res, 'SUGGESTIONS', err);
  }
}


// ──────────────────────────────────────────────────────────────────────
// CREATE
// ──────────────────────────────────────────────────────────────────────
export async function create(req, res) {
  try {
    const customerId = parseId(req.body?.customer_id);
    const alertDay = parseDay(req.body?.alert_day);

    if (!customerId) {
      return res.status(400).json({ ok: false, error: 'Selecione o cliente.' });
    }
    if (!alertDay) {
      return res.status(400).json({ ok: false, error: 'O dia do alerta deve ser entre 1 e 31.' });
    }
    if (await api.findByCustomer(customerId)) {
      return res.status(409).json({ ok: false, error: 'Este cliente já tem um alerta. Edite o alerta existente.' });
    }

    const created = await api.createBetterDate({
      customer_id: customerId,
      alert_day: alertDay,
      notes: req.body?.notes,
      status: req.body?.status
    });

    res.status(201).json({ ok: true, data: created });
  } catch (err) {
    fail(res, 'CREATE', err);
  }
}


// ──────────────────────────────────────────────────────────────────────
// CREATE EM LOTE (sugestões)
// ──────────────────────────────────────────────────────────────────────
export async function createBulk(req, res) {
  try {
    const items = (Array.isArray(req.body?.items) ? req.body.items : [])
      .map((item) => ({
        customer_id: parseId(item?.customer_id),
        alert_day: parseDay(item?.alert_day),
        notes: item?.notes
      }))
      .filter((item) => item.customer_id && item.alert_day);

    if (!items.length) {
      return res.status(400).json({ ok: false, error: 'Selecione ao menos um cliente.' });
    }

    const result = await api.createBetterDatesBulk(items);
    res.status(201).json({
      ok: true,
      created: result.created.length,
      skipped: result.skipped,
      data: result.created
    });
  } catch (err) {
    fail(res, 'CREATE BULK', err);
  }
}


// ──────────────────────────────────────────────────────────────────────
// UPDATE
// ──────────────────────────────────────────────────────────────────────
export async function update(req, res) {
  try {
    const id = parseId(req.params.id);
    const customerId = parseId(req.body?.customer_id);
    const alertDay = parseDay(req.body?.alert_day);

    if (!id) return res.status(400).json({ ok: false, error: 'Alerta inválido.' });
    if (!customerId) return res.status(400).json({ ok: false, error: 'Selecione o cliente.' });
    if (!alertDay) {
      return res.status(400).json({ ok: false, error: 'O dia do alerta deve ser entre 1 e 31.' });
    }
    if (await api.findByCustomer(customerId, id)) {
      return res.status(409).json({ ok: false, error: 'Este cliente já tem outro alerta.' });
    }

    const updated = await api.updateBetterDate(id, {
      customer_id: customerId,
      alert_day: alertDay,
      notes: req.body?.notes,
      status: req.body?.status
    });

    if (!updated) {
      return res.status(404).json({ ok: false, error: 'Alerta não encontrado.' });
    }

    res.json({ ok: true, data: updated });
  } catch (err) {
    fail(res, 'UPDATE', err);
  }
}


// ──────────────────────────────────────────────────────────────────────
// MARCAR COMO CONTATADO / DESFAZER
// ──────────────────────────────────────────────────────────────────────
export async function markSent(req, res) {
  try {
    const updated = await api.markAlertSent(req.params.id);
    if (!updated) {
      return res.status(404).json({ ok: false, error: 'Alerta não encontrado.' });
    }
    res.json({ ok: true, data: updated });
  } catch (err) {
    fail(res, 'MARK SENT', err);
  }
}

export async function unmarkSent(req, res) {
  try {
    const updated = await api.unmarkAlertSent(req.params.id);
    if (!updated) {
      return res.status(404).json({ ok: false, error: 'Alerta não encontrado.' });
    }
    res.json({ ok: true, data: updated });
  } catch (err) {
    fail(res, 'UNMARK SENT', err);
  }
}


// ──────────────────────────────────────────────────────────────────────
// PAUSAR / ATIVAR
// ──────────────────────────────────────────────────────────────────────
export async function setStatus(req, res) {
  try {
    const status = req.body?.status === 'inactive' ? 'inactive' : 'active';
    const updated = await api.setBetterDateStatus(req.params.id, status);
    if (!updated) {
      return res.status(404).json({ ok: false, error: 'Alerta não encontrado.' });
    }
    res.json({ ok: true, data: updated });
  } catch (err) {
    fail(res, 'STATUS', err);
  }
}


// ──────────────────────────────────────────────────────────────────────
// DELETE
// ──────────────────────────────────────────────────────────────────────
export async function remove(req, res) {
  try {
    await api.deleteBetterDate(req.params.id);
    res.json({ ok: true, success: true });
  } catch (err) {
    fail(res, 'DELETE', err);
  }
}


// ──────────────────────────────────────────────────────────────────────
// PENDENTES DE CONTATO (painel da Home)
// ──────────────────────────────────────────────────────────────────────
export async function todayAlerts(req, res) {
  try {
    const data = await api.getTodayAlerts();
    res.json({ ok: true, count: data.length, data });
  } catch (err) {
    fail(res, 'TODAY ALERTS', err);
  }
}
