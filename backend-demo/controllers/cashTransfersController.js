// ╔══════════════════════════════════════════════════════════════════════╗
// ║ cashTransfersController.js — Transferência entre contas (Caixa)     ║
// ║ /api/caixa/transferencias                                           ║
// ║ SAIDA na origem + ENTRADA no destino, fora de receitas/despesas     ║
// ╚══════════════════════════════════════════════════════════════════════╝

'use strict';

import {
  createTransfer,
  getTransfer,
  updateTransfer,
  deleteTransfer,
} from '../repositories/cashMoviments/cashTransfers.repository.js';

function fail(res, err) {
  if (err?.statusCode === 400) return res.status(400).json({ ok: false, error: err.message });
  console.error('[CAIXA][TRANSFERENCIAS]', err);
  return res.status(500).json({ ok: false, error: 'Erro interno do servidor' });
}

const notFound = (res) => res.status(404).json({ ok: false, error: 'Transferência não encontrada' });

export async function createTransferencia(req, res) {
  try {
    return res.status(201).json(await createTransfer(req.body || {}));
  } catch (err) {
    return fail(res, err);
  }
}

export async function getTransferencia(req, res) {
  try {
    const row = await getTransfer(req.params.id);
    return row ? res.json(row) : notFound(res);
  } catch (err) {
    return fail(res, err);
  }
}

export async function updateTransferencia(req, res) {
  try {
    const row = await updateTransfer(req.params.id, req.body || {});
    return row ? res.json(row) : notFound(res);
  } catch (err) {
    return fail(res, err);
  }
}

export async function deleteTransferencia(req, res) {
  try {
    const result = await deleteTransfer(req.params.id);
    return result ? res.json({ ok: true, ...result }) : notFound(res);
  } catch (err) {
    return fail(res, err);
  }
}
