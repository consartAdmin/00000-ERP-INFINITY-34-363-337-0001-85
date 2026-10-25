// ╔══════════════════════════════════════════════════════════════════════╗
// ║ FILE: salesGoalsConsartController.js                                 ║
// ║ MODULE: Metas de vendas (CONSART ERP)                                ║
// ║ BASE: /api/sales-goals-consart                                       ║
// ╚══════════════════════════════════════════════════════════════════════╝

'use strict';

import * as repo from '../repositories/salesGoalsConsart/salesGoalsConsart.repository.js';

function fail(res, tag, error) {
  const status = error?.status || 500;
  if (status >= 500) console.error(`[salesGoalsConsartController] ${tag} error:`, error);
  return res.status(status).json({ ok: false, error: error?.message || 'Erro inesperado.' });
}

export async function getMonth(req, res) {
  try {
    const { rows, ...summary } = await repo.getMonth(req.query);
    return res.json({ ok: true, data: rows, ...summary });
  } catch (error) {
    return fail(res, 'getMonth', error);
  }
}

export async function saveMonth(req, res) {
  try {
    const { rows, ...summary } = await repo.saveMonth(req.params, req.body?.goals, req.user);
    return res.json({ ok: true, data: rows, ...summary });
  } catch (error) {
    return fail(res, 'saveMonth', error);
  }
}

export async function listSales(req, res) {
  try {
    const rows = await repo.listSales(req.query);
    return res.json({ ok: true, data: rows });
  } catch (error) {
    return fail(res, 'listSales', error);
  }
}

export async function getHistory(req, res) {
  try {
    const rows = await repo.getHistory(req.query);
    return res.json({ ok: true, data: rows });
  } catch (error) {
    return fail(res, 'getHistory', error);
  }
}

export async function getLeadsByState(req, res) {
  try {
    const rows = await repo.getLeadsByState(req.query);
    return res.json({ ok: true, data: rows });
  } catch (error) {
    return fail(res, 'getLeadsByState', error);
  }
}
