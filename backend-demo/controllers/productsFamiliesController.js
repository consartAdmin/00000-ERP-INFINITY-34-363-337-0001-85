// ╔══════════════════════════════════════════════════════════════════════╗
// ║ productsFamiliesController.js — HTTP Controller Famílias de Produtos ║
// ║ 3º nível: Grupo → Subgrupo → Família | CONSART ERP | ESM             ║
// ╚══════════════════════════════════════════════════════════════════════╝

import ProductsFamiliesAPI from '../repositories/productsFamilies/productsFamilies.index.js';

function sendError(res, err, context = 'productsFamilies') {
  const status = err?.status || 500;
  if (status >= 500) console.error(`[${context}]`, err);
  return res.status(status).json({
    ok: false,
    context,
    error: err?.message || 'Erro inesperado ao processar famílias de produtos.',
  });
}

const notFound = (res) => res.status(404).json({ ok: false, error: 'Família não encontrada.' });

const productsFamiliesController = {
  async list(req, res) {
    try {
      const { q, subgroup_id, product_subgroup_id, group_id, product_group_id, is_active, limit, offset, orderBy, dir } = req.query;
      const result = await ProductsFamiliesAPI.list({
        q,
        subgroup_id: product_subgroup_id ?? subgroup_id,
        group_id: product_group_id ?? group_id,
        is_active,
        limit,
        offset,
        orderBy,
        dir,
      });
      return res.json({ ok: true, data: result });
    } catch (err) {
      return sendError(res, err, 'productsFamilies.list');
    }
  },

  async getById(req, res) {
    try {
      const row = await ProductsFamiliesAPI.getById(Number(req.params.id));
      return row ? res.json({ ok: true, data: row }) : notFound(res);
    } catch (err) {
      return sendError(res, err, 'productsFamilies.getById');
    }
  },

  async create(req, res) {
    try {
      const created = await ProductsFamiliesAPI.create(req.body || {});
      return res.status(201).json({ ok: true, data: created });
    } catch (err) {
      return sendError(res, err, 'productsFamilies.create');
    }
  },

  async update(req, res) {
    try {
      const updated = await ProductsFamiliesAPI.update(Number(req.params.id), req.body || {});
      return updated ? res.json({ ok: true, data: updated }) : notFound(res);
    } catch (err) {
      return sendError(res, err, 'productsFamilies.update');
    }
  },

  async remove(req, res) {
    try {
      const ok = await ProductsFamiliesAPI.remove(Number(req.params.id));
      return ok ? res.json({ ok: true, data: true }) : notFound(res);
    } catch (err) {
      return sendError(res, err, 'productsFamilies.remove');
    }
  },
};

export default productsFamiliesController;
