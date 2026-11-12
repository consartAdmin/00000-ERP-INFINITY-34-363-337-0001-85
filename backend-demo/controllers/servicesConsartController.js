// ╔══════════════════════════════════════════════════════════════╗
// ║ FILE: servicesConsartController.js                           ║
// ║ MODULE: Cadastro de serviços (CONSART ERP)                   ║
// ║ BASE: /api/services-consart                                  ║
// ╚══════════════════════════════════════════════════════════════╝

'use strict';

import * as repo from '../repositories/servicesConsart/servicesConsart.repository.js';

function fail(res, tag, error) {
  const status = error?.status || 500;
  if (status >= 500) console.error(`[servicesConsartController] ${tag} error:`, error);
  return res.status(status).json({ ok: false, error: error?.message || 'Erro inesperado.' });
}

export async function list(req, res) {
  try {
    const { rows, ...summary } = await repo.list(req.query);
    return res.json({ ok: true, data: rows, ...summary });
  } catch (error) {
    return fail(res, 'list', error);
  }
}

export async function categories(req, res) {
  try {
    return res.json({ ok: true, data: await repo.listCategories() });
  } catch (error) {
    return fail(res, 'categories', error);
  }
}

export async function getById(req, res) {
  try {
    const service = await repo.getById(req.params.id);
    if (!service) return res.status(404).json({ ok: false, error: 'Serviço não encontrado.' });
    return res.json({ ok: true, data: service });
  } catch (error) {
    return fail(res, 'getById', error);
  }
}

export async function create(req, res) {
  try {
    return res.status(201).json({ ok: true, data: await repo.create(req.body) });
  } catch (error) {
    return fail(res, 'create', error);
  }
}

export async function update(req, res) {
  try {
    const service = await repo.update(req.params.id, req.body);
    if (!service) return res.status(404).json({ ok: false, error: 'Serviço não encontrado.' });
    return res.json({ ok: true, data: service });
  } catch (error) {
    return fail(res, 'update', error);
  }
}

export async function remove(req, res) {
  try {
    const removed = await repo.remove(req.params.id);
    if (!removed) return res.status(404).json({ ok: false, error: 'Serviço não encontrado.' });
    return res.json({ ok: true });
  } catch (error) {
    return fail(res, 'remove', error);
  }
}
