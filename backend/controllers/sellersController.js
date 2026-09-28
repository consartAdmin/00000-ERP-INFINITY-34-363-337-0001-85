// ╔══════════════════════════════════════════════════════════════════╗
// ║ sellersController.js — HTTP Controller de Vendedores (ESM)      ║
// ║ - Conecta rotas Express ao sellersApi                           ║
// ║ - Padrão de resposta: { ok, data?, error? }                     ║
// ╚══════════════════════════════════════════════════════════════════╝

import sellersApi from '../services/apis/sellersApi.js';

/* ====================================================================
 * Helpers
 * ==================================================================== */
function parseActiveFlag(raw) {
  if (raw === undefined || raw === null || raw === '') return undefined;
  const s = String(raw).trim().toLowerCase();
  if (['1', 'true', 't', 'sim', 'yes', 'y', 'ativo', 'active'].includes(s)) return true;
  if (['0', 'false', 'f', 'nao', 'não', 'no', 'n', 'inativo', 'inactive'].includes(s)) return false;
  return undefined;
}

/* ====================================================================
 * LIST / SEARCH
 * ==================================================================== */
export async function listSellers(req, res) {
  try {
    const {
      q,
      active,
      limit,
      offset,
    } = req.query;

    const params = {
      q: q || undefined,
      active: parseActiveFlag(active),
      limit: limit ? Number(limit) : 50,
      offset: offset ? Number(offset) : 0,
    };

    const data = await sellersApi.list(params);
    return res.json({ ok: true, data });
  } catch (err) {
    console.error('[sellersController] listSellers error:', err);
    return res.status(500).json({ ok: false, error: 'Erro ao listar vendedores.' });
  }
}

export async function searchSellers(req, res) {
  try {
    const { q, limit } = req.query;
    const data = await sellersApi.search(q || '', limit ? Number(limit) : 20);
    return res.json({ ok: true, data });
  } catch (err) {
    console.error('[sellersController] searchSellers error:', err);
    return res.status(500).json({ ok: false, error: 'Erro na busca de vendedores.' });
  }
}

/* ====================================================================
 * GET BY ID
 * ==================================================================== */
export async function getSellerById(req, res) {
  try {
    const id = Number(req.params.id);
    if (!Number.isFinite(id)) {
      return res.status(400).json({ ok: false, error: 'ID inválido.' });
    }

    const data = await sellersApi.getById(id);
    if (!data) {
      return res.status(404).json({ ok: false, error: 'Vendedor não encontrado.' });
    }

    return res.json({ ok: true, data });
  } catch (err) {
    console.error('[sellersController] getSellerById error:', err);
    return res.status(500).json({ ok: false, error: 'Erro ao buscar vendedor.' });
  }
}

/* ====================================================================
 * CREATE
 * ==================================================================== */
export async function createSeller(req, res) {
  try {
    const payload = req.body || {};
    const created = await sellersApi.create(payload);
    return res.status(201).json({ ok: true, data: created });
  } catch (err) {
    console.error('[sellersController] createSeller error:', err);
    return res.status(500).json({ ok: false, error: err.message || 'Erro ao criar vendedor.' });
  }
}

/* ====================================================================
 * UPDATE
 * ==================================================================== */
export async function updateSeller(req, res) {
  try {
    const id = Number(req.params.id);
    if (!Number.isFinite(id)) {
      return res.status(400).json({ ok: false, error: 'ID inválido.' });
    }

    const payload = req.body || {};
    const updated = await sellersApi.update(id, payload);
    if (!updated) {
      return res.status(404).json({ ok: false, error: 'Vendedor não encontrado para atualizar.' });
    }

    return res.json({ ok: true, data: updated });
  } catch (err) {
    console.error('[sellersController] updateSeller error:', err);
    return res.status(500).json({ ok: false, error: 'Erro ao atualizar vendedor.' });
  }
}

/* ====================================================================
 * REMOVE (soft delete: active = false)
 * ==================================================================== */
export async function deleteSeller(req, res) {
  try {
    const id = Number(req.params.id);
    if (!Number.isFinite(id)) {
      return res.status(400).json({ ok: false, error: 'ID inválido.' });
    }

    const removed = await sellersApi.remove(id);
    if (!removed) {
      return res.status(404).json({ ok: false, error: 'Vendedor não encontrado para remoção.' });
    }

    return res.json({ ok: true, data: removed });
  } catch (err) {
    console.error('[sellersController] deleteSeller error:', err);
    return res.status(500).json({ ok: false, error: 'Erro ao remover vendedor.' });
  }
}

/* ====================================================================
 * Export default
 * ==================================================================== */
export default {
  listSellers,
  searchSellers,
  getSellerById,
  createSeller,
  updateSeller,
  deleteSeller,
};
