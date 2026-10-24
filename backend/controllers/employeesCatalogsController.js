// ╔══════════════════════════════════════════════════════════════════════╗
// ║ employeesCatalogsController.js — Departamentos e Cargos (R.H)        ║
// ║ BASE: /api/employees-departments  e  /api/employees-positions       ║
// ║ O tipo vem de req.catalogKind (definido na rota).                   ║
// ╚══════════════════════════════════════════════════════════════════════╝

'use strict';

import * as repo from '../repositories/employeesCatalogs/employeesCatalogs.repository.js';

const NOT_FOUND = {
  departments: 'Departamento não encontrado.',
  positions: 'Cargo não encontrado.',
};

function fail(res, tag, error) {
  const status = error?.status || 500;
  if (status >= 500) console.error(`[employeesCatalogsController] ${tag} error:`, error);
  return res.status(status).json({ ok: false, error: error?.message || 'Erro inesperado.' });
}

export async function list(req, res) {
  try {
    return res.json({ ok: true, data: await repo.list(req.catalogKind, req.query) });
  } catch (error) {
    return fail(res, 'list', error);
  }
}

export async function getById(req, res) {
  try {
    const row = await repo.getById(req.catalogKind, req.params.id);
    if (!row) return res.status(404).json({ ok: false, error: NOT_FOUND[req.catalogKind] });
    return res.json({ ok: true, data: row });
  } catch (error) {
    return fail(res, 'getById', error);
  }
}

export async function create(req, res) {
  try {
    return res.status(201).json({ ok: true, data: await repo.create(req.catalogKind, req.body) });
  } catch (error) {
    return fail(res, 'create', error);
  }
}

export async function update(req, res) {
  try {
    const row = await repo.update(req.catalogKind, req.params.id, req.body);
    if (!row) return res.status(404).json({ ok: false, error: NOT_FOUND[req.catalogKind] });
    return res.json({ ok: true, data: row });
  } catch (error) {
    return fail(res, 'update', error);
  }
}

export async function remove(req, res) {
  try {
    const removed = await repo.remove(req.catalogKind, req.params.id);
    if (!removed) return res.status(404).json({ ok: false, error: NOT_FOUND[req.catalogKind] });
    return res.json({ ok: true });
  } catch (error) {
    return fail(res, 'remove', error);
  }
}
