// ╔══════════════════════════════════════════════════════════════════════╗
// ║ tmsController.js — Controller (Módulo Transporte / TMS)              ║
// ║ CONSART LOGISTICS | ESM                                             ║
// ║ CRUD genérico dos cadastros + ações de CT-e, MDF-e, fretes, EDI     ║
// ║ Usa: backend/repositories/tms/*                                      ║
// ╚══════════════════════════════════════════════════════════════════════╝

'use strict';

import pool from '../config/db.js';
import * as tms from '../repositories/tms/tms.index.js';

// ======================================================================
// Helpers de resposta (mesmo formato do deliveryTripsController)
// ======================================================================
function ok(res, data, status = 200) {
  return res.status(status).json({ ok: true, data });
}

function fail(res, err, scope) {
  const status = err?.status || 500;
  if (status >= 500) console.error(`[tmsController:${scope}]`, err);
  const payload = { ok: false, error: String(err?.message || 'Error') };
  if (err?.details !== undefined) payload.details = err.details;
  return res.status(status).json(payload);
}

const handle = (scope, fn, status = 200) => async (req, res) => {
  try {
    return ok(res, await fn(req), status);
  } catch (err) {
    return fail(res, err, scope);
  }
};

export async function ensureReady(_req, res, next) {
  try {
    await tms.ensureTmsTables();
    return next();
  } catch (err) {
    return fail(res, err, 'ensureReady');
  }
}

// ======================================================================
// CRUD genérico: /api/tms/:resource
// ======================================================================
export const list = handle('list', (req) => tms.list(req.params.resource, req.query));
export const getOne = handle('get', (req) => tms.get(req.params.resource, req.params.id));
export const create = handle('create', (req) => tms.create(req.params.resource, req.body, req.user), 201);
export const update = handle('update', (req) => tms.update(req.params.resource, req.params.id, req.body, req.user));
export const remove = handle('remove', (req) => tms.remove(req.params.resource, req.params.id));

// ======================================================================
// Listas para selects
// ======================================================================
export const lookup = handle('lookup', (req) => tms.lookup(req.params.name, req.query));

// ======================================================================
// CT-e / MDF-e
// ======================================================================
export const emitCte = handle('emitCte', (req) => tms.emitCte(req.params.id));
export const cancelCte = handle('cancelCte', (req) => tms.cancelCte(req.params.id, req.body));
export const insureCte = handle('insureCte', (req) => tms.insureCte(req.params.id, req.body));
export const emitMdfe = handle('emitMdfe', (req) => tms.emitMdfe(req.params.id));
export const closeMdfe = handle('closeMdfe', (req) => tms.closeMdfe(req.params.id, req.body));
export const cancelMdfe = handle('cancelMdfe', (req) => tms.cancelMdfe(req.params.id, req.body));
export const printData = handle('printData', (req) => tms.printData(req.params.kind, req.params.id));

// ======================================================================
// Comercial
// ======================================================================
export const calcQuote = handle('calcQuote', (req) => tms.calcFreight((t, p) => pool.query(t, p), req.body));
export const quoteToCte = handle('quoteToCte', (req) => tms.quoteToCte(req.params.id, req.user), 201);
export const openCtes = handle('openCtes', (req) => tms.openCtesForBilling(req.query));
export const issueInvoice = handle('issueInvoice', (req) => tms.issueInvoice(req.params.id));
export const payInvoice = handle('payInvoice', (req) => tms.payInvoice(req.params.id, req.body));
export const cancelInvoice = handle('cancelInvoice', (req) => tms.cancelInvoice(req.params.id));
export const exportEdi = handle('exportEdi', (req) => tms.exportEdi(req.body, req.user), 201);
export const importNotfis = handle('importNotfis', (req) => tms.importNotfis(req.body, req.user), 201);

export async function downloadEdi(req, res) {
  try {
    const f = await tms.getEdiFile(req.params.id);
    res.setHeader('Content-Type', 'text/plain; charset=latin1');
    res.setHeader('Content-Disposition', `attachment; filename="${f.file_name.replace(/[^\w.-]/g, '_')}"`);
    return res.send(Buffer.from(f.content, 'latin1'));
  } catch (err) {
    return fail(res, err, 'downloadEdi');
  }
}

// ======================================================================
// Operação / Gestão
// ======================================================================
export const loadCandidates = handle('loadCandidates', (req) => tms.loadPlanCandidates(req.query));
export const setLoadPlanStatus = handle('setLoadPlanStatus', (req) => tms.setLoadPlanStatus(req.params.id, req.body));
export const tacRetentions = handle('tacRetentions', (req) => ({
  ...tms.calcTacRetentions(Number(req.query.freight || 0), Number(req.query.dependents || 0)),
  rules: tms.TAC_RULES,
}));
export const tripProfit = handle('tripProfit', (req) => tms.tripProfit(req.query));
export const fleetAlerts = handle('fleetAlerts', () => tms.fleetAlerts());
