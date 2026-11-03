/* ╔══════════════════════════════════════════════════════════════════════╗
   ║ pdvStarterController.js — API do caixa Consart Starter (Windows)    ║
   ║ CONSART ERP                                                          ║
   ╚══════════════════════════════════════════════════════════════════════╝ */

'use strict';

import {
  ensureSchema,
  listCatalog,
  getOpenSession,
  getLastClosed,
  openSession,
  addMovement,
  getSummary,
  closeSession,
  createSale,
  listSales,
  findSaleByUuid,
  isNfceEnabled,
  emitSaleNfce,
  nfceView,
  getIssuerForReceipt,
  PAYMENT_METHODS,
} from '../repositories/pdvStarter/pdvStarter.index.js';
import { verifyCredentials } from '../repositories/pdv_logins/pdv_logins.index.js';
import { signPdvToken } from '../middleware/requirePdvAuth.js';

ensureSchema()
  .then(() => console.log('[pdvStarterController] Tabelas do PDV verificadas.'))
  .catch((error) => console.error('[pdvStarterController] Erro ao verificar tabelas:', error));

function parseId(value) {
  const id = Number.parseInt(value, 10);
  return Number.isInteger(id) && id > 0 ? id : null;
}

function sendError(res, error) {
  const status = error?.statusCode || 500;
  if (status >= 500) console.error('[pdvStarterController]', error);
  return res.status(status).json({
    success: false,
    error: error?.code || 'INTERNAL_ERROR',
    message: status >= 500 ? 'Erro interno no servidor.' : error.message,
    details: error?.details,
  });
}

// POST /api/pdv/auth/login
export async function login(req, res) {
  const { username, password, terminal } = req.body ?? {};
  if (!username || !password) {
    return res.status(400).json({ success: false, message: 'Informe usuário e senha.' });
  }
  try {
    const user = await verifyCredentials(username, password);
    if (!user) return res.status(401).json({ success: false, message: 'Usuário ou senha inválidos.' });
    const term = String(terminal || 'CAIXA-01').trim().slice(0, 40);
    return res.json({ success: true, token: signPdvToken(user, term), user });
  } catch (error) {
    return sendError(res, error);
  }
}

// GET /api/pdv/config
export async function getConfig(req, res) {
  const enabled = isNfceEnabled();
  let issuer = null;
  if (enabled) issuer = await getIssuerForReceipt().catch(() => null);
  return res.json({
    success: true,
    data: {
      company: process.env.PDV_COMPANY_NAME || process.env.DB_NAME || 'BH3',
      payment_methods: PAYMENT_METHODS,
      server_time: new Date().toISOString(),
      nfce: { enabled, issuer },
    },
  });
}

// Espera a NFC-e até este limite; depois responde e a emissão segue no servidor
const NFCE_WAIT_MS = Number(process.env.PDV_NFCE_WAIT_MS || 40000);

async function emitWithLimit(sale) {
  if (!isNfceEnabled() || !sale || ['AUTORIZADA', 'CANCELADA'].includes(sale.nfce_status)) return sale;
  const emission = emitSaleNfce(sale.sale_id).catch((error) => {
    console.error('[pdvStarterController] NFC-e:', error);
    return sale;
  });
  const timeout = new Promise((resolve) => setTimeout(() => resolve(null), NFCE_WAIT_MS));
  return (await Promise.race([emission, timeout])) || { ...sale, nfce_status: 'PROCESSANDO', nfce_message: 'SEFAZ demorando a responder. Consulte a NFC-e em instantes.' };
}

// GET /api/pdv/catalogo?limit=&offset=
export async function getCatalog(req, res) {
  try {
    const data = await listCatalog({ limit: req.query.limit, offset: req.query.offset });
    return res.json({ success: true, ...data });
  } catch (error) {
    return sendError(res, error);
  }
}

// GET /api/pdv/caixa/atual?terminal=
export async function getCurrentSession(req, res) {
  try {
    const terminal = String(req.query.terminal || req.pdvUser.terminal);
    const [session, lastClosed] = await Promise.all([getOpenSession(terminal), getLastClosed(terminal)]);
    return res.json({ success: true, data: { session, last_closed: lastClosed } });
  } catch (error) {
    return sendError(res, error);
  }
}

// POST /api/pdv/caixa/abrir
export async function openCash(req, res) {
  try {
    const { terminal, opening_amount: openingAmount, notes } = req.body ?? {};
    const result = await openSession({
      terminal: String(terminal || req.pdvUser.terminal),
      user: req.pdvUser,
      openingAmount,
      notes,
    });
    return res.status(result.alreadyOpen ? 200 : 201).json({ success: true, data: result });
  } catch (error) {
    return sendError(res, error);
  }
}

// POST /api/pdv/caixa/:id/movimentos
export async function createCashMovement(req, res) {
  const id = parseId(req.params.id);
  if (!id) return res.status(400).json({ success: false, message: 'Caixa inválido.' });
  try {
    const { type, amount, reason } = req.body ?? {};
    const data = await addMovement(id, { type, amount, reason, user: req.pdvUser });
    return res.status(201).json({ success: true, data });
  } catch (error) {
    return sendError(res, error);
  }
}

// GET /api/pdv/caixa/:id/resumo
export async function getCashSummary(req, res) {
  const id = parseId(req.params.id);
  if (!id) return res.status(400).json({ success: false, message: 'Caixa inválido.' });
  try {
    return res.json({ success: true, data: await getSummary(id) });
  } catch (error) {
    return sendError(res, error);
  }
}

// POST /api/pdv/caixa/:id/fechar
export async function closeCash(req, res) {
  const id = parseId(req.params.id);
  if (!id) return res.status(400).json({ success: false, message: 'Caixa inválido.' });
  try {
    const { counted, notes } = req.body ?? {};
    return res.json({ success: true, data: await closeSession(id, { counted, notes, user: req.pdvUser }) });
  } catch (error) {
    return sendError(res, error);
  }
}

// POST /api/pdv/vendas
export async function postSale(req, res) {
  try {
    const result = await createSale(req.body ?? {}, req.pdvUser);
    const sale = await emitWithLimit(result.sale);
    return res.status(result.duplicated ? 200 : 201).json({
      success: true,
      duplicated: result.duplicated,
      sale,
      nfce: isNfceEnabled() ? nfceView(sale) : null,
    });
  } catch (error) {
    return sendError(res, error);
  }
}

// GET /api/pdv/vendas?session_id=&limit=
export async function getSales(req, res) {
  try {
    const data = await listSales({ sessionId: req.query.session_id, limit: req.query.limit });
    return res.json({ success: true, data });
  } catch (error) {
    return sendError(res, error);
  }
}

// GET /api/pdv/vendas/:uuid/nfce — situação da NFC-e (com QR Code para imprimir)
export async function getSaleNfce(req, res) {
  try {
    const sale = await findSaleByUuid(req.params.uuid);
    if (!sale) return res.status(404).json({ success: false, message: 'Venda não encontrada.' });
    return res.json({ success: true, nfce: nfceView(sale) });
  } catch (error) {
    return sendError(res, error);
  }
}

// POST /api/pdv/vendas/:uuid/nfce — emite (ou consulta de novo) a NFC-e da venda
export async function postSaleNfce(req, res) {
  try {
    if (!isNfceEnabled()) return res.status(409).json({ success: false, message: 'NFC-e desligada neste ERP.' });
    const sale = await findSaleByUuid(req.params.uuid);
    if (!sale) return res.status(404).json({ success: false, message: 'Venda não encontrada.' });
    const updated = await emitWithLimit(sale);
    return res.json({ success: true, nfce: nfceView(updated) });
  } catch (error) {
    return sendError(res, error);
  }
}
