// ╔══════════════════════════════════════════════════════════════╗
// ║ FILE: proposalsConsartController.js                          ║
// ║ MODULE: Propostas comerciais (CONSART ERP)                   ║
// ║ BASE: /api/proposals-consart                                 ║
// ╚══════════════════════════════════════════════════════════════╝

'use strict';

import * as repo from '../repositories/proposalsConsart/proposalsConsart.repository.js';
import { generateProposalConsartPdf } from '../generationPdf/generateProposalConsartPdf.js';

function fail(res, tag, error) {
  const status = error?.status || 500;
  if (status >= 500) console.error(`[proposalsConsartController] ${tag} error:`, error);
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

export async function getById(req, res) {
  try {
    const proposal = await repo.getById(req.params.id);
    if (!proposal) return res.status(404).json({ ok: false, error: 'Proposta não encontrada.' });
    return res.json({ ok: true, data: proposal });
  } catch (error) {
    return fail(res, 'getById', error);
  }
}

export async function create(req, res) {
  try {
    const proposal = await repo.create(req.body, req.user);
    return res.status(201).json({ ok: true, data: proposal });
  } catch (error) {
    return fail(res, 'create', error);
  }
}

export async function update(req, res) {
  try {
    const proposal = await repo.update(req.params.id, req.body);
    if (!proposal) return res.status(404).json({ ok: false, error: 'Proposta não encontrada.' });
    return res.json({ ok: true, data: proposal });
  } catch (error) {
    return fail(res, 'update', error);
  }
}

export async function remove(req, res) {
  try {
    const removed = await repo.remove(req.params.id);
    if (!removed) return res.status(404).json({ ok: false, error: 'Proposta não encontrada.' });
    return res.json({ ok: true });
  } catch (error) {
    return fail(res, 'remove', error);
  }
}

export async function duplicate(req, res) {
  try {
    const proposal = await repo.duplicate(req.params.id, req.user);
    if (!proposal) return res.status(404).json({ ok: false, error: 'Proposta não encontrada.' });
    return res.status(201).json({ ok: true, data: proposal });
  } catch (error) {
    return fail(res, 'duplicate', error);
  }
}

export async function pdf(req, res) {
  try {
    const proposal = await repo.getForPdf(req.params.id);
    if (!proposal) return res.status(404).json({ ok: false, error: 'Proposta não encontrada.' });

    const buffer = await generateProposalConsartPdf(proposal);
    const filename = `Proposta_${String(proposal.number).replace('/', '-')}.pdf`;

    res.setHeader('Content-Type', 'application/pdf');
    res.setHeader('Content-Disposition', `attachment; filename="${filename}"`);
    res.setHeader('Content-Length', buffer.length);
    res.setHeader('Cache-Control', 'no-store');
    return res.end(buffer);
  } catch (error) {
    return fail(res, 'pdf', error);
  }
}
