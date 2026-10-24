/* ╔══════════════════════════════════════════════════════════════════════╗
   ║ FILE: debtsTypesController.js                                       ║
   ║ MODULE: Debts Types Controller                                      ║
   ║ DESCRIPTION: HTTP handlers for debt types (public."debtsTypes")     ║
   ║ CONSART ERP · Express · ESM                                         ║
   ╚══════════════════════════════════════════════════════════════════════╝ */

'use strict';

import { listDebtsTypes, createDebtsType } from '../repositories/debtsTypes/debtsTypes.repository.js';

function sendError(res, error, fallbackMessage) {
  if (error?.status) {
    return res.status(error.status).json({ ok: false, message: error.message });
  }

  console.error('[debtsTypesController]', error);
  return res.status(500).json({ ok: false, message: fallbackMessage, error: error?.message });
}

export async function listTypes(req, res) {
  try {
    const data = await listDebtsTypes({ active: req.query.active });
    return res.status(200).json({ ok: true, data });
  } catch (error) {
    return sendError(res, error, 'Erro ao listar tipos de dívida.');
  }
}

export async function createType(req, res) {
  try {
    const data = await createDebtsType(req.body || {});
    return res.status(201).json({ ok: true, data });
  } catch (error) {
    return sendError(res, error, 'Erro ao cadastrar tipo de dívida.');
  }
}
