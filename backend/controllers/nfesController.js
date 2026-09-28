// ╔══════════════════════════════════════════════════════════════════════╗
// ║ nfesController.js — Controller de Notas Fiscais (CONSART ERP)       ║
// ║ Lista/pesquisa, reconcilia, baixa DANFE/XML, lote XML, e-mail e diag ║
// ║ + Estoque: baixa/estorno por transição AUTORIZADA/CANCELADA          ║
// ║ + E-mail NF-e via nfesEmailApi.js (service)                           ║
// ╚══════════════════════════════════════════════════════════════════════╝

'use strict';

import axios from 'axios';
import nfesApi from '../repositories/nfes/nfes.index.js';

// Conciliação / Emissão:
import ordersApi from '../services/apis/orders/ordersApi.js';
import tecnospeedNfeApi from '../repositories/tecnoSpeedNfe/tecnoSpeedNfe.index.js';

import pool from '../config/db.js';

import { sendAndLogEmail } from '../services/email/emailOutboundsService.js';

// ✅ seu helper de boleto (accountsReceivableApi)
import {
  getExistingBoletoDownloadInfoByAccountsReceivableId,
} from '../repositories/accountsReceivable/accountsReceivable.index.js';

// ✅ NOVO: service de e-mail NF-e
import { createNfesEmailApi } from '../repositories/nfesEmail/nfesEmail.index.js';

import asaasApi, { getPayment as getAsaasPayment } from '../repositories/asaas/asaas.index.js';

import { generateReportNfesPdf } from '../generationPdf/generationReportNfesPdf.js';

import { generateNfesExcel } from '../generationExcel/generationNfesExcel.js';

/* --------------------------------------------------------------------- */
/* Base interna para chamar o próprio backend (para /api/orders/...)     */
/* --------------------------------------------------------------------- */
const API_BASE_FROM_SERVER =
  process.env.API_BASE ||
  process.env.API_BASE_URL ||
  'http://localhost:8080';

/* ===================================================================== */
/* Helpers de ambiente / autenticação                                     */
/* ===================================================================== */
function getBaseUrl() {
  return (
    process.env.PLUGNOTAS_BASE_URL ||
    process.env.TECNOSPEED_BASE_URL ||
    'https://api.plugnotas.com.br'
  );
}

function getApiKey() {
  return (
    process.env.PLUGNOTAS_API_KEY ||
    process.env.TECNOSPEED_TOKEN_SH ||
    process.env.TECNOSPEED_TOKEN ||
    ''
  );
}

async function buscarNfesParaRelatorio({
  q = '',
  status,
  dateFrom,
  dateTo,
  sortBy = 'pedido',
  sortOrder = 'desc',
}) {
  const out = await nfesApi.search({
    q: String(q || '').trim(),
    limit: 5000,
    offset: 0,
    status: status ? String(status).trim() : undefined,
    dateFrom: dateFrom ? String(dateFrom).trim() : undefined,
    dateTo: dateTo ? String(dateTo).trim() : undefined,
    includeStarted: true,
    sortBy,
    sortOrder,
  });

  if (!out?.ok) {
    throw new Error(out?.error || 'Erro ao buscar NF-es para relatório.');
  }

  return Array.isArray(out.rows) ? out.rows : [];
}

/* ===================================================================== */
/* Helpers NF-e (status e resolução de ID)                                */
/* ===================================================================== */

// Mapeia status + cStat da PlugNotas/Tecno para o nfe_status interno
function mapPlugNotasStatus(status, cStat) {
  const s = (status || '').toString().toUpperCase();

  if (cStat === 100 || cStat === '100') return 'AUTORIZADA';
  if (cStat === 101 || cStat === '101' || cStat === 135 || cStat === '135') {
    return 'CANCELADA';
  }
  if (s.includes('REJEIT')) return 'REJEITADA';
  if (s.includes('PROCESS') || s.includes('PENDENTE')) return 'EM_PROCESSAMENTO';

  return s || 'DESCONHECIDO';
}

/* ──────────────────────────────────────────────────────────────────── */
/* Helper: descobre o “id PlugNotas” a partir do parâmetro recebido     */
/* Aceita:                                                              */
/*  - id PlugNotas (24+ chars hex) → usa direto                         */
/*  - chave 44 dígitos → consulta resumo e pega o id                    */
/*  - número/ID de pedido → busca no DB e pega orders.nfe_plugnotas_id  */
/* ──────────────────────────────────────────────────────────────────── */
async function resolvePlugNotasId(param) {
  const raw = String(param || '').trim();
  if (!raw) return null;

  // ID PlugNotas costuma ser 24 chars hex (ou mais em alguns casos)
  if (/^[a-f0-9]{24,}$/i.test(raw)) return raw;

  // Chave de acesso (44 dígitos)
  if (/^\d{44}$/.test(raw)) {
    const resumo = await tecnospeedNfeApi.consultarNFe(raw);
    const d = resumo?.data;
    const first = Array.isArray(d) ? d[0] : d;
    const id = first?.id || first?._id || first?.documentId || null;
    if (id) return id;
  }

  // 1) por order_id exato
  if (/^\d+$/.test(raw)) {
    const { rows } = await pool.query(
      `SELECT nfe_plugnotas_id
         FROM public.orders
        WHERE order_id = $1
        LIMIT 1`,
      [Number(raw)],
    );
    if (rows[0]?.nfe_plugnotas_id) return rows[0].nfe_plugnotas_id;
  }

  // 2) por número do pedido (coluna "number")
  const { rows: byNumber } = await pool.query(
    `SELECT nfe_plugnotas_id
       FROM public.orders
      WHERE number = $1
      LIMIT 1`,
    [raw],
  );
  if (byNumber[0]?.nfe_plugnotas_id) return byNumber[0].nfe_plugnotas_id;

  // 3) por chave gravada (nfe_key)
  const { rows: byKey } = await pool.query(
    `SELECT nfe_plugnotas_id
       FROM public.orders
      WHERE nfe_key = $1
      LIMIT 1`,
    [raw],
  );
  if (byKey[0]?.nfe_plugnotas_id) return byKey[0].nfe_plugnotas_id;

  return null;
}

/* ──────────────────────────────────────────────────────────────────── */
/* Helper: extrai resumo “normalizado” da resposta consultarNFe          */
/* ──────────────────────────────────────────────────────────────────── */
function extractResumoFromConsultarNFe(out) {
  if (!out?.data) return null;

  const d = out.data;
  let base = null;

  if (Array.isArray(d) && d.length) base = d[0];
  else if (d.resumo) base = d.resumo;
  else base = d;

  if (!base || typeof base !== 'object') return null;

  const cStat = base.cStat ?? base.cstat ?? base.statusSefaz ?? base.codStatus ?? null;
  const status = base.status ?? base.situacao ?? base.situacaoNfe ?? null;

  const chave =
    base.chave ??
    base.chaveAcesso ??
    base.chaveAcessoNFe ??
    base.key ??
    base.chaveNFe ??
    null;

  const numero = base.numero ?? base.nNumero ?? base.numeroNfe ?? base.numeroNFe ?? null;

  const protocolo =
    base.protocolo ??
    base.protocoloAutorizacao ??
    base.nProt ??
    base.nProtocolo ??
    null;

  const xmlUrl = base.xml ?? base.linkXml ?? base.xmlUrl ?? base.urlXml ?? null;
  const pdfUrl = base.pdf ?? base.linkDanfe ?? base.linkPdf ?? base.urlDanfe ?? null;

  const plugId = base.id ?? base._id ?? base.documentId ?? null;

  return {
    raw: base,
    plugId,
    status,
    cStat,
    chave,
    numero,
    protocolo,
    xmlUrl,
    pdfUrl,
  };
}

/* ===================================================================== */
/* Resolver order_id a partir de qualquer param (orderId/chave/plug/etc.) */
/* ===================================================================== */
async function resolveOrderIdFromParam(param, chave = null, nfeNumero = null) {
  const raw = String(param || '').trim();
  if (!raw) return null;

  // 1) Se já for orderId numérico
  if (/^\d+$/.test(raw)) return Number(raw);

  // 2) Resolve plugId (se for chave/plugId/etc)
  let plugId = null;
  try {
    plugId = await resolvePlugNotasId(raw);
  } catch { }

  // 3) Candidatos para busca no banco
  const candidates = Array.from(
    new Set(
      [plugId, raw, chave, nfeNumero != null ? String(nfeNumero) : null]
        .filter(Boolean)
        .map((v) => String(v).trim())
        .filter(Boolean),
    ),
  );

  if (!candidates.length) return null;

  // 4) Procura no banco pelos campos que você grava
  const { rows } = await pool.query(
    `
    SELECT o.order_id
      FROM public."orders" o
     WHERE o.nfe_plugnotas_id = ANY($1::text[])
        OR o.nfe_key          = ANY($1::text[])
        OR (o.nfe_number::text) = ANY($1::text[])
        OR (o.number::text)     = ANY($1::text[])
     ORDER BY o.updated_at DESC NULLS LAST, o.order_id DESC
     LIMIT 1
    `,
    [candidates],
  );

  return rows?.[0]?.order_id || null;
}

/* ===================================================================== */
/* 📦 Helpers de ESTOQUE (baixa / estorno) baseados em orderItems        */
/* ===================================================================== */

// Busca itens do pedido na tabela public.orderItems
// Ligação por SKU → products.product_code = orderItems.sku
async function listarItensPedido(orderId, client = pool) {
  const db = client;

  console.log(
    `[NFES][ESTOQUE] Buscando itens do pedido order_id=${orderId} em public."orderItems"...`,
  );

  const { rows } = await db.query(
    `
      SELECT 
        oi.order_item_id,
        oi.order_id,
        oi.sku,
        oi.quantity,
        p.product_id,
        p.product_code,
        p.product_stock_id
      FROM public."orderItems" oi
      JOIN products p 
        ON p.product_code = oi.sku
      WHERE oi.order_id = $1
    `,
    [orderId],
  );

  console.log(
    `[NFES][ESTOQUE] Itens encontrados para order_id=${orderId}:`,
    (rows || []).map((r) => ({
      order_item_id: r.order_item_id,
      sku: r.sku,
      quantity: r.quantity,
      product_id: r.product_id,
      product_stock_id: r.product_stock_id,
    })),
  );

  return rows || [];
}

// 📉 Baixa de estoque quando NF-e AUTORIZADA
async function baixarEstoquePorOrderId(orderId, client = pool) {
  const db = client;
  const itens = await listarItensPedido(orderId, db);

  if (!itens.length) {
    console.warn(
      `[NFES][ESTOQUE] Nenhum item encontrado para order_id=${orderId} ao baixar estoque.`,
    );
    return;
  }

  for (const item of itens) {
    if (!item.product_stock_id) {
      console.warn(
        `[NFES][ESTOQUE] Produto ${item.product_id} (sku=${item.sku}) sem product_stock_id, ignorando baixa.`,
      );
      continue;
    }

    console.log(
      `[NFES][ESTOQUE] Baixando ${item.quantity} do estoque (product_stock_id=${item.product_stock_id})`,
    );

    await db.query(
      `
        UPDATE "productsStock"
           SET stock_qty = stock_qty - $1,
               updated_at = NOW()
         WHERE product_stock_id = $2
      `,
      [item.quantity, item.product_stock_id],
    );
  }

  console.log(`[NFES][ESTOQUE] Baixa de estoque concluída para order_id=${orderId}.`);
}

// 📈 Estorno de estoque quando NF-e CANCELADA (se já estava AUTORIZADA)
async function estornarEstoquePorOrderId(orderId, client = pool) {
  const db = client;
  const itens = await listarItensPedido(orderId, db);

  if (!itens.length) {
    console.warn(
      `[NFES][ESTOQUE] Nenhum item encontrado para order_id=${orderId} ao estornar estoque.`,
    );
    return;
  }

  for (const item of itens) {
    if (!item.product_stock_id) {
      console.warn(
        `[NFES][ESTOQUE] Produto ${item.product_id} (sku=${item.sku}) sem product_stock_id, ignorando estorno.`,
      );
      continue;
    }

    console.log(
      `[NFES][ESTOQUE] Estornando ${item.quantity} no estoque (product_stock_id=${item.product_stock_id})`,
    );

    await db.query(
      `
        UPDATE "productsStock"
           SET stock_qty = stock_qty + $1,
               updated_at = NOW()
         WHERE product_stock_id = $2
      `,
      [item.quantity, item.product_stock_id],
    );
  }

  console.log(`[NFES][ESTOQUE] Estorno de estoque concluído para order_id=${orderId}.`);
}

/* =====================================================================
 * 🧪 DEBUG: GET /api/nfes/debug/baixa-estoque/:orderId
 * ===================================================================== */
export async function debugBaixaEstoque(req, res) {
  try {
    const raw = String(req.params.orderId || '').trim();
    const orderId = Number(raw);

    if (!Number.isFinite(orderId) || orderId <= 0) {
      return res.status(400).json({ ok: false, error: 'orderId inválido' });
    }

    console.log(`[NFES][DEBUG] Forçando baixa de estoque para order_id=${orderId}...`);
    await baixarEstoquePorOrderId(orderId, pool);

    return res.json({
      ok: true,
      message: `Baixa de estoque executada para order_id=${orderId}`,
    });
  } catch (e) {
    console.error('[NFES][DEBUG] debugBaixaEstoque erro:', e);
    return res.status(500).json({ ok: false, error: String(e?.message || e) });
  }
}

/* ===================================================================== */
/* 📋 GET /api/nfes/search                                                */
/* ===================================================================== */
export async function searchNfes(req, res) {
  try {
    const {
      q = '',
      limit = 20,
      offset = 0,

      // nomes possíveis para STATUS
      status,
      nfeStatus,
      nfe_status,

      // nomes possíveis para DATA INICIAL / FINAL
      dateFrom,
      dateTo,
      dataIni,
      dataFim,

      // inclui NF-e "iniciadas"
      includeStarted,
    } = req.query;

    const rawStatus = nfeStatus ?? nfe_status ?? status;
    const finalStatus = rawStatus ? String(rawStatus).trim() : undefined;

    const finalDateFrom = (dateFrom || dataIni)
      ? String(dateFrom || dataIni).trim()
      : undefined;
    const finalDateTo = (dateTo || dataFim)
      ? String(dateTo || dataFim).trim()
      : undefined;

    const finalLimit = Math.min(Math.max(Number(limit) || 20, 1), 200);
    const finalOffset = Math.max(Number(offset) || 0, 0);

    const finalQ = String(q ?? '').trim();

    const includeStartedBool =
      includeStarted === true ||
      includeStarted === '1' ||
      includeStarted === 'true';

    const out = await nfesApi.search({
      q: finalQ,
      limit: finalLimit,
      offset: finalOffset,
      status: finalStatus,
      dateFrom: finalDateFrom,
      dateTo: finalDateTo,
      includeStarted: includeStartedBool,
    });

    if (!out?.ok) {
      const code = out?.status && Number(out.status) >= 400 ? Number(out.status) : 502;
      return res.status(code).json({ ok: false, ...out });
    }

    return res.json({
      ok: true,
      ...out,
      filters: {
        q: finalQ,
        status: finalStatus,
        dateFrom: finalDateFrom,
        dateTo: finalDateTo,
        limit: finalLimit,
        offset: finalOffset,
        includeStarted: includeStartedBool,
      },
    });
  } catch (err) {
    console.error('[searchNfes] EXC:', err);
    return res.status(500).json({ ok: false, error: String(err?.message || err) });
  }
}

/* ===================================================================== */
/* 📄 GET /api/nfes/:orderId                                              */
/* ===================================================================== */
export async function getNfeByOrderId(req, res) {
  try {
    const id = String(req.params.orderId || '').trim();
    if (!id) {
      return res.status(400).json({ ok: false, error: 'Parâmetro :orderId inválido' });
    }

    const out = await nfesApi.getByOrderId(id);
    if (!out?.ok) {
      const code = out.error === 'NOT_FOUND' ? 404 : 400;
      return res.status(code).json(out);
    }
    return res.json(out);
  } catch (err) {
    console.error('[getNfeByOrderId] EXC:', err);
    return res.status(500).json({ ok: false, error: String(err?.message || err) });
  }
}

/* ===================================================================== */
/* 🔄 POST /api/nfes/reconcile/:orderId                                   */
/* ===================================================================== */
export async function reconcileNfe(req, res) {
  try {
    const orderId = Number(req.params.orderId);
    if (!Number.isFinite(orderId) || orderId <= 0) {
      return res.status(400).json({ ok: false, error: 'orderId inválido' });
    }

    const pedido = await ordersApi.getById(orderId);
    if (!pedido?.ok) {
      return res.status(404).json({ ok: false, error: 'Pedido não encontrado' });
    }

    const nfeJson = await tecnospeedNfeApi.buildNFeFromOrder(pedido);

    const envio = await tecnospeedNfeApi.emitirNFe(nfeJson);
    if (!envio?.ok) {
      return res.status(envio.status || 400).json({ ok: false, error: envio.error });
    }

    const plugId =
      envio.data?.id ||
      envio.data?.documents?.[0]?.id ||
      envio.data?.resumo?.id ||
      null;

    const statusResumo = (envio.existed && envio.data?.resumo?.status) || 'PROCESSANDO';

    if (!plugId) {
      return res.status(502).json({ ok: false, error: 'PlugNotas sem ID na resposta' });
    }

    await pool.query(
      `UPDATE public."orders"
          SET nfe_plugnotas_id = $2,
              nfe_status       = $3,
              updated_at       = NOW()
        WHERE order_id = $1`,
      [orderId, plugId, statusResumo],
    );

    try {
      const rec = await tecnospeedNfeApi.reconcileOrderNfe(orderId);
      if (!rec?.ok) {
        console.warn('[reconcileNfe] reconcileOrderNfe falhou:', rec?.error || rec);
      }
    } catch (e) {
      console.error('[reconcileNfe] EXC reconcileOrderNfe:', e.message || e);
    }

    return res.json({
      ok: true,
      orderId,
      nfe_plugnotas_id: plugId,
      existed: !!envio.existed,
      status: statusResumo,
    });
  } catch (err) {
    console.error('[reconcileNfe] EXC:', err);
    return res.status(500).json({ ok: false, error: String(err?.message || err) });
  }
}

/* ===================================================================== */
/* 🔁 POST /api/nfes/refresh/:orderId                                     */
/* ===================================================================== */
export async function refreshSingle(req, res) {
  try {
    const raw = String(req.params.orderId || '').trim();
    const orderId = Number(raw);

    if (!Number.isFinite(orderId) || orderId <= 0) {
      return res.status(400).json({ ok: false, error: 'orderId inválido' });
    }

    const { rows } = await pool.query(
      `
        SELECT order_id,
               number,
               nfe_plugnotas_id,
               nfe_key,
               nfe_status,
               nfe_number,
               nfe_protocol,
               nfe_xml_url,
               nfe_danfe_url,
               nfe_environment
          FROM public.orders
         WHERE order_id = $1
      `,
      [orderId],
    );

    if (!rows.length) {
      return res
        .status(404)
        .json({ ok: false, error: `Pedido order_id=${orderId} não encontrado.` });
    }

    const order = rows[0];
    const previousStatus = order.nfe_status || null;

    console.log(`[NFES][REFRESH] order_id=${orderId} status anterior='${previousStatus}'`);

    const lookupParam =
      order.nfe_plugnotas_id ||
      order.nfe_key ||
      (order.number != null ? String(order.number) : String(orderId));

    const pn = await tecnospeedNfeApi.consultarNFe(lookupParam);
    if (!pn?.ok || !pn.data) {
      const code = pn?.status && Number(pn.status) >= 400 ? Number(pn.status) : 502;
      return res.status(code).json({
        ok: false,
        error: pn?.error || 'Falha ao consultar NF-e na PlugNotas/Tecnospeed',
      });
    }

    const resumo = extractResumoFromConsultarNFe(pn);
    if (!resumo) {
      return res.status(502).json({
        ok: false,
        error: 'Resposta de consultarNFe sem estrutura reconhecida.',
        data: pn.data,
      });
    }

    const novoStatus = mapPlugNotasStatus(resumo.status, resumo.cStat);

    console.log(
      `[NFES][REFRESH] order_id=${orderId} novoStatus='${novoStatus}' (status bruto='${resumo.status}', cStat='${resumo.cStat}')`,
    );

    let ambiente = null;
    try {
      const eff = tecnospeedNfeApi.getEffectiveConfig?.();
      if (eff?.ambiente) ambiente = eff.ambiente;
    } catch { }

    if (!ambiente && resumo.raw?.ambiente) ambiente = String(resumo.raw.ambiente).toUpperCase();

    await pool.query(
      `
        UPDATE public.orders
           SET nfe_status      = $1,
               nfe_key         = COALESCE($2, nfe_key),
               nfe_number      = COALESCE($3, nfe_number),
               nfe_protocol    = COALESCE($4, nfe_protocol),
               nfe_xml_url     = COALESCE($5, nfe_xml_url),
               nfe_danfe_url   = COALESCE($6, nfe_danfe_url),
               nfe_environment = COALESCE($7, nfe_environment),
               nfe_plugnotas_id= COALESCE($8, nfe_plugnotas_id),
               updated_at      = NOW()
         WHERE order_id        = $9
      `,
      [
        novoStatus,
        resumo.chave,
        resumo.numero,
        resumo.protocolo,
        resumo.xmlUrl,
        resumo.pdfUrl,
        ambiente,
        resumo.plugId,
        orderId,
      ],
    );

    const wasAutorizada = previousStatus === 'AUTORIZADA';
    const isAutorizada = novoStatus === 'AUTORIZADA';
    const isCancelada = novoStatus === 'CANCELADA';

    if (!wasAutorizada && isAutorizada) {
      console.log(
        `[NFES][ESTOQUE] order_id=${orderId} transição → AUTORIZADA (antes='${previousStatus}', agora='${novoStatus}') → BAIXA estoque.`,
      );
      await baixarEstoquePorOrderId(orderId, pool);
    }

    if (wasAutorizada && isCancelada) {
      console.log(`[NFES][ESTOQUE] order_id=${orderId} transição AUTORIZADA → CANCELADA → ESTORNA estoque.`);
      await estornarEstoquePorOrderId(orderId, pool);
    }

    return res.json({
      ok: true,
      orderId,
      nfe: {
        order_id: orderId,
        nfe_status: novoStatus,
        nfe_key: resumo.chave ?? order.nfe_key,
        nfe_number: resumo.numero ?? order.nfe_number,
        nfe_protocol: resumo.protocolo ?? order.nfe_protocol,
        nfe_xml_url: resumo.xmlUrl ?? order.nfe_xml_url,
        nfe_danfe_url: resumo.pdfUrl ?? order.nfe_danfe_url,
        nfe_environment: ambiente ?? order.nfe_environment,
        nfe_plugnotas_id: resumo.plugId ?? order.nfe_plugnotas_id,
        resumo_raw: resumo.raw,
      },
    });
  } catch (e) {
    console.error('[NFES] refreshSingle erro:', e);
    return res.status(500).json({ ok: false, error: String(e?.message || e) });
  }
}

/* ===================================================================== */
/* 🧾 GET /api/nfes/:id/pdf → Baixar DANFE (proxy com X-API-KEY)          */
/* ===================================================================== */
export async function downloadDanfeCtrl(req, res) {
  try {
    const param = req.params.id;
    const plugId = await resolvePlugNotasId(param);
    if (!plugId) {
      return res.status(404).json({ ok: false, error: 'NF-e não encontrada (id/chave/pedido)' });
    }

    const url = `${getBaseUrl().replace(/\/$/, '')}/nfe/${encodeURIComponent(plugId)}/pdf`;
    const r = await axios.get(url, {
      responseType: 'stream',
      headers: { 'X-API-KEY': getApiKey() },
      timeout: Number(process.env.PLUGNOTAS_TIMEOUT || 20000),
    });

    res.setHeader('Content-Type', r.headers['content-type'] || 'application/pdf');
    const filename =
      (r.headers['content-disposition']?.match(/filename="?([^"]+)"?/)?.[1]) || `danfe-${plugId}.pdf`;
    res.setHeader('Content-Disposition', `attachment; filename="${filename}"`);

    r.data.pipe(res);
  } catch (err) {
    const st = err.response?.status || 500;
    console.error('[NFES] downloadDanfeCtrl:', st, err.response?.data || err.message);
    res.status(st).json({ ok: false, error: err.response?.data || err.message });
  }
}

/* ===================================================================== */
/* Helper: resolve accounts_receivable_id a partir do orderId             */
/* ===================================================================== */
async function resolveAccountsReceivableIdFromOrder(orderId) {
  const oid = Number(orderId);
  if (!Number.isFinite(oid) || oid <= 0) return null;

  const { rows: orderRows } = await pool.query(
    `
    SELECT order_id, number, nfe_number, nfe_key, accounts_receivable_id
      FROM public.orders
     WHERE order_id = $1
     LIMIT 1
    `,
    [oid],
  );

  const o = orderRows[0];
  if (!o) return null;

  // ✅ 1) vínculo direto
  if (o.accounts_receivable_id) return o.accounts_receivable_id;

  const candidates = [
    o.number != null ? String(o.number) : null,
    o.nfe_number != null ? String(o.nfe_number) : null,
    o.nfe_key != null ? String(o.nfe_key) : null,
    String(o.order_id),
  ].filter(Boolean);

  // ✅ 3) tenta metadata (se gravar orderId)
  {
    const { rows } = await pool.query(
      `
      SELECT asa.accounts_receivable_id
        FROM public."accountsReceivableAsaas" asa
       WHERE (asa.raw->'metadata'->>'orderId') = $1
          OR (asa.raw->>'externalReference') = $1
       ORDER BY asa.updated_at DESC NULLS LAST
       LIMIT 1
      `,
      [String(oid)],
    );
    if (rows[0]?.accounts_receivable_id) return rows[0].accounts_receivable_id;
  }

  // ✅ 4) tenta casar por invoiceNumber / payment_id
  if (candidates.length) {
    const whereInvoice = candidates.map((_, i) => `asa.raw->>'invoiceNumber' = $${i + 1}`).join(' OR ');
    const wherePayment = candidates.map((_, i) => `asa.asaas_payment_id = $${i + 1}`).join(' OR ');

    const { rows } = await pool.query(
      `
      SELECT asa.accounts_receivable_id
        FROM public."accountsReceivableAsaas" asa
       WHERE (${whereInvoice}) OR (${wherePayment})
       ORDER BY asa.updated_at DESC NULLS LAST
       LIMIT 1
      `,
      candidates,
    );
    if (rows[0]?.accounts_receivable_id) return rows[0].accounts_receivable_id;
  }

  return null;
}

/* ===================================================================== */
/* ✉️ POST /api/nfes/:id/email → delega para nfesEmailApi (service)       */
/* ===================================================================== */

// ✅ instancia service (injeção de deps) — evita duplicar lógica no controller
// ✅ instancia service (injeção de deps) — evita duplicar lógica no controller
const nfesEmailApi = createNfesEmailApi({
  pool,
  tecnospeedNfeApi,
  resolvePlugNotasId,
  extractResumoFromConsultarNFe,
  mapPlugNotasStatus,
  getBaseUrl,
  getApiKey,
  sendAndLogEmail,
  resolveAccountsReceivableIdFromOrder,
  getBoletoDownloadInfo: async (arId) => {
    return await getExistingBoletoDownloadInfoByAccountsReceivableId(arId);
  },

  // ✅ NOVO: fallback Asaas quando raw não tem bankSlipPdfUrl
  getAsaasPayment: async (paymentId) => {
    return await getAsaasPayment(paymentId);
  },

  logger: console,
});

export async function sendNfeEmailCtrl(req, res) {
  try {
    const idParam = String(req.params.id || '').trim();

    const to = String(req.body?.to || '').trim();
    const cc = req.body?.cc;
    const bcc = req.body?.bcc;
    const subject = req.body?.subject;
    const message = req.body?.message;

    const out = await nfesEmailApi.sendNfeEmail({
      idParam,
      to,
      cc,
      bcc,
      subject,
      message,
      provider: 'hostinger_smtp',
    });

    if (!out?.ok) {
      return res.status(out?.status || 500).json(out);
    }

    return res.json({
      ok: true,
      ...out.result,
    });
  } catch (e) {
    console.error('[NFES] sendNfeEmailCtrl EXC:', e);
    return res.status(500).json({ ok: false, error: String(e?.message || e) });
  }
}

/* ===================================================================== */
/* 🗎 GET /api/nfes/:id/xml → Baixar XML (proxy com X-API-KEY)            */
/* ===================================================================== */
export async function downloadXmlCtrl(req, res) {
  try {
    const param = req.params.id;
    const plugId = await resolvePlugNotasId(param);
    if (!plugId) {
      return res.status(404).json({ ok: false, error: 'NF-e não encontrada (id/chave/pedido)' });
    }

    const url = `${getBaseUrl().replace(/\/$/, '')}/nfe/${encodeURIComponent(plugId)}/xml`;
    const r = await axios.get(url, {
      responseType: 'stream',
      headers: { 'X-API-KEY': getApiKey() },
      timeout: Number(process.env.PLUGNOTAS_TIMEOUT || 20000),
    });

    res.setHeader('Content-Type', r.headers['content-type'] || 'application/xml');
    const filename =
      (r.headers['content-disposition']?.match(/filename="?([^"]+)"?/)?.[1]) || `nfe-${plugId}.xml`;
    res.setHeader('Content-Disposition', `attachment; filename="${filename}"`);

    r.data.pipe(res);
  } catch (err) {
    const st = err.response?.status || 500;
    console.error('[NFES] downloadXmlCtrl:', st, err.response?.data || err.message);
    res.status(st).json({ ok: false, error: err.response?.data || err.message });
  }
}

/* ===================================================================== */
/* 🗎 GET /api/nfes/xml/lote → Baixar ZIP com vários XML de NF-e          */
/* ===================================================================== */
export async function downloadXmlLoteCtrl(req, res) {
  try {
    const {
      q = '',

      // status aliases
      status,
      nfeStatus,
      nfe_status,

      // environment aliases
      environment,
      ambiente,

      // date aliases
      dateFrom,
      dateTo,
      dateIni,
      dateFim,
      dataIni,
      dataFim,

      // optional pagination cap override
      limit,
    } = req.query;

    const finalQ = String(q ?? '').trim();

    const finalStatus = (nfeStatus ?? nfe_status ?? status)
      ? String(nfeStatus ?? nfe_status ?? status).trim()
      : undefined;

    const finalEnvironment = (environment ?? ambiente)
      ? String(environment ?? ambiente).trim()
      : undefined;

    const finalDateFrom = (dateFrom ?? dateIni ?? dataIni)
      ? String(dateFrom ?? dateIni ?? dataIni).trim()
      : undefined;

    const finalDateTo = (dateTo ?? dateFim ?? dataFim)
      ? String(dateTo ?? dateFim ?? dataFim).trim()
      : undefined;

    const finalLimit = Math.min(Math.max(Number(limit) || 5000, 1), 10000);

    console.log('[NFES XML LOTE] filtros recebidos:', {
      q: finalQ,
      status: finalStatus,
      environment: finalEnvironment,
      dateFrom: finalDateFrom,
      dateTo: finalDateTo,
    });

    const out = await ordersApi.search({
      q: finalQ,
      limit: finalLimit,
      offset: 0,
      nfeStatus: finalStatus,
      environment: finalEnvironment,
      dateFrom: finalDateFrom,
      dateTo: finalDateTo,
      onlyWithNfe: true,
    });

    if (!out?.ok) {
      return res.status(400).json({
        ok: false,
        error: out.error || 'Erro ao buscar NF-es para download em lote.',
      });
    }

    const rows = out.rows || [];
    if (!rows.length) {
      return res.status(404).json({
        ok: false,
        message: 'Nenhuma NF-e encontrada para os filtros aplicados.',
        filters: {
          q: finalQ,
          status: finalStatus,
          environment: finalEnvironment,
          dateFrom: finalDateFrom,
          dateTo: finalDateTo,
        },
      });
    }

    const { default: JSZip } = await import('jszip');
    const zip = new JSZip();

    for (const row of rows) {
      const orderId = row.order_id || row.id || row.orderId;
      const chave = row.nfe_key || row.chaveAcesso || row.chave_acesso || row.chave || null;
      if (!orderId) continue;

      try {
        const xmlUrl = `${API_BASE_FROM_SERVER}/api/orders/${orderId}/nfe/xml`;
        const resp = await axios.get(xmlUrl, { responseType: 'text' });

        const xmlText =
          typeof resp.data === 'string' ? resp.data : resp.data?.toString?.() || '';

        if (!xmlText) {
          console.warn(`[NFES XML LOTE] XML vazio para order_id=${orderId}.`);
          continue;
        }

        const safeName = (chave ? `${chave}.xml` : `xml_${orderId}.xml`)
          .replace(/[^\w.-]/g, '_');

        zip.file(safeName, xmlText);
      } catch (e) {
        console.error(
          `[NFES XML LOTE] Erro ao processar XML da ordem ${orderId}:`,
          e.message || e,
        );
      }
    }

    const buffer = await zip.generateAsync({ type: 'nodebuffer' });

    res.setHeader('Content-Type', 'application/zip');
    res.setHeader(
      'Content-Disposition',
      `attachment; filename="xmls_nfe_lote_${Date.now()}.zip"`,
    );

    return res.send(buffer);
  } catch (err) {
    console.error('[NFES XML LOTE] EXC:', err);
    return res.status(500).json({ ok: false, error: err.message || err });
  }
}

/* ===================================================================== */
/* 🧪 GET /api/nfes/:id/resumo → Resumo direto (debug rápido)             */
/* ===================================================================== */
export async function getResumoCtrl(req, res) {
  try {
    const id = String(req.params.id || '').trim();
    if (!id) return res.status(400).json({ ok: false, error: 'Parâmetro inválido' });

    const out = await tecnospeedNfeApi.consultarNFe(id);
    if (!out?.ok) {
      const code = out?.status && Number(out.status) >= 400 ? Number(out.status) : 502;
      return res.status(code).json(out);
    }
    return res.json({ ok: true, resumo: out.data });
  } catch (e) {
    return res.status(500).json({ ok: false, error: String(e?.message || e) });
  }
}

/* ===================================================================== */
/* 🧭 GET /api/nfes/diag/:id/ambiente → Compara tpAmb x baseURL           */
/* ===================================================================== */
export async function ambienteDiagnosticoCtrl(req, res) {
  try {
    const raw = String(req.params.id || '').trim();
    if (!raw) return res.status(400).json({ ok: false, error: 'Parâmetro inválido' });

    const isChave = /^\d{44}$/.test(raw);
    const plugId = isChave ? raw : await resolvePlugNotasId(raw);
    if (!plugId) {
      return res.status(404).json({ ok: false, error: 'NF-e não encontrada (id/chave/pedido)' });
    }

    const xmlResp = await tecnospeedNfeApi.obterXml(plugId);
    if (!xmlResp?.ok) {
      const code = xmlResp.status && Number(xmlResp.status) >= 400 ? Number(xmlResp.status) : 502;
      return res.status(code).json({ ok: false, error: xmlResp.error });
    }

    const xml = xmlResp.xml || '';
    const tpAmb = tecnospeedNfeApi.extrairTpAmb(xml);

    const cfg = tecnospeedNfeApi.getEffectiveConfig?.() || {};
    const baseAmb = cfg.ambiente || null;

    const tpAmbMap = { '1': 'PRODUCAO', '2': 'HOMOLOGACAO' };
    const xmlAmb = tpAmbMap[String(tpAmb)] || 'DESCONHECIDO';

    const diverge = !!(xmlAmb && baseAmb && xmlAmb !== baseAmb);

    return res.json({
      ok: true,
      idParam: raw,
      idConsultado: plugId,
      ambienteXml: xmlAmb,
      ambienteBaseURL: baseAmb,
      tpAmb: tpAmb ?? null,
      diverge,
      hint: diverge
        ? 'Ambiente divergente: verifique PLUGNOTAS_BASE_URL e/ou emissão configurada.'
        : 'Ambiente do XML confere com a base utilizada.',
    });
  } catch (e) {
    return res.status(500).json({ ok: false, error: String(e?.message || e) });
  }
}

/* ===================================================================== */
/* ⚙️ GET /api/nfes/debug/env → Config efetiva do conector                */
/* ===================================================================== */
export async function debugEnv(req, res) {
  try {
    const cfg = tecnospeedNfeApi.getEffectiveConfig?.() || {};
    return res.json({ ok: true, ...cfg });
  } catch (e) {
    return res.status(500).json({ ok: false, error: String(e?.message || e) });
  }
}

/* ===================================================================== */
/* 🧪 GET /api/nfes/diag/:id/ambiente (alias diagAmbiente)                */
/* ===================================================================== */
export async function diagAmbiente(req, res) {
  try {
    const param = String(req.params.id || '').trim();
    if (!param) return res.status(400).json({ ok: false, error: 'Parâmetro :id inválido' });

    let plugId = null;
    try {
      plugId = await resolvePlugNotasId(param);
    } catch {
      plugId = null;
    }
    if (!plugId) plugId = param;

    const resumo = await tecnospeedNfeApi.consultarNFe(plugId);
    if (!resumo?.ok || !resumo.data) {
      return res.status(404).json({
        ok: false,
        error: 'NOT_FOUND',
        detail: resumo?.error || 'Resumo não retornou dados',
      });
    }

    let tpAmb = null;
    let ambienteXml = null;

    const flat = typeof resumo.data === 'string' ? resumo.data : JSON.stringify(resumo.data);
    const m = flat.match(/<tpAmb>(\d)<\/tpAmb>/);
    if (m) tpAmb = m[1];

    if (!tpAmb) {
      const tryPaths = [
        ['ide', 'tpAmb'],
        ['NFe', 'infNFe', 'ide', 'tpAmb'],
        ['nfeProc', 'NFe', 'infNFe', 'ide', 'tpAmb'],
      ];
      for (const p of tryPaths) {
        let cur = resumo.data;
        for (const k of p) cur = cur?.[k];
        if (cur) {
          tpAmb = String(cur);
          break;
        }
      }
    }

    if (tpAmb === '1') ambienteXml = 'PRODUCAO';
    else if (tpAmb === '2') ambienteXml = 'HOMOLOGACAO';

    const eff = tecnospeedNfeApi.getEffectiveConfig?.() || {};
    const ambienteBaseURL = eff?.ambiente || null;

    const diverge = !!(ambienteXml && ambienteBaseURL && ambienteXml !== ambienteBaseURL);

    return res.json({
      ok: true,
      idConsultado: plugId,
      tpAmb: tpAmb ?? null,
      ambienteXml: ambienteXml ?? 'DESCONHECIDO',
      ambienteBaseURL,
      diverge,
      hint: diverge
        ? 'Ambiente divergente entre XML e BaseURL. Ajuste o ambiente da empresa na PlugNotas e/ou o token usado.'
        : 'Ambientes coincidem.',
    });
  } catch (e) {
    return res.status(500).json({ ok: false, error: String(e?.message || e) });
  }
}

// ================================
// GET /api/nfes/debug/routes
// ================================
export function listRegisteredRoutes(req, res) {
  try {
    const app = req.app;
    const dump = [];

    function walk(layer, prefix = '') {
      if (layer.route) {
        const methods = Object.keys(layer.route.methods)
          .filter(Boolean)
          .map((m) => m.toUpperCase());
        dump.push({ path: prefix + layer.route.path, methods });
      } else if (layer.name === 'router' && layer.handle.stack) {
        const newPrefix = prefix;
        layer.handle.stack.forEach((l) => walk(l, newPrefix));
      }
    }

    app._router?.stack?.forEach((l) => {
      if (l.name === 'router' && l.regexp && /\\\/api\\\//.test(String(l.regexp))) {
        l.handle.stack.forEach((s) => walk(s, '/api'));
      }
    });

    return res.json({ ok: true, routes: dump });
  } catch (e) {
    return res.status(500).json({ ok: false, error: String(e?.message || e) });
  }
}

/* ===================================================================== */
/* 🧾 GET /api/nfes/report/pdf → Relatório PDF de NF-es                   */
/* ===================================================================== */
export async function exportarRelatorioPdf(req, res) {
  try {
    const {
      q = '',
      status,
      nfeStatus,
      nfe_status,
      dateFrom,
      dateTo,
      dataIni,
      dataFim,
      sortBy = 'pedido',
      sortOrder = 'desc',
    } = req.query;

    const finalStatus = (nfeStatus ?? nfe_status ?? status)
      ? String(nfeStatus ?? nfe_status ?? status).trim()
      : undefined;

    const finalDateFrom = (dateFrom ?? dataIni)
      ? String(dateFrom ?? dataIni).trim()
      : undefined;

    const finalDateTo = (dateTo ?? dataFim)
      ? String(dateTo ?? dataFim).trim()
      : undefined;

    const rows = await buscarNfesParaRelatorio({
      q,
      status: finalStatus,
      dateFrom: finalDateFrom,
      dateTo: finalDateTo,
      sortBy: String(sortBy || 'pedido'),
      sortOrder: String(sortOrder || 'desc'),
    });

    const fileName = `relatorio_nfes_${Date.now()}.pdf`;

    res.setHeader('Content-Type', 'application/pdf');
    res.setHeader('Content-Disposition', `inline; filename="${fileName}"`);

    await generateReportNfesPdf({
      rows,
      filters: {
        q: String(q || '').trim(),
        status: finalStatus || '',
        dataIni: finalDateFrom || '',
        dataFim: finalDateTo || '',
        sortBy: String(sortBy || 'pedido'),
        sortOrder: String(sortOrder || 'desc'),
      },
      output: {
        type: 'response',
        res,
      },
    });
  } catch (err) {
    console.error('[NFES][REPORT PDF] erro:', err);

    if (!res.headersSent) {
      return res.status(500).json({
        ok: false,
        error: err?.message || 'Erro ao gerar relatório PDF de NF-es.',
      });
    }
  }
}

/* ===================================================================== */
/* 📊 GET /api/nfes/report/excel → Relatório Excel de NF-es               */
/* ===================================================================== */
export async function exportarRelatorioExcel(req, res) {
  try {
    const {
      q = '',
      status,
      nfeStatus,
      nfe_status,
      dateFrom,
      dateTo,
      dataIni,
      dataFim,
      sortBy = 'pedido',
      sortOrder = 'desc',
    } = req.query;

    const finalStatus = (nfeStatus ?? nfe_status ?? status)
      ? String(nfeStatus ?? nfe_status ?? status).trim()
      : undefined;

    const finalDateFrom = (dateFrom ?? dataIni)
      ? String(dateFrom ?? dataIni).trim()
      : undefined;

    const finalDateTo = (dateTo ?? dataFim)
      ? String(dateTo ?? dataFim).trim()
      : undefined;

    const rows = await buscarNfesParaRelatorio({
      q,
      status: finalStatus,
      dateFrom: finalDateFrom,
      dateTo: finalDateTo,
      sortBy: String(sortBy || 'pedido'),
      sortOrder: String(sortOrder || 'desc'),
    });

    return await generateNfesExcel({
      rows,
      filters: {
        q: String(q || '').trim(),
        status: finalStatus || '',
        dateFrom: finalDateFrom || '',
        dateTo: finalDateTo || '',
        sortBy: String(sortBy || 'pedido'),
        sortOrder: String(sortOrder || 'desc'),
      },
      res,
    });
  } catch (err) {
    console.error('[NFES][REPORT EXCEL] erro:', err);
    return res.status(500).json({
      ok: false,
      error: err?.message || 'Erro ao gerar relatório Excel de NF-es.',
    });
  }
}