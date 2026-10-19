// ╔══════════════════════════════════════════════════════════════════════╗
// ║ FILE: contractsConsartController.js                                  ║
// ║ MODULE: Contratos de Serviços (CONSART ERP)                          ║
// ║ BASE: /api/contracts-consart                                         ║
// ╚══════════════════════════════════════════════════════════════════════╝

'use strict';

import * as repo from '../repositories/contractsConsart/contractsConsart.repository.js';
import { DEFAULT_CLAUSES, PLACEHOLDERS } from '../repositories/contractsConsart/contractsConsart.clauses.js';
import * as reps from '../repositories/contractsConsart/customersConsartRepresentatives.repository.js';
import { generateContractConsartPdf } from '../generationPdf/generateContractConsartPdf.js';

function fail(res, tag, error) {
  const status = error?.status || 500;
  if (status >= 500) console.error(`[contractsConsartController] ${tag} error:`, error);
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

/** Modelo de cláusulas e campos automáticos ({CAMPO}) para o editor. */
export function template(req, res) {
  return res.json({ ok: true, data: { clauses: DEFAULT_CLAUSES, placeholders: PLACEHOLDERS, roles: reps.ROLES } });
}

export async function getById(req, res) {
  try {
    const contract = await repo.getById(req.params.id);
    if (!contract) return res.status(404).json({ ok: false, error: 'Contrato não encontrado.' });
    return res.json({ ok: true, data: contract });
  } catch (error) {
    return fail(res, 'getById', error);
  }
}

export async function create(req, res) {
  try {
    const contract = await repo.create(req.body, req.user);
    return res.status(201).json({ ok: true, data: contract });
  } catch (error) {
    return fail(res, 'create', error);
  }
}

export async function fromProposal(req, res) {
  try {
    const result = await repo.fromProposal(req.params.proposalId, req.user);
    if (!result) return res.status(404).json({ ok: false, error: 'Proposta não encontrada.' });
    return res.status(result.existed ? 200 : 201).json({ ok: true, data: result.contract, existed: result.existed });
  } catch (error) {
    return fail(res, 'fromProposal', error);
  }
}

export async function update(req, res) {
  try {
    const contract = await repo.update(req.params.id, req.body);
    if (!contract) return res.status(404).json({ ok: false, error: 'Contrato não encontrado.' });
    return res.json({ ok: true, data: contract });
  } catch (error) {
    return fail(res, 'update', error);
  }
}

export async function remove(req, res) {
  try {
    const removed = await repo.remove(req.params.id);
    if (!removed) return res.status(404).json({ ok: false, error: 'Contrato não encontrado.' });
    return res.json({ ok: true });
  } catch (error) {
    return fail(res, 'remove', error);
  }
}

export async function duplicate(req, res) {
  try {
    const contract = await repo.duplicate(req.params.id, req.user);
    if (!contract) return res.status(404).json({ ok: false, error: 'Contrato não encontrado.' });
    return res.status(201).json({ ok: true, data: contract });
  } catch (error) {
    return fail(res, 'duplicate', error);
  }
}

export async function pdf(req, res) {
  try {
    const contract = await repo.getForPdf(req.params.id);
    if (!contract) return res.status(404).json({ ok: false, error: 'Contrato não encontrado.' });

    const buffer = await generateContractConsartPdf(contract);
    const filename = `Contrato_${String(contract.number).replace('/', '-')}.pdf`;

    res.setHeader('Content-Type', 'application/pdf');
    res.setHeader('Content-Disposition', `attachment; filename="${filename}"`);
    res.setHeader('Content-Length', buffer.length);
    res.setHeader('Cache-Control', 'no-store');
    return res.end(buffer);
  } catch (error) {
    return fail(res, 'pdf', error);
  }
}

// ─────────────────────────────────────────────────────────────────────
// Representantes / sócios do cliente (quem assina pelo contratante)
// ─────────────────────────────────────────────────────────────────────

export async function listRepresentatives(req, res) {
  try {
    const rows = await reps.list(req.params.customerId, { all: req.query.all === 'true' });
    return res.json({ ok: true, data: rows });
  } catch (error) {
    return fail(res, 'listRepresentatives', error);
  }
}

export async function createRepresentative(req, res) {
  try {
    const rep = await reps.create(req.params.customerId, req.body);
    return res.status(201).json({ ok: true, data: rep });
  } catch (error) {
    return fail(res, 'createRepresentative', error);
  }
}

export async function updateRepresentative(req, res) {
  try {
    const rep = await reps.update(req.params.id, req.body);
    if (!rep) return res.status(404).json({ ok: false, error: 'Representante não encontrado.' });
    return res.json({ ok: true, data: rep });
  } catch (error) {
    return fail(res, 'updateRepresentative', error);
  }
}

export async function removeRepresentative(req, res) {
  try {
    const removed = await reps.remove(req.params.id);
    if (!removed) return res.status(404).json({ ok: false, error: 'Representante não encontrado.' });
    return res.json({ ok: true });
  } catch (error) {
    return fail(res, 'removeRepresentative', error);
  }
}
