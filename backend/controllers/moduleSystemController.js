// ╔══════════════════════════════════════════════════════════════════════╗
// ║ moduleSystemController.js — REST handlers do cadastro de módulos    ║
// ║ CONSART ERP — Usado por /api/module-system                           ║
// ╚══════════════════════════════════════════════════════════════════════╝

import {
  list,
  findById,
  create,
  update,
  remove,
} from '../services/apis/moduleSystemApi.js';

function toBool(v) {
  if (typeof v === 'boolean') return v;
  if (typeof v === 'string') return v === 'true' || v === '1';
  if (typeof v === 'number') return v === 1;
  return false;
}

export const moduleSystemController = {
  /** GET /api/module-system?onlyActive=1&search=texto */
  async list(req, res) {
    try {
      const { onlyActive, search } = req.query;
      const data = await list({
        onlyActive: onlyActive === '1' || onlyActive === 'true',
        search: search || undefined,
      });
      res.json({ ok: true, data });
    } catch (err) {
      console.error('[moduleSystemController.list] erro:', err);
      res.status(500).json({ ok: false, error: 'Erro ao listar módulos.' });
    }
  },

  /** GET /api/module-system/:id */
  async getById(req, res) {
    try {
      const { id } = req.params;
      const row = await findById(id);
      if (!row) {
        return res.status(404).json({ ok: false, error: 'Módulo não encontrado.' });
      }
      res.json({ ok: true, data: row });
    } catch (err) {
      console.error('[moduleSystemController.getById] erro:', err);
      res.status(500).json({ ok: false, error: 'Erro ao buscar módulo.' });
    }
  },

  /** POST /api/module-system  (body: { name, path, isActive }) */
  async create(req, res) {
    try {
      const { name, path, isActive } = req.body;

      if (!name || !path) {
        return res
          .status(400)
          .json({ ok: false, error: 'Campos "name" e "path" são obrigatórios.' });
      }

      const row = await create({
        name: String(name),
        path: String(path),
        is_active: isActive !== undefined ? toBool(isActive) : true,
      });

      res.status(201).json({ ok: true, data: row });
    } catch (err) {
      console.error('[moduleSystemController.create] erro:', err);
      res.status(500).json({ ok: false, error: 'Erro ao criar módulo.' });
    }
  },

  /** PUT /api/module-system/:id  (body: campos para atualizar) */
  async update(req, res) {
    try {
      const { id } = req.params;
      const { name, path, isActive } = req.body;

      const payload = {};
      if (name !== undefined) payload.name = String(name);
      if (path !== undefined) payload.path = String(path);
      if (isActive !== undefined) payload.is_active = toBool(isActive);

      const row = await update(id, payload);
      if (!row) {
        return res.status(404).json({ ok: false, error: 'Módulo não encontrado.' });
      }

      res.json({ ok: true, data: row });
    } catch (err) {
      console.error('[moduleSystemController.update] erro:', err);
      res.status(500).json({ ok: false, error: 'Erro ao atualizar módulo.' });
    }
  },

  /** DELETE /api/module-system/:id */
  async remove(req, res) {
    try {
      const { id } = req.params;
      const row = await remove(id);
      if (!row) {
        return res.status(404).json({ ok: false, error: 'Módulo não encontrado.' });
      }
      res.json({ ok: true, data: row });
    } catch (err) {
      console.error('[moduleSystemController.remove] erro:', err);
      res.status(500).json({ ok: false, error: 'Erro ao remover módulo.' });
    }
  },
};
