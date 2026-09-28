// ╔══════════════════════════════════════════════════════════════════════╗
// ║ invoicesIssuedController.js — Controller de NF-e Emitidas                                   ║
// ║ CONSART ERP | ESM                                                                           ║
// ║ Downloads XML/DANFE via PlugNotas/TecnoSpeed                                                ║
// ╚══════════════════════════════════════════════════════════════════════╝

import axios from 'axios';

import pool from '../config/db.js';

import invoicesIssuedApi from '../repositories/invoicesIssued/invoicesIssued.index.js';

import { generateDanfeFromXml } from '../services/danfeConsartService.js';

import ordersApi from '../services/apis/orders/ordersApi.js';

import { createAuditLog } from '../services/apis/auditLogsApi.js';

function getRequestUserId(req) {
  const value =
    req.user?.user_id ??
    req.user?.id ??
    req.session?.user?.user_id ??
    req.session?.user?.id ??
    null;

  const id = Number(value);
  return Number.isSafeInteger(id) && id > 0 ? id : null;
}

function getRequestMetadata(req) {
  return {
    ip: req.ip || req.socket?.remoteAddress || null,
    user_agent: req.get?.('user-agent') || null,
  };
}

async function auditInvoiceAction(req, invoice, operation, details = {}) {
  await createAuditLog({
    tabela: 'invoicesIssued',
    register_id: invoice?.invoice_id ?? null,
    operation,
    user_id: getRequestUserId(req),
    before: null,
    after: {
      invoice_id: invoice?.invoice_id ?? null,

      order_id: invoice?.order_id ?? null,
      budget_id: invoice?.budget_id ?? null,
      bonus_id: invoice?.bonus_id ?? null,
      source_type: invoice?.source_type ?? null,

      nfe_number: invoice?.nfe_number ?? null,
      nfe_key: invoice?.nfe_key ?? null,

      nfe_status_id: invoice?.nfe_status_id ?? null,
      nfe_status: invoice?.nfe_status ?? null,
      nfe_status_name: invoice?.nfe_status_name ?? null,

      ...details,
      ...getRequestMetadata(req),
    },
  });
}

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

function sanitizeFilename(name, fallback = 'arquivo') {
  return String(name || fallback)
    .replace(/[\\/:*?"<>|]+/g, '_')
    .replace(/\s+/g, '_')
    .trim();
}

async function resolvePlugNotasIdFromInvoice(invoice) {
  if (!invoice) return null;

  /*
   * Primary source: invoicesIssued.
   * An authorized invoice must use its own provider identifier.
   */
  const invoiceProviderId =
    String(invoice.nfe_provider_id ?? '').trim();

  if (invoiceProviderId) {
    return invoiceProviderId;
  }

  const invoiceAccessKey =
    String(invoice.nfe_key ?? '').replace(/\D/g, '');

  if (invoiceAccessKey.length === 44) {
    return invoiceAccessKey;
  }

  /*
   * Fallback for order invoices that were created before
   * nfe_provider_id was copied into invoicesIssued.
   */
  const orderId = Number(invoice.order_id);

  if (Number.isSafeInteger(orderId) && orderId > 0) {
    const { rows } = await pool.query(
      `
        SELECT
          a.provider_id,
          a.access_key,
          a.integration_id,
          a.provider_response
        FROM public."ordersNfeAttempts" a
        WHERE a.order_id = $1
          AND (
            NULLIF(BTRIM(a.provider_id), '') IS NOT NULL
            OR NULLIF(BTRIM(a.access_key), '') IS NOT NULL
            OR NULLIF(BTRIM(a.integration_id), '') IS NOT NULL
            OR a.provider_response IS NOT NULL
          )
        ORDER BY
          (a.authorized_at IS NOT NULL) DESC,
          a.attempt_number DESC,
          a.attempt_id DESC
        LIMIT 1
      `,
      [orderId],
    );

    const attempt = rows[0];

    const providerResponse = Array.isArray(
      attempt?.provider_response,
    )
      ? attempt.provider_response[0]
      : attempt?.provider_response;

    const identifier = [
      attempt?.provider_id,
      attempt?.access_key,
      providerResponse?.id,
      providerResponse?.chave,
      providerResponse?.chaveAcesso,
      attempt?.integration_id,
      providerResponse?.idIntegracao,
    ].find(
      (value) => String(value ?? '').trim(),
    );

    if (identifier) {
      return String(identifier).trim();
    }
  }

  /*
   * Fallback for budget invoices created before the provider
   * identifier was copied into invoicesIssued.
   */
  const budgetId = Number(invoice.budget_id);

  if (Number.isSafeInteger(budgetId) && budgetId > 0) {
    const { rows } = await pool.query(
      `
        SELECT
          a.provider_id,
          a.access_key,
          a.integration_id,
          a.provider_response
        FROM public."budgetsNfeAttempts" a
        WHERE a.budget_id = $1
          AND (
            NULLIF(BTRIM(a.provider_id), '') IS NOT NULL
            OR NULLIF(BTRIM(a.access_key), '') IS NOT NULL
            OR NULLIF(BTRIM(a.integration_id), '') IS NOT NULL
            OR a.provider_response IS NOT NULL
          )
        ORDER BY
          (a.authorized_at IS NOT NULL) DESC,
          a.attempt_number DESC,
          a.attempt_id DESC
        LIMIT 1
      `,
      [budgetId],
    );

    const attempt = rows[0];

    const providerResponse = Array.isArray(
      attempt?.provider_response,
    )
      ? attempt.provider_response[0]
      : attempt?.provider_response;

    const identifier = [
      attempt?.provider_id,
      attempt?.access_key,
      providerResponse?.id,
      providerResponse?.chave,
      providerResponse?.chaveAcesso,
      attempt?.integration_id,
      providerResponse?.idIntegracao,
    ].find(
      (value) => String(value ?? '').trim(),
    );

    if (identifier) {
      return String(identifier).trim();
    }
  }

  return null;
}

async function streamPlugNotasFile({
  res,
  plugId,
  kind,
  filename,
  contentType,
  onReady = null,
}) {
  const base = getBaseUrl().replace(/\/$/, '');
  const url = `${base}/nfe/${encodeURIComponent(plugId)}/${kind}`;

  const apiKey = getApiKey();

  if (!apiKey) {
    return res.status(500).json({
      ok: false,
      error: 'API Key PlugNotas/TecnoSpeed não configurada no .env',
    });
  }

  const response = await axios.get(url, {
    responseType: 'stream',
    headers: {
      'X-API-KEY': apiKey,
    },
    timeout: Number(process.env.PLUGNOTAS_TIMEOUT || 20000),
  });

  if (typeof onReady === 'function') {
    await onReady();
  }

  const headerFilename =
    response.headers['content-disposition']
      ?.match(/filename="?([^"]+)"?/i)
    ?.[1];

  res.setHeader(
    'Content-Type',
    response.headers['content-type'] || contentType
  );

  res.setHeader(
    'Content-Disposition',
    `attachment; filename="${sanitizeFilename(headerFilename || filename)}"`
  );

  return response.data.pipe(res);
}

async function getPlugNotasFileBuffer({ plugId, kind }) {
  const base = getBaseUrl().replace(/\/$/, '');
  const url = `${base}/nfe/${encodeURIComponent(plugId)}/${kind}`;

  const apiKey = getApiKey();

  if (!apiKey) {
    throw new Error('API Key PlugNotas/TecnoSpeed não configurada no .env');
  }

  const response = await axios.get(url, {
    responseType: 'arraybuffer',
    headers: {
      'X-API-KEY': apiKey,
    },
    timeout: Number(process.env.PLUGNOTAS_TIMEOUT || 20000),
  });

  return Buffer.from(response.data);
}

export async function initInvoicesIssuedController() {
  try {
    await invoicesIssuedApi.ensureTable();
    console.log('[InvoicesIssued] tabela validada.');
  } catch (err) {
    console.error('[initInvoicesIssuedController] ERR:', err?.message || err);
  }
}

export async function createInvoiceIssued(req, res) {
  try {
    const out = await invoicesIssuedApi.create(req.body || {}, {
      userId: getRequestUserId(req),
    });
    return res.status(out.ok ? 201 : 400).json(out);
  } catch (err) {
    console.error('[createInvoiceIssued] EXC:', err);
    return res.status(500).json({
      ok: false,
      error: String(err?.message || err),
    });
  }
}

export async function syncInvoiceFromOrder(req, res) {
  try {
    const orderId = Number(req.params.orderId || req.body?.order_id);

    if (!Number.isFinite(orderId) || orderId <= 0) {
      return res.status(400).json({
        ok: false,
        error: 'order_id inválido',
      });
    }

    const out = await invoicesIssuedApi.upsertFromOrder(orderId, {
      userId: getRequestUserId(req),
    });
    return res.status(out.ok ? 200 : 400).json(out);
  } catch (err) {
    console.error('[syncInvoiceFromOrder] EXC:', err);
    return res.status(500).json({
      ok: false,
      error: String(err?.message || err),
    });
  }
}

export async function syncAllFaturadasFromOrders(req, res) {
  try {
    const out = await invoicesIssuedApi.syncFaturadasFromOrders({
      userId: getRequestUserId(req),
    });
    return res.status(200).json(out);
  } catch (err) {
    console.error('[syncAllFaturadasFromOrders] EXC:', err);
    return res.status(500).json({
      ok: false,
      error: String(err?.message || err),
    });
  }
}

export async function getInvoicesIssuedKpis(req, res) {
  try {
    const out = await invoicesIssuedApi.getKpis();

    return res
      .status(out.ok ? 200 : 400)
      .json(out);

  } catch (err) {
    console.error(
      '[getInvoicesIssuedKpis] EXC:',
      err
    );

    return res.status(500).json({
      ok: false,
      error: String(err?.message || err),
    });
  }
}

export async function searchInvoicesIssued(req, res) {
  try {
    const {
      q = '',
      status,
      dateFrom,
      dateTo,

      // Sorting
      sortBy = 'issued_date',
      sortDirection = 'desc',

      limit = 50,
      offset = 0,
    } = req.query;

    // ================================================================
    // Sync only when searching a specific order
    // ================================================================

    const qClean = String(q || '').trim();

    if (/^\d+$/.test(qClean)) {
      try {
        await invoicesIssuedApi.upsertFromOrder(
          Number(qClean),
          {
            userId: getRequestUserId(req),
          }
        );
      } catch (syncErr) {
        console.warn(
          '[searchInvoicesIssued] upsertFromOrder falhou:',
          syncErr?.message || syncErr
        );
      }
    }

    // ================================================================
    // SEARCH
    // ================================================================

    const out = await invoicesIssuedApi.search({
      q,
      status,
      dateFrom,
      dateTo,

      sortBy,
      sortDirection,

      limit: Number(limit) || 50,
      offset: Number(offset) || 0,
    });

    return res
      .status(out.ok ? 200 : 400)
      .json(out);

  } catch (err) {

    console.error(
      '[searchInvoicesIssued] EXC:',
      err
    );

    return res.status(500).json({
      ok: false,
      error: String(err?.message || err),
    });
  }
}

export async function getInvoiceIssuedById(req, res) {
  try {
    const id = Number(req.params.id);

    if (!Number.isFinite(id) || id <= 0) {
      return res.status(400).json({
        ok: false,
        error: 'invoice_id inválido',
      });
    }

    const out = await invoicesIssuedApi.getById(id);

    if (!out.ok && out.error === 'NOT_FOUND') {
      return res.status(404).json(out);
    }

    return res.status(out.ok ? 200 : 400).json(out);
  } catch (err) {
    console.error('[getInvoiceIssuedById] EXC:', err);
    return res.status(500).json({
      ok: false,
      error: String(err?.message || err),
    });
  }
}

export async function getInvoicesByOrderId(req, res) {
  try {
    const orderId = Number(req.params.orderId);

    if (!Number.isFinite(orderId) || orderId <= 0) {
      return res.status(400).json({
        ok: false,
        error: 'order_id inválido',
      });
    }

    const out = await invoicesIssuedApi.getByOrderId(orderId);
    return res.status(out.ok ? 200 : 400).json(out);
  } catch (err) {
    console.error('[getInvoicesByOrderId] EXC:', err);
    return res.status(500).json({
      ok: false,
      error: String(err?.message || err),
    });
  }
}

export async function updateInvoiceIssued(req, res) {
  try {
    const id = Number(req.params.id);

    if (!Number.isFinite(id) || id <= 0) {
      return res.status(400).json({
        ok: false,
        error: 'invoice_id inválido',
      });
    }

    const out = await invoicesIssuedApi.update(id, req.body || {}, {
      userId: getRequestUserId(req),
    });

    if (!out.ok && out.error === 'NOT_FOUND') {
      return res.status(404).json(out);
    }

    return res.status(out.ok ? 200 : 400).json(out);
  } catch (err) {
    console.error('[updateInvoiceIssued] EXC:', err);
    return res.status(500).json({
      ok: false,
      error: String(err?.message || err),
    });
  }
}

export async function cancelInvoiceIssued(req, res) {
  try {
    const id = Number(req.params.id);
    const reason =
      req.body?.reason ||
      req.body?.cancellation_reason ||
      null;

    if (!Number.isFinite(id) || id <= 0) {
      return res.status(400).json({
        ok: false,
        error: 'invoice_id inválido',
      });
    }

    const out = await invoicesIssuedApi.cancel(id, reason, {
      userId: getRequestUserId(req),
    });

    if (!out.ok && out.error === 'NOT_FOUND') {
      return res.status(404).json(out);
    }

    return res.status(out.ok ? 200 : 400).json(out);
  } catch (err) {
    console.error('[cancelInvoiceIssued] EXC:', err);
    return res.status(500).json({
      ok: false,
      error: String(err?.message || err),
    });
  }
}

export async function deleteInvoiceIssued(req, res) {
  try {
    const id = Number(req.params.id);

    if (!Number.isFinite(id) || id <= 0) {
      return res.status(400).json({
        ok: false,
        error: 'invoice_id inválido',
      });
    }

    const out = await invoicesIssuedApi.remove(id, {
      userId: getRequestUserId(req),
    });
    return res.status(out.ok ? 200 : 400).json(out);
  } catch (err) {
    console.error('[deleteInvoiceIssued] EXC:', err);
    return res.status(500).json({
      ok: false,
      error: String(err?.message || err),
    });
  }
}

/* ╔══════════════════════════════════════════════════════════════════╗
   ║ DOWNLOAD XML — via PlugNotas/TecnoSpeed                         ║
   ╚══════════════════════════════════════════════════════════════════╝ */

export async function downloadInvoiceXml(req, res) {
  try {
    const id = Number(req.params.id);

    if (!Number.isFinite(id) || id <= 0) {
      return res.status(400).json({
        ok: false,
        error: 'invoice_id inválido',
      });
    }

    const out = await invoicesIssuedApi.getById(id);

    if (!out?.ok || !out.invoice) {
      return res.status(404).json({
        ok: false,
        error: 'NF-e não encontrada',
      });
    }

    const invoice = out.invoice;
    const plugId = await resolvePlugNotasIdFromInvoice(invoice);

    if (!plugId) {
      return res.status(404).json({
        ok: false,
        error:
          'NF-e sem nfe_provider_id, chave de acesso ou tentativa rastreável',
      });
    }

    return await streamPlugNotasFile({
      res,
      plugId,
      kind: 'xml',
      filename: `nfe-${invoice.nfe_number || invoice.invoice_id}.xml`,
      contentType: 'application/xml; charset=utf-8',
      onReady: () =>
        auditInvoiceAction(req, invoice, 'XML_DOWNLOAD', {
          source: 'PlugNotas/TecnoSpeed',
        }),
    });
  } catch (err) {
    const status = err.response?.status || 500;
    console.error(
      '[downloadInvoiceXml] EXC:',
      status,
      err.response?.data || err.message || err
    );

    return res.status(status).json({
      ok: false,
      error: err.response?.data || err.message || String(err),
    });
  }
}

/* ╔══════════════════════════════════════════════════════════════════╗
   ║ DOWNLOAD DANFE PDF — via PlugNotas/TecnoSpeed                   ║
   ╚══════════════════════════════════════════════════════════════════╝ */

export async function downloadInvoiceDanfe(req, res) {
  try {
    const id = Number(req.params.id);

    if (!Number.isFinite(id) || id <= 0) {
      return res.status(400).json({
        ok: false,
        error: 'invoice_id inválido',
      });
    }

    const out = await invoicesIssuedApi.getById(id);

    if (!out?.ok || !out.invoice) {
      return res.status(404).json({
        ok: false,
        error: 'NF-e não encontrada',
      });
    }

    const invoice = out.invoice;
    const plugId = await resolvePlugNotasIdFromInvoice(invoice);

    if (!plugId) {
      return res.status(404).json({
        ok: false,
        error:
          'NF-e sem nfe_provider_id, chave de acesso ou tentativa rastreável',
      });
    }

    // 1) Baixa o XML da PlugNotas/TecnoSpeed
    const xmlBuffer = await getPlugNotasFileBuffer({
      plugId,
      kind: 'xml',
    });

    const xmlContent = xmlBuffer.toString('utf8');

    // 2) Gera o PDF pelo layout CONSART
    // ----------------------------------------------------------------------
    // Load complete order information
    // ----------------------------------------------------------------------

    let orderData = null;

    if (invoice.order_id) {
      orderData = await ordersApi.getById(invoice.order_id);
    }

    const danfeResult = await generateDanfeFromXml({
      numero: invoice.nfe_number,
      chave: invoice.nfe_key,
      xmlContent,

      prot: {
        status: invoice.nfe_status,
        nfe_status: invoice.nfe_status,
        nProt: invoice.nfe_protocol,
      },

      complementaryInfo:
        orderData?.header?.complementary_info ||
        orderData?.header?.notes ||
        null,

      paymentText:
        orderData?.payment_observation ||
        null,

      orderItems:
        Array.isArray(orderData?.items)
          ? orderData.items
          : [],

      orderPayments:
        Array.isArray(orderData?.payments)
          ? orderData.payments
          : [],

      orderInstallments:
        Array.isArray(orderData?.installments)
          ? orderData.installments
          : [],

      orderDuplicatas:
        Array.isArray(orderData?.duplicatas)
          ? orderData.duplicatas
          : [],

      orderShipping:
        orderData?.shipping || null,
    });

    const pdfBuffer =
      danfeResult?.buffer ||
      danfeResult?.pdfBuffer ||
      danfeResult;

    await auditInvoiceAction(req, invoice, 'DANFE_DOWNLOAD', {
      source: 'CONSART_DANFE',
    });

    const filename = sanitizeFilename(
      `danfe-consart-${invoice.nfe_number || invoice.invoice_id}.pdf`
    );

    res.setHeader('Content-Type', 'application/pdf');
    res.setHeader(
      'Content-Disposition',
      `attachment; filename="${filename}"`
    );
    res.setHeader('Content-Length', pdfBuffer.length);

    return res.end(pdfBuffer);
  } catch (err) {
    const status = err.response?.status || 500;

    console.error(
      '[downloadInvoiceDanfe CONSART] EXC:',
      status,
      err.response?.data || err.message || err
    );

    return res.status(status).json({
      ok: false,
      error: err.response?.data || err.message || String(err),
    });
  }
}

import archiver from 'archiver';

async function searchInvoicesForDownload(req) {
  const {
    q = '',
    status,
    dateFrom,
    dateTo,
  } = req.query;

  return invoicesIssuedApi.search({
    q,
    status,
    dateFrom,
    dateTo,
    limit: 5000,
    offset: 0,
  });
}

export async function downloadInvoicesXmlZip(req, res) {
  try {
    const out = await searchInvoicesForDownload(req);

    if (!out.ok || !out.rows?.length) {
      return res.status(404).json({
        ok: false,
        error: 'Nenhuma NF-e encontrada para os filtros informados.',
      });
    }

    res.setHeader('Content-Type', 'application/zip');
    res.setHeader(
      'Content-Disposition',
      `attachment; filename="nfe-xmls-${Date.now()}.zip"`
    );

    const archive = archiver('zip', { zlib: { level: 9 } });
    archive.pipe(res);
    let generatedCount = 0;

    for (const invoice of out.rows) {
      try {
        const plugId = await resolvePlugNotasIdFromInvoice(invoice);
        if (!plugId) continue;

        const xmlBuffer = await getPlugNotasFileBuffer({
          plugId,
          kind: 'xml',
        });

        const filename = sanitizeFilename(
          `nfe-${invoice.nfe_number || invoice.invoice_id}.xml`
        );

        archive.append(xmlBuffer, { name: filename });
        generatedCount++;
      } catch (err) {
        console.error('[downloadInvoicesXmlZip][ITEM_ERROR]', {
          invoice_id: invoice.invoice_id,
          error: err?.message || err,
        });
      }
    }

    await createAuditLog({
      tabela: 'invoicesIssued',
      register_id: null,
      operation: 'XML_BULK_DOWNLOAD',
      user_id: getRequestUserId(req),
      before: null,
      after: {
        filters: {
          q: req.query.q || '',
          status: req.query.status || null,
          dateFrom: req.query.dateFrom || null,
          dateTo: req.query.dateTo || null,
        },
        requested_count: out.rows.length,
        generated_count: generatedCount,
        ...getRequestMetadata(req),
      },
    });

    await archive.finalize();
  } catch (err) {
    console.error('[downloadInvoicesXmlZip] EXC:', err);
    return res.status(500).json({
      ok: false,
      error: String(err?.message || err),
    });
  }
}

export async function downloadInvoicesDanfeZip(req, res) {
  try {
    const out = await searchInvoicesForDownload(req);

    if (!out.ok || !out.rows?.length) {
      return res.status(404).json({
        ok: false,
        error: 'Nenhuma NF-e encontrada para os filtros informados.',
      });
    }

    res.setHeader('Content-Type', 'application/zip');
    res.setHeader(
      'Content-Disposition',
      `attachment; filename="nfe-danfes-${Date.now()}.zip"`
    );

    const archive = archiver('zip', { zlib: { level: 9 } });
    archive.pipe(res);
    let generatedCount = 0;

    for (const invoice of out.rows) {
      try {
        const plugId = await resolvePlugNotasIdFromInvoice(invoice);
        if (!plugId) continue;

        const xmlBuffer = await getPlugNotasFileBuffer({
          plugId,
          kind: 'xml',
        });

        const xmlContent = xmlBuffer.toString('utf8');

        // ----------------------------------------------------------------------
        // Load complete order information
        // ----------------------------------------------------------------------

        let orderData = null;

        if (invoice.order_id) {
          orderData = await ordersApi.getById(invoice.order_id);
        }

        const danfeResult = await generateDanfeFromXml({
          numero: invoice.nfe_number,
          chave: invoice.nfe_key,
          xmlContent,

          prot: {
            status: invoice.nfe_status,
            nfe_status: invoice.nfe_status,
            nProt: invoice.nfe_protocol,
          },

          complementaryInfo:
            orderData?.header?.complementary_info ||
            orderData?.header?.notes ||
            null,

          paymentText:
            orderData?.payment_observation ||
            null,

          orderItems:
            Array.isArray(orderData?.items)
              ? orderData.items
              : [],

          orderPayments:
            Array.isArray(orderData?.payments)
              ? orderData.payments
              : [],

          orderInstallments:
            Array.isArray(orderData?.installments)
              ? orderData.installments
              : [],

          orderDuplicatas:
            Array.isArray(orderData?.duplicatas)
              ? orderData.duplicatas
              : [],

          orderShipping:
            orderData?.shipping || null,
        });

        const pdfBuffer =
          danfeResult?.buffer ||
          danfeResult?.pdfBuffer ||
          danfeResult;

        const filename = sanitizeFilename(
          `danfe-${invoice.nfe_number || invoice.invoice_id}.pdf`
        );

        archive.append(pdfBuffer, { name: filename });
        generatedCount++;
      } catch (err) {
        console.error('[downloadInvoicesDanfeZip][ITEM_ERROR]', {
          invoice_id: invoice.invoice_id,
          error: err?.message || err,
        });
      }
    }

    await createAuditLog({
      tabela: 'invoicesIssued',
      register_id: null,
      operation: 'DANFE_BULK_DOWNLOAD',
      user_id: getRequestUserId(req),
      before: null,
      after: {
        filters: {
          q: req.query.q || '',
          status: req.query.status || null,
          dateFrom: req.query.dateFrom || null,
          dateTo: req.query.dateTo || null,
        },
        requested_count: out.rows.length,
        generated_count: generatedCount,
        ...getRequestMetadata(req),
      },
    });

    await archive.finalize();
  } catch (err) {
    console.error('[downloadInvoicesDanfeZip] EXC:', err);
    return res.status(500).json({
      ok: false,
      error: String(err?.message || err),
    });
  }
}

export async function finishInvoiceFromOrder(req, res) {
  try {
    const orderId = Number(req.params.orderId);

    if (!Number.isFinite(orderId) || orderId <= 0) {
      return res.status(400).json({
        ok: false,
        error: 'order_id inválido',
      });
    }

    await fetch(`http://localhost:8080/api/nfes/reconcile/${orderId}`, {
      method: 'POST',
      headers: { Accept: 'application/json' },
    });

    const out = await invoicesIssuedApi.upsertFromOrder(orderId, {
      userId: getRequestUserId(req),
    });

    return res.status(out.ok ? 200 : 400).json(out);
  } catch (err) {
    return res.status(500).json({
      ok: false,
      error: String(err?.message || err),
    });
  }
}
